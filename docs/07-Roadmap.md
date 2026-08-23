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
