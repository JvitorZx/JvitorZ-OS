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
- Representa um item de biblioteca, como template, recurso ou referência.
- Campos principais:
  - `id`: identificador único.
  - `projectId`: projeto opcional associado.
  - `title`: título do item.
  - `type`: tipo do item (`template`, `resource`, `reference`).
  - `content`: conteúdo opcional.
  - `createdAt`: data de criação.
  - `updatedAt`: data de atualização.

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
