# COMPONENTS.md

## Visão Geral
Este documento descreve os componentes reutilizáveis do frontend do JvitorZ OS e como eles são organizados para compor a experiência do dashboard e dos operadores.

## Diretório de componentes
- `frontend/src/design-system/`: pasta oficial de componentes reutilizáveis.
- `frontend/src/components.js`: proxy legado que reexporta o design system central.

## Componentes principais
### `html`
- Função de template literal que gera strings HTML seguras.
- Utilizada em todo o frontend para montar markup dinâmico de módulos e layouts.

### `createIcon`
- Gera ícones SVG ou spans identificando cada módulo.
- Ajuda a manter a aparência consistente na sidebar, botões e cards.

### `createShell`
- Cria o layout principal do dashboard, incluindo `aside.sidebar`, `header.topbar` e o `main.workspace`.
- Responsável pelo esqueleto inicial da aplicação.

### `createDashboard`
- Inicializa o dashboard dentro do elemento raiz.
- Gera a shell e registra eventos de atualização, hashchange e navegação.
- Gerencia o estado de carregamento e exibição de módulos.

### `module.render`
- Cada módulo exporta um método `render(data, context)` que recebe dados do dashboard e contexto compartilhado.
- Retorna markup que representa uma seção do dashboard ou workspace completo.

### `workspace-fullscreen`
- Classe aplicada ao `main.workspace` quando um módulo requer tela cheia.
- Permite que operadores sejam exibidos em um modo de workspace separado, com botão `Voltar`.

## Reutilização entre módulos
### Navegação e layout
- A sidebar e os links de navegação usam o mesmo modelo para todos os módulos registrados em `frontend/src/modules/index.js`.
- A estrutura de cada módulo é consistente: `section.module-section` contém o conteúdo principal.

### Painéis e estados
- O `statePanel` exibe mensagens de estado de carregamento, erros e avisos.
- O mesmo painel é usado por todos os módulos, garantindo comportamento uniforme.

### Renderização de módulos
- O frontend centraliza a renderização no `dashboardModules.map(...)`.
- Isso garante que cada módulo compartilhe o mesmo host e apenas substitua a visualização quando necessário.

## Componentes de operador
### Planejador de Conteúdo
- Implementado como um módulo de workspace completo.
- Usa componentes de layout padrão: `workspace-wrap`, `workspace-back`, `workspace-module`.
- Exibe conteúdo específico de planejamento dentro da seção de workspace.
- O módulo trata de estado local, chat e entradas do usuário.

### Outras arquiteturas de workspace
- Operadores futuros devem seguir o mesmo padrão:
  - `module.fullscreen = true` para ocupar toda a área de trabalho.
  - Renderização pelo `dashboard` com botão de retorno.
  - Resultado renderizado dentro de `workspace-wrap`.

## Estilo e temas
- `frontend/styles.css` contém regras globais e temas escuros para a workspace.
- A separação de estilos base para dashboard e operadores permite que cada módulo mantenha visual próprio dentro do mesmo layout.

## Boas práticas de componentes
- Manter os módulos pequenos e responsáveis por renderizar apenas seu próprio bloco.
- Evitar lógica de negócio nos componentes de markup; encapsular em serviços ou módulos de dados.
- Reaproveitar funções de criação de markup (`html`, `createIcon`) em vez de repetir strings.
- Extrair comportamento do workspace fullscreen para o container do dashboard, não para cada módulo.

## Evolução futura
- Criar componentes adicionais no `frontend/src/components.js` para botões, cards, tabelas e formulários.
- Padronizar ainda mais os módulos de operador com helpers de renderização de workspace.
- Considerar a extração de um pequeno sistema de layouts em `frontend/src/layout.js`.
