# PRODUCT_ARCHITECTURE.md

## Referência principal de visão
O documento principal da visão do produto está em [`docs/PRODUCT_VISION.md`](PRODUCT_VISION.md).
A estrutura oficial do sistema está documentada em [`docs/JVITORZ_OS.md`](JVITORZ_OS.md).

## Visão geral
Este documento descreve a arquitetura de produto do JvitorZ OS como uma plataforma modular de operações criativas para canais e conteúdo digital.

## Estrutura do produto
JvitorZ OS

├── Dashboard
├── Canal
├── Analytics
├── Operadores
│   ├── Planejador
│   ├── Analytics IA
│   ├── Supervisor
│   ├── Escritor
│   ├── Biblioteca
│   ├── Tendências
│   ├── CTR
│   ├── Retenção
│   ├── Shorts
│   ├── Longos
│   ├── SEO
│   └── Automações
├── Configurações

## Camadas do sistema
- **Frontend**: SPA leve em `frontend/` com navegação baseada em hash e módulos renderizados dinamicamente.
- **Backend**: API express em `backend/` com roteamento modular e serviços para dashboard, autenticação e operadores.
- **Documentação**: arquivos em `docs/` que descrevem arquitetura, operadores, UX e fluxos.

## Módulos principais
### Dashboard
- Tela principal de controle da plataforma.
- Exibe cards de métricas, status do canal, links para operadores e visão rápida do sistema.
- Consome a API `GET /api/dashboard`.

### Canal
- Objeto do domínio responsável por resumir os dados do canal conectado.
- No backend, expõe `ChannelModule` e se integra à API do YouTube.
- No frontend, representa a seção de canal do dashboard.

### Analytics
- Coleta e apresenta métricas de desempenho do canal.
- No backend, `AnalyticsModule` agrega dados para o dashboard.
- No frontend, exibe cards e resumos de análise.

### Operadores
- Conjunto de ferramentas especializadas para criação, planejamento e automação.
- Atualmente há um `Planejador de Conteúdo` funcional e um módulo de listagem `Operadores`.
- A visão de operadores deve evoluir para incluir todos os itens da lista acima.
- A página Operadores atua como catálogo; a sidebar e o hash formam a navegação principal das ferramentas realmente disponíveis.

### Configurações
- Módulo de ajustes do sistema e das integrações.
- Presente no frontend como painel de configuração.

## Operadores documentados
### Planejador de Conteúdo
- **Objetivo**: oferecer uma workspace para planejar pautas, escrever prompts e conduzir conversas de planejamento.
- **O que faz**: apresenta chat, biblioteca, histórico e prompt base editável; funciona como workspace de operador.
- **Dados que consome**: histórico, mensagens e contexto persistidos das conversas do Planejador.
- **Dados que gera**: novas conversas, mensagens, contexto, respostas inteligentes e artefatos da Biblioteca persistidos pelo backend em SQLite.
- **Componentes reutilizados**: header, chat, sidebar, painel, input fixo, prompt editável.
- **Próximas integrações**: análise de tendências, importação de roteiros e automação de publicações.

#### Resposta inteligente concluída na Sprint 15

A Sprint 15 aplica a FASE 5 - OpenAI ao primeiro operador funcional da FASE 7 - Primeiro Operador. O fluxo implementado acrescenta uma resposta inteligente persistida ao comportamento existente:

```text
Conversation.context + mensagens persistidas em ordem cronológica
  -> entrada neutra do provider de linguagem
    -> resposta textual
      -> mensagem persistida com sender "operator"
```

O `PlannerService` coordena conversa, histórico, provider e persistência sem depender diretamente do SDK OpenAI. O contrato injetável `LanguageProvider` separa o domínio do adapter externo e permite testes com provider fake, sem rede. O mapper neutro limita o contexto a 4.000 caracteres, o histórico às 30 mensagens mais recentes e a 16.000 caracteres, e a saída a 4.000 caracteres.

O `OpenAILanguageProvider` usa o SDK oficial e a Responses API. A configuração é avaliada somente em `generate()`: `OPENAI_API_KEY` é obrigatória apenas para gerar e `OPENAI_MODEL` é opcional, com fallback `gpt-5-mini`. A saída de 4.000 caracteres é convertida conservadoramente em `max_output_tokens: 1000`. O backend inicia sem chave e retorna `503` seguro quando o provider está indisponível.

O frontend solicita `/reply` somente após persistir a mensagem do usuário e renderiza a mensagem `operator` retornada pelo backend, que já está persistida. Enquanto a geração está em andamento, novos envios são bloqueados. Respostas tardias de outra conversa ou montagem são ignoradas pela UI; ao reabrir a conversa correta, a resposta persistida é carregada normalmente. Falhas preservam a mensagem do usuário e aparecem apenas no feedback local do Planner.

Os testes automatizados usam providers e clients injetáveis, sem chave ou rede externa. Permanece como validação externa não bloqueadora executar um smoke test manual com uma `OPENAI_API_KEY` válida para confirmar uma chamada real HTTP `201`.

Streaming, seleção de modelo pela UI, múltiplos providers, RAG, dados do YouTube no prompt, tools/function calling, automações e novos operadores permanecem fora desta Sprint.

#### Biblioteca de artefatos concluída na Sprint 16

A Sprint 16 avança a FASE 7 - Primeiro Operador ao transformar respostas inteligentes persistidas em artefatos reutilizáveis. A Biblioteca do Planner usa dados reais por meio deste fluxo:

```text
Conversation + Message persistida com sender "operator"
  -> LibraryService valida conversa, mensagem e autoria
    -> conteúdo copiado no backend
      -> LibraryItemRepository
        -> Prisma -> SQLite
```

O frontend envia apenas os identificadores necessários para localizar a conversa e a mensagem. O backend não aceita conteúdo arbitrário como fonte: busca a mensagem persistida, confirma seu pertencimento e aceita somente `sender: "operator"`.

`LibraryItem.sourceMessageId` registra a origem com unicidade no banco. A primeira gravação retorna `201`; novas chamadas para a mesma mensagem retornam `200` com o item existente. Em concorrência, a constraint única decide a criação e o serviço trata `P2002` buscando o registro vencedor, sem expor detalhes do Prisma. A relação usa `ON DELETE SET NULL`, preservando o artefato se a mensagem de origem for removida, e a migration mantém itens legados com origem nula.

A UI usa o API client centralizado para salvar, listar e abrir itens. Após salvar, a lista é recarregada do backend; o leitor mantém o artefato separado do chat e renderiza título e conteúdo como texto. Tokens de operação impedem respostas obsoletas de alterar uma montagem, conversa ou seleção mais nova, e erros permanecem no feedback local do Planner.

Edição, exclusão, busca, tags, pastas, RAG, inclusão automática nos prompts, compartilhamento, exportação, redesign amplo e novos operadores permanecem no backlog.

#### Memória ativa concluída na Sprint 17

**Status: CONCLUÍDA.**

A Sprint 17 transforma artefatos persistidos em contexto explicitamente selecionado para uma conversa. A seleção não é automática e não altera o conteúdo do `LibraryItem`:

```text
Conversation
  -> ConversationLibraryItem (vínculo explícito)
    -> LibraryItem persistido
      -> entrada neutra do LanguageProvider
```

O join model `ConversationLibraryItem` possui chave composta entre `conversationId` e `libraryItemId`, `createdAt` para ordenação e relações com remoção em cascata. Ele não armazena cópia de título ou conteúdo. O backend recebe somente IDs e resolve os itens reais antes de qualquer geração.

O contrato neutro de linguagem representa `context`, `messages`, `artifacts` e `limits`. Cada artefato contém apenas `id`, `title`, `type` e `content`; o adapter OpenAI não define regras de domínio. Conteúdo da Biblioteca é delimitado como referência não confiável, sem autoridade de instrução de sistema.

`ConversationLibraryItemRepository` e `ConversationLibraryService` resolvem itens reais em ordem determinística, mantêm link e unlink idempotentes e aplicam o limite de cinco no SQLite. Três endpoints no namespace da conversa expõem vínculo, listagem e remoção com validação segura.

A API client valida IDs antes da rede e a UI permite vincular e remover itens na conversa ativa. A geração carrega somente vínculos confirmados e respostas obsoletas não alteram a montagem atual.

Os limites são cinco artefatos por conversa, 4.000 caracteres por artefato e 12.000 caracteres totais por geração. A ordem é a data do vínculo crescente, com ID como desempate. O serviço rejeita um sexto vínculo; o mapper aplica truncamento defensivo e determinístico.

A UI permanece dentro do Planner e reutiliza a Biblioteca real para adicionar e remover vínculos da conversa ativa. A associação é uma fronteira reutilizável; a generalização visual e operacional para outros agentes aguardará um segundo operador funcional.

RAG, embeddings, busca semântica e seleção automática permanecem fora da Sprint 17.

### Supervisor (conceitual)
- **Objetivo**: monitorar saúde do sistema, status de operações e alertas de fluxo.
- **O que faz**: exibe indicadores de automação, IA e conexões.
- **Dados que consome**: estado de backend, status de operadores, eventos de processo.
- **Dados que gera**: visão de supervisão para o usuário.
- **Componentes reutilizados**: cards, painel resumo, status pills.
- **Próximas integrações**: monitoramento de erros, alertas em tempo real, dashboards de estabilidade.

### Monitor de YouTube (conceitual)
- **Objetivo**: inspecionar o canal e trazer sinais de conteúdo relevante.
- **O que faz**: mostra dados de canal, inscritos, visualizações e engajamento.
- **Dados que consome**: API do YouTube, tokens de autenticação.
- **Dados que gera**: relatórios e indicadores para materiais do planner.
- **Componentes reutilizados**: cards de métrica, painel de detalhes.
- **Próximas integrações**: análises de performance histórica, recomendações de conteúdo.

### Outros operadores planejados
Os itens abaixo são parte da visão futura da plataforma e devem reaproveitar a mesma estrutura de workspace e componentes:
- Analytics IA
- Escritor
- Biblioteca
- Tendências
- CTR
- Retenção
- Shorts
- Longos
- SEO
- Automações

## Workspace e ciclo de vida dos operadores

A Sprint 14 concluiu a estabilização desta camada. Módulos interativos podem declarar o contrato:

```js
module.createController(context) => ({
  mount(container, context),
  unmount(),
})
```

- a sidebar permanece disponível e é o mecanismo principal para entrar e sair das workspaces;
- módulos navegáveis são registrados em um catálogo único e resolvidos pela rota em hash;
- hash ausente ou inválido é normalizado para `#channel` sem duplicar o lifecycle;
- cada módulo mantém sua função de renderização e pode associar um controller com montagem e desmontagem explícitas;
- o Dashboard coordena o ciclo de vida sem conhecer detalhes do Planejador ou de qualquer operador específico;
- a desmontagem ocorre antes da substituição do DOM e a montagem ocorre uma única vez depois da renderização;
- workspaces fullscreen usam um contêiner compartilhado e não dependem de botão `Voltar`;
- a página Operadores lista ferramentas, mas apenas itens com módulo registrado iniciam navegação;
- operadores indisponíveis permanecem no catálogo com status não interativo e sem produzir hash;
- o `statePanel` pertence ao estado global do Dashboard; feedback de execução e erro pertence à workspace do operador.

O Planejador é a referência de regressão desse contrato: persistência, histórico, Nova Conversa, troca de conversas, mensagens, contexto, feedback local, listeners únicos e proteção contra respostas obsoletas permanecem funcionais após montagens e desmontagens.

## Backend e integração
### Backend API
- `GET /api/dashboard`: retorna dados de canal, analytics, operadores, supervisor e configurações.
- `GET /api/operators/planner`: endpoint de teste do operador Planejador.
- `/api/operators/planner/conversations`: endpoints persistentes de criação e listagem de conversas.
- `/api/operators/planner/conversations/:id`: abertura de conversa com mensagens.
- `/api/operators/planner/conversations/:id/messages`: criação persistida de mensagens.
- `/api/operators/planner/conversations/:id/context`: atualização do prompt-base da conversa.
- `/api/operators/planner/conversations/:id/reply`: geração e persistência da próxima resposta `operator`.
- `GET /api/auth/google`: foco em autenticação de Google OAuth (documentado no backend, não modificado nesta sprint).

### Serviços backend
- `DashboardService`: orquestra a agregação de módulos.
- `ChannelModule`, `AnalyticsModule`, `OperatorsModule`, `SupervisorModule`, `SettingsModule`: retornam dados estruturados para o dashboard.
- `PlannerModule`: endpoint de operador de teste.
- `PlannerService`: coordena conversas, mensagens, contexto e geração de respostas usando repositories e um `LanguageProvider` injetável.
- `OpenAILanguageProvider`: encapsula SDK, Responses API, configuração lazy, mapeamento de roles e parsing seguro da saída.

## Organização de pastas
- `backend/`: código do servidor, rotas, serviços e integrações.
- `frontend/`: SPA, módulos, componentes reutilizáveis e estilos.
- `docs/`: documentação do produto, arquitetura, UX e fluxos.
- `database/`: espaço reservado para modelos ou scripts de banco de dados.

## Conclusão
O JvitorZ OS é uma plataforma modular com dashboard central, operadores como workspaces especializadas e um backend leve que fornece dados agregados. A base atual está pronta para evoluir com operadores adicionais e componentes reutilizáveis sem alterar a estrutura de rotas nem o comportamento existente.

## Creator Intelligence Foundation

O domínio `CreatorIntelligence` fica entre dados persistidos e consumidores editoriais:

```text
Planner/API
  -> CreatorIntelligenceService
    -> ResearchProvider[]
    -> IdeaEvaluationService
    -> ChannelMemoryService
    -> repositories -> Prisma/SQLite
```

Esse `ResearchProvider` histórico é uma fronteira estreita da avaliação de uma `VideoIdea` já persistida: recebe a ideia e consulta apenas `PerformanceSignal` interno. Ele não é o motor geral de descoberta da Sprint 37. Novas fontes de YouTube, vidIQ ou web pertencem ao contrato neutro `domains/research/ResearchProvider`, evitando duplicar serviços de pesquisa ou acoplar `CreatorIntelligenceService` a SDKs externos.

Cada componente do score carrega classificação, fontes e justificativa. Ausência de evidência permanece explícita e nenhum componente promete desempenho futuro.

`PlannerService` recebe opcionalmente `PlannerEditorialIntelligenceProvider`, permitindo consultar “o que vale gravar?” sem importar repositories. O fluxo de chat e o `LanguageProvider` continuam independentes.

## Performance Intelligence

`PerformanceProvider` é a fronteira neutra para fontes de métricas. `PerformanceIngestionService` normaliza e persiste snapshots sem conhecer SDK externo. O caminho manual continua disponível e `YouTubeAnalyticsPerformanceProvider` é o primeiro adapter externo real. O adapter usa o OAuth Google já existente; a YouTube Analytics API fornece métricas e a YouTube Data API complementa metadados. vidIQ permanece futuro.

```text
provider -> sincronização -> normalização -> snapshot -> baseline -> sinal -> aprendizado -> decisão
```

- snapshots guardam observações e provenance;
- sinais expressam comparação quantitativa contra a baseline do canal;
- aprendizados são inferências estruturadas, atualizáveis e invalidáveis;
- decisões registram recomendação, confiança, evidências, riscos e dados ausentes;
- Biblioteca e memória de canal não duplicam responsabilidades.

`YouTubePerformanceSyncService` coordena os modos vídeo, recentes e período, com limite máximo de 50 resultados e sem polling. Recoletas idênticas atualizam o snapshot pela chave de ingestão. O Supervisor expõe estado conectado, sincronizado, não autorizado, não configurado ou erro temporário sem ativar operadores inexistentes.

Rotas continuam delegando a serviços, e somente repositories acessam Prisma. A configuração do provider é avaliada quando status ou sincronização são solicitados; a suíte usa fakes e SQLite em memória, sem rede externa. Ausência de métricas permanece `null`, inclusive impressões e CTR.

## Performance Operations UI

O módulo `analytics` é a superfície operacional da Performance Intelligence. Seu controller usa exclusivamente o API client central e participa do lifecycle genérico do Dashboard:

```text
AnalyticsController
  -> frontend API client
    -> status/sync/records/baseline/signals/learnings/evidence
      -> Creator Intelligence + YouTubePerformanceSyncService
        -> repositories -> Prisma/SQLite
```

Na montagem, consultas independentes são executadas em paralelo e cada seção mantém um estado coerente mesmo se outra falhar. A sincronização é manual, bloqueia apenas o controle correspondente e recarrega os dados persistidos depois do sucesso. Não existe polling.

Tokens de montagem e de seleção impedem respostas tardias de substituir uma workspace desmontada ou uma evidência mais recente. Conteúdo externo é renderizado com APIs de texto do DOM. Valores `null` permanecem visualmente indisponíveis; zero só é exibido quando é um valor real.

O `statePanel` continua reservado ao Dashboard. Erros de Analytics aparecem em feedback local com `aria-live`. O Supervisor consome estados reais de YouTube, configuração de IA e automações controladas persistidas.

## Controlled Automation Runner

Automações são definições operacionais, não um executor alternativo. A arquitetura mantém uma única cadeia de autoridade:

```text
AutomationDefinition
  -> AutomationRuntimeService (quando explicitamente habilitado)
  -> tick serializado
  -> AutomationSchedulerService.runDueAutomations(now)
  -> AutomationRunnerService
  -> OrchestratorService.preview()
  -> PlanReview
  -> OrchestratorService.executeApprovedPlan()
  -> capabilities reais
  -> AutomationRun + AutomationAuditEvent + AutomationRuntimeEvent
```

`AutomationService` valida definição, agenda, timezone, intenção e input permitido. `AutomationRuntimeService` é o processo local controlável que chama o scheduler somente quando `AUTOMATION_RUNTIME_ENABLED=true`. O padrão é desabilitado. O polling usa `setTimeout` após a conclusão do tick anterior, portanto ticks lentos não se acumulam. `AutomationSchedulerService` lê um snapshot finito de vencidas e `AutomationRunnerService` cria uma ocorrência idempotente antes do preview. A constraint única por ocorrência e o índice parcial de run ativo protegem concorrência no SQLite.

Planos `LOW`/`MEDIUM` aceitos pela política existente podem seguir para execução. Planos `review_required` ficam `BLOCKED`, preservam o `orchestrationExecutionId` e só continuam pelo mesmo plano após aprovação. A agenda jamais define `confirmExternalSideEffect` e não contorna o guard do Orchestrator.

A workspace `automation-runner` usa o lifecycle genérico do Dashboard e o API client central. Ela mostra health, último/próximo tick e controles explícitos de start, stop e tick. Gerente e Supervisor consultam somente resumos persistidos e health real; nenhum deles executa uma automação durante leitura.

No restart, runs `PENDING`/`RUNNING` são marcados `FAILED` com razão sanitizada `Interrupted`, auditados e nunca reexecutados silenciosamente. Ocorrências `DAILY`/`WEEKLY` acumuladas são coalescidas na mais recente elegível. Retry automático é limitado a 0 por padrão, no máximo 2 por configuração, e usa o menor teto entre a configuração global do runtime e `AutomationGovernancePolicy.retryPolicy`. O backoff é linear e curto, de 1 segundo por tentativa, e somente falha técnica explicitamente classificada como transitória é elegível. Review, validação, OAuth e `EXTERNAL_WRITE` não entram em retry automático.

## Automation Operational Governance

Toda nova execução passa por `AutomationGovernanceService` antes do claim. A decisão neutra é `ALLOW`, `DEFER`, `BLOCK` ou `REQUIRE_APPROVAL` e inclui motivos, políticas envolvidas, fatos de uso e próxima elegibilidade. A avaliação combina estado, policy habilitada, quotas diária/semanal, janela no timezone da automação, cooldown, falhas consecutivas e aprovação manual para agenda.

`AutomationDiagnosticsService` usa a mesma policy e os mesmos repositories para classificar `HEALTHY`, `DEGRADED`, `BLOCKED`, `FAILING` ou `DISABLED`. Gerente, Supervisor e workspace não inferem causas. Overrides são explícitos, one-shot e limitados a quota, janela e cooldown; eles não ignoram capability validation, PlanReview ou `EXTERNAL_WRITE`. Retry/recovery criam um novo run ligado por `sourceRunId`; skip persiste `SKIPPED`; nenhum histórico é reescrito.

## Editorial Decision Loop

O `EditorialDecisionService` é a fronteira única entre evidência persistida e decisão editorial operacional:

```text
Planner ou API
  -> EditorialDecisionService
    -> CreatorIntelligenceService
      -> ideias + baseline + sinais + ChannelMemory + snapshots
    -> operadores CTR / Retenção / Long-form / Shorts
    -> Trends + Series + Content Patterns
    -> OpportunityScoringService
    -> DecisionHistoryRepository
      -> Prisma -> SQLite
  -> resposta operator persistida / Supervisor
```

O serviço classifica a intenção, carrega apenas o contexto necessário e produz recomendação principal, alternativas, categoria, score relativo, confiança, evidências classificadas, riscos, restrições, dados ausentes e próxima ação. A classificação separa `fact`, `inference` e `recommendation`; nenhuma camada calcula previsão exata de views.

`OpportunityScoringService` é um domínio puro e determinístico. Seus fatores são performance histórica, tendência, saúde de série, aderência de formato, retenção, CTR, watch time, inscritos, resposta de audiência e aderência editorial. Os pesos somam 100% e nenhum fator excede 15%. Qualidade e freshness reduzem peso e confiança; cobertura pequena ou conflito relevante leva a `INSUFFICIENT_DATA` ou `REEVALUATE` em vez de certeza artificial.

O score só ordena oportunidades dentro da evidência disponível. Ele não estima resultado futuro. Confiança expressa cobertura e qualidade das fontes, não probabilidade de sucesso. Evidência favorável e contrária mantém fonte, classificação e confiança para auditoria.

`PlannerService` recebe o serviço editorial por injeção. Quando a última mensagem do usuário é uma pergunta editorial reconhecida, a decisão é gerada antes da resposta, persistida e vinculada à mensagem `operator`. Conversas gerais continuam no `LanguageProvider`, mantendo OpenAI e Creator Intelligence desacoplados.

O hash das entradas e do estado das evidências evita decisões duplicadas para a mesma situação. `DecisionHistoryRepository` mantém consultas de decisão atual, oportunidades, riscos e histórico em ordem determinística. O modelo `EditorialDecision` é append-only para cada novo estado de evidência, pode apontar para conversa e mensagem `operator` e preserva o contrato de resultados das Sprints 23–24.

O Planner renderiza categoria, score, explicação, confiança, evidências favoráveis/contrárias e restrições com DOM textual seguro, ignorando respostas obsoletas após troca de conversa ou unmount. O Gerente usa `creator-intelligence.decide` em vez de reconstruir Analytics. O Supervisor agrega prioridades, riscos, oportunidades, conflitos e insuficiência sem disparar side effects ou transformar ausência de dados em estado falso.

## Decision Outcome Loop

O ciclo de resultado mantém decisão, publicação e avaliação como responsabilidades separadas:

```text
EditorialDecision
  -> EditorialDecisionVideoLink
    -> VideoPerformanceSnapshot real
      -> DecisionOutcomeService
        -> EditorialDecisionOutcome
        -> ChannelInsight revisável
          -> Creator Intelligence -> Planner
```

`EditorialDecisionVideoLink` registra a identidade do vídeo, o snapshot persistido que comprovou sua existência, a origem da associação e a data. A constraint `decisionId + videoId` torna o vínculo idempotente e impede duplicação concorrente.

`DecisionOutcomeService` seleciona um snapshot persistido do vídeo e o compara com uma baseline histórica que exclui o próprio vídeo avaliado. A preferência é formato, depois jogo e por fim canal; cada dimensão exige ao menos duas amostras históricas. A avaliação produz fatos, comparação, interpretação, confiança, métricas favoráveis e contrárias, lacunas e hipóteses editoriais testáveis. `POSITIVE`, `MIXED`, `NEGATIVE` e `INCONCLUSIVE` descrevem a comparação, nunca causalidade.

O resultado é persistido antes de virar aprendizado. Uma chave estável atualiza o mesmo `ChannelInsight` em reavaliações, permitindo revisar ou enfraquecer a memória quando novos dados chegam. O método `evaluateAvailableForVideo(videoId)` é a fronteira preparada para uma integração futura após sincronização; nenhum scheduler, polling ou gatilho automático foi ativado.

No frontend, Planner e Analytics usam o API client central. Tokens de montagem, conversa e requisição impedem que associações, avaliações ou listagens tardias alterem a tela atual. O `statePanel` continua global; falhas dessas operações permanecem locais ao módulo.

## Outcome Review & Refresh Loop

`OutcomeRefreshService` é a fronteira operacional entre novos dados de performance e uma avaliação editorial anterior. Ele deriva `current`, `review_available`, `stale` ou `insufficient_data` a partir do banco, sem relógio artificial e sem consultar rede externa.

Uma revisão disponível exige evidência objetiva: snapshot mais novo, valor relevante alterado, métrica antes ausente agora presente ou baseline aplicável diferente. A execução reutiliza `DecisionOutcomeService`, persiste um novo outcome quando a evidência muda e atualiza o `ChannelInsight` pela chave estável. Outcomes anteriores permanecem imutáveis como histórico.

`EditorialDecisionOutcomeReview` funciona como journal append-only da operação. A chave única de revisão e o mapa de operações ativas tornam o comando idempotente para a mesma evidência. Outcome, memória, decisão e conclusão do review são confirmados na mesma transação; uma falha reverte esse conjunto, é sanitizada no registro da tentativa e não invalida a classificação anterior. O lote continua nos demais itens.

Analytics controla revisão individual e em lote. Planner apenas informa quando a avaliação usada está desatualizada. Supervisor consulta contagens de estados e falhas recentes, sem iniciar revisões. Todos mantêm feedback local e proteção contra respostas obsoletas.

Esta camada não atribui causalidade, não prevê views, não estima `engagedViews`, não cria scheduler e não muda o contrato do provider YouTube.

## Controlled Orchestration Foundation

O Gerente é uma camada de coordenação separada dos especialistas. `OrchestratorService` recebe uma intenção, usa regras determinísticas para criar um `OrchestrationPlan`, resolve capabilities pelo `CapabilityRegistry`, executa passos em ordem e consolida um `OrchestrationResult`. Ele não importa implementações concretas: a composição registra adapters para serviços maduros.

Capabilities disponíveis: `performance.read`, `analytics.read`, `channel-operator.ctr`, `channel-operator.retention`, `channel-operator.long-form`, `channel-operator.shorts`, `creator-intelligence.decide`, `decision-outcomes.read`, `outcome-refresh.inspect`, `outcome-refresh.run`, `supervisor.read`, `library.read`, `youtube.sync` e `planner.respond`. Cada contrato declara inputs, outputs, dependências, disponibilidade e acesso `read`, `write` ou `external_side_effect`. Funcionalidades planejadas não entram no registro.

O Planner continua dono de conversa e mensagem. Na composição real, perguntas editoriais usam o Gerente para consolidar contexto, mas o Planner persiste a resposta e o Creator Intelligence continua dono da decisão. O Supervisor somente informa estado operacional e nunca executa capabilities.

## Autonomous Manager Orchestration

A Sprint 36 evolui a foundation sem criar uma segunda engine. `ManagerOrchestratorService` interpreta a pergunta, cria contexto seletivo e entrega um request enriquecido ao `OrchestratorService`. `ManagerPlanner` converte o intent em capability tags; o `CapabilityRegistry` descobre somente operadores disponíveis, elimina repetições e mantém dependências reais.

Intents suportados: `CHANNEL_DIAGNOSIS`, `CONTENT_DECISION`, `IDEA_COMPARISON`, `SERIES_ANALYSIS`, `SHORTS_ANALYSIS`, `LONGFORM_ANALYSIS`, `CTR_ANALYSIS`, `RETENTION_ANALYSIS`, `TREND_ANALYSIS`, `AUDIENCE_ANALYSIS`, `TRAFFIC_ANALYSIS`, `PLANNING`, `OPPORTUNITY_DISCOVERY`, `RISK_ANALYSIS`, `GENERAL_CREATOR_QUESTION` e `UNKNOWN`.

As capability tags incluem performance, analytics, data quality, CTR, retention, long-form, Shorts, trends, series, audience, traffic sources, decision memory, shared memory, editorial decision, supervision e response. Um plano focado não executa todos os operadores. `EditorialDecisionService` continua sendo a única implementação de ranking e oportunidade; o Gerente apenas o invoca.

`EvidenceConsolidator` mantém fato, inferência e recomendação separados. Conflitos conhecidos, como CTR forte com retenção fraca ou tendência agregada em queda com série saudável, permanecem explícitos e reduzem confiança; nenhum lado é descartado arbitrariamente. Confiança consolidada combina disponibilidade, qualidade, freshness, amostra, conflitos e dados ausentes. Ela não representa chance de sucesso.

Falhas de capabilities são sanitizadas. Operadores independentes continuam, o resultado passa a `DEGRADED` e a disponibilidade reduz a confiança. Sem evidência útil, a saída é `INSUFFICIENT_DATA`; nenhum conteúdo ausente é fabricado. `OrchestrationExecution.id` funciona como correlation ID, e request, contexto, plano, invocações, evidências, conflitos, resposta e confiança ficam no histórico append-only já existente.

O Planner usa essa fronteira somente em perguntas editoriais e persiste a mensagem final. O Supervisor lê resumos de execuções recentes, operadores, conflitos, baixa confiança e insuficiência. A UI do Gerente mantém o fluxo autônomo separado do painel de operações controladas; side effects continuam passando por preview, política de risco e `PlanReview`.

## Operational Plan Review & Approval

A execução controlada segue `Intent → Plan → Risk Classification → Review → Approval/Rejection → Execution → Audit`. `PlanReviewService` aplica política determinística, persiste review, snapshot/hash do plano aprovado e trilha append-only. `OrchestratorService` continua responsável pelo plano e pelas capabilities, mas o execution guard impede execução rejeitada, expirada, desatualizada ou concorrente. Antes de executar, o plano também é reconstruído com o registro atual; mudança ou remoção de capability expira a aprovação anterior.

Cada capability declara `sideEffect`, `persistentMutation` e limite de itens afetados. O registry rejeita metadata incoerente antes da execução. Os níveis são `READ_ONLY`, `INTERNAL_WRITE`, `EXTERNAL_READ` e `EXTERNAL_WRITE`; riscos são `LOW`, `MEDIUM` e `HIGH`.

Política inicial:

- leitura segura e escrita interna única/limitada podem ser autoaprovadas;
- escrita interna não limitada, de alto volume ou composta exige uma aprovação;
- leitura externa que também persiste dados exige uma aprovação;
- escrita externa sempre exige aprovação explícita;
- planos HIGH, MEDIUM e LOW valem respectivamente 15, 30 e 60 minutos, refletindo volatilidade dos dados e impacto operacional.

O Gerente cria preview sem executar, apresenta efeitos e coleta decisão. O Supervisor apenas consolida contagens de reviews e execuções; não aprova nem executa. Não existe scheduler, cron, polling ou n8n.

Execuções são sequenciais, reutilizam outputs anteriores e aplicam short-circuit antes de uma etapa desnecessária. Falhas são sanitizadas por capability; quando ainda existe evidência útil, o resultado é `partial`. Uma chave opcional deduplica chamadas sequenciais e concorrentes e fica vinculada ao request normalizado original; reutilizá-la para outro trabalho é conflito seguro.

`youtube.sync` exige confirmação explícita e parâmetros limitados. A composição manual Sync → Detect → Review → Supervisor não cria scheduler, cron, polling, n8n ou processo em background.

## Operator Expansion e navegação real

A Sprint 30 estabelece uma shell operacional única e rotas SPA canônicas de `#/dashboard` a `#/settings`. A sidebar e o page header permanecem visíveis; somente a página ativa é montada em `moduleHost`. O lifecycle existente continua genérico e o Dashboard não importa controllers de Planner, Analytics ou operadores.

`ChannelOperatorService` é a fronteira read-only sobre `VideoPerformanceSnapshotRepository`. CTR, Retenção, Long-form e Shorts compartilham `ChannelOperatorAnalysis` com status, fatos, sinais, insights, recomendações, lacunas, confiança e evidências. O serviço não consulta Google: usa exclusivamente snapshots persistidos e explicita dados ausentes.

```text
Analytics / Gerente / Supervisor
  -> ChannelOperatorService
    -> VideoPerformanceSnapshotRepository
      -> Prisma -> SQLite
```

O Gerente registra `channel-operator.ctr`, `channel-operator.retention`, `channel-operator.long-form` e `channel-operator.shorts` como capabilities `READ_ONLY`. O roteador determinístico pode escolher uma capability ou combinar CTR + Retenção. O Supervisor consulta resumos e nunca dispara mutação.

O Dashboard opera em modo degradado quando OAuth Google não está disponível ou retorna `invalid_grant`: dados locais continuam em HTTP 200 e a UI oferece reconexão. Falhas inesperadas permanecem sanitizadas.

## Live Data Integration e consistência operacional

A Sprint 31 introduz uma fonte única para estado de integrações. `IntegrationStatusService` separa configuração, autenticação, disponibilidade e stale state de Google OAuth, YouTube Data, YouTube Analytics, OpenAI, banco, backend e runtime. Dashboard, Canal, Planner, Supervisor e Configurações consomem o mesmo contrato, enquanto status de operadores permanece um domínio separado.

```text
Google OAuth
  -> ChannelDataService -> ChannelSnapshotRepository -> SQLite
  -> YouTubePerformanceSyncService
     -> YouTubeAnalyticsPerformanceProvider + YouTubeVideoMetadataService
     -> PerformanceIngestionService -> snapshots/signals/memory
     -> ChannelOperatorService
        -> Analytics / Gerente / Supervisor / Dashboard
```

O refresh do OAuth é lazy e tokens atualizados são persistidos sem logs sensíveis. Canal possui last-known-good; falha externa temporária preserva o snapshot e resulta em `DEGRADED`. Analytics solicita `engagedViews` e `creatorContentType` reais, classifica Shorts e VOD sem heurística e mantém impressões/CTR como `null` até uma fonte real existir.

## Reach Reporting e Data Quality

A Sprint 32 adiciona `GoogleYouTubeReachProvider`, uma integração separada com a YouTube Reporting API. O report type oficial `channel_reach_basic_a1` entrega `date`, `channel_id`, `video_id`, `video_thumbnail_impressions` e `video_thumbnail_impressions_ctr`. O provider reutiliza jobs remotos, trata conflito concorrente de criação, limita a leitura a 31 relatórios e usa parser CSV estruturado.

`YouTubeReachSyncService` é a fronteira de aplicação e persiste por repositories. `VideoReachSnapshot` não substitui `VideoPerformanceSnapshot`; o `ChannelOperatorService` cruza as fontes apenas para leitura por vídeo/período. Isso separa distribuição (impressões), clique (CTR), consumo (retenção/watch time) e resultado (views/outcomes).

`DataQualityService` aplica a política única de freshness e produz estados explícitos. Ausência é `MISSING`; falha do provider é `ERROR`; anomalias são `INCONSISTENT`; uma amostra incompleta é `PARTIAL`. Supervisor, Gerente, Analytics, Dashboard e Configurações recebem esse metadado sem acesso a OAuth, payload bruto ou Prisma.

Fontes oficiais: [YouTube Reporting API](https://developers.google.com/youtube/reporting/v1/reference/rest), [Channel Reach reports](https://developers.google.com/youtube/reporting/v1/reports/channel_reports) e [Reach metrics](https://developers.google.com/youtube/reporting/v1/reports/metrics).

O `PlannerModule` reflete a configuração real de OpenAI. Supervisor fornece estado técnico e resumo humano dos operadores. Configurações mostra apenas estado e ações seguras; nenhuma tela recebe secrets.

## Audience & Traffic Source Intelligence

A Sprint 33 mantém uma terceira fronteira YouTube separada: `GoogleYouTubeAudienceProvider` usa relatórios direcionados da YouTube Analytics API para `insightTrafficSourceType`, detalhe de `YT_SEARCH` quando disponível, `country`, `deviceType` e `subscribedStatus`. Essa fonte não substitui Performance por vídeo nem Reach bulk.

```text
GoogleYouTubeAudienceProvider
  -> YouTubeAudienceSyncService
    -> AudienceSnapshotRepository + AudienceSyncStateRepository
      -> DataQualityService
        -> AudienceIntelligenceService
          -> Long-form / Shorts / CTR / Retention
          -> Gerente / Supervisor / Dashboard / Analytics UI
```

`AudienceSnapshot` preserva dimensão, segmento oficial, formato oficial, período, métricas compatíveis, coleta, freshness e qualidade. A chave de ingestão torna a mesma fonte/projeto/dimensão/segmento/formato/período idempotente. Sync parcial registra dimensões ausentes e falhas posteriores preservam o last-known-good.

Fatos, sinais, hipóteses e recomendações são canais separados. País não é convertido em idioma; subscribed status não prova fidelidade; origem de tráfego não prova causa de CTR ou retenção. Duração média e percentual médio permanecem `null` nos relatórios em que a API não os aceita. Termos de busca nunca são gerados localmente.

Fontes oficiais: [Channel reports](https://developers.google.com/youtube/analytics/channel_reports), [Dimensions](https://developers.google.com/youtube/analytics/dimensions) e [Metrics](https://developers.google.com/youtube/analytics/metrics).

## Trends, Series & Content Pattern Intelligence

A inteligência temporal é uma camada derivada e read-only sobre evidências persistidas. `TrendIntelligenceService` compara janelas equivalentes definidas por `TrendWindowPolicy`, persiste `TrendSignal` e mantém classificação, confiança, qualidade e evidências separadas. Os limites iniciais exigem duas observações por janela, tratam variação inferior a 8% como estável, exigem 15% para movimento significativo e usam coeficiente de variação 0,60 para volatilidade.

```text
Performance + Reach + Audience persistidos
  -> TrendWindowPolicy + TrendDetection
    -> TrendIntelligenceService -> TrendSignalRepository
    -> SeriesIntelligenceService -> SeriesDefinitionRepository
    -> ContentPatternIntelligenceService -> ContentPatternRepository
      -> Trends / Series operators
        -> Analytics / Planner / Gerente / Supervisor
```

Confiança combina volume (35%), comparabilidade das janelas (20%), qualidade da fonte (25%) e consistência direcional (20%). Histórico insuficiente produz `INSUFFICIENT_DATA`; não é convertido em tendência. O mapper preserva as observações recentes e não altera snapshots de origem.

`SeriesIntelligenceService` aceita importação apenas de metadado explícito, vínculo manual reversível e associação automática somente por correspondência exata de alta confiança. Saúde compara os três episódios mais recentes com os três anteriores quando há amostra. `DORMANT` comunica inatividade e não julgamento de qualidade.

`ContentPatternIntelligenceService` agrupa apenas dimensões realmente persistidas. Resultado é uma associação com amostra, recência, confiança e evidências; não é uma explicação causal. Trends e Series seguem o contrato comum de operadores e entram no Gerente como capabilities read-only. O Planner recebe evidências temporais pelo `EditorialDecisionService`; o Dashboard continua sem lógica específica desses operadores e o Supervisor apenas consolida destaques.

## Research & Opportunity Discovery

A Sprint 37 adiciona uma fronteira de descoberta anterior à decisão editorial:

```text
Planner / Gerente / Research workspace
  -> ResearchService
    -> ResearchProvider[]
      -> InternalResearchProvider
        -> snapshots + trends + series + patterns + ideas + audience
    -> OpportunityDiscoveryService
    -> ResearchHistoryRepository + ResearchOpportunityRepository
      -> Prisma -> SQLite
  -> EditorialDecisionService
```

`ResearchProvider` recebe uma `ResearchQuery` neutra e devolve `ResearchSource`, `ResearchEvidence` e `ResearchCandidate`. Provider, origem interna/externa, coleta, freshness, qualidade e limitações permanecem explícitos. O motor não conhece SDK, credencial ou formato específico de YouTube, vidIQ ou web.

O provider inicial é inteiramente local e não faz rede. Ele normaliza apenas fatos e associações já persistidos. `OpportunityDiscoveryService` consolida candidatos, preserva conflitos, aponta content gaps e produz próxima investigação. O resultado não toma uma decisão nem recalcula `OpportunityScore`; a capability `research.discover` entrega candidatos e evidências ao `EditorialDecisionService`, que continua responsável pelo ranking editorial.

Consultas idênticas usam cache por seis horas. Reexecuções criam histórico comparável; falha de provider pode devolver last-known-good somente como `STALE_FALLBACK`. Ausência total retorna indisponibilidade segura sem derrubar Dashboard, Planner ou Supervisor.

## Strategic Content Planning

`StrategicPlanningService` é a camada de aplicação entre evidência editorial e execução. Ele não substitui Research nem o Decision Engine: recebe decisões, oportunidades, tendências e séries já calculadas, normaliza candidatos e delega a ordenação ao `StrategicPlanningRanker`.

```text
Research -> EditorialDecision -> StrategicPlanning
  -> ContentPlan + PlannedContentItem + PlanningHistory
  -> Planning workspace / Planner / Gerente / Supervisor
```

O ranking é determinístico e considera evidência, confiança, freshness, saúde de série, esforço, restrições, dependências e dados ausentes. Repetição excessiva gera risco; somente uma restrição bloqueante ou dependência não satisfeita produz `BLOCKED`. O balanceamento reserva espaço para experimentos sem transformar hipótese em ordem de gravação.

Cada plano é uma nova versão persistida. Mudanças manuais de prioridade, status, posição e conclusão geram `PlanningHistory`; planos anteriores não são sobrescritos silenciosamente. A fila operacional usa `NEXT`, `LATER`, `WAITING`, `BLOCKED` e `DONE`, enquanto readiness usa `READY`, `NEEDS_RESEARCH` e `BLOCKED`.

`ExecutionGuidance` transforma o primeiro item elegível em uma ação operacional explícita sem criar um segundo ranking. Cada item persiste estado (`pending`, `in_progress`, `completed`, `skipped`, `paused`), ação e confiança. `PlanningExecutionRepository` aplica transição, promoção do próximo item, `PlanningExecutionEvent` e `PlanningHistory` na mesma transação; uma constraint parcial limita cada plano a uma execução ativa. O snapshot do evento conserva o contexto estratégico do momento sem sobrescrever prioridade ou posição manual.

O frontend usa o client central e o lifecycle genérico da workspace. O controller monta uma vez, remove listeners no unmount, ignora respostas obsoletas e apresenta apenas a análise recebida do backend. A workspace mostra ação atual e histórico auditável; Planner mostra guidance, Gerente consulta a capability de planning e Supervisor apresenta estado operacional e alertas. Nenhum deles recalcula ranking.

Planning não publica, não prevê views e não garante performance. Dados stale/missing reduzem confiança e permanecem visíveis. A decisão editorial continua pertencendo ao `EditorialDecisionService`; Planning organiza a sequência de execução.
