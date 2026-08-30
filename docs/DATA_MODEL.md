# DATA_MODEL

## Visão geral

Este documento descreve cada entidade do modelo de dados inicial do JvitorZ OS e seu propósito.

## Entidades

### User
- Representa um usuário da plataforma.
- Campos principais:
  - `id`: identificador único.
  - `email`: email do usuário.
  - `name`: nome opcional.
  - `role`: função do usuário (`admin`, `user`, `operator`).
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

### Project
- Representa um projeto ou fluxo de trabalho dentro do sistema.
- Campos principais:
  - `id`: identificador único.
  - `name`: nome do projeto.
  - `description`: descrição opcional.
  - `ownerId`: referência ao `User` responsável.
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

### Conversation
- Representa uma conversa ou sessão de planejamento ligada a um projeto.
- Campos principais:
  - `id`: identificador único.
  - `projectId`: referência ao `Project` pai.
  - `title`: título opcional da conversa.
  - `context`: contexto ou notas da conversa.
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

### Message
- Representa uma mensagem dentro de uma conversa.
- Campos principais:
  - `id`: identificador único.
  - `conversationId`: referência à `Conversation`.
  - `sender`: origem da mensagem (`user`, `system`, `operator`).
  - `text`: conteúdo da mensagem.
  - `createdAt`: data de criação.

### Operator
- Representa um operador ou workspace que pode ser usado pela plataforma.
- Campos principais:
  - `id`: identificador único.
  - `name`: nome do operador.
  - `description`: descrição opcional.
  - `status`: estado do operador (`active`, `inactive`, `pending`).
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

### LibraryItem
- Representa um artefato persistido da Biblioteca. O fluxo atual cria itens a partir de mensagens `operator` do Planner.
- Campos principais:
  - `id`: identificador único.
  - `projectId`: projeto opcional associado.
  - `sourceMessageId`: mensagem de origem opcional e única; itens legados podem manter valor nulo.
  - `title`: título do item.
  - `type`: tipo opcional; artefatos do Planner usam `resource`.
  - `content`: cópia opcional do conteúdo persistido da mensagem de origem.
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

A relação com `Message` usa `ON DELETE SET NULL`, preservando o artefato quando a mensagem de origem é removida. A unicidade de `sourceMessageId` impede duplicatas persistentes para a mesma resposta.

### ConversationLibraryItem
- Representa o vínculo explícito de memória entre uma conversa e um artefato existente.
- Campos:
  - `conversationId`: referência obrigatória à conversa.
  - `libraryItemId`: referência obrigatória ao item da Biblioteca.
  - `createdAt`: data de criação do vínculo.
- A chave composta `conversationId + libraryItemId` impede duplicação do mesmo vínculo.
- As relações com `Conversation` e `LibraryItem` usam `ON DELETE CASCADE`.
- O model não copia conteúdo nem metadata do artefato.

### Automation
- Representa uma automação configurável para o projeto.
- Campos principais:
  - `id`: identificador único.
  - `projectId`: projeto opcional associado.
  - `name`: nome da automação.
  - `description`: descrição opcional.
  - `trigger`: gatilho da automação.
  - `action`: ação que executa.
  - `enabled`: flag de ativação.
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

### Setting
- Representa uma configuração global ou específica de sistema.
- Campos principais:
  - `id`: identificador único.
  - `key`: chave de configuração.
  - `value`: valor armazenado.
  - `description`: descrição opcional.
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

### AnalyticsSnapshot
- Representa um snapshot de métricas ou dados analíticos capturados.
- Campos principais:
  - `id`: identificador único.
  - `projectId`: projeto opcional associado.
  - `metrics`: dicionário de métricas numéricas.
  - `summary`: resumo opcional.
  - `createdAt`: data de criação.

## Observações

- `Conversation` e `Message` possuem persistência real no fluxo atual do Planejador.
- As relações entre entidades suportam projetos, conversas e coleta de dados analíticos.

## Creator Intelligence

### VideoIdea

Ideia editorial com jogo opcional, tema, formato, premissa, esforço estimado de 1 a 5 e estimativas opcionais de novidade e compatibilidade. Estimativas não são métricas observadas.

### ContentOpportunity

Oportunidade ligada a uma ideia, com fonte, classificação, resumo e score opcional. É removida em cascata com sua ideia.

### ContentDecision

Decisão persistida com categoria (`GRAVAR`, `TESTAR`, `GUARDAR` ou `DESCARTAR`), score relativo, justificativa e snapshot JSON das evidências. Não armazena previsão de views.

### ChannelInsight

Memória revisável do canal. Uma chave estável permite atualizar o aprendizado quando novos sinais chegam. Confiança varia de 0 a 1 e a classificação explicita a natureza do conhecimento.

### PerformanceSignal

Sinal histórico normalizado entre 0 e 100, com chave estável opcional, métrica, fonte, amostragem, confiança e data. Pode se relacionar a projeto, ideia ou `VideoPerformanceSnapshot`, além de jogo, série e formato. Sinais derivados de snapshot são substituídos idempotentemente quando as métricas de origem mudam.

### ChannelSnapshot

Último dado válido do canal coletado pela YouTube Data API. `channelId` é único e permite `upsert` sem duplicar o canal. Título, inscritos, vídeos, views, país e publicação são preservados junto de `collectedAt`; contagens ficam como texto para manter a representação entregue pela API.

O registro sustenta o modo last-known-good: falha externa não apaga o dado, e a camada de serviço o devolve como `DEGRADED` e `stale`. A migration `20260831200000_live_channel_snapshot` é aditiva e não reescreve tabelas existentes.

### VideoPerformanceSnapshot

Registro normalizado de desempenho de um vídeo em um projeto, fonte e período. `ingestionKey` é única e identifica `projectId + source + videoId + periodStart + periodEnd`. Campos observáveis incluem views, views engajadas, impressões, CTR, duração, AVD, percentual médio assistido, watch time, inscritos ganhos, inscritos perdidos, likes e comentários.

Impressões e CTR existentes em snapshots manuais/legados permanecem compatíveis, mas a fonte oficial nova é mantida separadamente em `VideoReachSnapshot` para não misturar universos Analytics e Reporting.

## VideoReachSnapshot

Linha diária do relatório oficial `channel_reach_basic_a1`. Guarda `videoId`, `periodStart`, `periodEnd`, `impressions`, `ctr`, `source`, `reportId`, `jobId`, `reportCreatedAt`, `collectedAt`, freshness/qualidade na coleta e metadados mínimos do provider. `ingestionKey` é a identidade única de projeto + fonte + vídeo + período, tornando reprocessamento idempotente.

## ReachSyncState

Estado local e não sensível do provider: report type, job ID, estado, último relatório, último sync e classe segura do último erro. Tokens OAuth nunca são persistidos nessa tabela.

## DataQualityReport

Read model calculado, não uma métrica inventada. Consolida disponibilidade, freshness, completude, consistência, tamanho da amostra, confiabilidade da fonte e motivos. Os estados oficiais do produto são `GOOD`, `PARTIAL`, `STALE`, `MISSING`, `INCONSISTENT` e `ERROR`.

Todos os campos que a fonte não fornece permanecem `null`; o sistema não substitui ausência por zero. `source`, `confidence` e `collectedAt` registram provenance. Atualizações do mesmo vídeo/período preservam a identidade do snapshot.

```text
Project 1 -> N VideoIdea
Project 1 -> N ChannelInsight
Project 1 -> N PerformanceSignal
Project 1 -> N VideoPerformanceSnapshot
VideoIdea 1 -> N ContentOpportunity
VideoIdea 1 -> N ContentDecision
VideoIdea 1 -> N PerformanceSignal
VideoPerformanceSnapshot 1 -> N PerformanceSignal
```

As tabelas são aditivas e não alteram `Conversation`, `Message` ou `LibraryItem`.

A migration `20260825100000_youtube_analytics_subscribers_lost` adiciona `subscribersLost` como inteiro opcional. Snapshots anteriores permanecem válidos com esse campo `null`.

### EditorialDecision

Decisão editorial operacional persistida. Mantém o snapshot lógico usado para justificar uma ação sem transformar score em previsão.

- `question` e `intent`: pergunta normalizada e intenção editorial reconhecida;
- `recommendation`, `alternatives`, `score`, `confidence` e `nextAction`: saída operacional;
- `category`: `PRIORITIZE`, `CONTINUE`, `TEST`, `HOLD`, `PAUSE`, `REEVALUATE` ou `INSUFFICIENT_DATA`;
- `candidateType` e `candidateKey`: identidade neutra da oportunidade escolhida;
- `opportunityScore`: snapshot estruturado dos componentes, pesos, qualidade, cobertura, justificativa e disclaimer;
- `favorableEvidence`, `contraryEvidence` e `constraints`: justificativa auditável da classificação;
- `classification`: natureza principal da saída, atualmente `recommendation`;
- `evidence`: itens com classificação `fact`, `inference` ou `recommendation`, fonte, resumo e confiança;
- `risks` e `missingData`: limitações explícitas;
- `dedupeKey`: chave única derivada do escopo e do estado das evidências;
- `conversationId` e `operatorMessageId`: vínculos opcionais com o fluxo do Planner;
- `outcomeSnapshotId` e `outcome`: contrato legado opcional, preservado para compatibilidade.

```text
Project 1 -> N EditorialDecision
Conversation 1 -> N EditorialDecision
Message 1 -> 0..1 EditorialDecision
VideoPerformanceSnapshot 1 -> N EditorialDecision (resultado)
```

As relações usam `ON DELETE SET NULL` para preservar a memória editorial quando uma origem opcional deixa de existir. A migration `20260825220000_editorial_decision_loop` cria a estrutura original. A migration aditiva `20260902100000_editorial_opportunity_ranking` acrescenta os campos de ranking e índices por categoria/candidato; decisões anteriores permanecem válidas com categoria padrão `INSUFFICIENT_DATA`.

### EditorialDecisionVideoLink

Associação operacional entre uma decisão e um vídeo real já observado.

- `decisionId`: decisão de origem, removida em cascata com o vínculo;
- `sourceSnapshotId`: snapshot que comprovou a identidade do vídeo;
- `videoId`: identidade persistida derivada do snapshot, nunca enviada como conteúdo arbitrário;
- `origin`, `notes` e `linkedAt`: proveniência mínima da associação;
- `@@unique([decisionId, videoId])`: uma decisão não liga o mesmo vídeo mais de uma vez.

### EditorialDecisionOutcome

Avaliação persistida de um vínculo em um snapshot de performance.

- `decisionVideoLinkId` e `snapshotId`: origem rastreável da avaliação;
- `learningInsightId`: memória revisável opcional compartilhada por outcomes sucessivos do mesmo aprendizado;
- `baseline`, `facts`, `comparison` e `interpretation`: estruturas explícitas da análise;
- `supportingMetrics`, `contradictingMetrics` e `missingData`: sustentação e limites;
- `hypotheses`: próximos testes editoriais, não afirmações causais;
- `confidence` e `classification`: confiança entre 0 e 1 e estado `POSITIVE`, `MIXED`, `NEGATIVE` ou `INCONCLUSIVE`;
- `@@unique([decisionVideoLinkId, snapshotId])`: reavaliação do mesmo estado atualiza o outcome existente.

```text
EditorialDecision 1 -> N EditorialDecisionVideoLink
VideoPerformanceSnapshot 1 -> N EditorialDecisionVideoLink (snapshot de origem)
EditorialDecisionVideoLink 1 -> N EditorialDecisionOutcome
VideoPerformanceSnapshot 1 -> N EditorialDecisionOutcome (snapshot avaliado)
ChannelInsight 1 -> N EditorialDecisionOutcome
```

A migration `20260825233000_decision_outcome_loop` é aditiva: inclui `engagedViews` opcional, cria vínculos e outcomes e preserva snapshots e decisões existentes. O provider YouTube Analytics solicita a métrica real; quando a API não a fornece, o campo permanece `null` sem estimativa.

### EditorialDecisionOutcomeReview

Histórico append-only de uma revisão explícita de outcome.

- `sourceOutcomeId` e `resultOutcomeId`: estado anterior e resultado persistido da revisão;
- `previousSnapshotId` e `currentSnapshotId`: evidências comparadas;
- `reviewKey`: fingerprint único do outcome e da evidência atual, usado para deduplicação;
- `status`: `pending`, `reviewed`, `unchanged` ou `failed`;
- classificação, confiança e estados anterior/atual preservam a evolução sem sobrescrever o histórico;
- `changedMetrics`, `reason` e `errorType` registram somente metadados operacionais seguros.

```text
EditorialDecisionOutcome 1 -> N EditorialDecisionOutcomeReview (origem)
EditorialDecisionOutcome 1 -> N EditorialDecisionOutcomeReview (resultado opcional)
VideoPerformanceSnapshot 1 -> N EditorialDecisionOutcomeReview (anterior e atual)
```

A migration `20260826010000_outcome_review_refresh` remove apenas a unicidade antiga de `learningInsightId`, cria índice não exclusivo e adiciona a tabela de revisões. Outcomes, snapshots e aprendizados existentes são preservados.

### OrchestrationExecution

Memória estruturada e limitada de uma execução do Gerente.

- `intent` e `objective`: interpretação e objetivo operacional;
- `request` e `plan`: entrada validada e plano criado antes da execução;
- `capabilities`: IDs reais selecionados;
- `result`, `evidence` e `failures`: resposta consolidada, evidências classificadas e falhas sanitizadas;
- `status`: `pending`, `running`, `completed`, `partial` ou `failed`;
- `idempotencyKey`: chave opcional e única para deduplicação explícita;
- `projectId` e `conversationId`: escopos opcionais; somente projeto possui relação Prisma nesta etapa;
- timestamps permitem observar ordem e duração sem guardar logs sensíveis.

Na Sprint 36, o mesmo modelo também persiste a consulta autônoma sem migration adicional:

- `request.managerIntent`: intent estrutural do Gerente;
- `request.context`: projeto, conversa, candidatos explícitos e limite de memória relevante;
- `id`: correlation ID de ponta a ponta;
- `result.operatorInvocations`: operador/capability, motivo, status, duração e tipo seguro de erro;
- `result.evidenceItems`: fatos, inferências e recomendações com origem;
- `result.conflicts`: sinais incompatíveis preservados e seu efeito;
- `result.confidenceBasis`: disponibilidade, qualidade, freshness, amostra e penalidades;
- `result.outcome`: `ANSWERED`, `DEGRADED` ou `INSUFFICIENT_DATA`;
- `result.decision`: referência limitada à decisão criada pelo Decision Engine, quando aplicável.

O registro é append-only no uso do Gerente. Histórico, abertura e diagnóstico leem esse snapshot; não sobrescrevem execuções anteriores. A persistência em JSON mantém compatibilidade com execuções das Sprints 25–35 e evita uma tabela paralela para a mesma unidade transacional.

```text
Project 1 -> N OrchestrationExecution
Conversation ID 0..1 -> N OrchestrationExecution (referência lógica)

### PlanReview

Review único por `OrchestrationExecution`. Persiste estado, revisor, decisão, motivo, risco, efeito dominante, aprovações exigidas, versão otimista, hash do plano, snapshot aprovado e validade. Estados: `draft`, `review_required`, `approved`, `rejected`, `expired`, `executed`.

### OrchestrationAuditEvent

Evento append-only ligado à execução. Registra `PLAN_CREATED`, `PLAN_REVIEWED`, `PLAN_APPROVED`, `PLAN_REJECTED`, `PLAN_EXPIRED`, `EXECUTION_ATTEMPTED`, `EXECUTION_BLOCKED` e `PLAN_EXECUTED`, sem payload externo bruto ou credencial.

```text
OrchestrationExecution 1 -> 0..1 PlanReview
OrchestrationExecution 1 -> N OrchestrationAuditEvent
```
```

A migration `20260826150000_controlled_orchestration_foundation` é aditiva e não altera conversas, decisões, outcomes ou snapshots existentes.

## Controlled Automation Runner

### Automation

Definição persistida de uma rotina. Mantém os campos legados `trigger` e `action` por compatibilidade e acrescenta:

- `triggerType`: `MANUAL_ONLY`, `DAILY` ou `WEEKLY`;
- `schedule`: JSON limitado a horário e, para semanal, dia de 0 a 6;
- `timezone`: timezone IANA usado no cálculo;
- `intent` e `orchestrationInput`: request neutro entregue ao Orchestrator, sem confirmação externa;
- `status`: `DISABLED`, `ACTIVE`, `PAUSED`, `BLOCKED` ou `ERROR`;
- `riskLevel` e `sideEffectLevel`: classificação do plano real;
- `nextRunAt` e `lastRunAt`: estado operacional, sem polling embutido.

### AutomationRun

Uma ocorrência manual ou agendada. `occurrenceKey` é única dentro da automação, `triggerSource` distingue `MANUAL`/`SCHEDULED`, e `orchestrationExecutionId` liga logicamente o run ao plano/review. Estados: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED` e `BLOCKED`.

O índice parcial `AutomationRun_one_active_per_automation` impede mais de um run `PENDING`/`RUNNING` por automação. A unicidade `(automationId, occurrenceKey)` impede repetição da mesma agenda.

### AutomationAuditEvent

Evento append-only da definição/run. Registra criação, alteração, mudança de estado, vencimento, início, sucesso, falha e bloqueio. `details` contém apenas metadados operacionais seguros.

```text
Project 1 -> N Automation
Automation 1 -> N AutomationRun
Automation 1 -> N AutomationAuditEvent
```

A migration `20260828120000_controlled_automation_runner` é aditiva: preserva definições legadas como `MANUAL_ONLY`/`DISABLED`, cria runs/auditoria e não altera conversas, decisões ou dados de performance.

### AutomationRuntimeEvent

Evento operacional global e append-only do runtime local. Mantém `eventType`, `status`, `details` JSON sanitizado e `createdAt`. Os tipos atuais são `RUNTIME_STARTED`, `RUNTIME_STOPPED`, `RUNTIME_TICK_STARTED`, `RUNTIME_TICK_COMPLETED`, `RUNTIME_TICK_FAILED`, `MISSED_OCCURRENCE`, `RUN_INTERRUPTED` e `RUN_RECOVERED`.

Os índices `(eventType, createdAt)` e `createdAt` suportam diagnóstico recente sem carregar histórico de runs. A migration `20260829100000_safe_automation_runtime` cria apenas essa tabela e seus índices, preservando todas as definições, runs e auditorias anteriores.

### AutomationGovernancePolicy

Relação opcional 1:1 com `Automation`. Guarda `enabled`, quotas diária/semanal, cooldown, janelas JSON, threshold de falhas, auto-pause, aprovação manual e retry policy. Ausência de registro usa defaults conservadores: 10 runs/dia, 50/semana, zero cooldown, janela livre, threshold 3 e zero retry.

`AutomationRun.sourceRunId` liga logicamente retry/recovery ao run anterior sem sobrescrevê-lo. O status textual também admite `SKIPPED`, que não consome quota. A migration `20260830100000_automation_operational_governance` adiciona somente a coluna, índice e tabela de policy, preservando automações e runs anteriores.

## AudienceSnapshot e AudienceSyncState

`AudienceSnapshot` representa uma observação agregada oficial de audiência:

- escopo opcional `projectId`;
- `ingestionKey` única;
- `dimension`, `segment` e `format`;
- `periodStart`/`periodEnd`;
- views, engaged views, watch time e médias somente quando compatíveis;
- `source = youtube-analytics-audience` e `collectedAt`;
- freshness, qualidade, razões e metadados técnicos mínimos.

`AudienceSyncState` mantém por fonte o estado, última sincronização, tipo seguro do último erro e dimensões ausentes. Ele não contém token, query privada ou credencial.

```text
Project 1 -> N AudienceSnapshot
AudienceSyncState (global por source)
```

A identidade não mistura projetos e evita duplicar a mesma dimensão/segmento/formato/período. Valores ausentes permanecem `null`; supressão de termos de busca não produz linhas artificiais.

## Inteligência temporal, séries e padrões

### TrendSignal

Representa uma leitura derivada e reprodutível de uma dimensão (`CHANNEL`, `FORMAT`, `GAME`, `SERIES`, `TRAFFIC_SOURCE`, `COUNTRY`, `DEVICE` ou `SUBSCRIBER_SEGMENT`) e métrica. Guarda classificação, janelas comparadas, valores, variação, confiança, amostra, qualidade, evidências e chave única de derivação. Pertence opcionalmente a um `Project`.

### SeriesDefinition e VideoSeriesLink

`SeriesDefinition` guarda nome, descrição opcional, origem e timestamps. `VideoSeriesLink` associa a série a um `VideoPerformanceSnapshot`, registra `MANUAL`, `AUTO` ou `IMPORTED`, confiança e evidência, e impede duplicar o mesmo vídeo na mesma série. O vínculo é corrigível sem alterar o snapshot original.

### ContentPattern

Registra associação derivada por `GAME`, `FORMAT`, `SERIES`, `TOPIC`, `TRAFFIC_MIX` ou `AUDIENCE_SEGMENT`. Mantém força, confiança, amostra, recência, métricas e evidências. O conteúdo representa hipótese operacional revisável, não causalidade.

Relações principais:

- `Project 1:N TrendSignal`;
- `Project 1:N SeriesDefinition`;
- `Project 1:N ContentPattern`;
- `SeriesDefinition 1:N VideoSeriesLink`;
- `VideoPerformanceSnapshot 1:N VideoSeriesLink`.

## ResearchHistory e ResearchOpportunity

### ResearchHistory

Execução persistida de pesquisa. Guarda escopo opcional de projeto, query original e normalizada, intent, assunto, fontes, resultados, qualidade, freshness, limitações, contexto técnico seguro, instante de pesquisa e validade do cache. `cacheKey` agrupa pesquisas comparáveis; `executionKey` impede duplicação dentro da mesma janela sem impedir comparações futuras.

### ResearchOpportunity

Candidato derivado de uma pesquisa persistida. Guarda rank, assunto/tipo, estado de descoberta, resumo, fontes, evidências, freshness, compatibilidade, confiança, riscos, lacunas e próxima investigação. A relação pertence a um `ResearchHistory` e a chave é única dentro daquela execução.

```text
Project 1 -> N ResearchHistory
ResearchHistory 1 -> N ResearchOpportunity
```

Excluir um histórico remove somente suas oportunidades derivadas. Excluir um projeto preserva a pesquisa com `projectId = null`. Nenhuma tabela armazena token, credencial, payload bruto de provider ou previsão de views.

## Strategic Planning

### ContentPlan

Versão persistida de um plano estratégico. Guarda `projectId` opcional, horizonte, status, resumo, balanceamento, restrições, riscos, fontes e `generatedAt`. A consulta atual seleciona a versão mais recente; gerar novamente não sobrescreve versões anteriores.

### PlannedContentItem

Item ordenado do plano. Pode referenciar `EditorialDecision`, `ResearchOpportunity`, `ResearchHistory` e `SeriesDefinition`. Mantém candidato, título, justificativa, status, prioridade, esforço, readiness, fila, posição, score de execução, evidências, riscos, restrições, dados ausentes e dependências. A chave `(planId, candidateKey)` impede duplicação dentro da mesma versão.

### PlanningHistory

Journal append-only por plano e, opcionalmente, item. Registra evento, motivo, snapshot anterior/posterior e timestamp para geração, criação manual, repriorização, mudança de status, reorder, pesquisa e conclusão.

```text
Project 1 -> N ContentPlan
ContentPlan 1 -> N PlannedContentItem
ContentPlan 1 -> N PlanningHistory
PlannedContentItem 1 -> N PlanningHistory
EditorialDecision 1 -> N PlannedContentItem
ResearchOpportunity 1 -> N PlannedContentItem
ResearchHistory 1 -> N PlannedContentItem
SeriesDefinition 1 -> N PlannedContentItem
```

Campos JSON preservam a evidência estruturada já produzida pelos domínios de origem; não guardam token, segredo ou payload externo bruto. Excluir referências opcionais usa `SET NULL`, enquanto excluir um plano remove somente seus itens e histórico em cascade.
