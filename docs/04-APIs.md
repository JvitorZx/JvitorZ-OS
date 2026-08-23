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

Um item da Biblioteca possui:

```json
{
  "id": "cm-library-1",
  "projectId": null,
  "title": "Resposta - Planejamento semanal",
  "type": "resource",
  "content": "Resposta persistida do operador",
  "createdAt": "2026-08-23T12:08:00.000Z",
  "updatedAt": "2026-08-23T12:08:00.000Z"
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

## Gerar próxima resposta do Planner

### `POST /api/operators/planner/conversations/:id/reply`

Solicita ao provider de linguagem a próxima resposta para uma conversa existente e persiste o resultado como mensagem `operator` antes de responder.

**Parâmetros de rota:**

- `id`: identificador não vazio da conversa.

**Body:** não possui campos. A requisição pode omitir o body ou enviar `{}`; qualquer campo é rejeitado.

**Sucesso — `201 Created`:** retorna somente a mensagem `operator` persistida.

```json
{
  "id": "cm789",
  "conversationId": "cm123",
  "sender": "operator",
  "text": "Resposta gerada e persistida",
  "createdAt": "2026-08-23T12:07:00.000Z"
}
```

O endpoint não cria mensagem `user`. Cada chamada bem-sucedida gera e persiste exatamente uma resposta `operator`.

**Status possíveis:**

- `201`: resposta gerada e persistida.
- `400`: parâmetro `id` vazio ou body com conteúdo não permitido.
- `404`: conversa não encontrada; o provider não é chamado.
- `502`: provider falhou ou retornou resposta sem texto útil.
- `503`: provider ou configuração de linguagem indisponível.
- `500`: falha interna inesperada, inclusive persistência.

Respostas e logs de erro não incluem chave, contexto, histórico, request/response do provider, payload ou stack externa.

**Configuração do provider:**

- `OPENAI_API_KEY`: lida somente quando a geração é solicitada; sua ausência não impede o backend de iniciar e resulta em `503` neste endpoint.
- `OPENAI_MODEL`: opcional; o fallback atual é `gpt-5-mini`.
- O adapter usa o SDK oficial, a Responses API e `max_output_tokens: 1000` para o limite padrão de saída.

Os testes deste contrato usam provider fake e não fazem chamadas externas. Permanece pendente, como validação externa não bloqueadora, um smoke test manual com chave válida para confirmar uma chamada real HTTP `201`.

## Salvar resposta na Biblioteca

### `POST /api/operators/planner/conversations/:conversationId/messages/:messageId/library`

Transforma uma mensagem `operator` persistida em um item da Biblioteca. O backend busca a conversa e a mensagem pelos IDs, valida sua relação e copia o conteúdo persistido; o cliente não envia o conteúdo do artefato.

**Parâmetros de rota:**

- `conversationId`: identificador não vazio da conversa.
- `messageId`: identificador não vazio da mensagem.

**Body:** ausente ou `{}`. Qualquer campo é rejeitado.

**Sucesso:** retorna somente o item persistido no formato resumido da Biblioteca. A primeira chamada usa `201 Created`; chamadas posteriores para a mesma mensagem usam `200 OK` e retornam o mesmo item.

**Status possíveis:**

- `201`: item criado e persistido.
- `200`: a mensagem já possuía um item, retornado sem criar duplicata.
- `400`: parâmetro vazio ou body com conteúdo não permitido.
- `404`: conversa ou mensagem inexistente.
- `409`: mensagem pertence a outra conversa.
- `422`: mensagem não possui `sender: "operator"`.
- `500`: falha interna inesperada.

O backend registra a mensagem de origem em `LibraryItem.sourceMessageId`, protegido por unicidade no banco. Assim, chamadas sequenciais ou concorrentes para a mesma mensagem são idempotentes; somente mensagens de origem diferentes criam novos itens.

## Listar Biblioteca

### `GET /api/operators/planner/library`

Retorna os itens persistidos ordenados por `createdAt` decrescente e `id` decrescente como desempate.

**Parâmetros e body:** nenhum.

**Sucesso — `200 OK`:** retorna `[]` quando vazia ou uma lista de itens no formato resumido da Biblioteca.

**Status possíveis:**

- `200`: lista retornada.
- `500`: falha interna inesperada.

## Abrir item da Biblioteca

### `GET /api/operators/planner/library/:id`

Retorna um item persistido pelo seu identificador.

**Parâmetros de rota:**

- `id`: identificador não vazio do item.

**Body:** nenhum.

**Sucesso — `200 OK`:** retorna o item persistido no formato resumido da Biblioteca.

**Status possíveis:**

- `200`: item encontrado.
- `400`: parâmetro `id` vazio.
- `404`: item não encontrado.
- `500`: falha interna inesperada.

Erros dos endpoints da Biblioteca usam mensagens seguras e não expõem stack, consultas ou detalhes do Prisma.

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
