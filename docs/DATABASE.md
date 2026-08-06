# DATABASE

## Tecnologia escolhida

- Banco oficial de desenvolvimento: **SQLite**.
- Arquitetura projetada para migração futura para **PostgreSQL**.

## Motivo da escolha

- SQLite é simples de configurar e instalar localmente.
- Não exige servidor dedicado para desenvolvimento.
- Permite validar o modelo de dados rapidamente sem alterar o frontend.
- É leve e adequado para prototipagem de persistência em ambiente de desenvolvimento.

## Organização das pastas

- `backend/src/database/`
  - `database.ts`: configuração geral do banco e parâmetros de conexão.
  - `connection.ts`: abstração de criação de conexão e ponto único para inicialização futura.
  - `models/`: definições de entidades e tipos do domínio.
  - `repositories/`: contratos e locais de repositórios de dados.
- `backend/prisma/`
  - `schema.prisma`: definição do modelo Prisma e do esquema de banco.
  - `migrations/`: migrações geradas pelo Prisma.
- `backend/prisma.config.ts`: configuração do Prisma v7.

## Arquitetura Prisma

- O projeto agora usa Prisma como ORM para modelagem e migrações.
- O schema Prisma define as entidades e relacionamentos do sistema.
- O `prisma.config.ts` centraliza a configuração de datasource e migrações.
- O `Prisma Client` foi gerado em `node_modules/@prisma/client`.
- A camada de aplicação usa `backend/src/database/` como abstração de persistência.
- `DatabaseService` gerencia a instância singleton do Prisma Client.
- `UserRepository` e outros repositórios devem estender `PrismaRepository` para implementar lógica de dados.

## Estratégia futura para PostgreSQL

- Usar um cliente compartilhado compatível com SQLite e PostgreSQL (por exemplo, Knex ou Prisma).
- Manter a configuração de conexão em `database.ts` e `connection.ts` separada da lógica de modelo.
- Criar migrações portáveis que funcionem em ambos os bancos.
- Ajustar apenas a `client` e a string de conexão no ambiente de produção.
- Garantir que as entidades e tipos sejam independentes do banco específico.

## Convenções

- Entidades são definidas como interfaces TypeScript em `backend/src/database/models/`.
- Repositórios usam contratos genéricos em `backend/src/database/repositories/`.
- Migrações devem ser versionadas e organizadas cronologicamente.
- A camada de conexão deve ser um ponto único de troca de banco.
- Nomes de tabelas e campos devem ser consistentes com os modelos e relacionamentos definidos.

## Modelos iniciais definidos

- `User`
- `Project`
- `Conversation`
- `Message`
- `Operator`
- `LibraryItem`
- `Automation`
- `Setting`
- `AnalyticsSnapshot`

## Observações

- Esta fundação não implementa persistência real nem altera rotas existentes.
- O foco é estruturar a camada de banco para futuras implementações.
