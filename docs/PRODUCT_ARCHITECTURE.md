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
- **Dados que gera**: novas conversas, mensagens, contexto, respostas inteligentes e artefatos da Biblioteca persistidos pelo backend em SQLite.
- **Componentes reutilizados**: header, chat, sidebar, painel, input fixo, prompt editável.
- **Próximas integrações**: análise de tendências, importação de roteiros e automação de publicações.

#### Resposta inteligente concluída na Sprint 15

A Sprint 15 aplica a FASE 5 - OpenAI ao primeiro operador funcional da FASE 7 - Primeiro Operador. O fluxo implementado acrescenta uma resposta inteligente persistida ao comportamento existente:

```text
Conversation.context + mensagens persistidas em ordem cronológica
  -> entrada neutra do provider de linguagem
    -> resposta textual
      -> mensagem persistida com sender "operator"
```

O `PlannerService` coordena conversa, histórico, provider e persistência sem depender diretamente do SDK OpenAI. O contrato injetável `LanguageProvider` separa o domínio do adapter externo e permite testes com provider fake, sem rede. O mapper neutro limita o contexto a 4.000 caracteres, o histórico às 30 mensagens mais recentes e a 16.000 caracteres, e a saída a 4.000 caracteres.

O `OpenAILanguageProvider` usa o SDK oficial e a Responses API. A configuração é avaliada somente em `generate()`: `OPENAI_API_KEY` é obrigatória apenas para gerar e `OPENAI_MODEL` é opcional, com fallback `gpt-5-mini`. A saída de 4.000 caracteres é convertida conservadoramente em `max_output_tokens: 1000`. O backend inicia sem chave e retorna `503` seguro quando o provider está indisponível.

O frontend solicita `/reply` somente após persistir a mensagem do usuário e renderiza a mensagem `operator` retornada pelo backend, que já está persistida. Enquanto a geração está em andamento, novos envios são bloqueados. Respostas tardias de outra conversa ou montagem são ignoradas pela UI; ao reabrir a conversa correta, a resposta persistida é carregada normalmente. Falhas preservam a mensagem do usuário e aparecem apenas no feedback local do Planner.

Os testes automatizados usam providers e clients injetáveis, sem chave ou rede externa. Permanece como validação externa não bloqueadora executar um smoke test manual com uma `OPENAI_API_KEY` válida para confirmar uma chamada real HTTP `201`.

Streaming, seleção de modelo pela UI, múltiplos providers, RAG, dados do YouTube no prompt, tools/function calling, automações e novos operadores permanecem fora desta Sprint.

#### Biblioteca de artefatos concluída na Sprint 16

A Sprint 16 avança a FASE 7 - Primeiro Operador ao transformar respostas inteligentes persistidas em artefatos reutilizáveis. A Biblioteca do Planner usa dados reais por meio deste fluxo:

```text
Conversation + Message persistida com sender "operator"
  -> LibraryService valida conversa, mensagem e autoria
    -> conteúdo copiado no backend
      -> LibraryItemRepository
        -> Prisma -> SQLite
```

O frontend envia apenas os identificadores necessários para localizar a conversa e a mensagem. O backend não aceita conteúdo arbitrário como fonte: busca a mensagem persistida, confirma seu pertencimento e aceita somente `sender: "operator"`.

`LibraryItem.sourceMessageId` registra a origem com unicidade no banco. A primeira gravação retorna `201`; novas chamadas para a mesma mensagem retornam `200` com o item existente. Em concorrência, a constraint única decide a criação e o serviço trata `P2002` buscando o registro vencedor, sem expor detalhes do Prisma. A relação usa `ON DELETE SET NULL`, preservando o artefato se a mensagem de origem for removida, e a migration mantém itens legados com origem nula.

A UI usa o API client centralizado para salvar, listar e abrir itens. Após salvar, a lista é recarregada do backend; o leitor mantém o artefato separado do chat e renderiza título e conteúdo como texto. Tokens de operação impedem respostas obsoletas de alterar uma montagem, conversa ou seleção mais nova, e erros permanecem no feedback local do Planner.

Edição, exclusão, busca, tags, pastas, RAG, inclusão automática nos prompts, compartilhamento, exportação, redesign amplo e novos operadores permanecem no backlog.

#### Memória ativa concluída na Sprint 17

**Status: CONCLUÍDA.**

A Sprint 17 transforma artefatos persistidos em contexto explicitamente selecionado para uma conversa. A seleção não é automática e não altera o conteúdo do `LibraryItem`:

```text
Conversation
  -> ConversationLibraryItem (vínculo explícito)
    -> LibraryItem persistido
      -> entrada neutra do LanguageProvider
```

O join model `ConversationLibraryItem` possui chave composta entre `conversationId` e `libraryItemId`, `createdAt` para ordenação e relações com remoção em cascata. Ele não armazena cópia de título ou conteúdo. O backend recebe somente IDs e resolve os itens reais antes de qualquer geração.

O contrato neutro de linguagem representa `context`, `messages`, `artifacts` e `limits`. Cada artefato contém apenas `id`, `title`, `type` e `content`; o adapter OpenAI não define regras de domínio. Conteúdo da Biblioteca é delimitado como referência não confiável, sem autoridade de instrução de sistema.

`ConversationLibraryItemRepository` e `ConversationLibraryService` resolvem itens reais em ordem determinística, mantêm link e unlink idempotentes e aplicam o limite de cinco no SQLite. Três endpoints no namespace da conversa expõem vínculo, listagem e remoção com validação segura.

A API client valida IDs antes da rede e a UI permite vincular e remover itens na conversa ativa. A geração carrega somente vínculos confirmados e respostas obsoletas não alteram a montagem atual.

Os limites são cinco artefatos por conversa, 4.000 caracteres por artefato e 12.000 caracteres totais por geração. A ordem é a data do vínculo crescente, com ID como desempate. O serviço rejeita um sexto vínculo; o mapper aplica truncamento defensivo e determinístico.

A UI permanece dentro do Planner e reutiliza a Biblioteca real para adicionar e remover vínculos da conversa ativa. A associação é uma fronteira reutilizável; a generalização visual e operacional para outros agentes aguardará um segundo operador funcional.

RAG, embeddings, busca semântica e seleção automática permanecem fora da Sprint 17.

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
- `/api/operators/planner/conversations/:id/reply`: geração e persistência da próxima resposta `operator`.
- `GET /api/auth/google`: foco em autenticação de Google OAuth (documentado no backend, não modificado nesta sprint).

### Serviços backend
- `DashboardService`: orquestra a agregação de módulos.
- `ChannelModule`, `AnalyticsModule`, `OperatorsModule`, `SupervisorModule`, `SettingsModule`: retornam dados estruturados para o dashboard.
- `PlannerModule`: endpoint de operador de teste.
- `PlannerService`: coordena conversas, mensagens, contexto e geração de respostas usando repositories e um `LanguageProvider` injetável.
- `OpenAILanguageProvider`: encapsula SDK, Responses API, configuração lazy, mapeamento de roles e parsing seguro da saída.

## Organização de pastas
- `backend/`: código do servidor, rotas, serviços e integrações.
- `frontend/`: SPA, módulos, componentes reutilizáveis e estilos.
- `docs/`: documentação do produto, arquitetura, UX e fluxos.
- `database/`: espaço reservado para modelos ou scripts de banco de dados.

## Conclusão
O JvitorZ OS é uma plataforma modular com dashboard central, operadores como workspaces especializadas e um backend leve que fornece dados agregados. A base atual está pronta para evoluir com operadores adicionais e componentes reutilizáveis sem alterar a estrutura de rotas nem o comportamento existente.

## Creator Intelligence Foundation

O domínio `CreatorIntelligence` fica entre dados persistidos e consumidores editoriais:

```text
Planner/API
  -> CreatorIntelligenceService
    -> ResearchProvider[]
    -> IdeaEvaluationService
    -> ChannelMemoryService
    -> repositories -> Prisma/SQLite
```

`ResearchProvider` é a fronteira de extensão. O provider inicial usa apenas `PerformanceSignal` persistido. Futuros adapters de YouTube, vidIQ, tendências ou web deverão converter suas fontes para `ResearchEvidence`; o motor não conhece SDKs externos.

Cada componente do score carrega classificação, fontes e justificativa. Ausência de evidência permanece explícita e nenhum componente promete desempenho futuro.

`PlannerService` recebe opcionalmente `PlannerEditorialIntelligenceProvider`, permitindo consultar “o que vale gravar?” sem importar repositories. O fluxo de chat e o `LanguageProvider` continuam independentes.

## Performance Intelligence

`PerformanceProvider` é a fronteira neutra para fontes de métricas. `PerformanceIngestionService` normaliza e persiste snapshots sem conhecer SDK externo. O caminho manual continua disponível e `YouTubeAnalyticsPerformanceProvider` é o primeiro adapter externo real. O adapter usa o OAuth Google já existente; a YouTube Analytics API fornece métricas e a YouTube Data API complementa metadados. vidIQ permanece futuro.

```text
provider -> sincronização -> normalização -> snapshot -> baseline -> sinal -> aprendizado -> decisão
```

- snapshots guardam observações e provenance;
- sinais expressam comparação quantitativa contra a baseline do canal;
- aprendizados são inferências estruturadas, atualizáveis e invalidáveis;
- decisões registram recomendação, confiança, evidências, riscos e dados ausentes;
- Biblioteca e memória de canal não duplicam responsabilidades.

`YouTubePerformanceSyncService` coordena os modos vídeo, recentes e período, com limite máximo de 50 resultados e sem polling. Recoletas idênticas atualizam o snapshot pela chave de ingestão. O Supervisor expõe estado conectado, sincronizado, não autorizado, não configurado ou erro temporário sem ativar operadores inexistentes.

Rotas continuam delegando a serviços, e somente repositories acessam Prisma. A configuração do provider é avaliada quando status ou sincronização são solicitados; a suíte usa fakes e SQLite em memória, sem rede externa. Ausência de métricas permanece `null`, inclusive impressões e CTR.

## Performance Operations UI

O módulo `analytics` é a superfície operacional da Performance Intelligence. Seu controller usa exclusivamente o API client central e participa do lifecycle genérico do Dashboard:

```text
AnalyticsController
  -> frontend API client
    -> status/sync/records/baseline/signals/learnings/evidence
      -> Creator Intelligence + YouTubePerformanceSyncService
        -> repositories -> Prisma/SQLite
```

Na montagem, consultas independentes são executadas em paralelo e cada seção mantém um estado coerente mesmo se outra falhar. A sincronização é manual, bloqueia apenas o controle correspondente e recarrega os dados persistidos depois do sucesso. Não existe polling.

Tokens de montagem e de seleção impedem respostas tardias de substituir uma workspace desmontada ou uma evidência mais recente. Conteúdo externo é renderizado com APIs de texto do DOM. Valores `null` permanecem visualmente indisponíveis; zero só é exibido quando é um valor real.

O `statePanel` continua reservado ao Dashboard. Erros de Analytics aparecem em feedback local com `aria-live`. O Supervisor consome estados reais de YouTube e configuração de IA; automações permanecem não implementadas e não são anunciadas como operacionais.

## Editorial Decision Loop

O `EditorialDecisionService` é a fronteira única entre evidência persistida e decisão editorial operacional:

```text
Planner ou API
  -> EditorialDecisionService
    -> CreatorIntelligenceService
      -> ideias + baseline + sinais + ChannelMemory + snapshots
    -> EditorialDecisionRepository
      -> Prisma -> SQLite
  -> resposta operator persistida / Supervisor
```

O serviço classifica a intenção, carrega apenas o contexto necessário e produz recomendação principal, alternativas, score relativo, confiança, evidências classificadas, riscos, dados ausentes e próxima ação. A classificação separa `fact`, `inference` e `recommendation`; nenhuma camada calcula previsão exata de views.

`PlannerService` recebe o serviço editorial por injeção. Quando a última mensagem do usuário é uma pergunta editorial reconhecida, a decisão é gerada antes da resposta, persistida e vinculada à mensagem `operator`. Conversas gerais continuam no `LanguageProvider`, mantendo OpenAI e Creator Intelligence desacoplados.

O hash das entradas e do estado das evidências evita decisões duplicadas para a mesma situação. O modelo `EditorialDecision` pode apontar para conversa, mensagem `operator` e snapshot de resultado. O registro posterior de resultado compara sinais persistidos e grava uma avaliação cautelosa (`supported`, `mixed`, `contradicted` ou `unknown`) sem automatizar publicação ou sincronização.

O Planner renderiza explicação e confiança com DOM textual seguro e ignora respostas obsoletas após troca de conversa ou unmount. O Supervisor agrega decisões recentes em prioridades, riscos, oportunidades e ações, sem transformar ausência de dados em estado operacional falso.
