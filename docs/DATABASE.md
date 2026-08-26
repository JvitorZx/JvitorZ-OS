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

`PerformanceSignal` pode apontar para o snapshot de origem e usa `key` única para substituir sinais derivados sem duplicação. A relação usa `ON DELETE CASCADE`: remover um snapshot remove somente seus sinais derivados. Sinais legados sem snapshot continuam válidos.

`engagedViews` é uma métrica opcional adicionada pela migration `20260825233000_decision_outcome_loop`. O provider YouTube atual não a fornece e persiste `null`; o sistema não deriva nem estima esse valor.

A migration `20260824213000_performance_intelligence` cria snapshots, preserva sinais anteriores e adiciona série, confiança, chave e relação de origem. Os testes aplicam a migration em SQLite em memória.

## EditorialDecisionVideoLink e EditorialDecisionOutcome

`EditorialDecisionVideoLink` liga uma decisão a um `videoId` derivado de um `VideoPerformanceSnapshot` real. A unicidade `(decisionId, videoId)` impede duplicação sequencial e concorrente. O snapshot de origem usa `ON DELETE RESTRICT`, preservando a prova do vínculo; remover a decisão remove seus vínculos em cascata.

`EditorialDecisionOutcome` guarda uma avaliação por vínculo e snapshot. Baseline, fatos, comparação, interpretação, métricas favoráveis/contrárias, lacunas e hipóteses são JSON estruturado; confiança e classificação permanecem campos explícitos. A unicidade `(decisionVideoLinkId, snapshotId)` torna a reavaliação idempotente.

O outcome pode apontar para um `ChannelInsight` único. Essa relação permite atualizar o mesmo aprendizado em uma reavaliação. Excluir o aprendizado apenas limpa a referência (`ON DELETE SET NULL`); não remove o histórico do outcome.

A migration `20260825233000_decision_outcome_loop` apenas adiciona coluna, tabelas, índices e relações. Snapshots e decisões anteriores permanecem intactos. O teste de migration executa esse SQL em SQLite em memória e confirma preservação e unicidade.

## Organização

- `backend/src/database/DatabaseService.ts`: ciclo de vida do `PrismaClient`.
- `backend/src/database/repositories/PrismaRepository.ts`: base compartilhada dos repositories Prisma.
- `backend/src/database/repositories/ConversationRepository.ts`: persistência de conversas e contexto.
- `backend/src/database/repositories/MessageRepository.ts`: persistência de mensagens.
- `backend/src/database/repositories/LibraryItemRepository.ts`: persistência e consulta de artefatos.
- `backend/src/database/repositories/ConversationLibraryItemRepository.ts`: persistência atômica e consulta dos vínculos de memória.
- `backend/src/database/repositories/VideoPerformanceSnapshotRepository.ts`: snapshots idempotentes e consultas determinísticas.
- `backend/src/database/repositories/PerformanceSignalRepository.ts`: sinais históricos e substituição dos derivados por snapshot.
- `backend/src/database/repositories/EditorialDecisionVideoLinkRepository.ts`: vínculos persistentes entre decisão e vídeo.
- `backend/src/database/repositories/EditorialDecisionOutcomeRepository.ts`: avaliações idempotentes e consultas por escopo.
- `backend/src/services/PlannerService.ts`: regras e coordenação do domínio do Planejador.
- `backend/src/services/LibraryService.ts`: validação da origem, idempotência e coordenação da Biblioteca.
- `backend/src/services/ConversationLibraryService.ts`: validação, limite e ciclo de vínculo dos artefatos ativos.
- `backend/src/services/creator-intelligence/DecisionOutcomeService.ts`: validação, comparação, classificação e memória revisável dos resultados.
- `backend/src/routes/operators.ts`: validação HTTP e delegação ao serviço.

## Testes

Os testes do Planner, Biblioteca e Performance Intelligence usam SQLite `:memory:` e criam somente as tabelas necessárias para cada execução. As migrations são executadas contra SQLite em memória para validar preservação, unicidade e relações. Os testes não acessam nem modificam `backend/prisma/dev.db`.

## Evolução futura

O modelo continua preparado para uma migração futura para PostgreSQL por meio do Prisma. Essa migração permanece fora do escopo atual.
