# Fluxo de Dados

## Visão Geral

O frontend monta o dashboard em `frontend/app.js`, compartilha uma instância de `createApiClient()` e inicializa o controller do Planejador quando o módulo `content-planner` está ativo.

O fluxo persistente do Planejador é:

```text
Frontend Planner
  -> frontend/src/api/client.js
    -> /api/operators/planner/conversations
      -> PlannerService
        -> ConversationRepository / MessageRepository
          -> Prisma Client
            -> SQLite
```

As rotas fazem validação HTTP e delegam ao `PlannerService`. O serviço aplica regras de domínio e usa repositories; não há acesso Prisma direto pelo frontend ou pelas rotas.

Para geração inteligente, o serviço também usa uma fronteira independente do fornecedor:

```text
Conversation.context + mensagens persistidas
  -> PlannerLanguageInput
    -> LanguageProvider
      -> OpenAILanguageProvider (Responses API)
        -> texto normalizado
          -> MessageRepository (sender: "operator")
            -> Prisma -> SQLite
```

## Inicialização do Planner

1. `dashboard.js` monta o módulo ativo pelo contrato de lifecycle e chama `plannerController.mount(container, context)`.
2. O controller chama `GET /api/operators/planner/conversations` para carregar o histórico persistido.
3. Se o `activeConversationId` em memória ainda existir na lista, ele é reutilizado.
4. Sem uma conversa ativa válida, o controller escolhe a primeira conversa retornada pelo backend.
5. Se o histórico estiver vazio, chama `POST /api/operators/planner/conversations` e cria uma conversa automaticamente.
6. A conversa escolhida é aberta com `GET /api/operators/planner/conversations/:id`.
7. Mensagens e `context` retornados são renderizados como estado da conversa ativa.

`activeConversationId` existe somente no controller durante a execução. Ele não é persistido em `localStorage`; após recarregar toda a página, a seleção volta a seguir a ordenação retornada pelo backend.

## Histórico e Nova Conversa

- O histórico usa a listagem real da API e preserva sua ordenação.
- Cada item contém o ID necessário para abrir a conversa e indica visualmente a conversa ativa.
- O controle **Nova Conversa** chama o endpoint de criação uma única vez enquanto a operação está em andamento.
- Após sucesso, a conversa criada se torna ativa, a área de mensagens é limpa e o histórico é atualizado.
- Falhas não criam uma conversa apenas visual nem substituem a conversa ativa.

## Troca de Conversa

1. O usuário seleciona um item do histórico.
2. O controller solicita a conversa completa por ID.
3. Somente uma resposta ainda atual pode alterar `activeConversationId`.
4. As mensagens e o contexto anteriores são substituídos pelos dados da conversa selecionada.

As mensagens de conversas diferentes nunca são combinadas no mesmo painel.

## Persistência de Mensagens

1. O usuário envia texto pelo botão ou por `Enter`; `Shift+Enter` permanece disponível para quebra de linha.
2. O frontend chama `POST /api/operators/planner/conversations/:id/messages` com `sender: "user"` e `text`.
3. A rota valida o payload e delega a criação ao `PlannerService`.
4. O serviço confirma que a conversa existe e usa `MessageRepository`.
5. Prisma grava a mensagem no SQLite.
6. O frontend acrescenta a mensagem ao chat somente depois da resposta `201`.
7. O frontend chama `POST /api/operators/planner/conversations/:id/reply` exatamente uma vez.
8. `PlannerService.generateReply()` carrega a conversa completa e mapeia contexto e histórico cronológico para a entrada neutra.
9. O `LanguageProvider` gera texto sem persistir dados diretamente.
10. O serviço valida a saída e usa `MessageRepository` para persistir uma única mensagem `operator`.
11. A rota retorna `201` somente com a mensagem persistida; então o frontend a renderiza depois da mensagem `user`.

Se a geração falhar, a mensagem `user` permanece persistida e nenhuma mensagem `operator` falsa é criada. Um novo envio fica bloqueado durante a geração atual para evitar respostas duplicadas.

## Entrada e Limites de Linguagem

- `Conversation.context` é enviado como instrução, limitado a 4.000 caracteres.
- O histórico preserva ordem cronológica, roles `user`, `operator` e `system`, as 30 mensagens mais recentes e até 16.000 caracteres.
- `operator` é convertido em `assistant` apenas dentro do adapter OpenAI.
- A saída é limitada a 4.000 caracteres e a estimativa conservadora de quatro caracteres por token aplica `max_output_tokens: 1000`.
- `OPENAI_MODEL` configura o modelo; quando ausente, o adapter usa `gpt-5-mini`.
- A chave é lida de `OPENAI_API_KEY` somente quando `generate()` é chamado. Sua ausência não impede o startup.

## Persistência de Contexto

- O editor de Prompt Base representa `Conversation.context` da conversa ativa.
- Ao abrir ou trocar de conversa, o frontend restaura o valor retornado pela API.
- Ao perder foco após uma alteração, o editor chama `PATCH /api/operators/planner/conversations/:id/context`.
- Texto vazio ou somente com espaços limpa o campo, que passa a ser `null`.
- Se a atualização falhar, o editor restaura o último valor confirmado e não apresenta a alteração como salva.
- Não existe mais dependência de `localStorage["planner.prompt.base"]`.

## Biblioteca de Artefatos

O salvamento de uma resposta usa somente identificadores enviados pelo frontend:

```text
Planner -> API client
  -> POST /api/operators/planner/conversations/:conversationId/messages/:messageId/library
    -> LibraryService
      -> ConversationRepository + MessageRepository
        -> valida conversa, pertencimento e sender "operator"
          -> LibraryItemRepository
            -> Prisma -> SQLite
```

O conteúdo do artefato é sempre copiado da mensagem persistida pelo backend. Mensagens `user` ou `system`, mensagens ausentes e mensagens de outra conversa são rejeitadas antes da criação.

`LibraryItem.sourceMessageId` identifica a origem com unicidade persistente. A primeira chamada cria o item e retorna `201`; chamadas posteriores retornam `200` com o mesmo item. Se chamadas concorrentes atravessarem a consulta inicial, a constraint única produz um conflito tratado pelo serviço, que busca e retorna o item já criado.

Ao montar o Planner, o frontend chama `GET /api/operators/planner/library`. A lista preserva a ordenação do backend e mostra um estado vazio quando necessário. Após salvar, a lista é recarregada da API. A abertura chama `GET /api/operators/planner/library/:id`, mantém o artefato separado das mensagens e usa `textContent` para título e conteúdo.

Listagens, aberturas e salvamentos usam tokens de montagem/operação. Respostas tardias depois de unmount, troca de conversa ou seleção de outro item são ignoradas e não criam estado visual falso.

## Memória Ativa — Sprint 17

**Status: concluída.**

O contrato neutro aceita artefatos limitados e o schema persiste o vínculo por `ConversationLibraryItem`. Repository, service, API, API client e UI vinculam, listam e desvinculam com validação, idempotência e limite de cinco. `PlannerService.generateReply()` carrega somente os itens vinculados antes de montar a entrada neutra.

O usuário selecionará explicitamente itens já persistidos para a conversa ativa:

```text
Frontend envia conversationId + libraryItemId
  -> API do Planner
    -> serviço valida Conversation e LibraryItem
      -> ConversationLibraryItem persiste o vínculo
```

O frontend nunca envia título ou conteúdo como fonte da memória. Listagem e remoção também são resolvidas pelos IDs persistidos. A criação do vínculo é idempotente e uma conversa não observa vínculos pertencentes a outra.

No domínio já implementado, a criação limitada ocorre em um único statement de escrita parametrizado. Vínculo repetido retorna o item existente sem consumir limite; o sexto item diferente é rejeitado; remover um vínculo libera uma vaga. A listagem resolve os `LibraryItem` persistidos em `createdAt ASC` e `libraryItemId ASC`.

Na geração, o fluxo implementado é:

```text
Conversation.context
  + mensagens cronológicas
  + LibraryItems explicitamente vinculados
    -> mapper neutro e limites determinísticos
      -> LanguageProvider.generate(input)
        -> resposta operator persistida
```

Os artefatos são carregados pela data do vínculo crescente, com ID como desempate. São aceitos no máximo cinco vínculos ativos, limitados a 4.000 caracteres por conteúdo e 12.000 caracteres totais por geração. O mapper trunca o último item ao orçamento restante e omite os posteriores. Os limites atuais de contexto, histórico e saída permanecem inalterados.

Conteúdo de artefato é tratado como referência não confiável. Troca de conversa, Nova Conversa, seleções rápidas e unmount invalidam respostas assíncronas antigas antes de qualquer atualização visual.

## Respostas Assíncronas Obsoletas

O controller usa uma geração de montagem e tokens por operação:

- navegar para outro módulo invalida a montagem anterior;
- remontar o Planner cria uma nova geração;
- trocas, criações, envios, gerações e atualizações de contexto verificam se sua requisição ainda é atual;
- mensagens e contextos também verificam o ID da conversa capturado no início da operação.

Respostas antigas são ignoradas silenciosamente e não alteram conversa ativa, mensagens, contexto, histórico ou feedback visual.

## Tratamento Visual de Erros

O Planner possui uma região de status com `role="status"` e `aria-live="polite"`. Ela mostra mensagens curtas para falhas de:

- inicialização;
- criação de conversa;
- atualização do histórico;
- troca de conversa;
- envio de mensagem;
- geração de resposta inteligente;
- salvamento de contexto.
- carregamento, salvamento e abertura da Biblioteca.

O feedback não expõe payloads, stack traces ou detalhes internos. Uma ação posterior bem-sucedida limpa a mensagem correspondente.

## Testes do Fluxo

`npm test`, executado em `backend/`, cobre APIs reais com Prisma e SQLite em memória, providers/clients injetáveis, migrations e controllers frontend com DOM controlado. As 439 verificações atuais não dependem de OAuth, YouTube, OpenAI real, chave, rede externa ou `dev.db`.

Permanece pendente, sem bloquear a Sprint, um smoke test manual com `OPENAI_API_KEY` válida para confirmar uma chamada real HTTP `201`. Chave, prompt e resposta do teste não devem ser registrados na documentação.

## Creator Intelligence

```text
Cliente/Planner
  -> endpoints Creator Intelligence
    -> CreatorIntelligenceService
      -> ResearchProvider[]
        -> InternalHistoryResearchProvider
          -> PerformanceSignalRepository
      -> IdeaEvaluationService
      -> ContentDecisionRepository
      -> Prisma -> SQLite
```

### Registro e avaliação

1. O cliente registra jogo opcional, tema, formato, premissa e estimativas básicas.
2. O serviço valida e persiste a `VideoIdea`.
3. Cada `ResearchProvider` recebe a ideia persistida.
4. O provider interno seleciona sinais relacionados à ideia, jogo ou formato.
5. O avaliador combina somente fatores conhecidos e mantém lacunas como `unknown`.
6. A decisão é persistida com snapshot das evidências.

### Ranking, memória e Planner

O ranking usa score decrescente e ID como desempate. `ChannelMemoryService` deriva aprendizados por jogo, série, formato, watch time, retenção e conversão, atualizando a mesma memória por `upsert` ou invalidando evidência obsoleta. O Planner consulta o domínio pela interface `PlannerEditorialIntelligenceProvider`; o `LanguageProvider` permanece independente.

`buildContext()` seleciona estado do canal, histórico relevante, ideias, oportunidades, decisões e restrições sem despejar o banco inteiro. A Sprint não injeta esse objeto automaticamente no prompt.

## Performance Intelligence — Sprint 19

```text
PerformanceProvider (manual ou YouTube Analytics)
  -> PerformanceNormalizer
    -> VideoPerformanceSnapshotRepository
      -> snapshot idempotente no SQLite
        -> PerformanceBaselineService
          -> PerformanceSignalRepository
            -> ChannelMemoryService
              -> IdeaEvaluationService
                -> ContentDecision com evidências
```

O provider entrega campos brutos; o normalizador valida tipos, datas, percentuais e valores não negativos. Campo indisponível permanece `null`. A fonte é definida pelo provider, não pelo payload do cliente. A chave de ingestão usa fonte, vídeo e período, permitindo atualizar o mesmo registro sem duplicá-lo.

O baseline usa somente snapshots do mesmo projeto e calcula média, mediana e amostragem. Sinais com score relativo são criados apenas quando a métrica observada e sua referência existem. O baseline do próprio canal equivale a 50/100; o score é comparação interna e nunca previsão de views.

`ChannelMemoryService` converte evidências em inferências revisáveis. Cada aprendizado registra IDs de snapshots ou métricas agregadas, amostra e baseline. Se uma dimensão deixa de ter suporte nos dados atuais, o aprendizado estável é invalidado com classificação `unknown` e confiança zero.

Responsabilidades permanecem separadas:

- `LibraryItem`: conteúdo/artefato persistido e reutilizável;
- `ConversationLibraryItem`: seleção explícita de conteúdo para uma conversa;
- `PerformanceSignal`: evidência quantitativa normalizada;
- `ChannelInsight`: aprendizado estruturado, derivado e revisável;
- `ContentDecision`: recomendação persistida com score, confiança, evidências, riscos e lacunas.

O Planner consulta aprendizados e recomendações pela interface de Creator Intelligence. Não recebe dados externos inexistentes e não transforma artefatos da Biblioteca em métricas de canal.

## YouTube Analytics Performance Provider — Sprint 20

```text
OAuth Google existente
  -> YouTubePerformanceSyncService
    -> YouTubeAnalyticsPerformanceProvider
      -> YouTube Analytics API (métricas por vídeo/período)
      -> YouTubeVideoMetadataService
        -> YouTube Data API (título, publicação e duração)
    -> PerformanceIngestionService
      -> VideoPerformanceSnapshotRepository
      -> PerformanceSignalRepository
    -> ChannelMemoryService
      -> baseline/memória/evidências da Creator Intelligence
```

O serviço suporta sincronização explícita por vídeo, lista recente ou período, com limite de 1 a 50 resultados. Não há job recorrente nem polling. A Data API é consultada somente para metadados e para localizar uploads recentes.

O provider solicita somente métricas permitidas; nenhuma IA participa da coleta. Campos ausentes permanecem `null`; impressões e CTR não são calculadas a partir de views. Falhas de OAuth, quota, timeout e API são convertidas em erros de domínio seguros antes da rota.

O timestamp da última sincronização é derivado do snapshot persistido mais recente com `source = youtube-analytics`. O Supervisor lê esse estado sem impedir a inicialização do Dashboard em caso de indisponibilidade temporária.

## Performance Operations UI — Sprint 21

```text
Analytics workspace
  -> createApiClient()
    -> status + last-sync + records + baseline + signals + learnings + context
    -> POST sync manual
      -> YouTubePerformanceSyncService
        -> YouTube Analytics/Data APIs
        -> PerformanceIngestionService
          -> snapshots + signals + ChannelMemory
    -> nova leitura dos dados persistidos
      -> cards + baseline + sinais + memória + evidências
```

A montagem carrega as seções em paralelo com `Promise.allSettled`, permitindo que dados válidos continuem visíveis quando uma consulta independente falha. O formulário aceita modos recentes, período e vídeo; impede submissões concorrentes e não inicia polling.

Depois de uma sincronização bem-sucedida, a UI recarrega o backend em vez de inventar resultados locais. Se essa atualização parcial falhar, o sucesso da coleta e a indisponibilidade de painéis são informados separadamente. Respostas tardias de montagem, sincronização ou seleção de evidência são ignoradas por tokens locais de geração.

Métricas ausentes permanecem `null` no backend e aparecem como `—` na interface. Sinais e aprendizados exibem classificação e confiança; evidências de decisão exibem justificativa, componentes, riscos e dados ausentes sem apresentar JSON cru.

## Editorial Decision Loop — Sprint 22

```text
YouTube Analytics/Data API
  -> VideoPerformanceSnapshot
    -> baseline + PerformanceSignal
      -> ChannelMemory
        -> EditorialDecisionService
          -> EditorialDecision
            -> Planner / Supervisor
              -> outcomeSnapshot futuro
                -> avaliação + aprendizado
```

### Geração

1. O Planner persiste a mensagem `user` como antes.
2. `PlannerService.generateReply()` verifica a última pergunta com o classificador editorial.
3. Perguntas editoriais são delegadas ao `EditorialDecisionService`; conversa geral continua no `LanguageProvider`.
4. O serviço carrega contexto, ideias, baseline, sinais, aprendizados, snapshots e decisões anteriores do mesmo escopo.
5. Evidências são reduzidas aos limites do domínio e classificadas como fato, inferência ou recomendação.
6. A decisão é persistida antes de compor a mensagem `operator`.
7. A mensagem persistida recebe o vínculo da decisão e só então é retornada ao frontend.
8. O Planner mostra recomendação, confiança, evidências, riscos, dados ausentes e próxima ação. Tokens de montagem, conversa e requisição impedem resposta tardia de alterar a UI atual.

### Memória e feedback

`EditorialDecision` preserva pergunta, intenção, decisão, alternativas, confiança, evidências, riscos, lacunas e data. O `dedupeKey` incorpora o escopo e a versão observada das evidências, evitando cópia desnecessária da mesma decisão sem impedir nova avaliação quando os dados mudarem.

O endpoint legado de resultado permanece disponível para compatibilidade. O fluxo operacional de resultado usa um vínculo persistente entre decisão e vídeo e uma avaliação própria, conforme a Sprint 23.

### Supervisor

O Dashboard solicita o overview existente. `SupervisorModule` consulta até cinco decisões recentes e devolve prioridades, riscos, oportunidades e ações. Falha local dessa consulta resulta em coleção vazia e não derruba o Dashboard nem ativa recursos não implementados.

## Decision Outcome Loop — Sprint 23

```text
Decision persistida
  -> associação manual a snapshot/vídeo persistido
    -> EditorialDecisionVideoLink
      -> sincronização explícita pode atualizar VideoPerformanceSnapshot
        -> avaliação explícita
          -> baseline sem o vídeo-alvo
          -> fatos + comparação + interpretação + confiança + lacunas
          -> EditorialDecisionOutcome
            -> ChannelInsight revisável
              -> Creator Intelligence
                -> Planner / Analytics
```

### Associação e avaliação

1. O Planner lista apenas snapshots reais já persistidos e envia somente `snapshotId` ao backend.
2. O backend deriva `videoId`, valida projeto e cria um único vínculo por decisão e vídeo.
3. A avaliação usa o snapshot solicitado ou o snapshot mais recente do mesmo vídeo.
4. O próprio vídeo é excluído da baseline histórica para evitar comparação circular.
5. Métricas disponíveis são comparadas com limiar previsível; `null` continua ausente.
6. Menos de duas comparações válidas ou baseline insuficiente resulta em `INCONCLUSIVE`.
7. O outcome é persistido e o aprendizado correspondente é criado ou revisado pela mesma chave.
8. Perguntas posteriores do Planner recuperam o aprendizado pela memória existente, sem despejar o payload completo do outcome no prompt.

Reavaliações são idempotentes para o mesmo vínculo e snapshot. Vínculos avaliados são preservados para manter rastreabilidade. `evaluateAvailableForVideo(videoId)` permite que uma futura política de sincronização invoque a avaliação, mas esta Sprint não adiciona job, polling nem execução recorrente.

### Frontend

O Planner mostra `Aguardando publicação`, `Aguardando dados`, `Avaliável` ou `Avaliada`, permite associar um snapshot real e iniciar avaliação. Analytics consulta os outcomes persistidos e mostra recomendação original, classificação, confiança, interpretação e evidências favoráveis/contrárias. Todo conteúdo usa DOM textual seguro, feedback local e proteção contra respostas obsoletas.

## Outcome Review & Refresh Loop — Sprint 24

```text
Novo snapshot ou baseline persistido
  -> OutcomeRefreshService.inspect(outcomeId)
    -> current | review_available | stale | insufficient_data
      -> revisão manual individual ou em lote
        -> EditorialDecisionOutcomeReview (pending)
          -> DecisionOutcomeService.evaluate(...)
            -> novo/atualizado EditorialDecisionOutcome
            -> ChannelInsight revisável
          -> review reviewed | unchanged | failed
            -> Analytics / Planner / Supervisor
```

O estado é derivado por identidade do snapshot, métricas realmente alteradas, preenchimento de dados antes ausentes e mudança da baseline aplicável. Tempo sozinho não torna um outcome revisável e `engagedViews` continua ausente quando a fonte não o fornece.

A revisão é explícita. Analytics oferece ação individual e em lote, recarrega os dados persistidos e ignora respostas tardias depois de unmount. O Planner sinaliza que uma avaliação possui revisão disponível, mas continua usando a memória atual até a revisão terminar. O Supervisor apenas consolida contagens; ele não dispara trabalho.

Cada tentativa cria histórico antes da avaliação. Sucesso liga estado anterior e resultado; ausência de mudança fica como `unchanged`; falha preserva o outcome anterior e marca somente o registro da tentativa. O `reviewKey` único e o controle em processo evitam trabalho duplicado para a mesma evidência.

Não existe scheduler, polling ou rede externa nova. A sincronização YouTube e a revisão permanecem comandos manuais separados.

## Controlled Orchestration — Sprint 25

```text
João
  -> Gerente / Orchestrator API
    -> classificação determinística da intenção
    -> OrchestrationPlan persistível
      -> CapabilityRegistry
        -> serviços de domínio existentes
          -> outputs intermediários limitados
      -> consolidação de fatos / inferências / recomendações
    -> OrchestrationExecution
  -> resposta consolidada para João
```

O plano existe antes da execução. Cada step declara dependências e acesso; steps bloqueados são pulados, outputs são reutilizados e nenhuma capability aparece duas vezes no plano. O consolidator mantém fatos, inferências, recomendações, riscos e dados ausentes em canais diferentes.

Pergunta editorial no Planner → Orchestrator → Performance/Creator Intelligence → `planner.respond` → Planner persiste uma mensagem `operator`. O Gerente coordena, mas não assume a conversa nem substitui o especialista.

## Plan Review & Approval — Sprint 26

```text
User intent
  -> POST /api/orchestrator/preview
  -> deterministic OrchestrationPlan
  -> side-effect metadata validation
  -> risk classification
  -> OrchestrationExecution(pending) + PlanReview
  -> PLAN_CREATED + PLAN_REVIEWED audit
  -> policy auto-approval OR manual Approve/Reject
  -> approved plan snapshot/hash
  -> POST /executions/:id/execute
  -> execution guard (state + version + expiry + request + current capability plan + concurrency)
  -> capabilities
  -> persisted result
  -> PLAN_EXECUTED audit
  -> Supervisor read-only summary
```

Preview não chama capability. A `idempotencyKey` pertence ao request normalizado que criou o preview; outra entrada com a mesma chave é rejeitada. Previews concorrentes iguais convergem para uma execução. Alteração no plano persistido, no roteamento ou no metadata/registro das capabilities invalida o hash e expira o review. O compare-and-set de versão evita dupla decisão; `pending → running` atômico impede dupla execução. Eventos registram somente tipo, ator, motivo limitado e metadata operacional segura.

O fluxo operacional externo é exclusivamente manual:

```text
confirmação do usuário
  -> YouTube Sync
  -> detectar reviews disponíveis
  -> short-circuit quando zero
  -> Outcome Refresh
  -> Supervisor atualizado por leitura
```

Não existe execução recorrente, polling ou chamada externa implícita.
## Controlled Automation Runner

```text
Workspace Automações / entrada controlada do scheduler
  -> API client / GET due + POST run
  -> AutomationService ou AutomationSchedulerService
  -> AutomationRepository
  -> AutomationRunnerService
  -> AutomationRunRepository (claim idempotente)
  -> OrchestratorService.preview
  -> PlanReviewService
     -> approved: executeApprovedPlan -> capabilities reais
     -> review_required: AutomationRun BLOCKED
  -> resultado sanitizado
  -> AutomationRun + AutomationAuditEvent
  -> SQLite
```

- `findDueAutomations(now)` é read-only e ordena por `nextRunAt` e ID;
- `runDueAutomations(now)` lê uma lista finita e tenta cada ocorrência uma vez;
- `Run Now` usa `triggerSource=MANUAL`; agendas usam `SCHEDULED` e uma chave derivada da ocorrência;
- a sincronização recente do YouTube recalcula a janela limitada no momento da execução;
- sucesso agenda a próxima ocorrência; erro/bloqueio não entra em retry infinito;
- consultas de Dashboard, Gerente e Supervisor não disparam capabilities.
