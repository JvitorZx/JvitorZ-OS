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

### VideoPerformanceSnapshot

Registro normalizado de desempenho de um vídeo em um projeto, fonte e período. `ingestionKey` é única e identifica `projectId + source + videoId + periodStart + periodEnd`. Campos observáveis incluem views, views engajadas, impressões, CTR, duração, AVD, percentual médio assistido, watch time, inscritos ganhos, inscritos perdidos, likes e comentários.

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

As relações usam `ON DELETE SET NULL` para preservar a memória editorial quando uma origem opcional deixa de existir. A migration `20260825220000_editorial_decision_loop` é aditiva e cria tabela, índices, chaves estrangeiras e unicidade sem alterar registros anteriores.

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

A migration `20260825233000_decision_outcome_loop` é aditiva: inclui `engagedViews` opcional, cria vínculos e outcomes e preserva snapshots e decisões existentes. O provider YouTube atual não oferece `engagedViews`, portanto grava `null` sem estimativa.

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
