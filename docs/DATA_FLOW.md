# DATA_FLOW.md

## Visão Geral
Este documento descreve o fluxo de dados entre frontend, backend e operadores do JvitorZ OS.

## Fluxo principal
1. O frontend inicializa e monta o `dashboard` em `frontend/app.js`.
2. O dashboard cria a shell de UI usando `createShell()` em `frontend/src/dashboard.js`.
3. O frontend consome a API principal `GET /api/dashboard` por meio de `createApiClient()`.
4. O backend processa a requisição no `DashboardService` e suas dependências de módulo.
5. O backend retorna um objeto JSON que contém dados de canal, analytics, operadores, supervisor e configurações.
6. O frontend renderiza os módulos do dashboard com base em `dashboardModules` e nos dados retornados.

## Componentes de dados do backend
### DashboardService
- Orquestra a agregação de dados de vários módulos.
- Consulta:
  - `ChannelModule.getChannelSummary()`
  - `AnalyticsModule.getDashboardAnalytics()`
  - `OperatorsModule.getOperatorsStatus()`
  - `SupervisorModule.getSupervisorOverview()`
  - `SettingsModule.getSettings()`
- Retorna um payload composto com dados de métricas e status.

### Operators API
- `backend/src/routes/operators.ts` expõe:
  - `GET /api/operators/planner`
- O endpoint usa `PlannerModule.getInfo()` para retornar um objeto de teste.

## Fluxo de dados do frontend
### Inicialização
- `frontend/app.js` chama `createDashboard({ root, apiBaseUrl })`.
- `frontend/src/dashboard.js` monta o layout e guarda referências dos elementos principais.

### Requisições de API
- `createApiClient(apiBaseUrl)` define os métodos de chamada ao backend.
- O dashboard chama `api.getDashboard()` para carregar dados iniciais.
- Outros módulos podem chamar `api.getOperator('planner')` ou endpoints específicos, conforme necessário.

### Atualização de estado
- O botão `refreshButton` dispara `loadDashboard()` novamente.
- O painel de estado `statePanel` mostra mensagens de carregamento, erros e avisos.
- `hashchange` atualiza o módulo ativo exibido na tela.

## Fluxo de workspace de operador
1. Usuário clica em um link de módulo na sidebar.
2. Se o módulo tiver `fullscreen = true`, `dashboard.js` monta a tela de workspace completa.
3. O workspace renderiza `workspace-wrap` e o botão `workspaceBack`.
4. O módulo é exibido em `workspace-module` e o frontend aplica `workspace-fullscreen` na `main.workspace`.
5. O botão de retorno remove o modo fullscreen e volta ao módulo padrão.

## Dados e dependências do Planejador de Conteúdo
- O módulo `planner` recebe `dashboardData` e `context` do frontend.
- O workspace de planejamento processa dados locais e ações do usuário.
- Ele pode ser estendido para buscar dados de `/api/operators/planner` e outros serviços do backend.

## Integração com YouTube e autenticação
- O backend se integra ao Google/YouTube em `backend/src/integrations/`.
- A autenticação do Google é necessária para obter dados reais do canal e das métricas.
- `DashboardService` assume que o canal está conectado e retorna `status.youtubeConnected`.
- Se o usuário não estiver autenticado, o frontend deve exibir aviso e link para conexão.

## Estado atual vs evolução prevista
### Estado atual
- `GET /api/dashboard` retorna dados de dashboard básicos.
- `GET /api/operators/planner` retorna dados de teste do planner.
- O frontend renderiza dashboard e permite workspace fullscreen para operadores.

### Evolução prevista
- Suporte a operadores adicionais via backend e frontend.
- Endpoints REST expandidos para cada operador.
- Fluxo de dados bidirecionais entre frontend, backend e APIs externas.
- Autenticação e autorização mais robusta para operadores e dados sensíveis.

## Diagramas de fluxo sugeridos
- Frontend → `/api/dashboard` → `DashboardService` → módulos de dados
- Frontend → `/api/operators/planner` → `PlannerModule`
- Frontend hash-navegação → renderização de módulo ou workspace fullscreen

## Conclusão
O fluxo de dados do JvitorZ OS é simples e modular, com um backend centralizado para agregação de dashboard e um frontend que compõe módulos de UI de forma dinâmica. Esta base permite acrescentar operadores e integrações sem alterar a estrutura de renderização do dashboard.
