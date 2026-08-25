# JVITORZ OS

Este documento define a estrutura oficial do JvitorZ OS como plataforma modular de operações para criadores de conteúdo.

## Estrutura oficial do sistema

JvitorZ OS

├── Dashboard (Home)
├── Canal
├── Analytics
├── Biblioteca
├── Operadores
│   ├── Planejador de Conteúdo
│   ├── Supervisor
│   ├── Analytics IA
│   ├── Escritor
│   ├── SEO
│   ├── Shorts
│   ├── Longos
│   ├── Automações
│   ├── Tendências
│   ├── CTR
│   ├── Retenção
│   └── ...
├── Configurações
└── Sistema

## Módulos principais

### Dashboard
- Objetivo: ser a tela inicial de controle do JvitorZ OS.
- Responsabilidade: agregar visualizações de saúde do canal, métricas, status de operadores e atalhos para módulos especializados.
- Dados consumidos: resposta de `GET /api/dashboard`, dados do canal, métricas de analytics, lista de operadores e estado do sistema.
- Dados produzidos: estado de interface, navegação entre módulos e apresentação de cards.
- Componentes reutilizados: painéis (`createPanel`), cards de métrica, listas de operadores, status pills.
- Integrações futuras: dashboards dinâmicos, atualização em tempo real, filtros por período e profundidade de métricas.

### Canal
- Objetivo: apresentar o canal conectado ao YouTube e seus principais indicadores.
- Responsabilidade: exibir título do canal, localização, data de publicação e métricas de base.
- Dados consumidos: dados do canal retornados pelo backend, tokens de autenticação do YouTube e métricas agregadas.
- Dados produzidos: contexto de conexão do canal e sinalização de estado (conectado/pendente).
- Componentes reutilizados: metric cards, listas de detalhe, status pills.
- Integrações futuras: catálogo de vídeos, detalhes de alcance por vídeo, insights de público e monitoramento de conexão.

### Analytics
- Objetivo: fornecer visão resumida de desempenho de canal.
- Responsabilidade: exibir métricas principais como inscritos, número de vídeos e visualizações.
- Dados consumidos: métricas compiladas pelo backend a partir da integração de dados do canal.
- Dados produzidos: indicadores de desempenho para suporte ao planejamento de conteúdo.
- Componentes reutilizados: painel de analytics, grids de métricas.
- Integrações futuras: relatórios de tendência, análises históricas, previsão de crescimento e indicadores de retenção.

### Biblioteca
- Objetivo: ser o repositório de recursos, templates e materiais reutilizáveis para criadores e operadores.
- Responsabilidade: centralizar artefatos reutilizáveis produzidos pelos operadores; o fluxo atual salva respostas `operator` do Planejador.
- Dados consumidos: mensagens persistidas validadas no backend e identificadores enviados pelo frontend.
- Dados produzidos: `LibraryItem` persistido, listado e aberto pela API.
- Componentes reutilizados: seções de sidebar, painéis de listagem e detalhes.
- Integrações futuras: edição, busca, organização, exportação, compartilhamento e uso dos artefatos em prompts.

### Operadores
- Objetivo: agrupar as workspaces especializadas que executam tarefas de criação, análise e automação.
- Responsabilidade: apresentar módulos independentes com interface própria, dados compartilhados e comportamentos especializados.
- Dados consumidos: estado do dashboard, dados de canal/analytics, entrada do usuário, prompt base e configurações do sistema.
- Dados produzidos: ações de operador, conteúdo gerado, eventos de workflow e sinais para autômatos.
- Componentes reutilizados: layout de workspace, chat, sidebar, headers de operador, prompt editável, panel.
- Integrações futuras: registro de operadores, fluxo de passagem de contexto entre operadores e persistência de sessão.

#### Planejador de Conteúdo
- Objetivo: organizar ideias, pautas e próximos conteúdos em uma workspace de planejamento.
- Responsabilidade: oferecer chat persistente, histórico, biblioteca de apoio, prompt base editável e resposta inteligente baseada no contexto da conversa.
- Dados consumidos: histórico, mensagens e contexto de conversas carregados pela API do Planejador.
- Dados produzidos: conversas, mensagens de usuário, respostas `operator`, prompt-base e artefatos da Biblioteca persistidos no SQLite por meio do backend.
- Componentes reutilizados: `createChatArea`, `createSidebar`, `createPanel` e os controles do chat.
- Integrações futuras: geração de roteiros, importação de pautas, sugestões de títulos e integração com calendário.

#### Supervisor
- Objetivo: monitorar a saúde operacional do sistema e estados de integração.
- Responsabilidade: mostrar status de YouTube, IA e automações.
- Dados consumidos: estado de backend e indicadores de conexão.
- Dados produzidos: painéis de supervisão e alertas de estado.
- Componentes reutilizados: `createStatusPill`, painéis de resumo.
- Integrações futuras: monitoramento de erros, alertas em tempo real e painéis de operação.

#### Analytics IA
- Objetivo: oferecer análise avançada usando inteligência artificial.
- Responsabilidade: transformar dados de canal e de conteúdo em recomendações qualitativas.
- Dados consumidos: métricas, históricos e conteúdo do operador.
- Dados produzidos: insights, sugestões de otimização e recomendações estratégicas.
- Componentes reutilizados: painéis de insight, workflows de operador.
- Integrações futuras: modelos de linguagem, análise automatizada e geração de relatórios inteligentes.

#### Escritor
- Objetivo: assistir criação de texto e scripts para vídeos.
- Responsabilidade: permitir composição de roteiros e estruturas de conteúdo.
- Dados consumidos: briefing, temas, dados de canal e métricas de desempenho.
- Dados produzidos: roteiros, descrições e textos de apoio.
- Componentes reutilizados: áreas de conteúdo, prompts editáveis e painel de publicação.
- Integrações futuras: editor de texto rico, templates de roteiro e exportação de scripts.

#### SEO
- Objetivo: otimizar conteúdo para busca e engajamento.
- Responsabilidade: analisar títulos, descrições, tags e aspectos de discovery.
- Dados consumidos: informações de vídeo, texto gerado e dados de palavras-chave.
- Dados produzidos: recomendações de SEO, títulos e descrições otimizadas.
- Componentes reutilizados: painéis de análise, listas de recomendações.
- Integrações futuras: conectores de palavras-chave e validação de search intent.

#### Shorts
- Objetivo: apoiar a criação e análise de conteúdo curto.
- Responsabilidade: organizar ideias, roteiros e métricas específicas para vídeos curtos.
- Dados consumidos: dados de engajamento, tendências e elementos de formato curto.
- Dados produzidos: briefs de shorts, roteiros e sugestões de edição.
- Componentes reutilizados: painel de operador, cards de métricas.
- Integrações futuras: templates de shorts, análises de virilidade e pipeline de publicação.

#### Longos
- Objetivo: apoiar a criação de conteúdo de formato longo.
- Responsabilidade: estruturar roteiros, capítulos e narrativa para vídeos ou lives longas.
- Dados consumidos: históricos de performance e dados de audiência.
- Dados produzidos: roteiros longos, pautas detalhadas e cronogramas.
- Componentes reutilizados: workspace de operador e painel de planejamento.
- Integrações futuras: mapas de sequência, editor de capítulos e análises de retenção.

#### Automações
- Objetivo: orquestrar ações repetíveis e sequências de produção.
- Responsabilidade: conectar operadores, enviar gatilhos e automatizar etapas.
- Dados consumidos: estado de operador, dados de canal, parâmetros e condições.
- Dados produzidos: pipelines de execução, eventos e ações agendadas.
- Componentes reutilizados: painel de processos e status.
- Integrações futuras: engine de workflow, agendador de publicações e execução programada.

#### Tendências
- Objetivo: identificar temas e padrões relevantes para conteúdo.
- Responsabilidade: sugerir tópicos e formatos com base em sinais externos.
- Dados consumidos: dados de trending, histórico e contexto do canal.
- Dados produzidos: ideias de pauta, temas e listas de tendências.
- Componentes reutilizados: painéis de descoberta e cards de insights.
- Integrações futuras: fontes de tendências, análise de mercado e monitoramento de nicho.

#### CTR
- Objetivo: melhorar taxa de cliques de thumbnails, títulos e descrições.
- Responsabilidade: avaliar elementos criativos e sugerir melhorias.
- Dados consumidos: ativos de vídeo, títulos e métricas de clique.
- Dados produzidos: recomendações de CTR, variações e testes.
- Componentes reutilizados: painéis de recomendação e comparações.
- Integrações futuras: testes A/B e geração de thumbnails.

#### Retenção
- Objetivo: orientar aumento de tempo de visualização e engajamento.
- Responsabilidade: analisar padrões de retenção e sugerir ajustes de conteúdo.
- Dados consumidos: dados de audiência, métricas de retenção e heatmaps.
- Dados produzidos: sugestões de estrutura, cortes e pontos de atenção.
- Componentes reutilizados: dashboards de análise, painéis de insight.
- Integrações futuras: estudos de retenção por vídeo e recomendações de edição.

### Configurações
- Objetivo: ser o centro de ajustes do sistema e integrações.
- Responsabilidade: apresentar informações de API, configurações e integrações disponíveis.
- Dados consumidos: configuração do ambiente, rota `GET /api/dashboard` e estado de integrações.
- Dados produzidos: informações de configuração e contexto para o usuário.
- Componentes reutilizados: painel de detalhes.
- Integrações futuras: gerenciamento de credenciais, toggle de operadores e conexão de serviços.

### Sistema
- Objetivo: definir a base técnica do JvitorZ OS.
- Responsabilidade: manter o backend, carregamento de ambiente, autenticação, roteamento e serviços de integração.
- Dados consumidos: variáveis de ambiente, tokens de OAuth, dados do YouTube e conteúdo de backend.
- Dados produzidos: APIs REST, dados agregados de módulos e estado operacional.
- Componentes reutilizados: core do backend, módulos de rota e serviços de integração.
- Integrações futuras: persistência em banco de dados, orquestração de fluxo e monitoramento de runtime.

## Fluxo de comunicação entre módulos

```text
Usuário
  └─> Frontend SPA
        ├─> Dashboard (home)
        │     ├─> Canal
        │     ├─> Analytics
        │     ├─> Operadores
        │     ├─> Supervisor
        │     └─> Configurações
        ├─> Operadores especializados
        │     ├─> Planejador de Conteúdo
        │     ├─> Analytics IA
        │     ├─> Escritor
        │     ├─> SEO
        │     ├─> Shorts
        │     ├─> Longos
        │     ├─> Automações
        │     ├─> Tendências
        │     ├─> CTR
        │     └─> Retenção
        └─> Sistema de navegação

Frontend SPA
  └─> Backend API `/api`
        ├─> `/api/dashboard`
        ├─> `/api/auth`
        ├─> `/api/youtube`
        ├─> `/api/operators`
        └─> outros endpoints futuros

Backend API
  ├─> modules: Channel, Analytics, Operators, Planner, Supervisor, Settings
  ├─> integrações: Google OAuth, YouTube API
  ├─> core: configuração, rotas, app Express
  └─> estado: saúde, tokens e parâmetros de execução

Operadores especializados
  └─> recebem dados do dashboard e do backend

Sistema
  └─> mantém config, autenticação e roteamento como plano de fundo de toda a plataforma
```

## Padrão de comunicação

1. O usuário acessa o dashboard inicial.
2. O frontend consome `GET /api/dashboard` para montar os módulos visuais.
3. O backend orquestra módulos de canal, analytics, operadores e supervisor.
4. Os operadores usam o mesmo frontend de módulos para apresentar workspaces especializadas.
5. O sistema central mantém a configuração, autenticação e estado geral.

## Observações

- O documento descreve a arquitetura como ela deve ser estruturada oficialmente, sem alterar o código existente.
- A base atual já contém os módulos `channel`, `analytics`, `settings`, `supervisor`, `operators` e `content-planner`.
- Os módulos mais avançados são conceituais, mas fazem parte da estrutura oficial e devem ser incorporados na evolução do produto.

## Creator Intelligence

Fundação editorial compartilhada pelo Planner. Registra ideias, reúne evidências internas, calcula ranking relativo, persiste decisões e mantém aprendizados revisáveis do canal. O sistema diferencia dados reais, inferências, recomendações e lacunas desconhecidas; não prevê views.

Atualmente funciona apenas com dados persistidos internamente. YouTube, vidIQ, tendências e pesquisa web são providers futuros e não são simulados.

## Performance Intelligence

Resultados de vídeos podem ser ingeridos manualmente como snapshots normalizados. O sistema mantém métricas ausentes como desconhecidas, calcula baseline dinâmica do próprio canal, deriva sinais quantitativos e atualiza aprendizados estruturados com provenance e confiança.

O fluxo sustenta avaliação relativa de ideias e respostas explicáveis do Planner sem prever views. Biblioteca é conteúdo reutilizável; `PerformanceSignal` é evidência; `ChannelInsight` é aprendizado revisável. Conectores reais de YouTube Analytics, YouTube Data API e vidIQ permanecem para uma Sprint futura.
