import { createApiClient } from './api/client.js';
import { createFullscreenWorkspace, createIcon, html } from './design-system/index.js';
import { dashboardModules } from './modules/index.js';
import { createModuleLifecycle } from './modules/lifecycle.js';

const createShell = (modules) => html`
  <aside class="sidebar" aria-label="Navegacao principal">
    <div class="brand">
      <span class="brand-mark">JZ</span>
      <div>
        <strong>JvitorZ OS</strong>
        <span>Creator Ops Studio</span>
      </div>
    </div>

    <nav class="nav">
      ${modules
        .map(
          (module) => html`
            <a class="nav-link" href="#${module.id}" data-module-link="${module.id}">
              <span class="nav-icon">${createIcon(module.id)}</span>
              ${module.label}
            </a>
          `,
        )
        .join('')}
    </nav>

    <div class="sidebar-footer">
      <span>Fonte:</span>
      <strong>/api/dashboard</strong>
    </div>
  </aside>

  <main class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">Visao geral</p>
        <h1>Dashboard operacional</h1>
      </div>

      <button id="refreshButton" class="icon-button" type="button" aria-label="Atualizar dashboard" title="Atualizar">
        ${createIcon('refresh')}
      </button>
    </header>

    <section
      id="statePanel"
      class="state-panel"
      data-state-scope="global"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      hidden
    ></section>
    <section id="moduleHost" class="module-grid"></section>
  </main>
`;

export const createDashboard = ({
  root,
  apiBaseUrl,
  api = createApiClient(apiBaseUrl),
  modules = dashboardModules,
}) => {
  if (!root) {
    throw new Error('Dashboard root element not found');
  }

  const context = { apiBaseUrl, api, modules };
  let dashboardData = {};
  let activeModule = null;
  const lifecycles = new Map(
    modules.map((module) => [module.id, createModuleLifecycle(module, context)]),
  );

  root.innerHTML = createShell(modules);

  const elements = {
    globalStatePanel: root.querySelector('#statePanel'),
    moduleHost: root.querySelector('#moduleHost'),
    refreshButton: root.querySelector('#refreshButton'),
    navLinks: root.querySelectorAll('[data-module-link]'),
  };

  const setGlobalState = (message, variant = 'info') => {
    elements.globalStatePanel.hidden = !message;
    elements.globalStatePanel.className = `state-panel ${variant}`;
    elements.globalStatePanel.innerHTML = message || '';
  };

  const setLoading = (isLoading) => {
    elements.refreshButton.disabled = isLoading;
    elements.refreshButton.setAttribute('aria-busy', String(isLoading));
  };

  const renderModules = () =>
    modules
      .map(
        (module) => html`
          <section id="${module.id}" class="module-section">
            ${module.render(dashboardData, context)}
          </section>
        `,
      )
      .join('');

  const setModuleContent = (content) => {
    elements.moduleHost.innerHTML = content;
  };

  const unmountActiveModule = () => {
    if (!activeModule) return;

    lifecycles.get(activeModule.id)?.unmount();
    activeModule = null;
  };

  const setActiveModule = (moduleId, { rerender = false } = {}) => {
    const nextModule = modules.find((module) => module.id === moduleId) ?? modules[0];
    if (activeModule?.id === nextModule.id && !rerender) return;

    unmountActiveModule();

    elements.navLinks.forEach((link) => {
      link.classList.toggle('active', link.dataset.moduleLink === nextModule.id);
    });

    // If module requests fullscreen workspace view, replace main content
    if (nextModule.fullscreen) {
      setModuleContent(createFullscreenWorkspace({
        moduleId: nextModule.id,
        content: nextModule.render(dashboardData, context),
      }));

      // mark workspace mode on the main workspace element
      const workspaceMain = root.querySelector('.workspace');
      if (workspaceMain) workspaceMain.classList.add('workspace-fullscreen');

      // ensure focus/scroll to top of module
      const targetSection = root.querySelector(`#${nextModule.id}`);
      activeModule = nextModule;
      lifecycles.get(nextModule.id)?.mount(targetSection);
      if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    let targetSection = rerender ? null : root.querySelector(`#${nextModule.id}`);

    if (!targetSection) {
      setModuleContent(renderModules());
      targetSection = root.querySelector(`#${nextModule.id}`);
    }

    if (targetSection) {
      // ensure non-fullscreen modules remove workspace fullscreen class
      const workspaceMain = root.querySelector('.workspace');
      if (workspaceMain) workspaceMain.classList.remove('workspace-fullscreen');
      activeModule = nextModule;
      lifecycles.get(nextModule.id)?.mount(targetSection);
      targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const activateModuleFromHash = (options) => {
    const requestedModuleId = window.location.hash.replace('#', '');
    const requestedModule = modules.find((module) => module.id === requestedModuleId);

    if (!requestedModule) {
      const defaultHash = `#${modules[0].id}`;
      if (window.location.hash !== defaultHash) {
        window.location.hash = defaultHash;
        return;
      }
    }

    setActiveModule(requestedModule?.id ?? modules[0].id, options);
  };

  const loadDashboard = async () => {
    setLoading(true);
    setGlobalState('Carregando dados do dashboard...');

    try {
      const data = await api.getDashboard();

      if (data.unauthorized) {
        setGlobalState(`Google OAuth ainda nao conectado. <a href="${data.authUrl}">Conectar agora</a>.`, 'warning');
        dashboardData = {
          status: {
            youtubeConnected: false,
            automationsEnabled: false,
            aiEnabled: false,
          },
        };
      } else {
        dashboardData = data;
        setGlobalState('');
      }

      activateModuleFromHash({
        rerender: true,
      });
    } catch (error) {
      setGlobalState(`Nao foi possivel carregar o dashboard: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  elements.refreshButton.addEventListener('click', loadDashboard);

  window.addEventListener('hashchange', () => {
    activateModuleFromHash();
  });

  loadDashboard();
};
