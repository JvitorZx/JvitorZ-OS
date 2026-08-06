# DESIGN_SYSTEM

Este documento define o Design System oficial do JvitorZ OS. Ele descreve os tokens visuais, as regras de interface e os componentes oficiais que devem guiar o desenvolvimento visual, mesmo que o código atual não deva ser alterado nesta sprint.

## Paleta de cores

A paleta oficial é escura e cromática, com contrastes suaves e destaque em azul.

- `--bg`: #08101f
- `--surface`: #0f172a
- `--surface-soft`: #122238
- `--surface-strong`: #06101c
- `--text`: #e2e8f0
- `--muted`: #94a3b8
- `--line`: rgba(148, 163, 184, 0.16)
- `--accent`: #38bdf8
- `--accent-soft`: rgba(56, 189, 248, 0.14)
- `--warning`: #f59e0b
- `--danger`: #fb7185
- `--shadow`: 0 24px 80px rgba(0, 0, 0, 0.36)

### Uso recomendado

- Fundo principal: `--bg`
- Superfícies e cards: `--surface`, `--surface-soft`
- Texto principal: `--text`
- Texto secundário: `--muted`
- Linhas e bordas sutis: `--line`
- Destaques e ações primárias: `--accent`
- Estados de alerta: `--warning`, `--danger`

## Tipografia

A tipografia oficial é baseada em uma fonte sans-serif moderna e legível.

- Fonte base: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Peso e estilo:
  - Textos principais: normal / 400
  - Títulos e destaques: semibold / 600, bold / 700
  - Legendas e etiquetas: uppercase em 0.82rem com espaçamento de 0.12em
- Tamanhos principais:
  - `h1`: clamp(2rem, 3vw, 2.5rem)
  - Texto normal: 1rem
  - Pequeno / meta: 0.75rem a 0.9rem

## Espaçamentos

O Design System segue um espaçamento modular com múltiplos de 4 e 8.

- Gaps principais: 0.6rem, 0.75rem, 0.9rem, 1rem, 1.25rem, 1.5rem, 2rem
- Padding de containers: 1rem a 2rem
- Margens entre seções: 1.5rem a 2rem
- Espaçamento interno de cards e painéis: 18px a 24px

## Bordas

As bordas são suaves e discretas, com foco em separação leve.

- Bordas padrão: 1px sólido com opacidade baixa
- Cores de borda: rgba(255,255,255,0.08) ou rgba(148,163,184,0.12)
- Bordas enfatizadas para alertas: cores usando `--warning` ou `--danger` com opacidade 0.4

## Sombras

A sombra principal reforça profundidade sem perder a estética dark.

- Sombra base: `0 24px 80px rgba(0, 0, 0, 0.36)`
- Uso: aplicar em cards de métricas, painéis e workspaces flutuantes.

## Raios

O raio de borda é arredondado, mantendo um visual moderno e amigável.

- Raio padrão: 12px a 24px
- Componentes elevados: 14px ou 16px
- Painéis grandes: 24px

## Estados

O Design System define estados claros para elementos interativos.

- Hover:
  - Aumentar levemente o brilho de fundo.
  - Ajustar borda ou cor de texto para realçar.
  - Exemplo: `.nav-link:hover` muda o fundo para `rgba(56, 189, 248, 0.12)`.
- Active:
  - Manter cor de destaque mais intensa e transição suave.
  - Exemplo: `.nav-link.active` usa mesmo estilo de hover.
- Disabled:
  - Reduzir opacidade e remover o cursor de ponteiro.
  - Usar cores neutras sem destaque.

## Grid

O layout usa grids responsivos e sistemas de colunas.

- Grid principal do dashboard: `display: grid; gap: 24px;`.
- Cards de resumo: `grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px;`.
- Lists e painéis: `display: grid; gap: 14px;`.

## Responsividade

A plataforma deve adaptar-se a telas menores mantendo a hierarquia e a legibilidade.

- Ponto de quebra principal: 1080px
  - Sidebar torna-se posição relativa e largura total.
- Ponto de quebra secundário: 760px
  - Layout de cards se torna coluna única.
  - Topbar ajusta-se em coluna.
  - Painéis e componentes aumentam raio e padding para toque.

## Componentes oficiais

### Button
- Objetivo: acionar ações primárias e secundárias.
- Quando usar: navegação, envio de formulários, confirmações.
- Quando não usar: apenas exibir informação estática.
- Variações:
  - Primário: fundo acentuado, texto claro.
  - Secundário: borda suave e fundo transparente.
  - Ícone: botão quadrado com ícone central.
- Exemplo de uso:
  - Enviar mensagem em chat.
  - Alternar vista de workspace.

### Card
- Objetivo: segmentar conteúdo em blocos visuais claros.
- Quando usar: métricas, listas, destaques e agrupamentos de informações.
- Quando não usar: para ações diretas ou conteúdos complexos demais.
- Variações:
  - Metric card: card compacto com valor e legenda.
  - Summary card: card maior com múltiplos detalhes.
- Exemplo de uso: painel de métricas de canal.

### Panel
- Objetivo: agrupar seções com título, corpo e ação.
- Quando usar: áreas de dashboard, detalhes de módulo, relatórios.
- Quando não usar: pequenos elementos de painel único ou exibição inline.
- Variações:
  - Panel simples com header e corpo.
  - Panel com ação no header (botão ou status pill).
- Exemplo de uso: painel `Analytics`, `Canal`, `Supervisor`.

### Sidebar
- Objetivo: fornecer navegação persistente e contextual.
- Quando usar: menu principal, navegação de módulos e ações secundárias.
- Quando não usar: não substituir a barra lateral por navegação modal.
- Variações:
  - Sidebar principal do app.
  - Sidebar de operador com seções.
- Exemplo de uso: menu lateral fixo com links de módulo.

### Header
- Objetivo: apresentar título e contexto de seção.
- Quando usar: cabeçalhos de páginas, workspaces e operadores.
- Quando não usar: em elementos de lista ou itens pequenos.
- Variações:
  - Header de workspace com título e status.
  - Header de seção com título simples.
- Exemplo de uso: `Planejador de Conteúdo` header.

### Toolbar
- Objetivo: agrupar ações de ferramenta relacionadas.
- Quando usar: ações de module, filtros, botões rápidos.
- Quando não usar: ações isoladas.
- Variações:
  - Barra de ação horizontal com botões.
  - Grupo de ícones simples.
- Exemplo de uso: topbar de painel de workspace.

### Input
- Objetivo: capturar valores curtos de texto.
- Quando usar: formulários, buscas, campos de configuração.
- Quando não usar: textos longos ou conversas.
- Variações:
  - Campo único com placeholder.
  - Campo com borda clara e fundo escuro.
- Exemplo de uso: pesquisa ou campo de login imaginário.

### Textarea
- Objetivo: permitir entradas de texto longas.
- Quando usar: chat, prompts, descrições e mensagens.
- Quando não usar: campos de entrada curtos.
- Variações:
  - Textarea de altura ajustável.
  - Textarea em workspace com envio rápido.
- Exemplo de uso: campo de chat em `Planejador de Conteúdo`.

### Modal
- Objetivo: apresentar conteúdos transitórios sobrepostos.
- Quando usar: confirmações, formulários de escolha, detalhes rápidos.
- Quando não usar: navegação primária ou painéis persistentes.
- Variações:
  - Modal simples com título e ações.
  - Modal de confirmação com botões.
- Exemplo de uso: confirmação de logout ou aviso de erro.

### Dropdown
- Objetivo: oferecer seleção de opções em espaço reduzido.
- Quando usar: filtros, escolhas de estado, menus contextuais.
- Quando não usar: grandes formulários ou seleção múltipla complexa.
- Variações:
  - Dropdown simples.
  - Dropdown com seção de opções agrupadas.
- Exemplo de uso: seleção de período ou filtro.

### Table
- Objetivo: exibir dados tabulares organizados.
- Quando usar: listas, tabelas de métricas e relatórios.
- Quando não usar: dados livres ou conteúdo narrativo.
- Variações:
  - Tabela simples.
  - Tabela com linhas destacadas.
- Exemplo de uso: relatório de vídeo ou métricas estruturadas.

### Chat
- Objetivo: suportar conversas e comunicação sequencial.
- Quando usar: operadores de planejamento e assistentes.
- Quando não usar: exibição de dados estáticos.
- Variações:
  - Chat simples com bolhas me/eu.
  - Chat com campo fixo de envio.
- Exemplo de uso: interface de mensagens do `Planejador de Conteúdo`.

### Loading
- Objetivo: indicar que o sistema está processando.
- Quando usar: ações assíncronas ou carregamento de dados.
- Quando não usar: quando o conteúdo já está visível.
- Variações:
  - Spinner centralizado.
  - Placeholder de conteúdo.
- Exemplo de uso: carregamento inicial do dashboard.

### Empty State
- Objetivo: comunicar ausência de conteúdo.
- Quando usar: telas sem dados, listas vazias ou estados iniciais.
- Quando não usar: quando há informação disponível.
- Variações:
  - Empty state com mensagem.
  - Empty state com ação sugerida.
- Exemplo de uso: painel sem métricas disponíveis.

### Notification
- Objetivo: alertar o usuário sobre eventos ou erros.
- Quando usar: confirmações, avisos e erros.
- Quando não usar: informações permanentes.
- Variações:
  - Success / info / warning / danger.
  - Toast ou banner.
- Exemplo de uso: alerta de conexão com o YouTube.

### Badge
- Objetivo: destacar estados curtos ou categorias.
- Quando usar: status, rótulos e pequenos indicadores.
- Quando não usar: texto descritivo longo.
- Variações:
  - Badge de status com cor de fundo.
  - Badge de contagem.
- Exemplo de uso: pílula de status `Conectado`.

### Tag
- Objetivo: marcar itens com palavras-chave.
- Quando usar: filtragem, categorias e tags de conteúdo.
- Quando não usar: informação de status.
- Variações:
  - Tag ativa.
  - Tag inativa.
- Exemplo de uso: categoria de operador ou tema.

### Avatar
- Objetivo: representar usuários, perfis ou entidades.
- Quando usar: identificação visual em listas e cabeçalhos.
- Quando não usar: elementos que não precisam de identidade.
- Variações:
  - Avatar com iniciais.
  - Avatar com imagem.
- Exemplo de uso: perfil do usuário ou proprietário de canal.

## Resumo do Design System

O Design System do JvitorZ OS é construído para um tema escuro, modular e consistente. Ele prioriza:

- contraste suave e foco em azul como cor de destaque;
- tipografia simples e legível;
- espaçamentos regulares e bordas arredondadas;
- estados definidos para interação;
- grids responsivos que se adaptam a desktops e telas menores;
- componentes oficiais com uso claro e padrões de variação.

Este guia serve como referência para futuras implementações visuais, sem modificar o frontend ou o backend existentes na sprint atual.
