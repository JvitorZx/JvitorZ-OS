# Banco

O JvitorZ OS usa Prisma com SQLite no ambiente atual. O Planejador já persiste conversas, mensagens e contexto no banco real.

## Documentação relacionada

- `DATABASE.md`: tecnologia, conexão, repositories e fluxo de persistência.
- `DATA_MODEL.md`: campos e responsabilidades das entidades.
- `ERD.md`: relacionamentos entre as entidades.
- `04-APIs.md`: contratos HTTP que acessam os dados do Planejador.

## Estado atual do Planejador

- `Conversation` armazena título, projeto opcional e contexto.
- `Message` armazena mensagens vinculadas à conversa.
- `PlannerService` coordena `ConversationRepository` e `MessageRepository`.
- Prisma grava os dados no SQLite.
- Os testes automatizados usam SQLite em memória e não alteram `dev.db`.

## Evolução

Migração futura para PostgreSQL, backup e recuperação permanecem fora da Sprint 13.
