# APIs

## Convenções

- Prefixo do backend: `/api`.
- Endpoints do Planejador: `/api/operators/planner/conversations`.
- Requisições com body usam `Content-Type: application/json`.
- Datas são serializadas em JSON como strings ISO 8601.
- Erros usam o formato `{ "error": "mensagem" }`.
- Os endpoints desta Sprint não dependem de OAuth Google ou YouTube.

## Modelo resumido

Uma conversa completa possui:

```json
{
  "id": "cm123",
  "projectId": null,
  "title": "Nova conversa",
  "context": "Contexto do planejamento",
  "createdAt": "2026-08-21T12:00:00.000Z",
  "updatedAt": "2026-08-21T12:05:00.000Z",
  "messages": []
}
```

Uma mensagem possui:

```json
{
  "id": "cm456",
  "conversationId": "cm123",
  "sender": "user",
  "text": "Planejar a pauta da semana",
  "createdAt": "2026-08-21T12:06:00.000Z"
}
```

## Criar conversa

### `POST /api/operators/planner/conversations`

Cria e persiste uma conversa.

**Parâmetros de rota:** nenhum.

**Body:** opcional.

```json
{
  "title": "Planejamento semanal",
  "projectId": "project-id-opcional"
}
```

- `title`: string opcional. Ausente, vazia ou somente com espaços resulta em `Nova conversa`.
- `projectId`: string não vazia opcional. Quando informado, deve referenciar um projeto válido no banco.
- O contexto inicial é sempre `null` nesta operação.

**Sucesso — `201 Created`:**

```json
{
  "id": "cm123",
  "projectId": null,
  "title": "Planejamento semanal",
  "context": null,
  "createdAt": "2026-08-21T12:00:00.000Z",
  "updatedAt": "2026-08-21T12:00:00.000Z"
}
```

**Status possíveis:**

- `201`: conversa criada.
- `400`: `title` não é string ou `projectId` não é uma string não vazia.
- `500`: falha inesperada de persistência.

## Listar conversas

### `GET /api/operators/planner/conversations`

Retorna o histórico resumido de conversas, ordenado por `updatedAt` decrescente conforme `ConversationRepository`.

**Parâmetros e body:** nenhum.

**Sucesso — `200 OK`:**

```json
[
  {
    "id": "cm123",
    "projectId": null,
    "title": "Planejamento semanal",
    "createdAt": "2026-08-21T12:00:00.000Z",
    "updatedAt": "2026-08-21T12:05:00.000Z"
  }
]
```

A listagem não inclui `context` nem `messages`. Esses dados são carregados ao abrir uma conversa específica.

**Status possíveis:**

- `200`: lista retornada; banco vazio produz `[]`.
- `500`: falha inesperada de consulta.

## Abrir conversa

### `GET /api/operators/planner/conversations/:id`

Retorna uma conversa com seu contexto e suas mensagens persistidas.

**Parâmetros de rota:**

- `id`: identificador não vazio da conversa.

**Body:** nenhum.

**Sucesso — `200 OK`:**

```json
{
  "id": "cm123",
  "projectId": null,
  "title": "Planejamento semanal",
  "context": "Contexto do planejamento",
  "createdAt": "2026-08-21T12:00:00.000Z",
  "updatedAt": "2026-08-21T12:05:00.000Z",
  "messages": [
    {
      "id": "cm456",
      "conversationId": "cm123",
      "sender": "user",
      "text": "Planejar a pauta da semana",
      "createdAt": "2026-08-21T12:06:00.000Z"
    }
  ]
}
```

As mensagens são ordenadas por `createdAt` crescente.

**Status possíveis:**

- `200`: conversa encontrada.
- `400`: parâmetro `id` vazio ou inválido para a rota.
- `404`: conversa não encontrada.
- `500`: falha inesperada de consulta.

## Criar mensagem

### `POST /api/operators/planner/conversations/:id/messages`

Cria e persiste uma mensagem em uma conversa existente.

**Parâmetros de rota:**

- `id`: identificador não vazio da conversa.

**Body:** obrigatório e restrito a `sender` e `text`.

```json
{
  "sender": "user",
  "text": "Planejar a pauta da semana"
}
```

- `sender`: um de `user`, `system` ou `operator`.
- `text`: string não vazia após `trim()`.
- Campos adicionais são rejeitados.

**Sucesso — `201 Created`:** retorna a mensagem persistida.

```json
{
  "id": "cm456",
  "conversationId": "cm123",
  "sender": "user",
  "text": "Planejar a pauta da semana",
  "createdAt": "2026-08-21T12:06:00.000Z"
}
```

**Status possíveis:**

- `201`: mensagem criada.
- `400`: body inválido, campo adicional, papel não permitido ou texto vazio.
- `404`: conversa não encontrada.
- `500`: falha inesperada de persistência.

## Atualizar contexto

### `PATCH /api/operators/planner/conversations/:id/context`

Atualiza o prompt-base/contexto de uma conversa existente.

**Parâmetros de rota:**

- `id`: identificador não vazio da conversa.

**Body:** obrigatório e restrito a `context`.

```json
{
  "context": "Priorizar pautas educacionais para vídeos curtos"
}
```

- `context` deve ser string.
- O valor é normalizado com `trim()`.
- String vazia ou apenas com espaços limpa o campo e persiste `null`.
- Campos adicionais são rejeitados.

**Sucesso — `200 OK`:** retorna os campos persistidos da conversa atualizada, sem `messages`.

```json
{
  "id": "cm123",
  "projectId": null,
  "title": "Planejamento semanal",
  "context": "Priorizar pautas educacionais para vídeos curtos",
  "createdAt": "2026-08-21T12:00:00.000Z",
  "updatedAt": "2026-08-21T12:10:00.000Z"
}
```

**Status possíveis:**

- `200`: contexto atualizado ou removido.
- `400`: body inválido, `context` não textual ou campo adicional.
- `404`: conversa não encontrada.
- `500`: falha inesperada de persistência.

## Erros

Exemplos de respostas de erro:

```json
{ "error": "Conversation not found" }
```

```json
{ "error": "context must be a string" }
```

Mensagens `500` são genéricas e não expõem stack traces, credenciais ou payloads internos.
