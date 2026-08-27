# COMPONENTS.md

## Visão Geral
Este documento descreve os componentes reutilizáveis do frontend do JvitorZ OS e como eles são organizados para compor a experiência do dashboard e dos operadores.

## Diretório de componentes
- `frontend/src/design-system/`: pasta oficial de componentes reutilizáveis.
- `frontend/src/components.js`: proxy legado que reexporta o design system central.

## Componentes principais
### `html`
- Função de template literal usada para markup estrutural confiável.
- Não sanitiza interpolações automaticamente. Dados externos usam `textContent`, `createTextNode` ou `escapeHtml` conforme o ponto de renderização.

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
- Permite que operadores sejam exibidos em um modo de workspace separado sem remover a sidebar principal.
- Usa `createFullscreenWorkspace({ moduleId, content })` para gerar um único `workspace-wrap` compartilhado.
- Entrada e saída acontecem pela sidebar e pelo hash; não existe botão de retorno próprio.

## Reutilização entre módulos
### Navegação e layout
- A sidebar e os links de navegação usam o mesmo modelo para todos os módulos registrados em `frontend/src/modules/index.js`.
- A estrutura de cada módulo é consistente: `section.module-section` contém o conteúdo principal.
- Hash ausente ou inválido é normalizado para `#/dashboard`, mantendo URL e módulo ativo sincronizados.

### Painéis e estados
- O `statePanel` exibe estados globais de carregamento, autenticação e erro do Dashboard.
- Estados e erros específicos de um operador devem ser exibidos dentro de sua própria workspace. O Planner já usa feedback local com `aria-live`.

### Renderização de módulos
- O registro `dashboardModules` define rota, label, ícone, renderização e lifecycle.
- O Dashboard renderiza somente o módulo da rota ativa no host compartilhado.

## Componentes de operador
### Planejador de Conteúdo
- Implementado como um módulo de workspace completo.
- Usa os componentes `createFullscreenWorkspace`, `createWorkspaceLayout`, header, chat, sidebar, painel e input fixo.
- Exibe conteúdo específico de planejamento dentro da seção de workspace.
- O módulo trata de estado local, chat e entradas do usuário.
- Seu controller protege contra listeners duplicados e respostas assíncronas obsoletas e participa do lifecycle genérico sem acoplamento em `frontend/app.js` ou no Dashboard.

### Analytics de Performance

- Implementado como módulo operacional dentro do host compartilhado do Dashboard.
- Usa controller com `mount`/`unmount`, listeners locais e tokens para ignorar respostas obsoletas.
- Reúne status do provider, sincronização manual, métricas, baseline, sinais, memória e evidências sem `fetch` direto no módulo.
- O formulário bloqueia somente a sincronização concorrente e usa `aria-busy`; o feedback local usa `aria-live`.
- Listas e evidências recebidas do backend são construídas com DOM seguro e `textContent`.
- Valores ausentes usam `—`; cards não fabricam zero para métricas `null`.
- As subrotas `ctr`, `retention`, `long-form` e `shorts` reutilizam o mesmo módulo e controller composto, com um workspace contextual por vez.
- Cada análise usa o contrato comum de fatos, sinais, insights, recomendações, lacunas, confiança e evidências.

### Dashboard Home e Biblioteca

- `homeModule` oferece síntese e links para a página responsável, sem duplicar ferramentas completas.
- `libraryModule` lista e abre artefatos persistidos como uma página independente; conteúdo é renderizado literalmente com `textContent`.

### Outras arquiteturas de workspace
- Operadores futuros seguem o contrato estabilizado na Sprint 14:
  - `module.fullscreen = true` quando o operador precisar ocupar a área de trabalho;
  - renderização dentro de um contêiner de workspace centralizado pelo Dashboard;
  - navegação pela sidebar e pelo hash, sem botão de retorno próprio;
  - montagem e desmontagem explícitas por um mecanismo genérico;
  - estado e feedback de erro mantidos localmente pelo operador.

## Ciclo de vida dos módulos

### Contrato

```js
module.createController(context) => ({
  mount(container, context),
  unmount(),
})
```

- módulos continuam responsáveis por `render(data, context)` e podem declarar `createController`;
- módulos sem controller recebem lifecycle no-op;
- controllers são criados sob demanda e reutilizados em remontagens;
- o Dashboard desmonta o módulo anterior antes de substituir o DOM;
- o Dashboard monta o módulo ativo uma única vez após a renderização;
- navegar novamente para o módulo ativo não duplica lifecycle nem listeners;
- o mecanismo é independente do Planner e permite registrar novos operadores sem condições específicas na lógica central.

## Papel da página Operadores

- A página Operadores é um catálogo/índice das ferramentas disponíveis e planejadas.
- O catálogo cruza o registro declarativo com rotas reais do Dashboard e consulta o estado dos quatro operadores de canal pela API.
- `AVAILABLE`, `LIMITED` e `NOT_CONFIGURED` podem abrir uma workspace registrada; `PLANNED` permanece sem link.
- Respostas tardias depois do unmount são ignoradas e falhas ficam no feedback local.

## Estilo e temas
- `frontend/styles.css` contém regras globais e temas escuros para a workspace.
- A separação de estilos base para dashboard e operadores permite que cada módulo mantenha visual próprio dentro do mesmo layout.

## Boas práticas de componentes
- Manter os módulos pequenos e responsáveis por renderizar apenas seu próprio bloco.
- Evitar lógica de negócio nos componentes de markup; encapsular em serviços ou módulos de dados.
- Reaproveitar funções de criação de markup (`html`, `createIcon`) em vez de repetir strings.
- Extrair comportamento do workspace fullscreen para o container do dashboard, não para cada módulo.

## Evolução futura
- Adicionar novos componentes reutilizáveis em `frontend/src/design-system/` quando houver uso concreto.
- Manter refinamentos puramente visuais no backlog até que tenham prioridade própria.
- Considerar testes em navegador real e divisão do controller do Planner em tarefas futuras.
