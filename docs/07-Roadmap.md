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
