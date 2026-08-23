# PRODUCT_ARCHITECTURE.md

## Referência principal de visão
O documento principal da visão do produto está em [`docs/PRODUCT_VISION.md`](PRODUCT_VISION.md).
A estrutura oficial do sistema está documentada em [`docs/JVITORZ_OS.md`](JVITORZ_OS.md).

## Visão geral
Este documento descreve a arquitetura de produto do JvitorZ OS como uma plataforma modular de operações criativas para canais e conteúdo digital.

## Estrutura do produto
JvitorZ OS

├── Dashboard
├── Canal
├── Analytics
├── Operadores
│   ├── Planejador
│   ├── Analytics IA
│   ├── Supervisor
│   ├── Escritor
│   ├── Biblioteca
│   ├── Tendências
│   ├── CTR
│   ├── Retenção
│   ├── Shorts
│   ├── Longos
│   ├── SEO
│   └── Automações
├── Configurações

## Camadas do sistema
- **Frontend**: SPA leve em `frontend/` com navegação baseada em hash e módulos renderizados dinamicamente.
- **Backend**: API express em `backend/` com roteamento modular e serviços para dashboard, autenticação e operadores.
- **Documentação**: arquivos em `docs/` que descrevem arquitetura, operadores, UX e fluxos.

## Módulos principais
### Dashboard
- Tela principal de controle da plataforma.
- Exibe cards de métricas, status do canal, links para operadores e visão rápida do sistema.
- Consome a API `GET /api/dashboard`.

### Canal
- Objeto do domínio responsável por resumir os dados do canal conectado.
- No backend, expõe `ChannelModule` e se integra à API do YouTube.
- No frontend, representa a seção de canal do dashboard.

### Analytics
- Coleta e apresenta métricas de desempenho do canal.
- No backend, `AnalyticsModule` agrega dados para o dashboard.
- No frontend, exibe cards e resumos de análise.

### Operadores
- Conjunto de ferramentas especializadas para criação, planejamento e automação.
- Atualmente há um `Planejador de Conteúdo` funcional e um módulo de listagem `Operadores`.
- A visão de operadores deve evoluir para incluir todos os itens da lista acima.
- A página Operadores atua como catálogo; a sidebar e o hash formam a navegação principal das ferramentas realmente disponíveis.

### Configurações
- Módulo de ajustes do sistema e das integrações.
- Presente no frontend como painel de configuração.

## Operadores documentados
### Planejador de Conteúdo
- **Objetivo**: oferecer uma workspace para planejar pautas, escrever prompts e conduzir conversas de planejamento.
- **O que faz**: apresenta chat, biblioteca, histórico e prompt base editável; funciona como workspace de operador.
- **Dados que consome**: histórico, mensagens e contexto persistidos das conversas do Planejador.
- **Dados que gera**: novas conversas, mensagens e contexto persistidos pelo backend em SQLite.
- **Componentes reutilizados**: header, chat, sidebar, painel, input fixo, prompt editável.
- **Próximas integrações**: integração com LLMs, análise de tendências, importação de roteiros e automação de publicações.

### Supervisor (conceitual)
- **Objetivo**: monitorar saúde do sistema, status de operações e alertas de fluxo.
- **O que faz**: exibe indicadores de automação, IA e conexões.
- **Dados que consome**: estado de backend, status de operadores, eventos de processo.
- **Dados que gera**: visão de supervisão para o usuário.
- **Componentes reutilizados**: cards, painel resumo, status pills.
- **Próximas integrações**: monitoramento de erros, alertas em tempo real, dashboards de estabilidade.

### Monitor de YouTube (conceitual)
- **Objetivo**: inspecionar o canal e trazer sinais de conteúdo relevante.
- **O que faz**: mostra dados de canal, inscritos, visualizações e engajamento.
- **Dados que consome**: API do YouTube, tokens de autenticação.
- **Dados que gera**: relatórios e indicadores para materiais do planner.
- **Componentes reutilizados**: cards de métrica, painel de detalhes.
- **Próximas integrações**: análises de performance histórica, recomendações de conteúdo.

### Outros operadores planejados
Os itens abaixo são parte da visão futura da plataforma e devem reaproveitar a mesma estrutura de workspace e componentes:
- Analytics IA
- Escritor
- Biblioteca
- Tendências
- CTR
- Retenção
- Shorts
- Longos
- SEO
- Automações

## Workspace e ciclo de vida dos operadores

A Sprint 14 concluiu a estabilização desta camada. Módulos interativos podem declarar o contrato:

```js
module.createController(context) => ({
  mount(container, context),
  unmount(),
})
```

- a sidebar permanece disponível e é o mecanismo principal para entrar e sair das workspaces;
- módulos navegáveis são registrados em um catálogo único e resolvidos pela rota em hash;
- hash ausente ou inválido é normalizado para `#channel` sem duplicar o lifecycle;
- cada módulo mantém sua função de renderização e pode associar um controller com montagem e desmontagem explícitas;
- o Dashboard coordena o ciclo de vida sem conhecer detalhes do Planejador ou de qualquer operador específico;
- a desmontagem ocorre antes da substituição do DOM e a montagem ocorre uma única vez depois da renderização;
- workspaces fullscreen usam um contêiner compartilhado e não dependem de botão `Voltar`;
- a página Operadores lista ferramentas, mas apenas itens com módulo registrado iniciam navegação;
- operadores indisponíveis permanecem no catálogo com status não interativo e sem produzir hash;
- o `statePanel` pertence ao estado global do Dashboard; feedback de execução e erro pertence à workspace do operador.

O Planejador é a referência de regressão desse contrato: persistência, histórico, Nova Conversa, troca de conversas, mensagens, contexto, feedback local, listeners únicos e proteção contra respostas obsoletas permanecem funcionais após montagens e desmontagens.

## Backend e integração
### Backend API
- `GET /api/dashboard`: retorna dados de canal, analytics, operadores, supervisor e configurações.
- `GET /api/operators/planner`: endpoint de teste do operador Planejador.
- `/api/operators/planner/conversations`: endpoints persistentes de criação e listagem de conversas.
- `/api/operators/planner/conversations/:id`: abertura de conversa com mensagens.
- `/api/operators/planner/conversations/:id/messages`: criação persistida de mensagens.
- `/api/operators/planner/conversations/:id/context`: atualização do prompt-base da conversa.
- `GET /api/auth/google`: foco em autenticação de Google OAuth (documentado no backend, não modificado nesta sprint).

### Serviços backend
- `DashboardService`: orquestra a agregação de módulos.
- `ChannelModule`, `AnalyticsModule`, `OperatorsModule`, `SupervisorModule`, `SettingsModule`: retornam dados estruturados para o dashboard.
- `PlannerModule`: endpoint de operador de teste.
- `PlannerService`: coordena conversas, mensagens e contexto usando `ConversationRepository` e `MessageRepository`.

## Organização de pastas
- `backend/`: código do servidor, rotas, serviços e integrações.
- `frontend/`: SPA, módulos, componentes reutilizáveis e estilos.
- `docs/`: documentação do produto, arquitetura, UX e fluxos.
- `database/`: espaço reservado para modelos ou scripts de banco de dados.

## Conclusão
O JvitorZ OS é uma plataforma modular com dashboard central, operadores como workspaces especializadas e um backend leve que fornece dados agregados. A base atual está pronta para evoluir com operadores adicionais e componentes reutilizáveis sem alterar a estrutura de rotas nem o comportamento existente.
