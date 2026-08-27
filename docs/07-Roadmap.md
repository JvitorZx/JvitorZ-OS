# Roadmap

Este documento registra fases gerais e entregas concluídas do JvitorZ OS.

## Fases do Projeto

- **FASE 1 - Fundação** — em andamento
  - GitHub
  - Estrutura
  - Documentação
  - README
  - Backend
- **FASE 2 - Infraestrutura**
- **FASE 3 - Google Cloud**
- **FASE 4 - YouTube APIs**
- **FASE 5 - OpenAI**
- **FASE 6 - n8n**
- **FASE 7 - Primeiro Operador**
- **FASE 8 - Dashboard**
- **FASE 9 - JvitorZ OS Alpha**

## Sprint 13 — Persistência do Planejador

**Status: CONCLUÍDA**

### Entregas

- criação persistida de conversas;
- listagem e histórico de conversas;
- abertura de conversa por ID com mensagens;
- criação e persistência de mensagens;
- ordenação cronológica das mensagens;
- fluxo Nova Conversa;
- troca entre conversas sem mistura de mensagens;
- `Conversation.context` como prompt-base por conversa;
- remoção de `localStorage["planner.prompt.base"]`;
- integração frontend, API client e backend;
- proteção contra respostas assíncronas obsoletas;
- feedback visual e acessível de erros;
- testes automatizados com `node:test` e SQLite em memória.

### Backlog não bloqueador

- reordenar conversas por atividade após criação de mensagem;
- adicionar loading e estado vazio mais elaborados;
- otimizar a consulta usada apenas para validar existência de conversa;
- consolidar enum/tipos compartilhados de `sender`;
- dividir o controller do Planner em unidades menores;
- persistir `activeConversationId` após reload;
- adicionar testes futuros em navegador real.

## Observações

A Sprint 13 encerra o fluxo vertical de persistência do Planejador. IA, respostas automáticas e títulos automáticos permanecem fora deste escopo.

## Sprint 14 — Estabilização da Workspace e Navegação dos Operadores

**Status: CONCLUÍDA**

**Fase: FASE 7 - Primeiro Operador**, com preparação estrutural para a FASE 8 - Dashboard.

### Objetivo

Consolidar a estrutura da workspace e da navegação dos operadores para que novos operadores possam ser adicionados sobre uma base reutilizável e estável, sem regressão no Planejador.

### Princípio

A Sprint trata apenas de mudanças estruturais e funcionais necessárias à evolução do produto. Redesign amplo e melhorias puramente cosméticas não fazem parte do escopo.

### Entregas

- testes de caracterização da navegação e do lifecycle anterior;
- sidebar e hash como navegação oficial dos módulos e workspaces;
- fallback determinístico que normaliza hash ausente ou inválido para `#channel`;
- contrato genérico `module.createController(context)` com `mount` e `unmount` explícitos;
- Dashboard desacoplado do controller do Planner;
- desmontagem antes da substituição do DOM e montagem única do módulo seguinte;
- workspace fullscreen compartilhada por meio de `createFullscreenWorkspace`;
- remoção do botão `Voltar` e de seus estilos e listeners;
- catálogo Operadores baseado nos módulos realmente registrados;
- operadores indisponíveis visíveis como catálogo, sem links ou hashes inválidos;
- `statePanel` restrito a carregamento, autenticação e erros globais do Dashboard;
- feedback e estado de execução mantidos localmente por cada operador;
- preservação integral dos fluxos persistentes e das proteções do Planner;
- regressão automatizada com 43 testes determinísticos.

### Backlog

- redesign de layout, paleta, tipografia, sombras, bordas ou espaçamento;
- refinamentos cosméticos e responsivos que não bloqueiem o uso da workspace;
- breadcrumb ou navegação contextual adicional;
- redesign visual da página Operadores;
- loading e estados vazios mais elaborados;
- reorganização ampla do design system ou renomeação puramente estética de classes CSS;
- divisão do controller do Planner além do necessário para aderir ao ciclo de vida;
- persistência de `activeConversationId` após reload;
- testes end-to-end em navegador real;
- demais itens não bloqueadores registrados ao final da Sprint 13.

### Critérios de conclusão

- nenhuma workspace depende ou renderiza o botão `Voltar` para navegação;
- sidebar e hash permitem entrar e sair de qualquer módulo disponível, com comportamento previsível para hash inválido;
- Dashboard oferece um contrato genérico de montagem e desmontagem e não conhece o controller do Planner diretamente;
- cada mudança de módulo desmonta a instância anterior e monta a nova exatamente uma vez;
- um operador de teste pode ser registrado sem alteração na lógica central de navegação do Dashboard;
- itens indisponíveis na página Operadores não apontam para rotas inexistentes;
- `statePanel` permanece global e erros do Planner continuam em seu feedback local com `aria-live`;
- todos os fluxos da Sprint 13 continuam funcionais, sem duplicação de listeners ou aplicação de respostas assíncronas obsoletas;
- testes automatizados, build do backend, sintaxe do frontend e `git diff --check` passam;
- documentação reflete o contrato implementado e nenhuma mudança cosmética ampla foi incluída.

### Tarefas concluídas

1. testes de caracterização para sidebar, hash, fullscreen e ciclo de vida;
2. contrato genérico de montagem/desmontagem e adaptação do Planner;
3. workspace compartilhada e remoção do botão `Voltar`;
4. catálogo Operadores alinhado aos módulos navegáveis;
5. separação entre `statePanel` global e feedback local dos operadores;
6. fallback determinístico, regressão completa e documentação final.

### Resultado

A Sprint 14 estabiliza a base de navegação e lifecycle necessária para adicionar operadores futuros sem condições específicas no Dashboard. Nenhuma feature de operador ou redesign visual foi incluído.

## Sprint 15 — Primeira Resposta Inteligente do Planejador

**Status: CONCLUÍDA**

**Fase principal: FASE 5 - OpenAI**

**Aplicação: primeiro operador funcional da FASE 7 - Primeiro Operador.**

### Objetivo

Permitir que o Planner gere e persista uma resposta de IA baseada no contexto e no histórico da conversa, transformando o Planner de chat persistente em operador inteligente funcional.

### Problema que resolve

Antes desta Sprint, o Planner persistia conversas, mensagens e contexto, mas não produzia uma resposta inteligente. A entrega conecta essa base a um provider de linguagem sem acoplar o domínio ao SDK da OpenAI e sem tornar a inicialização do sistema dependente de credenciais de IA.

### Escopo obrigatório

1. **Provider de linguagem desacoplado**
   - definir contrato injetável e neutro em relação ao fornecedor;
   - manter o `PlannerService` independente do SDK OpenAI;
   - permitir testes determinísticos com provider fake e sem rede.
2. **Entrada da IA**
   - construir a entrada com `Conversation.context`;
   - incluir mensagens persistidas em ordem cronológica;
   - incluir a mensagem atual somente depois de sua persistência.
3. **Limites básicos**
   - limitar o contexto a 4.000 caracteres;
   - limitar o histórico às 30 mensagens mais recentes e a 16.000 caracteres;
   - limitar a saída a 4.000 caracteres, convertidos conservadoramente em até 1.000 tokens para a OpenAI;
   - manter o modelo configurável fora da interface do usuário;
   - evitar custo e payload desnecessários.
4. **PlannerService**
   - validar a existência da conversa;
   - carregar contexto e histórico;
   - chamar o provider injetado;
   - persistir a resposta com `sender: "operator"`;
   - retornar somente a mensagem persistida.
5. **Adapter OpenAI**
   - usar o SDK oficial e a Responses API;
   - carregar configuração e chave de ambiente de forma lazy;
   - ler `OPENAI_API_KEY` e `OPENAI_MODEL` do ambiente, com fallback `gpt-5-mini`;
   - permitir que o sistema inicie sem a chave configurada;
   - não registrar chave, prompt completo, resposta completa ou payload sensível.
6. **API**
   - expor `POST /api/operators/planner/conversations/:id/reply` para solicitar a próxima resposta inteligente de uma conversa existente.
7. **Frontend**
   - solicitar exatamente uma resposta depois de persistir a mensagem do usuário;
   - renderizar a resposta somente depois de sua persistência;
   - impedir duplicação;
   - preservar a mensagem do usuário quando a IA falhar;
   - manter o feedback de erro local ao Planner.
8. **Concorrência**
   - ignorar na UI respostas tardias depois de troca de conversa, navegação ou `unmount`;
   - preservar as proteções existentes contra respostas assíncronas obsoletas.
9. **Testes**
   - usar provider fake, sem chamada real à OpenAI ou outra rede externa;
   - usar banco isolado, sem alterar `dev.db`;
   - preservar a regressão das Sprints 13 e 14 dentro da suíte completa de 104 testes.

### Fora de escopo

- streaming;
- escolha de modelo pela UI;
- múltiplos providers;
- títulos automáticos;
- RAG e Biblioteca;
- dados do YouTube no prompt;
- tools/function calling;
- n8n e automações;
- regeneração de resposta;
- edição ou ramificação de mensagens;
- novos operadores;
- redesign;
- testes em navegador real.

### Critérios de conclusão

- uma mensagem `user` persistida gera exatamente uma mensagem `operator` persistida;
- `Conversation.context` e o histórico cronológico corretos são enviados ao provider;
- a resposta `operator` é persistida no SQLite e sobrevive a reload e troca de conversa;
- mensagens e respostas permanecem isoladas entre conversas;
- chave ausente ou configuração inválida da IA não impede o startup do sistema;
- falha do provider não cria mensagem ou sucesso visual falso;
- respostas obsoletas não alteram a conversa exibida;
- chaves, prompts completos, respostas completas e payloads sensíveis não aparecem em logs;
- testes são determinísticos, sem rede externa e sem uso de `dev.db`;
- suíte completa, build, sintaxe do frontend e `git diff --check` passam;
- contratos HTTP e documentação refletem o fluxo entregue.

### Tarefas concluídas

1. contrato do provider e mapeamento da entrada;
2. geração no `PlannerService` com provider fake;
3. adapter OpenAI, configuração lazy e limites;
4. endpoint de geração;
5. API client do frontend;
6. integração com o controller do Planner;
7. testes de concorrência, falhas e regressão;
8. documentação e contratos finais.

### Entregas

- contrato neutro e injetável `LanguageProvider`;
- entrada neutra com contexto, histórico cronológico, roles e limites;
- `PlannerService.generateReply()` desacoplado do SDK externo;
- persistência da resposta gerada com `sender: "operator"`;
- `OpenAILanguageProvider` com SDK oficial, Responses API e configuração lazy;
- configuração por `OPENAI_API_KEY` e `OPENAI_MODEL`, com fallback `gpt-5-mini`;
- endpoint `/reply` com respostas seguras para sucesso, validação, ausência de conversa, indisponibilidade e falha do provider;
- integração frontend/backend após a persistência da mensagem `user`;
- bloqueio de geração concorrente, listeners únicos e proteção contra respostas obsoletas;
- feedback de erro local ao Planner, sem alterar o `statePanel` global;
- 104 testes automatizados determinísticos, sem rede externa e sem uso de `dev.db`.

### Validação externa pendente — não bloqueadora

> Executar smoke test manual com `OPENAI_API_KEY` válida para confirmar uma chamada real HTTP 201 e resposta `operator` produzida pela API OpenAI.

O smoke test não bloqueia a conclusão da Sprint: o adapter possui cobertura determinística com client injetável, o startup sem chave foi validado e `/reply` retorna `503` seguro quando a configuração não está disponível. A suíte automatizada não depende de chave nem de rede.

### Resultado

A Sprint 15 transforma o Planner persistente no primeiro operador inteligente funcional do produto. A resposta só chega ao frontend depois de persistida, falhas preservam a mensagem do usuário e nenhuma credencial ou payload sensível é exposto.

## Sprint 16 — Biblioteca de Artefatos do Planejador

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**

### Objetivo

Permitir transformar respostas `operator` persistidas do Planner em artefatos reutilizáveis da Biblioteca, substituindo a Biblioteca estática atual por dados reais.

### Problema que resolve

Respostas úteis deixam de ficar enterradas no histórico de conversas e passam a existir como ativos persistidos e reutilizáveis dentro do JvitorZ OS.

### Entregas

- `LibraryItemRepository` com criação, listagem, busca por ID e busca pela mensagem de origem;
- `LibraryService` para validar a origem e copiar o conteúdo persistido de mensagens `operator`;
- endpoints HTTP para salvar, listar e abrir itens da Biblioteca;
- API client centralizado no frontend;
- ação **Salvar na Biblioteca** disponível somente em respostas `operator`;
- listagem real, estado vazio, abertura segura e atualização após salvar;
- `LibraryItem.sourceMessageId` opcional e único, relacionado a `Message` com `ON DELETE SET NULL`;
- idempotência persistente: primeira gravação retorna `201`, repetições retornam `200` com o mesmo item;
- concorrência protegida por constraint única e tratamento seguro de conflito `P2002`;
- migration SQLite que preserva itens legados com origem nula;
- lifecycle, tokens de operação, feedback local e renderização com APIs de DOM seguras preservados;
- testes automatizados determinísticos com SQLite em memória, sem rede externa e sem uso de `dev.db`.

### Fora de escopo

- edição de itens;
- exclusão de itens;
- busca;
- tags;
- pastas;
- RAG;
- inclusão automática da Biblioteca nos prompts;
- compartilhamento entre usuários;
- exportação;
- redesign amplo;
- novos operadores;

### Critérios de conclusão

- uma resposta `operator` persistida pode ser salva na Biblioteca;
- mensagem `user`, inexistente ou pertencente a outra conversa é rejeitada;
- o item persiste após reload ou remontagem do Planner;
- a listagem da Biblioteca usa dados reais do backend;
- a abertura de item usa dados reais do backend;
- chamadas sequenciais ou concorrentes para a mesma mensagem não criam duplicata persistente;
- erro de API não cria item visual falso;
- histórico, contexto, geração inteligente, lifecycle e listeners únicos do Planner permanecem funcionais;
- testes determinísticos passam sem rede externa;
- `dev.db` permanece inalterado;
- contratos e documentação refletem o fluxo entregue.

### Resultado

A Biblioteca do Planner deixou de ser estática. O navegador envia somente os IDs da conversa e da mensagem; o backend valida conversa, pertencimento e `sender`, copia o conteúdo real persistido e grava o artefato no SQLite. A listagem e a abertura são carregadas pela API, sobrevivem a reload/remontagem e não alteram mensagens da conversa.

O contrato de salvamento é idempotente por `sourceMessageId`: a primeira chamada cria o item e retorna `201`; chamadas posteriores, inclusive após concorrência, retornam `200` com o mesmo item. Nenhuma duplicata persistente é criada para a mesma mensagem.

### Checkpoint

**SPRINT 16 — BIBLIOTECA DE ARTEFATOS DO PLANEJADOR — CONCLUÍDA**

O checkpoint da Sprint 16 foi seguido pela auditoria do roadmap e da arquitetura. A Sprint 17 foi formalizada abaixo antes de qualquer implementação.

## Sprint 17 — Biblioteca como Memória Ativa do Planner

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**

### Objetivo

Transformar a Biblioteca de um destino passivo em uma fonte explícita de memória e contexto para o Planner. Artefatos persistidos poderão ser vinculados a uma conversa e, somente quando selecionados pelo usuário, participar da próxima geração inteligente.

### Relação com a Sprint 16

A Sprint 16 entregou criação, listagem, abertura e deduplicação de `LibraryItem`. A Sprint 17 não duplica nem edita esses itens: cria uma associação persistente entre `Conversation` e `LibraryItem` e fecha o ciclo funcional:

```text
Planner gera resposta
  -> resposta vira LibraryItem
    -> usuário vincula o artefato a uma Conversation
      -> geração carrega somente artefatos vinculados
        -> LanguageProvider recebe contexto estruturado e limitado
```

### Arquitetura formalizada

- usar um join model explícito `ConversationLibraryItem`;
- armazenar somente `conversationId`, `libraryItemId` e `createdAt`;
- usar chave composta entre conversa e item para impedir vínculo duplicado;
- remover vínculos quando a conversa ou o item for removido, sem copiar conteúdo para a associação;
- resolver título, tipo e conteúdo sempre a partir do `LibraryItem` persistido;
- manter o serviço de associação separado da rota e do adapter OpenAI;
- preservar isolamento: uma conversa usa somente seus próprios vínculos explícitos.

O model foi implementado como `ConversationLibraryItem`, com chave primária composta, relações inversas e remoção em cascata dos vínculos quando a conversa ou o item for removido.

### Contrato neutro de linguagem

O `LanguageGenerationInput` representa:

- `context`: contexto da conversa;
- `messages`: histórico cronológico;
- `artifacts`: artefatos explicitamente vinculados;
- `limits`: limites determinísticos de entrada e saída.

Cada artefato neutro conterá somente:

```text
id, title, type, content
```

O contrato permanece independente da OpenAI. Conteúdo de artefato é tratado como referência não confiável, nunca promovido a instrução de sistema. O adapter apenas serializa a estrutura neutra para o provider externo.

### Limites formalizados

- máximo de **5 artefatos ativos** por conversa;
- máximo de **4.000 caracteres de conteúdo por artefato**;
- máximo de **12.000 caracteres de conteúdo de artefatos por geração**;
- ordem de inclusão por `ConversationLibraryItem.createdAt` crescente, com `libraryItemId` crescente como desempate;
- o serviço rejeita um sexto vínculo com `422`;
- o mapper limita defensivamente cada conteúdo e percorre os vínculos na ordem definida;
- quando o orçamento total termina, o último artefato elegível é truncado ao espaço restante e os posteriores são omitidos;
- os limites atuais de contexto, histórico e saída permanecem, respectivamente, 4.000, 16.000 e 4.000 caracteres, com até 30 mensagens.

Não será usada contagem real de tokens nesta Sprint.

### API implementada

- `POST /api/operators/planner/conversations/:conversationId/library/:libraryItemId`: vincular item;
- `GET /api/operators/planner/conversations/:conversationId/library`: listar itens vinculados;
- `DELETE /api/operators/planner/conversations/:conversationId/library/:libraryItemId`: desvincular item.

O frontend envia somente IDs. Bodies ausentes ou `{}` são aceitos nas operações sem payload; campos adicionais são rejeitados. A criação é idempotente: `201` no primeiro vínculo e `200` quando o vínculo já existir. A remoção retorna `204` e também é idempotente para uma associação já ausente, desde que conversa e item existam.

### Frontend implementado

- reutilizar a Biblioteca real já exibida no Planner;
- permitir adicionar um item à conversa ativa;
- mostrar separadamente os artefatos ativos da conversa;
- permitir remover um vínculo sem remover o `LibraryItem`;
- atualizar a UI somente após confirmação da API;
- preservar feedback local, XSS seguro, listeners únicos e tokens contra respostas obsoletas.

### Geração implementada

`PlannerService.generateReply()` agora:

1. validar e carregar a conversa;
2. carregar mensagens em ordem cronológica;
3. carregar `LibraryItem` vinculados em ordem determinística;
4. aplicar os limites de contexto, histórico, artefatos e saída;
5. montar a entrada neutra;
6. chamar o `LanguageProvider` exatamente uma vez;
7. persistir e retornar a resposta `operator` pelo fluxo já existente.

Geração sem artefatos deve manter o comportamento atual.

### Segurança e integridade

- nenhum conteúdo arbitrário será aceito do frontend como memória;
- conversa, item e vínculo serão validados no backend;
- vínculo duplicado não criará registro adicional;
- uma conversa não herdará artefatos de outra;
- logs e erros não incluirão conteúdo, prompt, histórico, stack, detalhes Prisma ou payload externo;
- testes não usarão OpenAI real, rede externa ou `dev.db`.

### Riscos arquiteturais

- conteúdo salvo pode conter instruções maliciosas; o mapper e o adapter devem mantê-lo delimitado como referência não confiável;
- truncamento precisa ser estável para que testes, custo e comportamento sejam previsíveis;
- operações concorrentes de vínculo exigem garantia final no banco, não apenas bloqueio de botão;
- a API permanece no namespace do Planner nesta Sprint para evitar migração de contrato sem um segundo consumidor real;
- a associação deve ser reutilizável no domínio, sem antecipar uma arquitetura global de memória ou RAG;
- a migration aditiva preserva conversas, mensagens e itens existentes; sua validação usa SQLite temporário e não toca em `dev.db`.

### Fora de escopo

- RAG automático;
- embeddings ou banco vetorial;
- busca semântica;
- seleção automática de artefatos;
- edição ou exclusão da Biblioteca;
- busca, tags ou pastas;
- compartilhamento ou exportação;
- Analytics real;
- Supervisor;
- novos operadores;
- n8n e automações;
- redesign amplo.

### Tarefas oficiais

1. **CONCLUÍDA — Contrato neutro, mapper e limites**: tipos de entrada evoluídos, artefatos mapeados em ordem recebida e limites cobertos sem banco, API, frontend ou OpenAI real.
2. **CONCLUÍDA — Schema e migration**: join model explícito criado e migration SQLite validada com preservação dos dados existentes.
3. **CONCLUÍDA — Repository e serviço de associação**: vínculo, listagem e remoção implementados com validação, isolamento, idempotência e limite concorrente.
4. **CONCLUÍDA — API HTTP**: três contratos implementados com validação estrita, status seguros e testes em SQLite em memória.
5. **CONCLUÍDA — API client frontend**: chamadas de vínculo, listagem e remoção centralizadas com validação local e status HTTP seguros.
6. **CONCLUÍDA — UI de memória ativa**: selecionar, visualizar e remover artefatos da conversa atual.
7. **CONCLUÍDA — Integração da geração**: carregar vínculos no `PlannerService`, evoluir o adapter OpenAI e preservar geração sem artefatos.
8. **CONCLUÍDA — Concorrência, regressão e fechamento**: validar lifecycle, XSS, limites, regressão completa e documentação final.

### Resultado da Tarefa 1

O contrato neutro agora inclui `artifacts` separado de contexto e mensagens. O mapper aceita artefatos ausentes, `undefined`, `null` ou vazios como `[]`, preserva a ordem recebida, considera os cinco primeiros e aplica limites de 4.000 caracteres por item e 12.000 no total. A contagem usa code points Unicode para não dividir caracteres compostos por surrogate pairs. Nenhuma integração com schema, associação persistente, API, frontend, `PlannerService.generateReply()` ou adapter OpenAI foi iniciada.

### Resultado da Tarefa 2

O schema agora contém `ConversationLibraryItem` com `conversationId`, `libraryItemId` e `createdAt`, chave primária composta e relações inversas em `Conversation` e `LibraryItem`. As duas relações usam `ON DELETE CASCADE`, removendo somente os vínculos quando uma das entidades relacionadas for excluída. A migration é aditiva, cria a tabela inicialmente vazia e preserva os dados existentes. Índices suportam a futura ordenação por `createdAt` e `libraryItemId`, além da consulta inversa por item. Repository, serviço, API, frontend e integração com a geração não foram iniciados na Tarefa 2.

### Resultado da Tarefa 3

`ConversationLibraryItemRepository` encapsula criação, busca específica, listagem com `LibraryItem` real, contagem e remoção. `ConversationLibraryService` valida conversa e item, oferece `linkItem()`, `listLinkedItems()` e `unlinkItem()`, retorna criação idempotente e aplica o máximo de cinco itens ativos. O limite e a inserção usam um único statement parametrizado `INSERT ... SELECT ... WHERE COUNT < 5 ... ON CONFLICT DO NOTHING`: o lock de escrita do SQLite serializa inclusões concorrentes, impedindo que duas chamadas partindo de quatro persistam seis vínculos. Repository e service não foram ligados a rotas, frontend ou geração nesta tarefa.

### Resultado da Tarefa 4

A API expõe `POST`, `GET` e `DELETE` no namespace da conversa do Planner e delega integralmente ao `ConversationLibraryService`. O primeiro vínculo retorna `201`, repetições retornam `200`, listagens retornam `200` e remoções existentes ou ausentes retornam `204`. Parâmetros e bodies são validados antes do service; conversa ou item ausente no POST retorna `404`, limite retorna `422` e falhas internas retornam `500` sanitizado. API client, UI e geração não foram iniciados naquela tarefa.

### Resultado da Tarefa 5

O API client central oferece `linkLibraryItemToConversation()`, `listConversationLibraryItems()` e `unlinkLibraryItemFromConversation()`. IDs são validados e codificados antes da rede; link aceita `201` e `200`, list preserva a ordem recebida e unlink trata `204` como sucesso sem inventar payload. Erros continuam representados por `ApiRequestError` com status seguro. Nenhuma UI ou integração com `planner.js` foi iniciada nesta tarefa.

### Critérios de conclusão

- usuário consegue vincular, listar e desvincular artefatos na conversa ativa;
- vínculos persistem após reload e remontagem;
- vínculo duplicado não cria duplicata;
- conversa ou item inexistente é rejeitado com erro seguro;
- conversas permanecem isoladas;
- frontend envia somente IDs e não apresenta estado falso após falha;
- `LanguageProvider` recebe contexto, histórico e artefatos na estrutura neutra;
- somente artefatos explicitamente vinculados participam da geração;
- limites de quantidade, conteúdo individual, conteúdo total e ordem são determinísticos;
- geração sem artefatos continua funcionando;
- conteúdo de artefato permanece dado não confiável e é renderizado como texto;
- respostas tardias não alteram conversa, seleção ou montagem incorreta;
- Planner preserva histórico, contexto, IA, Biblioteca, Nova Conversa, lifecycle e listeners únicos;
- os 191 testes existentes permanecem passando e a nova cobertura é determinística;
- build, Prisma validate, migration em SQLite em memória, sintaxe frontend e `git diff --check` passam;
- `dev.db` permanece inalterado e a documentação reflete o fluxo entregue.

### Caminho futuro

A associação e o contrato neutro devem permitir que futuros operadores consumam a mesma Biblioteca sem introduzir RAG ou seleção automática nesta Sprint. A generalização para memória compartilhada entre operadores ocorrerá somente quando existir um segundo operador funcional e um caso de uso concreto.

## Sprint 18 — Creator Intelligence Foundation

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, preparando Analytics e orquestração editorial.

> O escopo recebido chamava esta entrega de “Sprint 17”. Como esse número já pertence à Biblioteca como Memória Ativa no histórico versionado, a entrega foi numerada como Sprint 18 para preservar a rastreabilidade.

### Objetivo

Criar a fundação do mecanismo de inteligência editorial: registrar ideias, organizar evidências, comparar alternativas e recomendar o próximo conteúdo sem fingir previsão exata de visualizações.

### Entregas

- domínio modular `CreatorIntelligence`;
- modelos `VideoIdea`, `ContentOpportunity`, `ContentDecision`, `ChannelInsight` e `PerformanceSignal`;
- repositories isolando Prisma;
- `IdeaEvaluationService` com score relativo, ranking e justificativas legíveis;
- decisões `GRAVAR`, `TESTAR`, `GUARDAR` e `DESCARTAR`;
- classificação explícita de dado real, inferência, recomendação e informação desconhecida;
- contrato extensível `ResearchProvider`;
- provider interno, sem rede, baseado somente em sinais persistidos;
- `ChannelMemoryService` com aprendizados recalculáveis;
- `CreatorIntelligenceService` para cadastro, avaliação, comparação, recomendação e contexto limitado;
- endpoints HTTP e ponte `PlannerService -> CreatorIntelligenceService`;
- migration aditiva e testes com SQLite em memória.

### Limites e honestidade

- scores de 0 a 100 servem somente para comparação relativa;
- fatores ausentes permanecem `unknown`;
- nenhuma resposta contém previsão de views;
- o contexto futuro seleciona no máximo cinco ideias e doze sinais relevantes;
- providers futuros entram por injeção sem alterar o motor principal.

### Fora de escopo

- coleta automática de YouTube Analytics;
- vidIQ, tendências e pesquisa web;
- previsão de views;
- tela nova ou redesign;
- n8n, RAG, Supervisor autônomo e novos operadores.

### Critérios atendidos

- ideias persistem jogo, tema, formato e premissa;
- ideias podem ser listadas, avaliadas e comparadas;
- decisões e evidências ficam persistidas;
- ranking possui justificativa por posição;
- memória muda quando novos sinais chegam;
- Planner consulta recomendação por interface de serviço;
- testes, build, Prisma e validações passam sem usar `dev.db` ou rede externa.

## Sprint 19 — Performance Intelligence & Active Memory

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, preparando Analytics real e providers externos.

### Objetivo

Transformar resultados históricos do canal em sinais estruturados, aprendizados revisáveis e evidências para decisões editoriais, além de concluir a Biblioteca como memória ativa explícita do Planner.

### Entregas

- UI de memória ativa e carregamento dos artefatos vinculados em `PlannerService.generateReply()`;
- serialização de artefatos como referência não confiável, separada das instruções de sistema;
- contrato neutro `PerformanceProvider`, com provider manual e fake em testes;
- `VideoPerformanceSnapshot` com métricas opcionais, provenance, confiança e período de coleta;
- normalização estrita: dados ausentes permanecem `null` e métricas inválidas são rejeitadas;
- ingestão idempotente por fonte, vídeo e período, com atualização de snapshots existentes;
- sinais derivados rastreáveis em `PerformanceSignal`, sem fabricar métricas ausentes;
- baseline dinâmica com média, mediana e amostragem para views, watch time, AVD, retenção, inscritos por vídeo, conversão e formato;
- aprendizados por jogo, série e formato, além de padrões de watch time, retenção e conversão;
- evidência por snapshot, confiança, atualização e invalidação de aprendizados sem suporte atual;
- avaliação de ideias com score relativo, confiança, evidências usadas, riscos e dados ausentes;
- consultas HTTP para ingestão manual, registros, sinais, baseline, aprendizados e evidência de decisões;
- ponte do Planner para aprendizados do canal, preservando recomendação e comparação já existentes;
- migration aditiva e testes determinísticos com SQLite em memória, sem rede externa.
- regressão completa com 348 verificações automatizadas aprovadas.

### Honestidade e limites

- nenhuma quantidade exata de views é prevista;
- correlação é registrada como inferência, não como verdade absoluta;
- origem busca/recomendados, tipo de premissa e esforço real de produção ainda não são derivados porque esses campos não fazem parte da ingestão atual;
- YouTube Analytics, YouTube Data API e vidIQ são providers futuros e não foram conectados nesta Sprint;
- credenciais e OAuth não foram alterados.

### Próxima camada

Conectar um primeiro provider externo real ao contrato `PerformanceProvider`, com escopo e OAuth definidos em Sprint própria, mantendo ingestão manual e testes sem rede como fallback reproduzível.

## Sprint 20 — YouTube Analytics Performance Provider

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, conectando Performance Intelligence a uma fonte externa real.

### Objetivo

Consultar dados reais permitidos do canal e transformá-los no formato interno de performance sem acoplar Creator Intelligence ao SDK Google e sem criar um segundo fluxo OAuth.

### Entregas

- `YouTubeAnalyticsPerformanceProvider` implementando o contrato neutro `PerformanceProvider`;
- reutilização do `GoogleService`, token local e scopes OAuth existentes;
- métricas reais de views, watch time, AVD, retenção média, inscritos ganhos/perdidos, likes e comentários;
- `YouTubeVideoMetadataService` para título, publicação, duração e uploads recentes via YouTube Data API;
- `YouTubePerformanceSyncService` com modos vídeo, recentes e período, limite de 1 a 50 e sem polling;
- ingestão idempotente em `VideoPerformanceSnapshot`, sinais derivados e atualização da memória do canal;
- campo opcional `subscribersLost` e migration aditiva com preservação de snapshots anteriores;
- endpoints internos de status, sincronização e última sincronização;
- estados operacionais no Supervisor: conectado, sincronizado, não autorizado, não configurado e erro temporário;
- erros sanitizados para OAuth expirado, quota, timeout, vídeo inexistente e indisponibilidade;
- testes determinísticos com clients/providers fake, SQLite em memória e nenhuma chamada de rede;
- regressão completa com 384 verificações automatizadas aprovadas.

### Honestidade e limites

- impressões e CTR não são inferidas e permanecem `null` neste provider;
- jogo, série e formato não são inventados a partir de metadados insuficientes;
- sincronização é manual e explícita; automações recorrentes ficam fora desta Sprint;
- vidIQ, web research, previsão de views e novos operadores permanecem fora do escopo;
- um smoke test real depende de OAuth local válido e deve usar período curto, sem expor tokens.

### Validação externa controlada

Em 24/08/2026, uma única consulta local de sete dias e `maxResults = 1` foi executada com o OAuth já configurado. O provider retornou um registro real no formato interno, com metadados da Data API e as oito métricas solicitadas; impressões e CTR permaneceram `null`. Nenhum token, título, ID de vídeo ou payload foi documentado, e o resultado não foi persistido no `dev.db`.

### Próxima camada recomendada

Expor a sincronização de performance em uma experiência operacional controlada ou avançar a inteligência de decisão sobre os sinais reais, sem introduzir polling antes de definir política de custo, quota e atualização.

## Sprint 21 — Performance Operations UI

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, tornando a Performance Intelligence operável no produto.

### Objetivo

Permitir consultar e sincronizar dados reais do YouTube Analytics pela interface, acompanhar baseline, sinais, memória do canal e evidências de decisão sem expor credenciais ou inventar métricas ausentes.

### Entregas

- API client centralizado para status, sincronização, última coleta, snapshots, baseline, sinais, aprendizados e evidências;
- workspace de Analytics com estados conectado, sincronizado, não autorizado, não configurado e erro temporário;
- sincronização manual por recentes, período ou vídeo, sem polling e com proteção contra cliques concorrentes;
- cards reais para views, watch time, AVD, retenção média, inscritos ganhos/perdidos, likes e comentários;
- valores ausentes exibidos como indisponíveis, sem conversão artificial de `null` em zero;
- baseline com média, mediana, amostra e comparações disponíveis por formato;
- visualizações legíveis de sinais, memória do canal e evidências de decisões, incluindo confiança, riscos e dados ausentes;
- estados reais de YouTube, IA e automações no Supervisor;
- feedback local acessível, lifecycle explícito, respostas obsoletas ignoradas e renderização textual segura;
- regressão automatizada com 419 verificações aprovadas.

### Validação controlada

Em 24/08/2026, o fluxo frontend client -> sync -> provider -> ingestão -> baseline/sinais/memória foi executado uma vez com OAuth local válido e SQLite temporário. Um snapshot foi criado, as oito métricas suportadas estavam disponíveis e a memória foi recalculada. Nenhum token, título, ID de vídeo ou payload foi registrado, e o `dev.db` não foi usado.

### Limites

- sincronização permanece manual e explícita;
- não há polling, automações recorrentes, vidIQ ou pesquisa web;
- impressões e CTR permanecem indisponíveis quando a fonte não os fornece;
- módulos não implementados continuam indicados como pendentes;
- redesign amplo e refinamentos cosméticos permanecem no backlog.

### Próxima camada recomendada

Usar os sinais reais já visíveis para fechar o ciclo entre evidência, decisão editorial e ação no Planner, preservando classificação, confiança e rastreabilidade.

## Sprint 22 — Editorial Decision Loop

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, fechando o ciclo entre Performance Intelligence, Planner e Supervisor.

### Objetivo

Transformar performance, baseline, sinais, memória e ideias persistidas em decisões editoriais operacionais, explicáveis e reutilizáveis. O Planner identifica perguntas editoriais e consulta o domínio automaticamente, sem exigir que o usuário escolha um operador.

### Entregas

- `EditorialDecisionService` como fluxo único de decisão editorial;
- intenções para próximo conteúdo, comparação de ideias, diagnóstico de performance, continuidade de série e melhoria do próximo vídeo;
- combinação limitada de contexto, ranking, snapshots, baseline, sinais, memória e decisões anteriores;
- distinção explícita entre fato, inferência e recomendação;
- recomendação principal, alternativas, score relativo, confiança, evidências, riscos, dados ausentes e próxima ação;
- modelo e repository `EditorialDecision`, com deduplicação por estado das evidências;
- persistência da pergunta, decisão, evidências, confiança e vínculo opcional com conversa e mensagem `operator`;
- contrato de resultado futuro ligado a `VideoPerformanceSnapshot`, com avaliação cautelosa e aprendizado derivado;
- endpoints para gerar, listar, abrir e registrar resultado de decisões;
- integração automática do Planner para perguntas editoriais, preservando o fluxo OpenAI para conversa geral;
- UI mínima e segura no Planner para confiança, evidências, riscos, lacunas e justificativa;
- Supervisor com prioridades, riscos, oportunidades e próximas ações recentes;
- migration aditiva e regressão automatizada com 439 verificações aprovadas.

### Honestidade e limites

- nenhuma decisão prevê quantidade exata de views;
- score é comparação relativa, não promessa de desempenho;
- fatos, inferências e recomendações mantêm classificação e fonte;
- ausência de dados aparece explicitamente e reduz a confiança;
- o vínculo decisão -> snapshot de resultado está preparado, mas não existe automação recorrente;
- não foram adicionados vidIQ, pesquisa web, RAG, clipping, novos operadores ou redesign;
- o `dev.db` local não contém snapshots compatíveis com esta camada, portanto não foi possível executar um cenário manual com evidência real local sem inventar dados ou alterar o banco. A validação controlada permanece coberta por fixtures persistidas e determinísticas em SQLite em memória.

### Critérios atendidos

- perguntas editoriais reconhecidas no Planner geram uma decisão persistida e exatamente uma resposta `operator`;
- perguntas gerais continuam usando o `LanguageProvider` existente;
- decisões e conversas permanecem isoladas;
- respostas tardias não alteram conversa ou montagem incorreta;
- APIs validam payloads e retornam erros sanitizados;
- Supervisor e Planner consomem somente dados persistidos reais do backend;
- suíte completa, build, Prisma, migration, sintaxe frontend e `git diff --check` passam sem rede externa nem uso do `dev.db`.

### Próxima camada recomendada

Vincular uma decisão a um vídeo publicado por um fluxo operacional explícito e acompanhar seu resultado no produto, fechando o feedback loop sem introduzir automação recorrente antes de existir uma política de sincronização.

## Sprint 23 — Decision Outcome Loop

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, fechando o ciclo observável entre decisão editorial, publicação, performance e aprendizado revisável.

### Objetivo

Permitir associar uma decisão editorial persistida a um vídeo real já sincronizado, comparar seu desempenho com baselines observadas e transformar o resultado em memória do canal sem atribuir causalidade não demonstrada.

### Entregas

- vínculo persistente e idempotente `EditorialDecisionVideoLink` entre decisão, vídeo e snapshot real de origem;
- avaliação persistente `EditorialDecisionOutcome`, reexecutável para snapshots atualizados;
- comparação de views, views engajadas quando disponíveis, impressões, CTR, watch time, duração média, retenção, inscritos, likes e comentários;
- baselines por formato, jogo ou canal, sempre com amostra e dados ausentes explícitos;
- classificações `POSITIVE`, `MIXED`, `NEGATIVE` e `INCONCLUSIVE`, sem previsão de views ou afirmação causal;
- fatos, comparação, interpretação, evidências favoráveis/contrárias, confiança, lacunas e hipóteses editoriais testáveis;
- memória derivada em `ChannelInsight`, atualizada pela mesma chave estável em reavaliações;
- Planner usando essa memória em perguntas editoriais e oferecendo associação/avaliação manual do vídeo;
- Analytics exibindo resultados editoriais compactos a partir do backend;
- endpoints para associar, remover vínculo ainda não avaliado, listar, avaliar e abrir resultados;
- contrato preparado para avaliar links quando uma sincronização futura trouxer dados novos, sem scheduler ou polling nesta Sprint;
- migration aditiva e regressão automatizada com 458 verificações aprovadas.

### Honestidade e limites

- comparação temporal e correlação não demonstram que a decisão causou o resultado;
- o YouTube provider atual não fornece `engagedViews`; o campo permanece `null` e nunca é estimado;
- uma avaliação direcional exige pelo menos duas métricas comparáveis e baseline com amostra mínima;
- vínculos avaliados não podem ser removidos pela API, preservando o histórico de aprendizado;
- sincronização e avaliação continuam ações explícitas; não há execução recorrente automática;
- não foram adicionados vidIQ, pesquisa web, automações, novos operadores ou redesign.

### Critérios atendidos

- decisão e vídeo pertencem ao mesmo projeto e usam snapshots persistidos reais;
- vínculo e avaliação são idempotentes, inclusive sob chamadas concorrentes;
- reavaliação revisa o mesmo aprendizado em vez de criar memória duplicada;
- dados insuficientes produzem `INCONCLUSIVE` com lacunas explícitas;
- Planner e Analytics ignoram respostas obsoletas e mantêm feedback local;
- suíte, build, Prisma, migration, sintaxe frontend e `git diff --check` passam sem rede externa e sem uso do `dev.db`.

## Sprint 24 — Outcome Review & Refresh Loop

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, mantendo resultados editoriais atualizados quando novas evidências reais chegam.

### Objetivo

Detectar quando um outcome deixou de refletir os dados persistidos atuais, permitir revisão manual segura e preservar a evolução da classificação e da memória sem sobrescrever o histórico.

### Entregas

- estados derivados `current`, `review_available`, `stale` e `insufficient_data`;
- detecção por snapshot novo, métricas alteradas, dado antes ausente e baseline diferente;
- `OutcomeRefreshService` com revisão individual e lote manual;
- histórico append-only `EditorialDecisionOutcomeReview` com estados anterior e atual;
- deduplicação por fingerprint único e proteção concorrente no processo;
- falhas isoladas por item, sem invalidar outcome ou memória anteriores;
- `ChannelInsight` revisável compartilhado por outcomes sucessivos;
- contratos HTTP para estado, elegíveis, revisão, lote, histórico e status;
- Analytics com revisão individual/lote e dados persistidos atualizados;
- Planner sinalizando revisão disponível sem misturar estado entre conversas;
- Supervisor com contagens atuais, revisáveis, inconclusivos e falhas recentes;
- migration aditiva validada em SQLite em memória;
- regressão automatizada com 477 verificações aprovadas.

### Honestidade e limites

- nenhuma mudança de performance prova causalidade da decisão;
- tempo sozinho não abre revisão;
- `engagedViews` ausente continua `null` e nunca é estimado;
- não existe scheduler, polling, sincronização recorrente ou nova rede externa;
- a revisão em lote é sequencial e limitada aos outcomes atuais retornados pelo serviço;
- vidIQ, web research, novos operadores, automações e redesign permanecem fora do escopo.

### Critérios atendidos

- evidência nova torna a revisão disponível de forma determinística;
- revisão cria ou reutiliza exatamente um registro para a mesma evidência;
- mudança e ausência de mudança ficam registradas separadamente;
- falha preserva o estado anterior e não interrompe os demais itens do lote;
- histórico é consultável pelo outcome anterior e pelo outcome resultante;
- Planner, Analytics e Supervisor consomem o estado persistido sem respostas obsoletas;
- suíte, build, Prisma, migration, sintaxe frontend e `git diff --check` passam sem rede externa e sem uso do `dev.db`.

### Próxima camada recomendada

Definir a próxima Sprint a partir do roadmap e dos dados operacionais acumulados. Automação recorrente deve continuar separada até existir política explícita de quota, frequência e recuperação de falhas.

## Sprint 25 — Controlled Orchestration Foundation

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, introduzindo a primeira camada real do Gerente sem automação recorrente.

### Objetivo

Permitir expressar uma intenção operacional em linguagem natural, montar um plano explícito, coordenar capabilities reais, consolidar evidências e registrar a execução sem exigir seleção manual de operadores.

### Entregas

- domínio `OrchestrationRequest`, `OrchestrationPlan`, `OrchestrationStep`, `OrchestrationResult` e `OrchestrationExecution`;
- `CapabilityRegistry` injetável com dez capabilities reais e classes de acesso;
- roteamento determinístico para conteúdo, outcome, canal, série e sync/review controlado;
- execução sequencial com dependências, reuse de outputs, short-circuit e falha parcial;
- consolidação separada de fatos, inferências, recomendações, riscos e dados ausentes;
- memória persistida com histórico recente e idempotência sequencial/concorrente;
- integração do Planner sem transferir a propriedade de mensagens e decisões;
- Supervisor somente como fonte de estado;
- composição manual YouTube Sync → Detect → Review → Supervisor;
- API para capabilities, plano, execução e histórico;
- workspace mínima do Gerente com lifecycle, feedback local, XSS seguro e confirmação externa;
- migration aditiva e regressão automatizada com 500 testes aprovados.

### Limites

- sem scheduler, cron, polling, n8n ou background job;
- sem capabilities fictícias, vidIQ ou web research;
- sincronização YouTube exige confirmação explícita e parâmetros limitados;
- roteamento usa regras determinísticas; classificador LLM permanece uma extensão futura;
- execução é sequencial; paralelismo futuro exige política explícita;
- não há previsão exata de views nem causalidade inferida.

### Próxima camada recomendada

Auditar uso real do Gerente e definir a Sprint 26 antes de automatizar qualquer fluxo. Candidatas: aprovação em duas etapas para planos com escrita, políticas de orçamento/quota e avaliação de qualidade das decisões orquestradas.

## Sprint 26 — Operational Plan Review & Approval

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, consolidando controle humano antes de qualquer automação recorrente.

### Objetivo

Transformar intenção e plano em uma operação revisável, classificando risco e efeitos antes de permitir execução e preservando uma trilha auditável.

### Entregas

- domínio `PlanReview` com estados de draft a executed;
- side effects `READ_ONLY`, `INTERNAL_WRITE`, `EXTERNAL_READ` e `EXTERNAL_WRITE` declarados pelas capabilities;
- riscos `LOW`, `MEDIUM` e `HIGH` com política padrão determinística;
- preview/dry-run persistido sem execução de capability;
- aprovação/rejeição versionada, snapshot e hash do plano aprovado;
- expiração por janela de validade ligada ao risco;
- execution guard contra estado inválido, request incompatível, plano/capability alterado e dupla execução;
- chave idempotente vinculada ao request original, inclusive durante concorrência;
- audit trail de criação, revisão, decisão, tentativas, bloqueios e execução;
- endpoints estritos para preview, review, approve, reject, expire, execute e audit;
- Gerente com plano, steps, dados, ações, risco, efeitos e controles de decisão;
- Supervisor com consolidação read-only de planos operacionais;
- migration aditiva validada em SQLite isolado;
- regressão automatizada com 529 testes aprovados.

### Limites preservados

- sem scheduler, cron, polling, n8n ou side effect externo automático;
- sem novas capabilities fictícias, vidIQ, pesquisa web ou redesign;
- Supervisor não aprova nem executa;
- política ainda é fixa em código, preparada para configuração futura;
- uma execução concorrente perde o compare-and-set e não repete capabilities;
- banco local não é usado pelos testes nem alterado pela Sprint.

### Próxima camada recomendada

Antes de automação recorrente, formalizar políticas operacionais configuráveis de quota, orçamento, janela e recuperação de falhas, mantendo aprovação humana para `EXTERNAL_WRITE`.

## Sprint 27 — Controlled Automation Runner

**Status: CONCLUÍDA**

**Fase principal: FASE 7 - Primeiro Operador**, adicionando recorrência controlada sobre o Gerente e o PlanReview já aprovados.

### Objetivo

Permitir definir, agendar, executar e auditar rotinas operacionais reais sem criar um caminho paralelo para capabilities nem autorizar side effects externos implicitamente.

### Entregas

- definições persistidas com agendas `MANUAL_ONLY`, `DAILY` e `WEEKLY`, timezone IANA e próxima ocorrência calculada;
- execuções persistidas, histórico, estados operacionais e auditoria append-only;
- detecção determinística de rotinas vencidas e entrada finita `runDueAutomations(now)`, sem loop ou processo residente;
- idempotência por automação e ocorrência agendada, além de exclusão mútua para execuções ativas;
- runner que cria preview no Orchestrator e executa somente planos autoaprovados ou posteriormente aprovados no PlanReview;
- bloqueio explícito para planos que aguardam revisão, sem executar capabilities;
- rotinas reais para resumo operacional, revisão de outcomes e sincronização controlada do YouTube;
- workspace `#automation-runner` para criar, editar, ativar, pausar, retomar, executar e consultar histórico;
- Gerente consultando definições recentes e Supervisor expondo contagens reais de automações;
- migration aditiva, contratos HTTP, testes em SQLite isolado e regressão automatizada.

### Limites preservados

- nenhum daemon, cron externo, polling infinito ou integração n8n foi iniciado;
- o scheduler expõe uma entrada segura que um runtime futuro poderá chamar periodicamente;
- `EXTERNAL_WRITE` continua dependendo de aprovação humana; a agenda nunca equivale a consentimento;
- falhas não repetem indefinidamente: a definição entra em `ERROR` e precisa ser retomada;
- vidIQ, pesquisa web, novos operadores, publicação automática e redesign permanecem fora do escopo.

### Critérios atendidos

- consulta de vencimento não executa trabalho por si só;
- uma ocorrência agendada produz no máximo um `AutomationRun`, inclusive sob concorrência;
- toda execução guarda o `orchestrationExecutionId` e respeita risco, efeito e review do plano;
- pausar/desativar remove a próxima execução, e retomar recalcula a agenda;
- falhas e bloqueios são sanitizados e auditáveis sem payload externo bruto;
- UI mantém lifecycle, feedback local, XSS seguro e listeners únicos;
- banco local é migrado somente após backup e validação da migration.
