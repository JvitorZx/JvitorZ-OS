# Fluxo de Dados

## Visão Geral

O frontend monta o dashboard em `frontend/app.js`, compartilha uma instância de `createApiClient()` e inicializa o controller do Planejador quando o módulo `content-planner` está ativo.

O fluxo persistente do Planejador é:

```text
Frontend Planner
  -> frontend/src/api/client.js
    -> /api/operators/planner/conversations
      -> PlannerService
        -> ConversationRepository / MessageRepository
          -> Prisma Client
            -> SQLite
```

As rotas fazem validação HTTP e delegam ao `PlannerService`. O serviço aplica regras de domínio e usa repositories; não há acesso Prisma direto pelo frontend ou pelas rotas.

Para geração inteligente, o serviço também usa uma fronteira independente do fornecedor:

```text
Conversation.context + mensagens persistidas
  -> PlannerLanguageInput
    -> LanguageProvider
      -> OpenAILanguageProvider (Responses API)
        -> texto normalizado
          -> MessageRepository (sender: "operator")
            -> Prisma -> SQLite
```

## Inicialização do Planner

1. `dashboard.js` renderiza o módulo ativo e chama `plannerController.init()`.
2. O controller chama `GET /api/operators/planner/conversations` para carregar o histórico persistido.
3. Se o `activeConversationId` em memória ainda existir na lista, ele é reutilizado.
4. Sem uma conversa ativa válida, o controller escolhe a primeira conversa retornada pelo backend.
5. Se o histórico estiver vazio, chama `POST /api/operators/planner/conversations` e cria uma conversa automaticamente.
6. A conversa escolhida é aberta com `GET /api/operators/planner/conversations/:id`.
7. Mensagens e `context` retornados são renderizados como estado da conversa ativa.

`activeConversationId` existe somente no controller durante a execução. Ele não é persistido em `localStorage`; após recarregar toda a página, a seleção volta a seguir a ordenação retornada pelo backend.

## Histórico e Nova Conversa

- O histórico usa a listagem real da API e preserva sua ordenação.
- Cada item contém o ID necessário para abrir a conversa e indica visualmente a conversa ativa.
- O controle **Nova Conversa** chama o endpoint de criação uma única vez enquanto a operação está em andamento.
- Após sucesso, a conversa criada se torna ativa, a área de mensagens é limpa e o histórico é atualizado.
- Falhas não criam uma conversa apenas visual nem substituem a conversa ativa.

## Troca de Conversa

1. O usuário seleciona um item do histórico.
2. O controller solicita a conversa completa por ID.
3. Somente uma resposta ainda atual pode alterar `activeConversationId`.
4. As mensagens e o contexto anteriores são substituídos pelos dados da conversa selecionada.

As mensagens de conversas diferentes nunca são combinadas no mesmo painel.

## Persistência de Mensagens

1. O usuário envia texto pelo botão ou por `Enter`; `Shift+Enter` permanece disponível para quebra de linha.
2. O frontend chama `POST /api/operators/planner/conversations/:id/messages` com `sender: "user"` e `text`.
3. A rota valida o payload e delega a criação ao `PlannerService`.
4. O serviço confirma que a conversa existe e usa `MessageRepository`.
5. Prisma grava a mensagem no SQLite.
6. O frontend acrescenta a mensagem ao chat somente depois da resposta `201`.
7. O frontend chama `POST /api/operators/planner/conversations/:id/reply` exatamente uma vez.
8. `PlannerService.generateReply()` carrega a conversa completa e mapeia contexto e histórico cronológico para a entrada neutra.
9. O `LanguageProvider` gera texto sem persistir dados diretamente.
10. O serviço valida a saída e usa `MessageRepository` para persistir uma única mensagem `operator`.
11. A rota retorna `201` somente com a mensagem persistida; então o frontend a renderiza depois da mensagem `user`.

Se a geração falhar, a mensagem `user` permanece persistida e nenhuma mensagem `operator` falsa é criada. Um novo envio fica bloqueado durante a geração atual para evitar respostas duplicadas.

## Entrada e Limites de Linguagem

- `Conversation.context` é enviado como instrução, limitado a 4.000 caracteres.
- O histórico preserva ordem cronológica, roles `user`, `operator` e `system`, as 30 mensagens mais recentes e até 16.000 caracteres.
- `operator` é convertido em `assistant` apenas dentro do adapter OpenAI.
- A saída é limitada a 4.000 caracteres e a estimativa conservadora de quatro caracteres por token aplica `max_output_tokens: 1000`.
- `OPENAI_MODEL` configura o modelo; quando ausente, o adapter usa `gpt-5-mini`.
- A chave é lida de `OPENAI_API_KEY` somente quando `generate()` é chamado. Sua ausência não impede o startup.

## Persistência de Contexto

- O editor de Prompt Base representa `Conversation.context` da conversa ativa.
- Ao abrir ou trocar de conversa, o frontend restaura o valor retornado pela API.
- Ao perder foco após uma alteração, o editor chama `PATCH /api/operators/planner/conversations/:id/context`.
- Texto vazio ou somente com espaços limpa o campo, que passa a ser `null`.
- Se a atualização falhar, o editor restaura o último valor confirmado e não apresenta a alteração como salva.
- Não existe mais dependência de `localStorage["planner.prompt.base"]`.

## Respostas Assíncronas Obsoletas

O controller usa uma geração de montagem e tokens por operação:

- navegar para outro módulo invalida a montagem anterior;
- remontar o Planner cria uma nova geração;
- trocas, criações, envios, gerações e atualizações de contexto verificam se sua requisição ainda é atual;
- mensagens e contextos também verificam o ID da conversa capturado no início da operação.

Respostas antigas são ignoradas silenciosamente e não alteram conversa ativa, mensagens, contexto, histórico ou feedback visual.

## Tratamento Visual de Erros

O Planner possui uma região de status com `role="status"` e `aria-live="polite"`. Ela mostra mensagens curtas para falhas de:

- inicialização;
- criação de conversa;
- atualização do histórico;
- troca de conversa;
- envio de mensagem;
- geração de resposta inteligente;
- salvamento de contexto.

O feedback não expõe payloads, stack traces ou detalhes internos. Uma ação posterior bem-sucedida limpa a mensagem correspondente.

## Testes do Fluxo

`npm test`, executado em `backend/`, cobre a API real com Prisma e SQLite em memória, providers/clients de linguagem injetáveis e o controller frontend com DOM controlado. As 104 verificações não dependem de OAuth, YouTube, OpenAI real, chave, rede externa ou `dev.db`.

Permanece pendente, sem bloquear a Sprint, um smoke test manual com `OPENAI_API_KEY` válida para confirmar uma chamada real HTTP `201`. Chave, prompt e resposta do teste não devem ser registrados na documentação.
