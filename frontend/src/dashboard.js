import { ApiRequestError, createApiClient } from './api/client.js';
import { createFullscreenWorkspace, createIcon, html } from './design-system/index.js';
import { dashboardModules } from './modules/index.js';
import { createModuleLifecycle } from './modules/lifecycle.js';

const moduleRoute = (module) => module.route ?? `/${module.id}`;
const navigationModules = (modules) => modules.filter(({ navigation = true }) => navigation);

const createShell = (modules) => html`
  <aside class="sidebar" aria-label="Navegacao principal">
    <div class="brand">
      <span class="brand-mark">JZ</span>
      <div><strong>JvitorZ OS</strong><span>Creator Ops Studio</span></div>
    </div>
    <nav class="nav">
      ${navigationModules(modules).map((module) => html`
        <a class="nav-link" href="#${moduleRoute(module)}" data-module-link="${module.id}">
          <span class="nav-icon">${createIcon(module.icon ?? module.id)}</span>${module.label}
        </a>
      `).join('')}
    </nav>
    <div class="sidebar-footer"><span>Workspace local</span><strong>Operacao controlada</strong></div>
  </aside>
  <main class="workspace">
    <header class="topbar">
      <div><p class="eyebrow" data-page-eyebrow>Workspace</p><h1 data-page-title>JvitorZ OS</h1></div>
      <button id="refreshButton" class="icon-button" type="button" aria-label="Atualizar dados" title="Atualizar">${createIcon('refresh')}</button>
    </header>
    <section id="statePanel" class="state-panel" data-state-scope="global" role="status" aria-live="polite" aria-atomic="true" hidden></section>
    <section id="moduleHost" class="module-grid"></section>
  </main>
`;

export const resolveDashboardRoute = (hash, modules = dashboardModules) => {
  const raw = String(hash ?? '').replace(/^#/, '').trim();
  const legacy = modules.find((module) => module.id === raw || module.aliases?.includes(raw));
  const path = legacy ? moduleRoute(legacy) : raw.startsWith('/') ? raw : raw ? `/${raw}` : '/dashboard';
  const cleanPath = `/${path.split('?')[0].split('/').filter(Boolean).join('/')}`;
  const exact = modules.find((module) => moduleRoute(module) === cleanPath);
  const contextual = modules
    .filter((module) => module.allowSubroutes && cleanPath.startsWith(`${moduleRoute(module)}/`))
    .sort((a, b) => moduleRoute(b).length - moduleRoute(a).length)[0];
  const module = exact ?? contextual ?? modules.find((item) => moduleRoute(item) === '/dashboard') ?? modules[0];
  const base = moduleRoute(module);
  const resolvedPath = exact || contextual ? cleanPath : base;
  return {
    module,
    path: resolvedPath,
    canonicalHash: `#${resolvedPath}`,
    valid: Boolean(exact || contextual),
    subpath: contextual ? cleanPath.slice(base.length + 1) : '',
  };
};

export const createDashboard = ({ root, apiBaseUrl, api = createApiClient(apiBaseUrl), modules = dashboardModules }) => {
  if (!root) throw new Error('Dashboard root element not found');
  const context = { apiBaseUrl, api, modules, route: null };
  let dashboardData = {};
  let activeModule = null;
  let activePath = null;
  const lifecycles = new Map(modules.map((module) => [module.id, createModuleLifecycle(module, context)]));
  root.innerHTML = createShell(modules);
  const elements = {
    globalStatePanel: root.querySelector('#statePanel'), moduleHost: root.querySelector('#moduleHost'), refreshButton: root.querySelector('#refreshButton'),
    navLinks: root.querySelectorAll('[data-module-link]'), pageTitle: root.querySelector('[data-page-title]'),
    pageEyebrow: root.querySelector('[data-page-eyebrow]'), workspace: root.querySelector('.workspace'),
  };
  const setGlobalState = (message = '', variant = 'info', action = null) => {
    elements.globalStatePanel.replaceChildren(); elements.globalStatePanel.hidden = !message; elements.globalStatePanel.className = `state-panel ${variant}`;
    if (!message) return;
    elements.globalStatePanel.append(document.createTextNode(message));
    if (action?.href && action?.label) { const link = document.createElement('a'); link.href = action.href; link.textContent = action.label; elements.globalStatePanel.append(document.createTextNode(' '), link); }
  };
  const setLoading = (loading) => { elements.refreshButton.disabled = loading; elements.refreshButton.setAttribute('aria-busy', String(loading)); };
  const setActiveNavigation = (moduleId) => elements.navLinks.forEach((link) => {
    const active = link.dataset.moduleLink === moduleId; link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const unmountActiveModule = () => { if (!activeModule) return; lifecycles.get(activeModule.id)?.unmount(); activeModule = null; activePath = null; };
  const renderPage = (module) => module.fullscreen
    ? createFullscreenWorkspace({ moduleId: module.id, content: module.render(dashboardData, context) })
    : html`<section id="${module.id}" class="module-section page-module">${module.render(dashboardData, context)}</section>`;
  const setActiveModule = (route, { rerender = false } = {}) => {
    const nextModule = route.module;
    if (activeModule?.id === nextModule.id && activePath === route.path && !rerender) return;
    unmountActiveModule(); context.route = route; setActiveNavigation(nextModule.id);
    elements.pageTitle.textContent = nextModule.pageTitle ?? nextModule.label; elements.pageEyebrow.textContent = nextModule.pageEyebrow ?? 'Workspace';
    elements.workspace.classList.toggle('workspace-fullscreen', Boolean(nextModule.fullscreen)); elements.moduleHost.innerHTML = renderPage(nextModule);
    const container = elements.moduleHost.querySelector(`#${nextModule.id}`); activeModule = nextModule; activePath = route.path;
    lifecycles.get(nextModule.id)?.mount(container); container?.scrollIntoView?.({ behavior: 'instant', block: 'start' });
  };
  const activateFromHash = (options) => {
    const route = resolveDashboardRoute(window.location.hash, modules);
    if (window.location.hash !== route.canonicalHash) {
      window.location.hash = route.canonicalHash;
      return;
    }
    setActiveModule(route, options);
  };
  const loadDashboard = async () => {
    setLoading(true); setGlobalState('Carregando estado global do sistema...');
    try {
      const data = await api.getDashboard(); dashboardData = data;
      if (data.unauthorized) setGlobalState('YouTube ainda não está conectado.', 'warning', { href: data.authUrl, label: 'Conectar agora' });
      else if (data.youtubeUnavailable) setGlobalState('YouTube está temporariamente indisponível. Os serviços locais continuam ativos.', 'warning');
      else setGlobalState();
      if (activeModule?.refreshOnDashboardData) activateFromHash({ rerender: true });
    } catch (error) {
      const message = error instanceof ApiRequestError ? 'O estado global não pôde ser carregado pelo backend.'
        : error instanceof TypeError ? 'Não foi possível conectar ao backend.' : 'Não foi possível carregar o estado global.';
      setGlobalState(message, 'error');
    } finally { setLoading(false); }
  };
  const handleHashChange = () => activateFromHash();
  const handleRefresh = () => loadDashboard();
  const handleNavigationIntent = (event) => {
    const moduleId = event.currentTarget?.dataset?.moduleLink;
    if (moduleId) setActiveNavigation(moduleId);
  };
  elements.refreshButton.addEventListener('click', handleRefresh);
  elements.navLinks.forEach((link) => link.addEventListener('click', handleNavigationIntent));
  window.addEventListener('hashchange', handleHashChange);
  activateFromHash(); loadDashboard();
  return { destroy() { unmountActiveModule(); elements.refreshButton.removeEventListener('click', handleRefresh); elements.navLinks.forEach((link) => link.removeEventListener('click', handleNavigationIntent)); window.removeEventListener('hashchange', handleHashChange); } };
};
