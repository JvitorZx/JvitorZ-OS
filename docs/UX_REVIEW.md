# UX Review — JvitorZ OS

## Visão geral
Esta revisão analisa a experiência atual do dashboard e da workspace do Planejador de Conteúdo, focando em navegação, consistência visual e oportunidades de simplificação.

## Pontos positivos
- Arquitetura modular clara: o frontend já separa módulos (`dashboard`, `planner`, `operators`, `settings`, `supervisor`) e usa renderização baseada em módulos.
- Navegação baseada em hash simples e previsível (`#channel`, `#analytics`, `#content-planner`), o que facilita o comportamento SPA sem recarregar a página.
- Sidebar fixa e bem posicionada à esquerda, servindo como âncora principal da navegação.
- Aparência dark já consistente no dashboard principal, com sistema de cards e painéis que transmite identidade visual.
- O Planejador de Conteúdo já foi convertido em workspace full‑screen, o que é um bom ponto para uma experiência de editor/operator.
- Componentização inicial no `frontend/src/components.js` fornece uma base reutilizável para `createPanel`, `createChatMessage`, `createSidebarSection` e `createFixedInput`.

## Problemas encontrados
### 1. Navegação e fluxo do usuário
- O botão `Voltar` aparece como solução temporária e confunde o fluxo principal; o usuário final espera usar a sidebar para alternar entre visões.
- O hash `#content-planner` abre a workspace em full screen, mas não há indicação clara de retorno à vista principal além do botão `Voltar`.
- O módulo `Operadores` apresenta links redundantes para operadores que também estão acessíveis diretamente via sidebar; isso pode gerar duplicidade de navegação.
- A sidebar do dashboard ainda mostra todos os módulos mesmo quando um operador em fullscreen está ativo; isso pode criar expectativa de navegação parcial mas não total.

### 2. Elementos redundantes ou em conflito
- O `statePanel` de status do dashboard ainda é renderizado em workspace full screen, mas em modo workspace ele não possui uso claro além de mensagens de carregamento/erro.
- O `workspace-back` é um elemento de desenvolvimento que precisa ser removido ou substituído por navegação de sidebar mais natural.
- A listagem dos operadores dentro de `Operadores` repete o mesmo destino de navegação que já existe na sidebar, criando redundância de caminhos.
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
- Centralizar a navegação apenas na sidebar e remover o botão `Voltar` na experiência final.
- Fundir `Operators` e o próprio item de operador em uma única navegação, evitando duas formas de acessar o mesmo recurso.
- Tornar a workspace uma experiência mais limpa, reduzindo wrappers extras e deixando apenas `header + body` na tela.
- Reutilizar menos HTML manual e mais componentes de alto nível para `header`, `chat`, `sidebar`, `prompt` e `input`.
- Limitar o uso de classes específicas do planner e preferir classes genéricas de workspace para permitir que outros operadores reutilizem o mesmo layout.

## Sugestões de melhoria
### Navegação
- Remover ou ocultar o botão `Voltar` em versões de usuário. A navegação deve ser feita exclusivamente pela sidebar através de módulos e submódulos.
- Se necessário, introduzir breadcrumb leve ou título de contexto no workspace para mostrar ao usuário onde está.
- Consolidar o módulo `Operadores` com o item específico `Planejador de Conteúdo`, evitando dois caminhos diferentes para o mesmo destino.

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

## Recomendações para a próxima sprint
- Priorizar a extração de componentes de workspace em `frontend/src/components.js`, não apenas para o Planejador, mas para qualquer operador futuro.
- Revisar a navegação de hash e garantir que a sidebar seja a única forma de navegação no produto final.
- Remover o botão `Voltar` após estabilizar a navegação e substituir sua função por navegação de sidebar ou breadcrumb.
- Uniformizar a UI do planner em um sistema de design escuro único, com painéis e input reutilizáveis.
- Avaliar se o módulo `Operadores` deve existir como página separada ou ser convertido em um índice/atalho dentro da sidebar para evitar redundância.
- Ajustar o `statePanel` para uso somente em mensagens de status global, não em workspace local.

## Conclusão
A interface atual já possui boa base modular e navegação SPA simples, mas precisa de estabilização na experiência do usuário final. A próxima fase deve focar em unificar componentes de workspace, reduzir caminhos redundantes de navegação e estabilizar a aparência do Planjador de Conteúdo com o tema dark existente.
