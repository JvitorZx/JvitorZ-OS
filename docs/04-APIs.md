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

## Memória ativa da conversa — Sprint 17

**Status: implementados no backend.**

Os endpoints abaixo trabalham somente com identificadores. Nenhum deles aceita título ou conteúdo de `LibraryItem` no body.

### Vincular item à conversa

#### `POST /api/operators/planner/conversations/:conversationId/library/:libraryItemId`

Cria uma associação persistente entre a conversa e um item real da Biblioteca.

**Parâmetros de rota:**

- `conversationId`: identificador não vazio da conversa.
- `libraryItemId`: identificador não vazio do item.

**Body:** ausente ou `{}`. Campos adicionais serão rejeitados.

**Sucesso:** retorna os campos seguros do `LibraryItem` persistido: `id`, `projectId`, `title`, `type`, `content`, `createdAt` e `updatedAt`.

- `201`: vínculo criado.
- `200`: vínculo já existia; retorna a mesma associação sem duplicar.
- `400`: parâmetro inválido ou body com conteúdo.
- `404`: conversa ou item inexistente.
- `422`: a conversa já possui o máximo de cinco artefatos ativos.
- `500`: erro interno seguro.

### Listar memória ativa da conversa

#### `GET /api/operators/planner/conversations/:conversationId/library`

Retorna os `LibraryItem` vinculados, ordenados por `ConversationLibraryItem.createdAt` crescente e `libraryItemId` crescente como desempate. O conteúdo não é truncado neste endpoint.

**Body:** nenhum.

- `200`: lista retornada; ausência de vínculos produz `[]`.
- `400`: parâmetro inválido.
- `404`: conversa inexistente.
- `500`: erro interno seguro.

### Desvincular item da conversa

#### `DELETE /api/operators/planner/conversations/:conversationId/library/:libraryItemId`

Remove somente a associação. O `LibraryItem` permanece persistido na Biblioteca.

**Body:** ausente ou `{}`. Campos adicionais serão rejeitados.

- `204`: vínculo removido ou já ausente, desde que a conversa exista. O item não é excluído.
- `400`: parâmetro inválido ou body com conteúdo.
- `404`: conversa inexistente.
- `500`: erro interno seguro.

As respostas de erro não incluirão conteúdo de artefato, contexto, histórico, prompt, stack, detalhes Prisma ou payload do provider.

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

## Creator Intelligence

Os endpoints abaixo não chamam rede externa e nunca retornam previsão de views.

### `POST /api/operators/creator-intelligence/ideas`

Registra uma ideia persistida.

```json
{
  "game": "BeamNG.drive",
  "theme": "Simulação",
  "format": "desafio narrado",
  "premise": "Descobrir se um carro popular conclui uma rota extrema.",
  "estimatedEffort": 2,
  "novelty": 75,
  "identityFit": 90
}
```

`theme`, `format` e `premise` são obrigatórios. Esforço aceita 1 a 5; novidade e compatibilidade aceitam 0 a 100. Campos extras são rejeitados. Retorna `201`, `400` ou `500` seguro.

### `GET /api/operators/creator-intelligence/ideas`

Lista ideias em ordem de criação decrescente. Aceita `projectId` opcional. Retorna `200`, `400` ou `500` seguro.

### `POST /api/operators/creator-intelligence/ideas/:id/evaluate`

Avalia uma ideia persistida com body ausente ou `{}`. Retorna `200` com ideia, decisão persistida e avaliação classificada; `400` para entrada inválida; `404` para ideia inexistente; `500` seguro.

### `POST /api/operators/creator-intelligence/ideas/compare`

```json
{ "ideaIds": ["idea-a", "idea-b"] }
```

Aceita de 2 a 20 IDs únicos. Retorna `200` com ranking e justificativa por posição; `400`, `404` ou `500` seguro quando aplicável.

### `GET /api/operators/creator-intelligence/recommendation`

Aceita `projectId` opcional. Retorna `200` com recomendação, ranking, classificação e disclaimer. Sem ideias, retorna recomendação nula e lista vazia.

### `GET /api/operators/creator-intelligence/context`

Retorna o objeto limitado preparado para IA futura: estado do canal, histórico relevante, ideias, oportunidades, decisões e restrições. Não chama IA nem altera prompts.

### `GET /api/operators/planner/conversations/:id/editorial-recommendation`

Ponte do Planner para a recomendação editorial. Retorna `200`; `400` para ID inválido; `404` para conversa inexistente; `503` quando o serviço não foi injetado; ou `500` sanitizado.

### `GET /api/operators/planner/conversations/:id/channel-learnings`

Retorna os aprendizados estruturados do projeto da conversa. Cada item inclui categoria, assunto, afirmação, confiança, classificação e evidência. Retorna `200`, `400`, `404`, `503` ou `500` sanitizado.

## Performance Intelligence

Todos os endpoints usam rota → `CreatorIntelligenceService` → serviço/repository. Eles não chamam rede externa e não aceitam credenciais.

### `POST /api/operators/creator-intelligence/performance/ingest/manual`

Ingere de 1 a 100 registros. A fonte é sempre `manual`; o cliente não pode defini-la.

```json
{
  "projectId": "project-optional",
  "records": [{
    "videoId": "youtube-video-id",
    "title": "Título persistido",
    "game": "BeamNG.drive",
    "series": "Desafios",
    "format": "narrado",
    "publishedAt": "2026-08-01T12:00:00.000Z",
    "views": 1200,
    "impressions": 10000,
    "ctr": 8.5,
    "durationSeconds": 600,
    "averageViewDurationSeconds": 300,
    "averageViewPercentage": 50,
    "watchTimeMinutes": 6000,
    "subscribersGained": 20,
    "subscribersLost": 2,
    "likes": 100,
    "comments": 12,
    "confidence": 1,
    "collectedAt": "2026-08-24T12:00:00.000Z"
  }]
}
```

Campos de métricas são opcionais e permanecem `null` quando ausentes. A mesma combinação projeto/fonte/vídeo/período é atualizada, não duplicada. Retorna `200` com `created`, `updated`, `records` e `signals`; `400` para payload inválido; ou `500` seguro.

### `GET /api/operators/creator-intelligence/performance/records`

Lista snapshots em `collectedAt DESC`, com ID como desempate. Aceita `projectId` opcional. Retorna `200`, `400` ou `500` seguro.

### `GET /api/operators/creator-intelligence/performance/signals`

Lista sinais derivados e persistidos, com provenance e confiança. Aceita `projectId` opcional. Retorna `200`, `400` ou `500` seguro.

### `GET /api/operators/creator-intelligence/performance/baseline`

Retorna média, mediana e amostragem para métricas disponíveis, incluindo views, watch time, AVD, retenção, inscritos por vídeo, conversão por mil views e views por formato. Métrica sem dados retorna `average: null`, `median: null` e `sampleSize: 0`.

### `GET /api/operators/creator-intelligence/learnings`

Atualiza e retorna aprendizados estruturados do canal. Aceita `projectId` opcional. Inferências incluem evidência, amostra e confiança; aprendizado sem suporte atual é marcado `unknown` com confiança zero.

### `GET /api/operators/creator-intelligence/decisions/:id/evidence`

Retorna a decisão persistida e seu snapshot de evidências, incluindo confiança, fontes, riscos e dados ausentes. Retorna `200`, `400`, `404` ou `500` seguro.

## YouTube Analytics Performance

Estas rotas reutilizam o OAuth Google do backend e o contrato `PerformanceProvider`. Nenhuma rota recebe token ou credencial. A sincronização é explícita e limitada; não existe polling nesta Sprint.

### `GET /api/operators/creator-intelligence/performance/youtube/status`

Retorna `200` com o estado operacional do provider:

```json
{
  "state": "connected",
  "lastSyncAt": null,
  "lastErrorType": null
}
```

`state` pode ser `connected`, `synchronized`, `not_authorized`, `not_configured` ou `temporary_error`. `lastErrorType` pode ser `authorization`, `quota`, `temporary` ou `null`. Uma falha inesperada ao consultar o status retorna `503` com estado temporário seguro.

### `POST /api/operators/creator-intelligence/performance/youtube/sync`

Sincroniza um vídeo, vídeos recentes ou um período. Datas usam `YYYY-MM-DD`; `limit` aceita de 1 a 50 e assume 20. `projectId` é opcional.

Vídeo específico:

```json
{
  "mode": "video",
  "videoId": "youtube-video-id",
  "startDate": "2026-08-01",
  "endDate": "2026-08-24",
  "limit": 1
}
```

Vídeos recentes:

```json
{
  "mode": "recent",
  "startDate": "2026-08-01",
  "endDate": "2026-08-24",
  "limit": 20
}
```

Período sem filtro de vídeo:

```json
{
  "mode": "period",
  "startDate": "2026-08-01",
  "endDate": "2026-08-24"
}
```

Retorna `200` com `source`, `created`, `updated`, `records` e `signals`. Uma recoleta da mesma fonte, projeto, vídeo e período atualiza o snapshot existente. Status possíveis: `400` para parâmetros inválidos; `401` para OAuth ausente/expirado; `404` para vídeo específico inexistente; `429` para quota; `503` para configuração ausente ou indisponibilidade temporária; e `500` sanitizado para falha inesperada.

### `GET /api/operators/creator-intelligence/performance/youtube/last-sync`

Retorna `200` com a fonte e o timestamp persistido do snapshot YouTube Analytics mais recente:

```json
{
  "source": "youtube-analytics",
  "lastSyncAt": "2026-08-24T15:00:00.000Z"
}
```

Sem sincronização anterior, `lastSyncAt` é `null`. Falha interna retorna `500` sanitizado.

### Origem das métricas

- YouTube Analytics API: `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, `subscribersLost`, `likes` e `comments`.
- YouTube Data API: `videoId`, título, `publishedAt` e duração.
- Impressões e CTR não são inferidas por este provider e permanecem `null`.
- Jogo, série e formato também permanecem `null` até existir uma fonte real para essa classificação.
