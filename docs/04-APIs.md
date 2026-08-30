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

## Editorial Decision Loop

As rotas abaixo não recebem credenciais, não chamam uma nova fonte externa e nunca retornam previsão exata de views. Erros `500` são sanitizados.

### `POST /api/operators/creator-intelligence/editorial-decisions`

Gera e persiste uma decisão editorial. O body aceita apenas:

```json
{
  "question": "O que vale gravar agora?",
  "projectId": "project-optional",
  "conversationId": "conversation-optional",
  "ideaIds": ["idea-a", "idea-b"],
  "videoId": "video-optional",
  "candidates": [
    { "key": "game-a", "label": "Jogo A", "type": "GAME", "game": "Jogo A" }
  ]
}
```

Somente `question` é obrigatória. `candidates` aceita no máximo 20 itens com tipo `IDEA`, `SERIES`, `GAME`, `FORMAT` ou `TOPIC`; chaves devem ser únicas. Retorna `201` ao criar, `200` quando o mesmo estado de evidências já produziu a decisão, `400` para payload inválido, `404` para conversa/ideia inexistente ou `500` seguro.

A resposta contém o registro persistido, incluindo `recommendation`, `alternatives`, `category`, `candidateType`, `candidateKey`, `score`, `confidence`, `opportunityScore`, evidências favoráveis/contrárias, restrições, riscos, dados ausentes, próxima ação e vínculos opcionais.

`score` é um ranking relativo e não prevê views. `confidence` representa cobertura e qualidade dos dados, não probabilidade de sucesso.

### `GET /api/operators/creator-intelligence/editorial-decisions`

Lista decisões mais recentes primeiro. Aceita somente `projectId`, `conversationId` e `limit` opcional de 1 a 50. Retorna `200`, `400` ou `500` seguro.

### `POST /api/operators/creator-intelligence/editorial-decisions/compare`

Compara de 2 a 20 candidatos e persiste a decisão resultante. Body estrito:

```json
{
  "question": "Qual jogo apresenta a melhor oportunidade agora?",
  "projectId": "project-optional",
  "conversationId": "conversation-optional",
  "candidates": [
    { "key": "city-car", "label": "City Car Driving", "type": "GAME", "game": "City Car Driving" },
    { "key": "forza", "label": "Forza", "type": "GAME", "game": "Forza" }
  ]
}
```

Retorna `201` ao criar ou `200` para o mesmo snapshot de evidências. Empates são resolvidos deterministicamente pela chave do candidato. Retorna `400`, `404` ou `500` sanitizado.

### `GET /api/operators/creator-intelligence/editorial-decisions/current`

Retorna a decisão mais recente no escopo opcional de `projectId`/`conversationId`. Retorna `200`, `400`, `404` ou `500` seguro.

### `GET /api/operators/creator-intelligence/editorial-decisions/:id/evidence`

Retorna categoria, score, confiança, evidências classificadas, evidências favoráveis/contrárias, riscos estruturados, restrições, dados ausentes e o snapshot do `OpportunityScore`. Retorna `200`, `400`, `404` ou `500` seguro.

### `GET /api/operators/creator-intelligence/editorial-opportunities`

Lista decisões `PRIORITIZE`, `CONTINUE` ou `TEST`, mais recentes primeiro. Aceita `projectId`, `conversationId` e `limit` de 1 a 50. Retorna `200`, `400` ou `500` seguro.

### `GET /api/operators/creator-intelligence/editorial-risks`

Lista decisões com riscos ou categoria `PAUSE`, `REEVALUATE` e `INSUFFICIENT_DATA`. Aceita os mesmos filtros de oportunidades e retorna `200`, `400` ou `500` seguro.

### `GET /api/operators/creator-intelligence/editorial-decisions/:id`

Abre uma decisão persistida com suas evidências e resultado, quando existente. Retorna `200`, `400`, `404` ou `500` seguro.

### `POST /api/operators/creator-intelligence/editorial-decisions/:id/outcome`

Registra um resultado futuro a partir de um snapshot de performance já persistido:

```json
{ "snapshotId": "performance-snapshot-id" }
```

Retorna `200` com a decisão atualizada; `400` para payload inválido; `404` para decisão ou snapshot inexistente; `409` quando o snapshot pertence a outro projeto; ou `500` seguro. O backend deriva a avaliação a partir dos sinais do snapshot e não aceita um resultado arbitrário enviado pelo cliente.

## Decision Outcome Loop

As rotas abaixo aceitam somente identificadores e metadados mínimos. Vídeo, métricas, baseline e conteúdo da decisão são sempre carregados do banco. Nenhuma resposta expõe stack ou detalhes do Prisma.

### `POST /api/operators/creator-intelligence/editorial-decisions/:id/videos`

Associa uma decisão a um vídeo por meio de um snapshot real:

```json
{ "snapshotId": "performance-snapshot-id", "origin": "manual", "notes": "opcional" }
```

`snapshotId` é obrigatório; `origin` aceita `manual` ou `youtube_sync`; `notes` é opcional. Retorna `201` ao criar ou `200` com o vínculo existente. Retorna `400` para payload/ID inválido, `404` para decisão ou snapshot ausente, `409` para projeto incompatível e `500` sanitizado.

### `GET /api/operators/creator-intelligence/editorial-decisions/:id/videos`

Lista os vínculos da decisão em ordem determinística, incluindo snapshot de origem, outcomes e status derivado `awaiting_data`, `evaluable` ou `evaluated`. Retorna `200`, `400`, `404` ou `500` seguro.

### `DELETE /api/operators/creator-intelligence/editorial-decisions/:decisionId/videos/:linkId`

Remove um vínculo ainda não avaliado e retorna `204`. É restrito à decisão indicada. Retorna `400` para IDs/body inválidos, `404` para decisão ou vínculo ausente, `409` quando o vínculo já possui outcome e `500` seguro.

### `POST /api/operators/creator-intelligence/editorial-decisions/:decisionId/videos/:linkId/outcomes`

Avalia o snapshot mais recente conhecido do vídeo, ou um snapshot específico do mesmo vídeo:

```json
{}
```

ou:

```json
{ "snapshotId": "performance-snapshot-id" }
```

Retorna `201` ao criar a avaliação ou `200` ao reavaliar o mesmo vínculo/snapshot. A resposta contém o outcome persistido e `created`. Retorna `400` para payload/ID inválido, `404` para decisão, vínculo ou snapshot ausente, `409` para escopo/vídeo incompatível e `500` sanitizado.

### `GET /api/operators/creator-intelligence/editorial-decisions/:id/outcomes`

Lista outcomes persistidos da decisão, mais recentes primeiro. Retorna `200`, `400`, `404` ou `500` seguro.

### `GET /api/operators/creator-intelligence/decision-outcomes`

Lista outcomes mais recentes. Aceita somente `projectId`, `conversationId`, `decisionId`, `videoId` e `limit` de 1 a 50. Retorna `200`, `400` ou `500` seguro.

### `GET /api/operators/creator-intelligence/decision-outcomes/:id`

Abre um outcome com vínculo, decisão, snapshot e aprendizado associado. Retorna `200`, `400`, `404` ou `500` seguro.

As classificações possíveis são `POSITIVE`, `MIXED`, `NEGATIVE` e `INCONCLUSIVE`. Elas representam comparação contra baseline observada e não demonstram causalidade.

## Outcome Review & Refresh Loop

As revisões abaixo usam somente dados persistidos. POSTs aceitam body ausente ou `{}` e rejeitam campos extras. Erros nunca retornam stack, detalhes Prisma ou payload de provider.

### `GET /api/operators/creator-intelligence/decision-outcomes/review-states`

Lista o estado derivado dos outcomes atuais: `current`, `review_available`, `stale` ou `insufficient_data`. Inclui motivo, última avaliação, IDs dos snapshots comparados, métricas alteradas e indicador de baseline alterada. Retorna `200` ou `500` seguro.

### `GET /api/operators/creator-intelligence/decision-outcomes/reviewable`

Lista somente outcomes com `review_available`, preservando a ordem determinística do serviço. Retorna `200` ou `500` seguro.

### `GET /api/operators/creator-intelligence/decision-outcomes/review-status`

Retorna contagens operacionais `current`, `reviewAvailable`, `stale`, `insufficientData` e `recentFailures`. Não dispara revisão. Retorna `200` ou `500` seguro.

### `GET /api/operators/creator-intelligence/decision-outcomes/:id/review-state`

Abre o estado derivado de um outcome. Retorna `200`, `400`, `404` ou `500` seguro.

### `POST /api/operators/creator-intelligence/decision-outcomes/:id/review`

Revisa um outcome contra a evidência mais recente. Retorna `200` com `status` igual a `reviewed`, `unchanged`, `skipped` ou `failed`, o estado derivado e o registro de revisão quando criado. Uma falha de avaliação é representada de forma segura e preserva o outcome anterior. Retorna `400`, `404` ou `500` para falha inesperada.

### `POST /api/operators/creator-intelligence/decision-outcomes/review`

Revisa em sequência todos os outcomes atualmente elegíveis e retorna contagens de `reviewed`, `unchanged`, `skipped`, `failed` e os resultados individuais. A falha de um item não interrompe o lote. Retorna `200`, `400` para body inesperado ou `500` seguro.

### `GET /api/operators/creator-intelligence/decision-outcomes/:id/reviews`

Lista o histórico append-only relacionado ao outcome, seja ele origem ou resultado da revisão, mais recente primeiro. Retorna `200`, `400`, `404` ou `500` seguro.

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

- YouTube Analytics API: `engagedViews`, `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, `subscribersLost`, `likes`, `comments` e `creatorContentType`.
- YouTube Data API: `videoId`, título, `publishedAt` e duração.
- Impressões e CTR não são inferidas por este provider e permanecem `null`.

Essas duas métricas pertencem ao provider separado de Reach descrito abaixo. O endpoint Analytics continua sem inferi-las.

## YouTube Reach Reporting e qualidade dos dados

### `GET /api/operators/creator-intelligence/reach/youtube/status`

Retorna o estado do job `channel_reach_basic_a1`, último relatório/sync e o diagnóstico de qualidade. Estados possíveis: `not_configured`, `not_authorized`, `waiting_for_report`, `synchronized` e `temporary_error`. Consultar status não cria job nem chama sincronização.

### `POST /api/operators/creator-intelligence/reach/youtube/sync`

Body estrito:

```json
{ "startDate": "2026-08-01", "endDate": "2026-08-27", "projectId": "opcional" }
```

Aceita no máximo 31 dias. Reutiliza um job existente do tipo `channel_reach_basic_a1`; se não existir, cria um único job. Retorna `202` enquanto o primeiro relatório assíncrono ainda não está disponível e `200` ao processar relatórios. Erros: `400 INVALID_REQUEST`, `401 AUTH_REQUIRED`, `429 RATE_LIMITED`, `503 CONFIG_MISSING|PROVIDER_UNAVAILABLE` e `500 INTERNAL_ERROR` sanitizado.

### `GET /api/operators/creator-intelligence/reach/data`

Lista `VideoReachSnapshot` persistidos em ordem determinística. Filtros opcionais: `projectId` e `videoId`. Cada item contém período, impressões, CTR oficial, fonte, coleta, freshness e metadados técnicos mínimos; não contém token ou credencial.

### `GET /api/operators/creator-intelligence/reach/quality`

Retorna `GOOD`, `PARTIAL`, `STALE`, `MISSING`, `INCONSISTENT` ou `ERROR`, além de availability, freshness, completeness, consistency, sampleSize, sourceReliability e reasons estruturados. Ausência de relatório retorna `MISSING`, não `ERROR`.

### `GET /api/operators/channel/ctr`

Continua sendo o endpoint de análise do operador CTR. Quando há Reach real, retorna impressões/CTR, baselines compatíveis, sinais, freshness e qualidade; sem Reach, permanece limitado e não deriva CTR de views.
- `creatorContentType` classifica somente `SHORTS` e `VIDEO_ON_DEMAND`; outros valores permanecem `UNKNOWN`. Jogo e série continuam opcionais.

No modo `period`, o provider primeiro descobre os vídeos do período e depois faz uma consulta limitada a esses IDs para obter `creatorContentType`. Essa composição evita uma combinação não suportada pela API sem inferir formato.

### Consumo no frontend

O módulo Analytics usa exclusivamente `frontend/src/api/client.js`. Na montagem, consulta status, última sincronização, snapshots, baseline, sinais, aprendizados e contexto de decisões. O POST de sincronização envia somente modo, datas, limite e, quando aplicável, ID do vídeo; tokens e credenciais nunca fazem parte do payload do frontend.

Após sucesso, o frontend consulta novamente os dados persistidos. Respostas não `2xx` são representadas por erro seguro com status HTTP, permitindo mensagens locais específicas para `400`, `401`, `404`, `429` e `503` sem expor resposta crua do provider.

## Gerente autônomo

As rotas abaixo aceitam linguagem natural, selecionam capabilities internas e nunca executam side effect externo irreversível. Erros não incluem stack, payload bruto, credencial, prompt completo ou detalhes Prisma.

### `POST /api/manager/query`

Body estrito:

```json
{
  "message": "Por que meu canal caiu?",
  "projectId": "project-1",
  "conversationId": "conversation-1",
  "requestId": "optional-idempotency-key"
}
```

Somente `message` é obrigatório, com 1 a 1000 caracteres. IDs opcionais devem ser strings não vazias. `requestId` deduplica a mesma consulta sequencial ou concorrente.

`200` retorna `correlationId`, `status`, `outcome`, `intent`, `answer`, `confidence`, `operatorsUsed`, `evidence`, `conflicts`, `missingData`, `decision` e `createdAt`. `confidence` mede cobertura/qualidade, não chance de sucesso. `outcome` é `ANSWERED`, `DEGRADED` ou `INSUFFICIENT_DATA`.

- `400`: body, texto ou identificador inválido;
- `409`: conflito seguro de idempotência ou revisão, quando aplicável;
- `500`: falha interna sanitizada.

### `GET /api/manager/history`

Lista consultas autônomas mais recentes. Aceita `projectId`, `conversationId` e `limit` de 1 a 50. Preserva a ordem do backend. Retorna `200`, `400` ou `500` seguro.

### `GET /api/manager/history/:id`

Abre o resultado persistido pelo correlation ID. Retorna `200`, `400`, `404` ou `500` seguro.

### `GET /api/manager/history/:id/diagnostics`

Retorna correlation ID, intent, status, outcome, confiança, operadores, conflitos, dados ausentes e timestamps. Cada operador informa motivo, status, duração e tipo seguro de erro. Não retorna stack nem output bruto. Retorna `200`, `400`, `404` ou `500` seguro.

## Orchestrator

Todas as rotas usam `/api/orchestrator`. Payloads rejeitam campos extras e respostas de erro não expõem stack, token, credencial ou output bruto de capability.

### `GET /api/orchestrator/capabilities`

Lista somente capabilities reais registradas, incluindo responsabilidade, inputs, outputs, dependências, disponibilidade e classe de acesso. Retorna `200`.

### `POST /api/orchestrator/plan`

Cria um plano sem executar ou persistir trabalho:

```json
{ "intent": "Como está meu canal?", "projectId": "opcional", "conversationId": "opcional" }
```

Retorna `200` com intenção classificada, objetivo, passos, dependências, necessidade de escrita, side effect externo e dados ausentes. Retorna `400` para payload inválido.

### `POST /api/orchestrator/run`

Mantido por compatibilidade para planos que a política pode autoaprovar. Planos que exigem revisão são persistidos e retornam `409` com `executionId`; a confirmação booleana isolada não substitui aprovação.

```json
{
  "intent": "Sincronize o YouTube e revise outcomes",
  "confirmExternalSideEffect": true,
  "sync": { "mode": "recent", "startDate": "2026-08-18", "endDate": "2026-08-25", "limit": 20 }
}
```

Retorna `201` para nova execução autoaprovada ou `200` quando a chave idempotente já foi concluída. `409` indica revisão obrigatória ou conflito; `400`, payload inválido; `500`, erro interno sanitizado.

### `POST /api/orchestrator/preview`

Persiste plano e review sem executar nenhuma capability. Aceita o mesmo request de planejamento, incluindo `sync` quando a intenção exige sincronização. Retorna `201`, ou `200` para uma `idempotencyKey` já conhecida e vinculada ao mesmo request. Reutilizar a chave com outro request retorna `409`:

```json
{
  "executionId": "execution-id",
  "plan": { "intent": "controlled_sync_review", "steps": [] },
  "review": {
    "state": "review_required",
    "riskLevel": "HIGH",
    "sideEffectLevel": "EXTERNAL_READ",
    "requiredApprovals": 1,
    "version": 1,
    "validUntil": "2026-08-27T12:15:00.000Z"
  },
  "created": true
}
```

O preview informa serviços, ordem, inputs, outputs, persistência e limite estimado de itens. Ele nunca executa side effect.

### `GET /api/orchestrator/executions/:id/review`

Consulta o estado persistido `draft`, `review_required`, `approved`, `rejected`, `expired` ou `executed`. Retorna `200`, `404` ou erro seguro.

### `POST /api/orchestrator/executions/:id/approve`

```json
{ "reviewer": "local-operator", "reason": "Plano conferido", "expectedVersion": 1 }
```

Aprova somente a versão vigente, registra snapshot e hash do plano e incrementa a versão do review. Retorna `200`; repetição após aprovação é idempotente. Retorna `400` para payload inválido, `404` para execução ausente, `409` para concorrência/estado incompatível e `410` para plano expirado.

### `POST /api/orchestrator/executions/:id/reject`

Recebe `reviewer`, `reason` obrigatório e `expectedVersion`. Registra rejeição sem executar. Retorna `200`, `400`, `404`, `409` ou `410`.

### `POST /api/orchestrator/executions/:id/expire`

Aceita `{ "reason": "opcional" }` e invalida review pendente/aprovado de forma explícita. A expiração automática usa a janela associada ao risco. Retorna `200`, `400`, `404` ou `409`.

### `POST /api/orchestrator/executions/:id/execute`

Body deve ser `{}`. Executa somente plano aprovado, não expirado e cujo hash ainda corresponde ao snapshot aprovado e ao plano reconstruído com as capabilities atuais. Plano rejeitado retorna `409` com motivo seguro; mudança ou remoção de capability expira a aprovação e retorna `410`. Retentativa após conclusão retorna o resultado persistido; tentativa concorrente não duplica execução. Retorna `200`, `400`, `404`, `409`, `410` ou `500` sanitizado.

### `GET /api/orchestrator/executions/:id/audit`

Lista, em ordem cronológica, eventos sanitizados de criação, classificação/revisão, aprovação/rejeição/expiração, tentativa, bloqueio e execução. Não retorna secrets, tokens ou payloads externos brutos.

### `GET /api/orchestrator/executions/recent`

Lista histórico recente em ordem determinística. Aceita `projectId`, `conversationId` e `limit` de 1 a 50. Retorna `200` ou `400`.

### `GET /api/orchestrator/executions/:id`

Abre a execução persistida. Retorna `200`, `400`, `404` ou `500` seguro.

### `GET /api/orchestrator/executions/:id/plan`

Retorna o plano persistido da execução. Retorna `200`, `400`, `404` ou `500` seguro.

## Controlled Automations

Todas as rotas usam `/api/automations`. Payloads rejeitam campos extras e nunca aceitam capability, token, confirmação externa ou código executável.

### `POST /api/automations`

Cria uma definição e retorna `201`. Campos: `name`, `description?`, `projectId?`, `triggerType`, `schedule?`, `timezone?`, `intent`, `orchestrationInput?` e `enabled?`.

```json
{
  "name": "Resumo diário",
  "triggerType": "DAILY",
  "schedule": { "time": "09:00" },
  "timezone": "America/Sao_Paulo",
  "intent": "Como está o estado operacional do canal?",
  "orchestrationInput": {},
  "enabled": true
}
```

Retorna `400` para definição/agenda inválida e `500` sanitizado para falha inesperada.

### `GET /api/automations` e `GET /api/automations/:id`

Listam em ordem determinística e abrem a definição persistida. Retornam `200`; ID ausente retorna `404`.

### `PATCH /api/automations/:id`

Atualiza nome, descrição, trigger, schedule, timezone, intent ou input. Reavalia risco/efeito e recalcula `nextRunAt` quando ativa. Retorna `200`, `400`, `404` ou `500` seguro.

### Ações de estado

- `POST /api/automations/:id/enable`
- `POST /api/automations/:id/disable`
- `POST /api/automations/:id/pause`
- `POST /api/automations/:id/resume`

Body vazio. Retornam `200`, `400`, `404` ou `500`. Resume/enable recalculam a próxima ocorrência; pause/disable removem a agenda ativa.

### `POST /api/automations/:id/run`

Executa `Run Now` pelo pipeline preview → PlanReview → Orchestrator. Retorna `201` para novo run ou `200` para claim já existente. O run pode terminar `SUCCEEDED`, `FAILED` ou `BLOCKED`. `409` indica conflito operacional.

### `GET /api/automations/due`

Lista definições vencidas sem executá-las. Aceita `now` ISO opcional. Retorna `200` ou `400`.

### `POST /api/automations/due/run`

Entrada manual de compatibilidade. Aceita `{}` ou `{ "now": "ISO-8601" }`, captura uma lista finita de vencidas e executa cada ocorrência elegível. Não altera o estado start/stop do runtime. Retorna `200` com `checkedAt`, contagens `due`/`missed` e resultados.

### Runtime local

- `GET /api/automations/runtime/status`: snapshot de estado e health;
- `GET /api/automations/runtime/health`: alias operacional do mesmo snapshot;
- `GET /api/automations/runtime/events?limit=100`: eventos recentes, limite de 1 a 100;
- `POST /api/automations/runtime/start`: inicia quando habilitado por ambiente;
- `POST /api/automations/runtime/stop`: para e aguarda o tick ativo;
- `POST /api/automations/runtime/tick`: executa um tick explícito sem sobreposição.

As ações aceitam somente body vazio ou `{}`. Start/tick retornam `409` quando o runtime está desabilitado ou outro runtime já possui o processo. Query/body inválido retorna `400`; erro inesperado retorna `500` sanitizado. Health expõe somente status, configuração não sensível, timestamps, contagens e tipo seguro do último erro.

### Runs e auditoria

- `GET /api/automations/:id/runs?limit=20`: histórico mais recente;
- `GET /api/automations/runs/:runId`: abre um run;
- `POST /api/automations/runs/:runId/execute`: continua um run bloqueado depois que seu plano foi aprovado;
- `GET /api/automations/:id/audit?limit=100`: trilha operacional.

Retornam `200`, `400`, `404`, `409` ou `500` sanitizado conforme estado e existência.

### Governança e diagnósticos

- `GET /api/automations/diagnostics`: diagnósticos reais de todas as definições;
- `GET /api/automations/:id/diagnostics`: health, quotas, cooldown, janela, falhas, bloqueio, fatos e recomendação;
- `GET /api/automations/:id/governance`: policy efetiva, incluindo defaults;
- `PUT /api/automations/:id/governance`: atualiza somente campos permitidos da policy;
- `POST /api/automations/:id/clear-block`: limpa bloqueio operacional, nunca PlanReview pendente;
- `POST /api/automations/:id/skip`: persiste a ocorrência como `SKIPPED` e avança a agenda;
- `POST /api/automations/:id/override`: executa override one-shot de quota/janela/cooldown;
- `POST /api/automations/runs/:runId/retry`: cria nova tentativa ligada ao run falho;
- `POST /api/automations/runs/:runId/recover`: cria nova tentativa somente para `Interrupted`.

O body de override exige `policies`, `reason` e `authorizedBy`. Valores aceitos em `policies`: `quota`, `window`, `cooldown`. Aprovação externa, validação de capability, estado de segurança e PlanReview não são ignoráveis. Payload/ID inválido retorna `400`, ausente `404`, conflito operacional `409` e erro inesperado `500` sanitizado.

## Operadores especializados do canal

### `GET /api/operators/channel`

Lista CTR, Retenção, Long-form e Shorts na ordem oficial. Aceita somente `projectId` textual opcional. Retorna `200` com análises estruturadas ou `400` para query inválida.

### `GET /api/operators/channel/:id`

Abre uma análise de `ctr`, `retention`, `long-form` ou `shorts`. Aceita somente `projectId` opcional.

```json
{
  "id": "ctr",
  "status": "AVAILABLE",
  "facts": [],
  "signals": [],
  "insights": [],
  "recommendations": [],
  "missingData": [],
  "confidence": 0.8,
  "evidence": [],
  "source": "persisted-youtube-performance",
  "sampleSize": 5,
  "lastDataAt": "2026-08-25T12:00:00.000Z"
}
```

Retorna `200`, `400`, `404` ou `500` sanitizado. A rota não chama YouTube e não retorna credenciais, queries ou stack.

## Dashboard degradado

`GET /api/dashboard` retorna `200` com `unauthorized: true` e `authUrl` quando o Google não está autenticado ou exige novo consentimento. O payload preserva serviços locais. Somente falha interna inesperada retorna `500` sanitizado.

Quando o Google/YouTube está temporariamente inacessível por rede, quota ou indisponibilidade do provider, o Dashboard também retorna `200`, agora com `youtubeUnavailable: true`, mantendo os dados e serviços locais operacionais. Dados de canal previamente persistidos são retornados com `integration.state = "DEGRADED"`, `stale = true` e `lastSuccessAt`. Sem cache válido, a consulta direta `GET /api/youtube/channel` retorna erro seguro; ausência ou expiração não recuperável da autenticação retorna `401` com `code = "AUTH_REQUIRED"`.

## Estado consolidado de integrações

### `GET /api/integrations/status`

Retorna `200` com os estados seguros de `backend`, `database`, `googleOAuth`, `youtubeData`, `youtubeAnalytics`, `openai` e `automationRuntime`. Cada item contém `state`, `configured`, `available`, `stale`, `summary`, `lastSuccessAt` e `action` opcional. `state` usa somente `NOT_CONFIGURED`, `AUTH_REQUIRED`, `CONNECTED`, `DEGRADED` ou `ERROR`.

O endpoint nunca retorna client secret, token, chave, caminho local ou payload bruto do provider.

## Canal conectado

### `GET /api/youtube/channel`

Coleta o canal autenticado e persiste o último resultado válido. Retorna `200` com ID, título, contagens públicas, país, publicação e o estado operacional da coleta. Quando a rede externa falha e existe cache, retorna o dado conhecido com estado `DEGRADED`; configuração ausente retorna `503` com `CONFIG_MISSING`, autenticação ausente retorna `401` com `AUTH_REQUIRED` e indisponibilidade sem cache retorna `503` com `PROVIDER_UNAVAILABLE`.

## Audience e fontes de tráfego

Base: `/api/operators/creator-intelligence/audience`.

- `GET /status`: estado do provider, última sincronização, dimensões ausentes e qualidade;
- `POST /sync`: sincroniza no máximo 31 dias. Body estrito: `startDate`, `endDate` e `projectId` opcional;
- `GET /summary?projectId=`: fontes, países, dispositivos, status de inscrição, termos disponíveis, fatos, sinais, hipóteses, recomendações, confiança e `missingData`;
- `GET /traffic?projectId=`: leitura específica de fontes e termos de busca disponíveis;
- `GET /comparison?currentStart=&currentEnd=&previousStart=&previousEnd=&projectId=`: compara dois intervalos explícitos.

`POST /sync` retorna `200`; payload inválido retorna `400`, autorização ausente `401`, quota `429`, configuração ou provider temporariamente indisponível `503` e falha inesperada `500` sanitizado. Leituras retornam `200`, `400` ou `500` sanitizado.

Os contratos preservam enums oficiais como `YT_SEARCH`, `RELATED_VIDEO`, `BROWSE`, `SHORTS`, `EXT_URL`, `MOBILE`, `COMPUTER`, `SUBSCRIBED` e `UNSUBSCRIBED`. Termos de busca aparecem somente quando a API os fornece; ausência ou supressão é `missingData`, nunca uma keyword inferida.

## Trends, Series e Content Patterns

Base: `/api/operators/creator-intelligence`. Todos os endpoints retornam erros sanitizados; IDs e queries inválidos retornam `400`, registros ausentes retornam `404` e falhas inesperadas retornam `500` sem stack ou payload interno.

### `GET /trends`

Lista sinais persistidos/atualizados. Queries opcionais: `projectId`, `subjectType`, `classification`, `days` (`7` ou `28`) e `refresh` (`false` evita recalcular). Retorna `200` com array em ordem determinística.

### `GET /trends/:id`

Abre uma tendência com janelas, confiança, qualidade e evidências. Retorna `200` ou `404`.

### `POST /series`

Cria ou reutiliza uma série com body estrito `{ "name": "Série", "projectId"?: "...", "game"?: "...", "topic"?: "...", "status"?: "ACTIVE" | "PAUSED" | "ARCHIVED", "metadata"?: {} }`. A listagem posterior importa somente snapshots cujo metadado explícito de série corresponda exatamente. Retorna `201` na criação ou `200` quando a chave já existe; payload inválido retorna `400`.

### `GET /series` e `GET /series/:id`

Listam ou abrem séries com episódios e saúde derivada. Aceitam `projectId` na listagem. Retornam `200`; ID ausente retorna `404`.

### `POST /series/:id/videos`

Vincula um snapshot real com `{ "snapshotId": "...", "mode"?: "manual" | "auto" }`. O modo automático exige evidência explícita de alta confiança e o mesmo projeto. Retorna `201` na criação, `200` no vínculo idempotente ou `422` quando a evidência automática é insuficiente; validação retorna `400` e registros ausentes retornam `404`.

### `DELETE /series/:id/videos/:videoId`

Remove apenas a associação da série. Retorna `204`; parâmetros inválidos retornam `400`.

### `GET /content-patterns`

Lista associações persistidas. Queries opcionais: `projectId`, `patternType` (`GAME`, `FORMAT`, `SERIES`, `TOPIC`, `TRAFFIC_MIX`, `AUDIENCE_SEGMENT`) e `refresh` (`false` evita recalcular). Retorna `200`.

### `GET /subject-performance`

Consulta agrupamentos reais por `type=game|topic`, com `projectId` opcional. Retorna `200`; tipo ausente ou inválido retorna `400`. Metadado indisponível resulta em lista vazia, nunca inferência textual.

## Research & Opportunity Discovery

Base: `/api/research`. Todos os bodies e filtros são estritos. Validação retorna `400`, registro ausente `404`, providers totalmente indisponíveis sem cache retornam `503` e falha inesperada retorna `500` sanitizado.

### `POST /api/research`

Executa pesquisa normalizada. Body:

```json
{
  "query": "procure jogos que combinem com meu canal",
  "intent": "GAME_DISCOVERY",
  "projectId": "opcional",
  "subjectType": "GAME",
  "subject": "simulador",
  "forceRefresh": false
}
```

Somente `query` é obrigatória. Retorna `200` com `historyId`, query, fontes, resultados, oportunidades, qualidade, freshness, limitações, validade e estado de cache (`MISS`, `HIT` ou `STALE_FALLBACK`).

### `POST /api/research/games` e `POST /api/research/topics`

Atalhos do mesmo contrato. Forçam respectivamente `GAME_DISCOVERY/GAME` e `TOPIC_RESEARCH/TOPIC`; não usam provider externo implicitamente.

### `GET /api/research/opportunities`

Lista oportunidades persistidas em ordem de pesquisa mais recente e rank. Filtros opcionais: `projectId`, `state` e `limit` (1–100). Cada item inclui origem da pesquisa e data.

### `GET /api/research/opportunities/:id`

Abre o artefato persistido com fontes, evidências, freshness, compatibilidade, confiança, riscos, lacunas e próxima investigação. Retorna `200` ou `404`.

### `GET /api/research/history` e `GET /api/research/history/:id`

Listam ou abrem pesquisas persistidas. A listagem aceita `projectId` e `limit` (1–50). Resultados externos e internos, quando existirem, mantêm sua origem separada.

### `POST /api/research/history/:id/refresh`

Reexecuta uma pesquisa existente com body `{}` e cria uma observação comparável. Não transforma resultado stale em atual sem nova execução válida.

## Strategic Planning

Base: `/api/planning`. Todos os payloads e filtros são estritos. Validação retorna `400`, plano/item ausente retorna `404` e falha inesperada retorna `500` sanitizado.

### `GET /api/planning/current`

Retorna o plano atual mais recente. Filtros opcionais: `projectId` e `horizon` (`TODAY`, `NEXT_3_DAYS`, `NEXT_7_DAYS`, `NEXT_14_DAYS`). Retorna `200` ou `404` quando ainda não existe plano.

### `GET /api/planning/current/guidance`

Retorna somente a orientação operacional atual: item, estado de execução, ação, motivo, prioridade, readiness, esforço, confiança, evidências, riscos, dados ausentes e indicador degradado. Aceita os mesmos filtros de `current`. Retorna `200`, `400` ou `404`.

### `POST /api/planning/generate`

Gera e persiste uma nova versão do plano. Body estrito:

```json
{
  "projectId": "opcional",
  "horizon": "NEXT_7_DAYS",
  "constraints": [
    { "code": "availability", "summary": "Janela curta de gravação", "blocking": false }
  ]
}
```

Retorna `201` com `ContentPlan`, itens ordenados e histórico inicial. Um plano anterior não é sobrescrito.

### `POST /api/planning/items`

Adiciona um item manual a um plano existente. Exige `planId`, `title` e `reason`; aceita `candidateType`, `priority`, `effort` e `constraints`. Retorna `201`.

### `PATCH /api/planning/items/:id`

Atualiza `status`, `priority` e/ou `effort` com `reason` obrigatório, retornando `200`. O contrato alternativo `{ "requestResearch": true }` solicita pesquisa controlada para um item `NEEDS_RESEARCH`; ele não pode ser combinado com outros campos.

### `POST /api/planning/items/:id/complete`

Marca o item como `COMPLETED`/`DONE`. Aceita body vazio, `{}` ou `{ "reason": "Conteúdo produzido" }`. Retorna `200` com o item persistido.

### `POST /api/planning/items/:id/execution`

Registra uma transição operacional. Body estrito:

```json
{
  "state": "in_progress",
  "reason": "Gravação iniciada",
  "note": "Preparar captura e roteiro"
}
```

`state` aceita `pending`, `in_progress`, `completed`, `skipped` ou `paused`; `reason` e `note` são opcionais. Retorna `200` com item, evento persistido quando houve mudança, plano recalculado e `currentGuidance`. Repetir o mesmo estado é idempotente. Transição terminal inválida ou tentativa concorrente de manter dois itens ativos retorna `409`; payload inválido retorna `400` e item ausente retorna `404`.

### `POST /api/planning/reorder`

Reordena todos os itens do plano. Body estrito:

```json
{
  "planId": "plan-id",
  "itemIds": ["item-b", "item-a"],
  "reason": "Ajuste editorial manual"
}
```

Retorna `200` com a ordem persistida. IDs ausentes, repetidos ou de outro plano são rejeitados com `400`.

### `GET /api/planning/history`

Lista mudanças append-only. Aceita `planId`, `itemId` e `limit` numérico. Retorna `200` em ordem determinística.

### `GET /api/planning/execution-history`

Lista eventos de execução append-only, do mais recente para o mais antigo. Aceita `planId`, `itemId` e `limit` de 1 a 200. Cada evento inclui estado, ação, motivo opcional, confiança e snapshot estratégico. Retorna `200` ou `400`.

### `GET /api/planning/:id`

Abre um plano persistido com itens e histórico. Retorna `200`, `400` para ID/query inválidos ou `404` quando ausente.

O contrato expõe fatos e decisões já persistidos. Ele não publica conteúdo, não prevê views e não envia credenciais, stack ou payload bruto de integrações.

## Strategic Planning Outcomes

Base: `/api/planning`. Todas as rotas usam IDs textuais não vazios, payload estrito e respostas sanitizadas. O frontend nunca envia métricas nem conteúdo editorial como origem do resultado; o backend lê snapshots reais já persistidos.

### `GET /api/planning/items/:id/video-candidates`

Lista a observação mais recente de cada vídeo do mesmo projeto, em ordem determinística. Cada candidato informa `snapshotId`, `videoId`, `title`, `format`, publicação, janela, coleta, confiança e `linkedItemId`. Títulos semelhantes não criam associação. Retorna `200`, `400`, `404` ou `422` quando a execução ainda não foi concluída.

### `GET /api/planning/items/:id/outcome`

Retorna `activeLink`, histórico de links, outcomes por janela e eventos de auditoria. Links removidos continuam no histórico. Retorna `200`, `400` ou `404`.

### `POST /api/planning/items/:id/outcome/video`

Associa explicitamente uma execução concluída a um snapshot/vídeo real.

```json
{
  "snapshotId": "snapshot-id",
  "reason": "Correção explícita do vídeo publicado."
}
```

`reason` é opcional na primeira associação e obrigatório ao substituir outro vídeo. A mesma associação é idempotente. Retorna `201` ao criar, `200` quando já existia, `400` para payload inválido, `404` para item/snapshot ausente, `409` para conflito e `422` para execução não concluída.

### `DELETE /api/planning/items/:id/outcome/video`

Remove logicamente o vínculo ativo sem apagar histórico nem outcomes.

```json
{ "reason": "Associação corrigida após revisão manual." }
```

Retorna `200`; usa `400`, `404` e `500` sanitizado quando aplicável.

### `POST /api/planning/items/:id/outcomes`

Captura e avalia um snapshot do vídeo associado. `{}` usa o snapshot mais recente; `{ "snapshotId": "..." }` seleciona uma janela persistida específica. Retorna `201` para novo outcome, `200` para captura idempotente, `400`, `404`, `409` ou `422`.

### `GET /api/planning/outcomes/:id`

Abre um outcome persistido com snapshot, vínculo, evento de execução e auditoria. Retorna `200`, `400`, `404` ou `500` sanitizado.

Classificações não representam causalidade. O benchmark usa mediana de pelo menos dois vídeos distintos com mesmo formato, duração de janela e idade de publicação; uma banda neutra explícita de 10% evita tratar pequenas oscilações como direção. Sem comparabilidade defensável, o resultado é `INSUFFICIENT_DATA`.
