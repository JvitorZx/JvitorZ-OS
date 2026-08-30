# ERD

## Diagrama textual das entidades

User
├── id
├── email
├── name
├── role
├── createdAt
└── updatedAt

Project
├── id
├── name
├── description
├── ownerId -> User.id
├── createdAt
└── updatedAt

Conversation
├── id
├── projectId -> Project.id
├── title
├── context
├── createdAt
└── updatedAt

Message
├── id
├── conversationId -> Conversation.id
├── sender
├── text
├── libraryItem -> LibraryItem (opcional)
└── createdAt

Operator
├── id
├── name
├── description
├── status
├── createdAt
└── updatedAt

LibraryItem
├── id
├── projectId -> Project.id
├── sourceMessageId -> Message.id (opcional, único, ON DELETE SET NULL)
├── title
├── type
├── content
├── createdAt
└── updatedAt

ConversationLibraryItem
├── conversationId -> Conversation.id (ON DELETE CASCADE)
├── libraryItemId -> LibraryItem.id (ON DELETE CASCADE)
└── createdAt

Automation
├── id
├── projectId -> Project.id
├── name
├── description
├── trigger
├── action
├── triggerType, schedule, timezone
├── intent, orchestrationInput
├── status, riskLevel, sideEffectLevel
├── enabled
├── nextRunAt, lastRunAt
├── createdAt
└── updatedAt

AutomationRun
├── id
├── automationId -> Automation.id (ON DELETE CASCADE)
├── occurrenceKey (único por automação)
├── triggerSource, status, scheduledFor
├── orchestrationExecutionId (referência lógica)
├── resultSummary, failureReason, attempt
└── startedAt, completedAt, createdAt, updatedAt

AutomationAuditEvent
├── id
├── automationId -> Automation.id (ON DELETE CASCADE)
├── runId (referência lógica opcional)
├── eventType, reason, details
└── createdAt

AutomationRuntimeEvent
├── id
├── eventType
├── status
├── details
└── createdAt

AutomationGovernancePolicy
├── automationId -> Automation.id (PK, ON DELETE CASCADE)
├── enabled
├── maxRunsPerDay, maxRunsPerWeek
├── cooldownMinutes, allowedExecutionWindows
├── maxConsecutiveFailures, pauseOnRepeatedFailure
├── manualApprovalRequired, retryPolicy
└── createdAt, updatedAt

Setting
├── id
├── key
├── value
├── description
├── createdAt
└── updatedAt

AnalyticsSnapshot
├── id
├── projectId -> Project.id
├── metrics
├── summary
└── createdAt

VideoIdea
├── id
├── projectId -> Project.id
├── game, theme, format, premise
├── estimatedEffort, novelty, identityFit
└── createdAt, updatedAt

ContentDecision
├── id
├── videoIdeaId -> VideoIdea.id (ON DELETE CASCADE)
├── category, score, rationale, evidence
└── createdAt

ChannelInsight
├── id
├── projectId -> Project.id
├── key (único)
├── category, subject, statement
├── confidence, classification, evidence
└── createdAt, updatedAt

VideoPerformanceSnapshot
├── id
├── projectId -> Project.id
├── ingestionKey (único)
├── videoId, title, game, series, format
├── publishedAt, periodStart, periodEnd
├── views, engagedViews, impressions, ctr, durationSeconds
├── averageViewDurationSeconds, averageViewPercentage, watchTimeMinutes
├── subscribersGained, likes, comments
├── source, confidence, collectedAt
└── createdAt, updatedAt

PerformanceSignal
├── id
├── projectId -> Project.id
├── videoIdeaId -> VideoIdea.id
├── performanceSnapshotId -> VideoPerformanceSnapshot.id (ON DELETE CASCADE)
├── key (opcional, único)
├── game, series, format, metric, value
├── sampleSize, source, classification, confidence
└── measuredAt, createdAt

EditorialDecision
├── id
├── projectId -> Project.id (ON DELETE SET NULL)
├── conversationId -> Conversation.id (ON DELETE SET NULL)
├── operatorMessageId -> Message.id (ON DELETE SET NULL, único)
├── outcomeSnapshotId -> VideoPerformanceSnapshot.id (contrato legado)
├── dedupeKey (único)
├── question, intent, recommendation, alternatives
├── score, confidence, classification, category
├── candidateType, candidateKey, opportunityScore
├── favorableEvidence, contraryEvidence, constraints
├── evidence, risks, missingData, nextAction, outcome
└── createdAt, updatedAt

EditorialDecisionVideoLink
├── id
├── decisionId -> EditorialDecision.id (ON DELETE CASCADE)
├── sourceSnapshotId -> VideoPerformanceSnapshot.id (ON DELETE RESTRICT)
├── videoId
├── origin, notes, linkedAt
└── unique(decisionId, videoId)

EditorialDecisionOutcome
├── id
├── decisionVideoLinkId -> EditorialDecisionVideoLink.id (ON DELETE CASCADE)
├── snapshotId -> VideoPerformanceSnapshot.id (ON DELETE RESTRICT)
├── learningInsightId -> ChannelInsight.id (ON DELETE SET NULL)
├── baseline, facts, comparison, interpretation
├── supportingMetrics, contradictingMetrics, missingData, hypotheses
├── confidence, classification, evaluatedAt, updatedAt
└── unique(decisionVideoLinkId, snapshotId)

EditorialDecisionOutcomeReview
├── id
├── sourceOutcomeId -> EditorialDecisionOutcome.id (ON DELETE CASCADE)
├── resultOutcomeId -> EditorialDecisionOutcome.id (ON DELETE SET NULL)
├── previousSnapshotId -> VideoPerformanceSnapshot.id (ON DELETE RESTRICT)
├── currentSnapshotId -> VideoPerformanceSnapshot.id (ON DELETE RESTRICT)
├── reviewKey (unique)
├── status, reason, changedMetrics, errorType
├── previousClassification, currentClassification
├── previousConfidence, currentConfidence
├── previousState, currentState
└── startedAt, completedAt

## Relacionamentos

- User 1:N Project
- Project 1:N Conversation
- Conversation 1:N Message
- Project 1:N LibraryItem
- Message 1:0..1 LibraryItem
- Conversation N:N LibraryItem, via ConversationLibraryItem
- Project 1:N Automation
- Automation 1:N AutomationRun
- Automation 1:N AutomationAuditEvent
- `AutomationRuntimeEvent` é global e não possui foreign key; IDs de automação/run em `details` são metadados operacionais.
- Automation 1:0..1 AutomationGovernancePolicy
- `AutomationRun.sourceRunId` registra origem lógica de retry/recovery e possui índice próprio.
- Project 1:N AnalyticsSnapshot
- Project 1:N VideoPerformanceSnapshot
- Project 1:N VideoIdea
- Project 1:N ChannelInsight
- VideoIdea 1:N ContentDecision
- VideoPerformanceSnapshot 1:N PerformanceSignal
- EditorialDecision 1:N EditorialDecisionVideoLink
- VideoPerformanceSnapshot 1:N EditorialDecisionVideoLink
- EditorialDecisionVideoLink 1:N EditorialDecisionOutcome
- VideoPerformanceSnapshot 1:N EditorialDecisionOutcome
- ChannelInsight 1:N EditorialDecisionOutcome
- EditorialDecisionOutcome 1:N EditorialDecisionOutcomeReview como origem
- EditorialDecisionOutcome 1:N EditorialDecisionOutcomeReview como resultado opcional
- VideoPerformanceSnapshot 1:N EditorialDecisionOutcomeReview

## Observações

- As entidades suportam projetos de conteúdo, conversas, mensagens, artefatos persistidos e dados de análise.
- `LibraryItem.sourceMessageId` garante no máximo um artefato por mensagem de origem; itens legados sem origem permanecem válidos.
- `ConversationLibraryItem` usa chave composta entre conversa e item, não copia conteúdo e é removido em cascata com qualquer lado da associação.
- `VideoPerformanceSnapshot.ingestionKey` impede duplicação do mesmo projeto/fonte/vídeo/período; campos ausentes permanecem nulos.
- `VideoPerformanceSnapshot.subscribersLost` é opcional e recebe dados reais do YouTube Analytics; snapshots anteriores permanecem válidos com `null`.

## Reach Reporting

```text
Project 1 ─── N VideoReachSnapshot

VideoReachSnapshot
  ingestionKey UNIQUE
  videoId
  periodStart / periodEnd
  impressions / ctr
  source / reportId / jobId
  collectedAt
  freshnessAtCollection / qualityAtCollection / qualityReasons

ReachSyncState
  source PK
  reportTypeId / jobId
  state / lastReportAt / lastSyncAt / lastErrorType
```

O alcance não possui FK para `VideoPerformanceSnapshot`: os providers têm granularidade e atraso diferentes. A junção para análise usa `videoId` e janelas temporais na camada de serviço, preservando as fontes originais.

## Strategic Planning

```text
Project 1 --- N ContentPlan
ContentPlan 1 --- N PlannedContentItem
ContentPlan 1 --- N PlanningHistory
PlannedContentItem 1 --- N PlanningHistory
ContentPlan 1 --- N PlanningExecutionEvent
PlannedContentItem 1 --- N PlanningExecutionEvent

EditorialDecision 1 --- N PlannedContentItem (opcional, ON DELETE SET NULL)
ResearchOpportunity 1 --- N PlannedContentItem (opcional, ON DELETE SET NULL)
ResearchHistory 1 --- N PlannedContentItem (opcional, ON DELETE SET NULL)
SeriesDefinition 1 --- N PlannedContentItem (opcional, ON DELETE SET NULL)
```

`ContentPlan` é a versão do plano. `PlannedContentItem` usa `unique(planId, candidateKey)`, índice `(planId, position)` e índice parcial único por `planId` quando `executionState = in_progress`. `PlanningHistory` registra toda mudança do plano; `PlanningExecutionEvent` registra estado, ação, motivo, confiança e snapshot estratégico de cada transição operacional. Ambos são append-only no fluxo de aplicação.
- `VideoPerformanceSnapshot.engagedViews` é opcional; permanece `null` quando o provider não a fornece e nunca é estimado.
- `PerformanceSignal.key` torna sinais derivados idempotentes e sua relação registra a evidência de origem.
- vínculos usam snapshots reais e são únicos por decisão/vídeo; outcomes são únicos por vínculo/snapshot.
- classificações de outcome representam comparação observada, não causalidade.
- revisões preservam estado anterior e resultado, e `reviewKey` impede repetir a mesma evidência.
- A modelagem preserva a arquitetura de futuro com PostgreSQL sem alterar o frontend ou as APIs.

```text
OrchestrationExecution
├── id
├── projectId -> Project.id (ON DELETE SET NULL)
├── conversationId (referência lógica opcional)
├── idempotencyKey (unique, opcional)
├── intent, objective, status
├── capabilities, request, plan
├── result, evidence, failures, errorType
└── startedAt, completedAt, createdAt, updatedAt
```

- Project 1:N OrchestrationExecution

```text
OrchestrationExecution
  1 ─── 0..1 PlanReview
  1 ─── N OrchestrationAuditEvent
```

`PlanReview.executionId` é único. Review e auditoria usam `ON DELETE CASCADE` para não deixar estado operacional órfão quando uma execução for removida.
- A execução referencia capabilities por ID de contrato, sem foreign key para módulos ou classes concretas.

## Audience Intelligence

```text
Project 1 ─── N AudienceSnapshot

AudienceSnapshot
  ingestionKey UNIQUE
  dimension / segment / format
  periodStart / periodEnd
  views / engagedViews / watchTimeMinutes
  averageViewDurationSeconds / averageViewPercentage
  source / collectedAt
  freshnessAtCollection / qualityAtCollection / qualityReasons

AudienceSyncState
  source PK
  state / lastSyncAt / lastErrorType / missingData
```

`AudienceSyncState` é global por provider e não possui FK. `AudienceSnapshot.projectId` usa `ON DELETE SET NULL`, preservando a evidência agregada. A análise cruza formatos apenas em leitura e nunca transforma país em idioma ou origem em causalidade.

## Trends, Series e Patterns

```text
Project 1 ─── N TrendSignal
Project 1 ─── N SeriesDefinition
Project 1 ─── N ContentPattern

SeriesDefinition 1 ─── N VideoSeriesLink
VideoPerformanceSnapshot 1 ─── N VideoSeriesLink
```

`TrendSignal.key` identifica uma derivação temporal sem alterar a evidência de origem. `VideoSeriesLink` possui unicidade por série e snapshot, registra modo de vínculo e pode ser removido sem remover vídeo ou série. `ContentPattern.key` torna a associação derivada atualizável e mantém amostra, recência e evidências explícitas.

## Strategic Planning Outcomes

```text
ContentPlan 1 --- N PlanningOutcomeLink
PlannedContentItem 1 --- N PlanningOutcomeLink
PlanningExecutionEvent 1 --- N PlanningOutcomeLink
VideoPerformanceSnapshot 1 --- N PlanningOutcomeLink

PlanningOutcomeLink 1 --- N PlanningOutcome
VideoPerformanceSnapshot 1 --- N PlanningOutcome
PlanningExecutionEvent 1 --- N PlanningOutcome

ContentPlan 1 --- N PlanningOutcomeAuditEvent
PlannedContentItem 1 --- N PlanningOutcomeAuditEvent
```

`PlanningOutcomeLink.activeItemKey` e `activeVideoKey` são únicos e opcionais: existem somente no vínculo atual. Remoção/correção mantém a linha histórica. `PlanningOutcome` usa `unique(linkId, snapshotId)`; janelas diferentes geram snapshots distintos. A auditoria é append-only. Essa estrutura registra comparação observada, não causalidade.

## Strategic Learning Memory

```text
Project 1 --- N StrategicLearning
StrategicLearning 1 --- N StrategicLearningEvidence
PlanningOutcome 1 --- N StrategicLearningEvidence
StrategicLearning 1 --- N StrategicLearningRevision
```

`StrategicLearning.key` identifica o grupo estruturado e comparavel. `StrategicLearningEvidence` possui unicidade `(learningId, outcomeId)`. A trilha ate outcome, snapshot, execucao, item e video e reconstruivel por FKs.

## Strategic Experimentation

```text
Project / StrategicLearning 1 --- N StrategicExperiment
StrategicExperiment 1 --- 1 ExperimentHypothesis
StrategicExperiment 1 --- N Variant / Metric / Constraint / Observation
PlanningOutcome 1 --- N ExperimentObservation
StrategicExperiment 1 --- 0..1 ExperimentResult
StrategicExperiment 1 --- N ExperimentEvidence / ExperimentEvent
```

`ExperimentObservation` e unica por experimento/outcome. Evidence conecta resultado a observacao e, quando disponivel, ao aprendizado reavaliado.

## Strategic Monitoring

```text
Project 1 --- N StrategicSignal
Project 1 --- N MonitoringSnapshot

StrategicSignal 1 --- N SignalEvidence
MonitoringSnapshot 1 --- N SignalEvidence

MonitoringRule
  code UNIQUE

MonitoringSnapshot
  evaluationFingerprint UNIQUE

StrategicSignal
  logicalKey UNIQUE
```

`SignalEvidence.signalId` usa `ON DELETE CASCADE`; `snapshotId` e opcional e usa `SET NULL`. `projectId` opcional em sinal/snapshot usa `SET NULL`. A modelagem preserva lifecycle e auditoria sem converter sinais em acoes automaticas.
