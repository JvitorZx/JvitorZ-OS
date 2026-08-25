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

Registro normalizado de desempenho de um vídeo em um projeto, fonte e período. `ingestionKey` é única e identifica `projectId + source + videoId + periodStart + periodEnd`. Campos observáveis incluem views, impressões, CTR, duração, AVD, percentual médio assistido, watch time, inscritos ganhos, likes e comentários.

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
