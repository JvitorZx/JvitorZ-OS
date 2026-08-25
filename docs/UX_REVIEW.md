# UX Review — JvitorZ OS

## Visão geral
Esta revisão analisa a experiência atual do dashboard e da workspace do Planejador de Conteúdo, focando em navegação, consistência visual e oportunidades de simplificação.

## Atualização após a Sprint 14

Os achados estruturais desta revisão são mantidos abaixo como registro histórico. A Sprint 14 concluiu:

- sidebar e hash como navegação oficial, com fallback para `#channel`;
- remoção do botão `Voltar` e do `workspace-back`;
- workspace fullscreen compartilhada para operadores;
- lifecycle genérico com montagem e desmontagem explícitas;
- página Operadores como catálogo seguro, sem links para módulos inexistentes;
- `statePanel` restrito a estados globais e feedback local sob responsabilidade de cada operador.

As recomendações de redesign, breadcrumb, refinamento visual, responsividade e reorganização ampla de componentes permanecem no backlog.

## Pontos positivos
- Arquitetura modular clara: o frontend já separa módulos (`dashboard`, `planner`, `operators`, `settings`, `supervisor`) e usa renderização baseada em módulos.
- Navegação baseada em hash simples e previsível (`#channel`, `#analytics`, `#content-planner`), o que facilita o comportamento SPA sem recarregar a página.
- Sidebar fixa e bem posicionada à esquerda, servindo como âncora principal da navegação.
- Aparência dark já consistente no dashboard principal, com sistema de cards e painéis que transmite identidade visual.
- O Planejador de Conteúdo já foi convertido em workspace full‑screen, o que é um bom ponto para uma experiência de editor/operator.
- O design system em `frontend/src/design-system/` fornece uma base reutilizável para painéis, chat, sidebar, input e workspace.

## Problemas encontrados
### 1. Navegação e fluxo do usuário
- Resolvido na Sprint 14: a sidebar e o hash são a navegação oficial, sem botão de retorno dentro da workspace.
- Resolvido na Sprint 14: hash ausente ou inválido é normalizado para `#channel`.
- Resolvido na Sprint 14: Operadores é um catálogo e somente ferramentas com módulo registrado geram links.
- A sidebar permanece visível em fullscreen por decisão arquitetural, permitindo trocar ou sair de operadores.

### 2. Elementos redundantes ou em conflito
- Resolvido na Sprint 14: `statePanel` possui escopo global; feedback de operadores permanece local.
- Resolvido na Sprint 14: o elemento `workspace-back` foi removido.
- Resolvido na Sprint 14: a listagem Operadores tem papel explícito de catálogo seguro.
- A área principal do Planejador está encapsulada dentro de um `createPanel` e dentro de `workspace-wrap`; essa hierarquia pode ser simplificada para reduzir wrappers visuais.

### 3. Componentes que podem ser unificados
- `createSidebarSection` e a seção `Prompt Base` usam markup semelhante, mas o `Prompt Base` ainda é construído manualmente. Unificar isso em um componente `createSidebarField` ou `createSidebarPanel` seria ideal.
- O `createChatArea` e o painel de chat atual são implementados com um wrapper próprio; a intenção de componente já está clara, mas os estilos e o comportamento poderiam ser extraídos para um componente `OperatorChat` reutilizável.
- `createOperatorHeader`, `createChatArea`, `createSidebar` e `createWorkspaceLayout` já existem, mas o `Prompt Base` e o wrapper da workspace ainda não são verdadeiramente parte do sistema de componentes reutilizáveis.
- O `createFixedInput` deveria ser capaz de aceitar variantes (mensagem de chat, campo de busca, comentário) para evitar implementação específica no planner.

### 4. Inconsistências visuais
- O conteúdo do chat ainda exibe fundo branco em algumas renderizações anteriores, apesar do tema escuro geral; isso causa quebra de estilo.
- A side bar e os painéis do planner possuem gradientes e bordas diferentes: alguns elementos usam sombreados fortes e outros usam superfícies mais suaves. Há falta de padrão único de profundidade.
- O botão `Enviar` do chat está visualmente mais moderno que o campo de texto, mas o campo não segue totalmente o mesmo tratamento de borda/arredondamento do restante do painel.
- As seções de `Biblioteca`, `Histórico` e `Prompt Base` utilizam estilos de card próximos, mas o conteúdo do `Prompt Base` ainda é um elemento `div contenteditable` com aparência distinta do restante.
- A altura do chat (`height: calc(100vh - 220px)`) e o tratamento de `workspace-module` criam diferenças de espaço em relação a outros módulos do dashboard.

### 5. Oportunidades de simplificação
- Concluído na Sprint 14: navegação centralizada na sidebar e no hash.
- Avaliar futuramente se o catálogo Operadores e os atalhos da sidebar devem ser consolidados visualmente.
- Tornar a workspace uma experiência mais limpa, reduzindo wrappers extras e deixando apenas `header + body` na tela.
- Reutilizar menos HTML manual e mais componentes de alto nível para `header`, `chat`, `sidebar`, `prompt` e `input`.
- Limitar o uso de classes específicas do planner e preferir classes genéricas de workspace para permitir que outros operadores reutilizem o mesmo layout.

## Sugestões de melhoria
### Navegação
- Se necessário, introduzir breadcrumb leve ou título de contexto no workspace para mostrar ao usuário onde está.
- Avaliar em sprint futura a consolidação visual entre catálogo e atalhos da sidebar.

### Componentização
- Criar um conjunto de componentes de workspace verdadeiramente reutilizáveis, por exemplo:
  - `WorkspaceHeader`
  - `WorkspaceChat`
  - `WorkspaceSidebar`
  - `WorkspacePanel`
  - `WorkspaceInput`
  - `WorkspaceLayout`
- O `Prompt Base` deve ser um componente do tipo `EditablePanel`, para que outros operadores reutilizem o mesmo campo com rótulo e comportamento.
- O `createPanel` genérico pode evoluir para suportar variantes de painel (`surface`, `section`, `sidebar-card`) sem duplicação de markup.

### Visual
- Padronizar a paleta dos painéis de workspace para superfícies escuras com bordas sutis e sombra leve, evitando fundos brancos.
- Simplificar a tipografia: usar um único estilo de título/subtítulo para todos os painéis de operador.
- Reduzir variações de profundidade entre `painel`, `chat` e `sidebar`; manter o mesmo padrão de `border-radius`, `border-color` e `background`.
- Garantir que o campo de mensagem seja sempre fixo e alinhado ao fim da tela, com espaçamento consistente.

### Simplificação de layout
- Transformar o workspace full screen em um layout de duas colunas definitivas: chat principal + sidebar secundária; isso evitará múltiplas formas de posicionamento.
- Remover wrappers duplicados como `workspace-wrap` quando não agregarem valor visual.
- Usar classes utilitárias genéricas de layout para dividir a tela em áreas reutilizáveis.

## Recomendações mantidas no backlog
- Evoluir componentes de workspace em `frontend/src/design-system/` somente quando houver uso concreto.
- Uniformizar a UI do planner em um sistema de design escuro único, com painéis e input reutilizáveis.
- Avaliar futuramente se o módulo Operadores deve permanecer como página separada.
- Considerar breadcrumb, refinamentos responsivos e testes em navegador real.

## Conclusão
A Sprint 14 concluiu a estabilização estrutural da navegação, workspace e lifecycle. Na Sprint 21, Analytics deixou de ser placeholder e passou a oferecer status, sincronização manual, métricas, baseline, sinais, memória e evidências reais com feedback local acessível. Os testes de navegação confirmam que hash e seleção visual mudam juntos; não foi necessária alteração cosmética ou animação. Os pontos restantes desta revisão são melhorias visuais e de organização que não bloqueiam a evolução funcional.
