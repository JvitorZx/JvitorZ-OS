# Banco de Dados

## Tecnologia atual

- Banco de desenvolvimento: **SQLite**.
- ORM: **Prisma** com `@prisma/adapter-better-sqlite3`.
- Schema: `backend/prisma/schema.prisma`.
- Migrações: `backend/prisma/migrations/`.
- Banco local padrão: `backend/prisma/dev.db`.
- A variável `DATABASE_URL` pode substituir o caminho padrão.

`DatabaseService` mantém uma única instância do `PrismaClient` e concentra a configuração de conexão. Rotas HTTP não acessam Prisma diretamente; o acesso passa por serviços e repositories.

## Fluxo de persistência do Planner

```text
Rotas do Planner
  -> PlannerService
    -> ConversationRepository / MessageRepository
      -> Prisma Client
        -> SQLite
```

As conversas, mensagens e contextos do Planejador já possuem persistência real. Reiniciar ou reabrir o frontend não remove esses dados do SQLite.

Os artefatos da Biblioteca seguem a mesma arquitetura:

```text
Rotas da Biblioteca
  -> LibraryService
    -> ConversationRepository / MessageRepository / LibraryItemRepository
      -> Prisma Client
        -> SQLite
```

## Conversation

`Conversation` representa uma sessão persistida do Planejador.

| Campo | Tipo | Regra atual |
| --- | --- | --- |
| `id` | `String` | Chave primária gerada pelo Prisma. |
| `projectId` | `String?` | Relação opcional com `Project`. |
| `title` | `String?` | Título da conversa; o serviço usa `Nova conversa` quando o título não é informado ou fica vazio após `trim()`. |
| `context` | `String?` | Prompt-base/contexto exclusivo da conversa. |
| `createdAt` | `DateTime` | Data de criação. |
| `updatedAt` | `DateTime` | Atualizado automaticamente pelo Prisma. |

O campo `context` substitui o armazenamento anterior do prompt-base no navegador. Texto não vazio é normalizado com `trim()`; string vazia ou composta apenas por espaços limpa o contexto e persiste `null`.

`ConversationRepository` implementa:

- criação de conversa;
- listagem por `updatedAt` decrescente;
- busca por ID incluindo mensagens por `createdAt` crescente;
- atualização de `context`.

## Message

`Message` representa uma mensagem persistida dentro de uma conversa.

| Campo | Tipo | Regra atual |
| --- | --- | --- |
| `id` | `String` | Chave primária gerada pelo Prisma. |
| `conversationId` | `String` | Relação obrigatória com `Conversation`. |
| `sender` | `String` | Validado pela aplicação como `user`, `system` ou `operator`. |
| `text` | `String` | Conteúdo textual obrigatório e não vazio após `trim()`. |
| `createdAt` | `DateTime` | Data de criação usada na ordenação cronológica. |

`MessageRepository` cria mensagens e permite consultá-las por conversa em ordem crescente de `createdAt`. A abertura de uma conversa também retorna suas mensagens nessa ordem.

## LibraryItem

`LibraryItem` representa um artefato persistido da Biblioteca. Na Sprint 16, ele é criado a partir de uma mensagem `operator` já persistida.

| Campo | Tipo | Regra atual |
| --- | --- | --- |
| `id` | `String` | Chave primária gerada pelo Prisma. |
| `projectId` | `String?` | Projeto opcional herdado da conversa de origem. |
| `sourceMessageId` | `String?` | Mensagem de origem opcional e única. Itens legados podem manter `null`. |
| `title` | `String` | Derivado deterministicamente do título da conversa ou usa `Resposta do Planner`. |
| `type` | `String?` | Usa `resource` para artefatos do Planner. |
| `content` | `String?` | Cópia do texto persistido da mensagem `operator`. |
| `createdAt` | `DateTime` | Data de criação. |
| `updatedAt` | `DateTime` | Atualizado automaticamente pelo Prisma. |

A relação entre `LibraryItem` e `Message` usa `ON DELETE SET NULL`: remover uma mensagem de origem não remove o artefato. A unicidade de `sourceMessageId` garante idempotência persistente. A primeira gravação cria o item; tentativas sequenciais ou concorrentes retornam o mesmo registro sem duplicação.

`LibraryItemRepository` implementa criação, listagem determinística por `createdAt` e `id` decrescentes, busca por ID e busca por `sourceMessageId`.

## ConversationLibraryItem

`ConversationLibraryItem` representa quais artefatos estão explicitamente ativos como memória de uma conversa. A associação não copia título, tipo nem conteúdo do artefato.

| Campo | Tipo | Regra atual |
| --- | --- | --- |
| `conversationId` | `String` | Referência obrigatória a `Conversation.id`. |
| `libraryItemId` | `String` | Referência obrigatória a `LibraryItem.id`. |
| `createdAt` | `DateTime` | Data do vínculo, usada na futura ordenação crescente. |

`conversationId` e `libraryItemId` formam a chave primária composta, impedindo que o mesmo item seja vinculado duas vezes à mesma conversa. Uma conversa pode ter vários itens e um item pode participar de várias conversas. As duas relações usam `ON DELETE CASCADE`: excluir uma conversa ou um item remove somente seus vínculos. O índice `(conversationId, createdAt, libraryItemId)` suporta ordenação determinística, e o índice por `libraryItemId` suporta consultas inversas.

A migration `20260823180000_conversation_library_items` é aditiva: cria a nova tabela vazia sem reescrever `Conversation`, `Message` ou `LibraryItem`.

`ConversationLibraryItemRepository` cria e consulta vínculos, inclui o `LibraryItem` real na listagem, conta associações e remove somente o vínculo. A ordem é `createdAt ASC`, seguida de `libraryItemId ASC`.

Para garantir o máximo de cinco itens mesmo com chamadas concorrentes, a criação limitada usa um único statement parametrizado: o banco insere apenas quando a contagem ainda é menor que cinco e ignora conflito da chave composta. No SQLite, o lock do statement de escrita serializa a decisão e a inserção; duas inclusões diferentes partindo de quatro resultam em uma criação e uma rejeição por limite, nunca seis registros.

## VideoPerformanceSnapshot e PerformanceSignal

`VideoPerformanceSnapshot` persiste métricas observadas de um vídeo para um projeto, fonte e período. A chave `ingestionKey` é única; nova ingestão do mesmo projeto, fonte, vídeo e período atualiza o snapshot existente. Métricas não fornecidas permanecem `null`. `source`, `confidence` e `collectedAt` preservam provenance.

O campo opcional `subscribersLost` registra a métrica homônima quando fornecida pelo YouTube Analytics. A migration `20260825100000_youtube_analytics_subscribers_lost` adiciona a coluna sem reescrever snapshots existentes; registros anteriores recebem `null`.

## Reach Reporting e Data Quality

A migration `20260827213000_reach_reporting_data_quality` é aditiva. Ela cria `VideoReachSnapshot` e `ReachSyncState`, sem reescrever snapshots de performance, conversas, decisões ou automações. A identidade de ingestão impede duplicar o mesmo vídeo/período/fonte; reprocessamento atualiza a linha existente.

`VideoReachSnapshot` preserva o dado oficial recebido, inclusive anomalias numéricas que precisam ser sinalizadas. O `DataQualityService` não corrige valores silenciosamente: classifica inconsistências e freshness em leitura. Em falha externa, linhas anteriores não são apagadas e funcionam como last-known-good.

`PerformanceSignal` pode apontar para o snapshot de origem e usa `key` única para substituir sinais derivados sem duplicação. A relação usa `ON DELETE CASCADE`: remover um snapshot remove somente seus sinais derivados. Sinais legados sem snapshot continuam válidos.

`engagedViews` é uma métrica opcional adicionada pela migration `20260825233000_decision_outcome_loop`. O provider solicita o valor real ao YouTube Analytics; ausência continua representada por `null`, sem derivação ou estimativa.

## ChannelSnapshot

`ChannelSnapshot` guarda o último dado válido do canal obtido pela YouTube Data API. `channelId` é único; novas coletas atualizam o registro e preservam a data da última coleta bem-sucedida. Quando o provider está temporariamente indisponível, `ChannelDataService` lê esse registro sem apagar ou substituir informação por placeholders.

A migration `20260831200000_live_channel_snapshot` cria a tabela e o índice por `collectedAt`. Antes de aplicá-la ao banco local foi criado backup, conferido hash e executado `PRAGMA integrity_check`; a migration também é testada em SQLite isolado.

A migration `20260824213000_performance_intelligence` cria snapshots, preserva sinais anteriores e adiciona série, confiança, chave e relação de origem. Os testes aplicam a migration em SQLite em memória.

## EditorialDecision e Opportunity Ranking

`EditorialDecision` continua sendo o histórico persistente e append-only das decisões editoriais. A Sprint 35 acrescenta `category`, identidade opcional do candidato, snapshot estruturado `opportunityScore`, evidências favoráveis/contrárias e restrições. O `dedupeKey` permanece a garantia contra cópia do mesmo estado de evidência; dados novos produzem uma nova decisão, sem sobrescrever a anterior.

`DecisionHistoryRepository` encapsula decisão atual, histórico, oportunidades e riscos. O repository não calcula métricas: recebe a decisão consolidada do serviço e preserva a ordem `createdAt DESC, id DESC`.

A migration `20260902100000_editorial_opportunity_ranking` é aditiva e compatível com SQLite. Registros anteriores recebem `category = INSUFFICIENT_DATA`, arrays vazios para os novos campos e mantêm integralmente recomendação, evidências, outcomes e vínculos existentes.

## EditorialDecisionVideoLink e EditorialDecisionOutcome

`EditorialDecisionVideoLink` liga uma decisão a um `videoId` derivado de um `VideoPerformanceSnapshot` real. A unicidade `(decisionId, videoId)` impede duplicação sequencial e concorrente. O snapshot de origem usa `ON DELETE RESTRICT`, preservando a prova do vínculo; remover a decisão remove seus vínculos em cascata.

`EditorialDecisionOutcome` guarda uma avaliação por vínculo e snapshot. Baseline, fatos, comparação, interpretação, métricas favoráveis/contrárias, lacunas e hipóteses são JSON estruturado; confiança e classificação permanecem campos explícitos. A unicidade `(decisionVideoLinkId, snapshotId)` torna a reavaliação idempotente.

O outcome pode apontar para um `ChannelInsight` revisável. Outcomes sucessivos podem apontar para o mesmo aprendizado, permitindo preservar avaliações anteriores enquanto a memória é atualizada pela chave estável. Excluir o aprendizado apenas limpa a referência (`ON DELETE SET NULL`); não remove o histórico do outcome.

A migration `20260825233000_decision_outcome_loop` apenas adiciona coluna, tabelas, índices e relações. Snapshots e decisões anteriores permanecem intactos. O teste de migration executa esse SQL em SQLite em memória e confirma preservação e unicidade.

## EditorialDecisionOutcomeReview

`EditorialDecisionOutcomeReview` registra cada tentativa manual de revisar um outcome contra evidência persistida mais recente. O registro guarda outcome e snapshot anteriores, outcome e snapshot resultantes, classificação, confiança, estado estruturado, métricas alteradas e timestamps. Falhas ficam registradas com tipo sanitizado e não apagam o outcome anterior.

`reviewKey` é único e deriva do outcome de origem e da evidência atual. Essa constraint fornece a garantia final contra revisões duplicadas; o serviço também compartilha a mesma Promise dentro do processo. Outcome, memória, decisão e conclusão da revisão são gravados em uma transação; em falha, somente a tentativa externa é marcada como `failed`. A migration `20260826010000_outcome_review_refresh` é aditiva, preserva dados existentes e torna a relação com `ChannelInsight` um-para-muitos.

## Organização

- `backend/src/database/DatabaseService.ts`: ciclo de vida do `PrismaClient`.
- `backend/src/database/repositories/PrismaRepository.ts`: base compartilhada dos repositories Prisma.
- `backend/src/database/repositories/ConversationRepository.ts`: persistência de conversas e contexto.
- `backend/src/database/repositories/MessageRepository.ts`: persistência de mensagens.
- `backend/src/database/repositories/LibraryItemRepository.ts`: persistência e consulta de artefatos.
- `backend/src/database/repositories/ConversationLibraryItemRepository.ts`: persistência atômica e consulta dos vínculos de memória.
- `backend/src/database/repositories/VideoPerformanceSnapshotRepository.ts`: snapshots idempotentes e consultas determinísticas.
- `backend/src/database/repositories/PerformanceSignalRepository.ts`: sinais históricos e substituição dos derivados por snapshot.
- `backend/src/database/repositories/DecisionHistoryRepository.ts`: histórico e consultas operacionais de decisões editoriais.
- `backend/src/database/repositories/EditorialDecisionVideoLinkRepository.ts`: vínculos persistentes entre decisão e vídeo.
- `backend/src/database/repositories/EditorialDecisionOutcomeRepository.ts`: avaliações idempotentes e consultas por escopo.
- `backend/src/database/repositories/EditorialDecisionOutcomeReviewRepository.ts`: histórico e deduplicação das revisões.
- `backend/src/services/PlannerService.ts`: regras e coordenação do domínio do Planejador.
- `backend/src/services/LibraryService.ts`: validação da origem, idempotência e coordenação da Biblioteca.
- `backend/src/services/ConversationLibraryService.ts`: validação, limite e ciclo de vínculo dos artefatos ativos.
- `backend/src/services/creator-intelligence/DecisionOutcomeService.ts`: validação, comparação, classificação e memória revisável dos resultados.
- `backend/src/services/creator-intelligence/OutcomeRefreshService.ts`: estado derivado, revisão individual/lote e status operacional.
- `backend/src/routes/operators.ts`: validação HTTP e delegação ao serviço.

## Testes

Os testes do Planner, Biblioteca e Performance Intelligence usam SQLite `:memory:` e criam somente as tabelas necessárias para cada execução. As migrations são executadas contra SQLite em memória para validar preservação, unicidade e relações. Os testes não acessam nem modificam `backend/prisma/dev.db`.

## Runtime local de automações

`AutomationRuntimeEvent` persiste eventos globais do scheduler local sem tokens, prompts ou payloads externos. A tabela não substitui `AutomationAuditEvent`: a primeira descreve lifecycle/ticks/recovery do processo; a segunda acompanha uma definição ou run específica.

A migration `20260829100000_safe_automation_runtime` é aditiva e cria a tabela e índices de consulta recente. Runs encontrados em `PENDING` ou `RUNNING` durante startup são preservados e classificados como `FAILED/Interrupted`; a recuperação é auditada e não repete a execução automaticamente.

Para aplicar localmente, faça backup de `backend/prisma/dev.db`, execute `npx prisma migrate deploy` dentro de `backend` e valide `PRAGMA integrity_check`. Testes continuam usando SQLite em memória e nunca o banco local.

## Governança operacional

`AutomationGovernancePolicy` é opcional e 1:1 com `Automation`; exclusão da automação remove sua policy em cascata. `AutomationRun.sourceRunId` é uma referência lógica indexada ao run que originou retry/recovery. Ela não usa foreign key para preservar trilhas mesmo se retenção futura remover a origem.

Quota é derivada de runs persistidos no início do dia/semana do timezone da automação. A avaliação e o claim são serializados por automação no processo; unicidade da ocorrência e índice parcial de run ativo continuam garantindo a camada persistente. A migration `20260830100000_automation_operational_governance` é aditiva e testada em SQLite isolado.

## Evolução futura

O modelo continua preparado para uma migração futura para PostgreSQL por meio do Prisma. Essa migração permanece fora do escopo atual.

## OrchestrationExecution

`OrchestrationExecution` persiste somente memória operacional relevante: intenção, plano, capabilities, resultados limitados, evidências classificadas, falhas seguras e timestamps. Não armazena tokens, secrets, prompts completos de provider ou payloads externos brutos.

## PlanReview e OrchestrationAuditEvent

`PlanReview` é uma relação 1:1 com execução. A constraint única impede reviews paralelos para o mesmo plano; `version` suporta decisão otimista; `approvedPlanHash` e `approvedPlan` congelam a versão autorizada. `validUntil` permite expiração justificável pela classe de risco. O guard compara o snapshot com o plano persistido e com o plano reconstruído pelo registro atual antes de executar.

`OrchestrationAuditEvent` é append-only e possui índices por execução/data e tipo/data. Exclusão de uma execução remove review e eventos por cascade. A migration `20260827120000_orchestration_plan_review` é aditiva e não altera registros anteriores.

O repository oferece criação, consulta por ID/chave idempotente, transição para `running`, conclusão e histórico recente. `idempotencyKey` possui constraint única; o serviço também compartilha a Promise ativa no processo para chamadas concorrentes iguais. A chave fica vinculada ao hash do request normalizado, impedindo que outro request receba ou execute o plano original.

A migration `20260826150000_controlled_orchestration_foundation` cria tabela e índices de forma aditiva. Os testes validam a migration e o repository em SQLite `:memory:`; `backend/prisma/dev.db` não é usado.

## Audience e Traffic Source

A migration aditiva `20260827223500_audience_traffic_intelligence` cria `AudienceSnapshot`, `AudienceSyncState`, índices de consulta e a relação opcional `Project 1:N AudienceSnapshot`. Ela não reescreve conversas, artefatos, decisões, performance, reach ou automações.

`AudienceSnapshot.ingestionKey` impede duplicação por fonte, projeto, dimensão, segmento, formato e período. Recoleta atualiza a linha. `AudienceSyncState` registra sync parcial/ausente/temporariamente indisponível sem apagar o last-known-good. Termos de busca suprimidos não são persistidos como dados inventados.

Antes da aplicação local foi criado backup fora do repositório e conferido por hash. A migration passou em SQLite real e em teste isolado com `foreign_key_check` e `integrity_check`.

## Trends, Series e Content Patterns

A migration `20260901120000_trends_series_patterns` é aditiva e cria `TrendSignal`, `SeriesDefinition`, `VideoSeriesLink` e `ContentPattern`, com índices de consulta, chaves de derivação e relações opcionais com `Project`. `VideoSeriesLink` referencia `VideoPerformanceSnapshot` sem copiar métricas.

Antes de aplicar a migration ao SQLite local foi criado backup fora do repositório e validado por SHA-256. Depois da aplicação, `PRAGMA integrity_check` retornou `ok`, `foreign_key_check` não encontrou violações e as contagens das 18 migrations e de todas as tabelas legadas permaneceram idênticas; a nova migration passou a ser a 19ª. O smoke derivou somente dados novos nas tabelas da Sprint 34.

Os testes aplicam a migration em SQLite isolado e não usam `backend/prisma/dev.db`. A ausência de metadados de jogo/série e a baixa cobertura temporal permanecem dados ausentes, sem preenchimento artificial.

## Strategic Planning

A migration `20260904120000_strategic_content_planning` adiciona `ContentPlan`, `PlannedContentItem` e `PlanningHistory`, seus índices e relações opcionais com Project, EditorialDecision, ResearchOpportunity, ResearchHistory e SeriesDefinition. A mudança é aditiva e não reescreve conversas, dados do YouTube, decisões ou automações existentes.

`ContentPlanRepository` consulta versões em ordem determinística; `PlannedContentItemRepository` encapsula criação, atualização, conclusão e reorder; `PlanningHistoryRepository` preserva o journal append-only. Rotas e frontend não acessam Prisma diretamente.

Os testes de domínio e migration usam SQLite isolado. O `backend/prisma/dev.db` é somente o banco local de desenvolvimento, deve ser preservado e não faz parte das fixtures ou do commit da Sprint 38.

### Execução do planejamento

A migration `20260905100000_planning_execution_guidance` acrescenta guidance e timestamps operacionais a `PlannedContentItem` e cria `PlanningExecutionEvent`. A migration é aditiva: itens legados são mapeados de `IN_PROGRESS`, `PAUSED`, `COMPLETED` e `CANCELLED`; planos, prioridades, posições e evidências existentes são preservados.

`PlanningExecutionRepository` executa a transição, a promoção da fila e os journals dentro de uma transação Prisma. O índice parcial `PlannedContentItem_one_in_progress_per_plan` impede duas execuções ativas no mesmo plano. Eventos usam `ON DELETE CASCADE` com plano/item e guardam o snapshot estratégico necessário para auditoria; não guardam segredo, credencial nem payload externo bruto.

### Strategic Planning Outcomes

A migration `20260906120000_strategic_planning_outcomes` é aditiva e cria `PlanningOutcomeLink`, `PlanningOutcome` e `PlanningOutcomeAuditEvent`. Ela não reescreve planos, execuções ou snapshots existentes.

- chaves únicas opcionais garantem um vínculo ativo por item e por vídeo;
- desvincular preserva a linha e zera somente as chaves ativas;
- `(linkId, snapshotId)` torna a captura idempotente;
- FKs para execução e snapshots usam `RESTRICT`, preservando evidência auditável;
- projeto opcional usa `SET NULL`; plano/item mantêm o ciclo de vida existente;
- auditoria registra somente IDs, classificação e metadados seguros.

O serviço usa transações Prisma para corrigir vínculo, registrar auditoria e criar outcome. Métricas ausentes permanecem `null` no snapshot e não são inventadas no JSON do outcome.

### Strategic Learning Memory

A migration `20260907120000_strategic_learning_memory` e aditiva. Cria `StrategicLearning`, `StrategicLearningEvidence` e `StrategicLearningRevision` sem reescrever outcomes, planos, execucoes, snapshots ou dados locais.

- `StrategicLearning.key` e unica e torna o grupo analitico estavel;
- `(learningId, outcomeId)` impede evidencia duplicada;
- evidencias referenciam outcomes por FK e revisoes sao append-only;
- `analysisFingerprint` torna reavaliacoes sem dados novos idempotentes;
- `projectId` opcional usa `SET NULL`; evidencia e revisao seguem o aprendizado por cascade.

Testes executam a migration em SQLite `:memory:`. O `backend/prisma/dev.db` continua local, recebe migration somente apos backup e nunca entra no commit.

### Strategic Experimentation

A migration `20260908120000_strategic_experimentation` e aditiva e cria as tabelas de definicao, observacao, resultado, evidencia e auditoria. Nao reescreve outcomes, planos, execucoes, aprendizados ou snapshots. `(experimentId, outcomeId)` impede duplicacao; outcomes usam `RESTRICT`; referencias opcionais usam `SET NULL`; filhos internos usam cascade. `analysisFingerprint` evita eventos artificiais em reanalise identica.

### Strategic Monitoring

A migration `20260909120000_strategic_monitoring` e aditiva. Ela cria `MonitoringRule`, `MonitoringSnapshot`, `StrategicSignal` e `SignalEvidence`, com chaves unicas para codigo, fingerprint de avaliacao e chave logica do sinal. Projetos opcionais usam `SET NULL`; evidencias seguem o sinal por cascade e preservam referencia opcional ao snapshot.

Os repositories encapsulam Prisma. Avaliacoes repetidas sao idempotentes, sinais preservam historico e cooldown, e nenhuma tabela guarda token, credencial ou payload externo bruto.

A migration aditiva `20260910120000_monitoring_control_plane` cria `MonitoringControl` e insere exatamente uma configuracao `strategic-monitoring`, desativada e com cadencia inicial de seis horas. Ela nao altera sinais, snapshots nem dados anteriores. O repository usa atualizacao condicional de `operationalState` para serializar execucoes e preserva ultima execucao, sucesso, falha e proxima cadencia.

Testes de migration, controle e runtime usam SQLite isolado. `backend/prisma/dev.db` permanece local e fora do commit.

### Channel Context & Creator Memory

A migration `20260911120000_channel_context_memory` e aditiva. Ela cria `ChannelContextEntry` e `ChannelContextRelation`, sem reescrever dados anteriores. Projeto e predecessor usam `SET NULL`; relacoes seguem o contexto por cascade. Chaves unicas em `stableKey`, `supersedesId` e na relacao composta garantem bootstrap, sucessao e vinculos idempotentes.

O bootstrap de aplicacao cria somente entradas ausentes por chave estavel. Ele nao faz update destrutivo e nao transforma o conteudo inicial em verdade eterna: cada registro continua atualizavel, rejeitavel ou supersedivel. Testes de migration usam SQLite `:memory:`; `backend/prisma/dev.db` permanece local e fora do Git.

### Packaging Intelligence

A migration `20260912120000_packaging_intelligence` cria de forma aditiva `ContentPackaging`, `PackagingVariant`, `PackagingHistory`, `PackagingMetricSnapshot` e `PackagingExperiment`.

Variantes sao unicas por `(packagingId, key)` e metricas por `ingestionKey`. Projeto e snapshot opcional usam `SET NULL`; filhos internos usam cascade. O journal nao e sobrescrito por selecao ou edicao. Testes usam SQLite em memoria; `dev.db` recebe a migration somente apos backup validado e fica fora do Git.
