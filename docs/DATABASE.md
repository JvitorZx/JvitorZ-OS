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

## Organização

- `backend/src/database/DatabaseService.ts`: ciclo de vida do `PrismaClient`.
- `backend/src/database/repositories/PrismaRepository.ts`: base compartilhada dos repositories Prisma.
- `backend/src/database/repositories/ConversationRepository.ts`: persistência de conversas e contexto.
- `backend/src/database/repositories/MessageRepository.ts`: persistência de mensagens.
- `backend/src/services/PlannerService.ts`: regras e coordenação do domínio do Planejador.
- `backend/src/routes/operators.ts`: validação HTTP e delegação ao serviço.

## Testes

Os testes do Planner usam SQLite `:memory:` e criam somente as tabelas necessárias para cada execução. Eles não acessam nem modificam `backend/prisma/dev.db`.

## Evolução futura

O modelo continua preparado para uma migração futura para PostgreSQL por meio do Prisma. Essa migração não faz parte da Sprint 13.
