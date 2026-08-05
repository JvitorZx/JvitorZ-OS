import { createApiClient } from './api/client.js';
import { createIcon, html } from './components.js';
import { dashboardModules } from './modules/index.js';

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

    <section id="statePanel" class="state-panel" hidden></section>
    <section id="moduleHost" class="module-grid"></section>
  </main>
`;

export const createDashboard = ({ root, apiBaseUrl }) => {
  if (!root) {
    throw new Error('Dashboard root element not found');
  }

  const api = createApiClient(apiBaseUrl);
  const context = { apiBaseUrl };
  let dashboardData = {};

  root.innerHTML = createShell(dashboardModules);

  const elements = {
    statePanel: root.querySelector('#statePanel'),
    moduleHost: root.querySelector('#moduleHost'),
    refreshButton: root.querySelector('#refreshButton'),
    navLinks: root.querySelectorAll('[data-module-link]'),
  };

  const setState = (message, variant = 'info') => {
    elements.statePanel.hidden = !message;
    elements.statePanel.className = `state-panel ${variant}`;
    elements.statePanel.innerHTML = message || '';
  };

  const setLoading = (isLoading) => {
    elements.refreshButton.disabled = isLoading;
    elements.refreshButton.setAttribute('aria-busy', String(isLoading));
  };

  const renderModules = () =>
    dashboardModules
      .map(
        (module) => html`
          <section id="${module.id}" class="module-section">
            ${module.render(dashboardData, context)}
          </section>
        `,
      )
      .join('');

  const setActiveModule = (moduleId) => {
    const activeModule = dashboardModules.find((module) => module.id === moduleId) ?? dashboardModules[0];

    elements.navLinks.forEach((link) => {
      link.classList.toggle('active', link.dataset.moduleLink === activeModule.id);
    });

    const targetSection = root.querySelector(`#${activeModule.id}`);
    if (targetSection) {
      targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const loadDashboard = async () => {
    setLoading(true);
    setState('Carregando dados do dashboard...');

    try {
      const data = await api.getDashboard();

      if (data.unauthorized) {
        setState(`Google OAuth ainda nao conectado. <a href="${data.authUrl}">Conectar agora</a>.`, 'warning');
        dashboardData = {
          status: {
            youtubeConnected: false,
            automationsEnabled: false,
            aiEnabled: false,
          },
        };
      } else {
        dashboardData = data;
        setState('');
      }

      elements.moduleHost.innerHTML = renderModules();
      setActiveModule(window.location.hash.replace('#', '') || dashboardModules[0].id);
    } catch (error) {
      setState(`Nao foi possivel carregar o dashboard: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  elements.refreshButton.addEventListener('click', loadDashboard);

  window.addEventListener('hashchange', () => {
    setActiveModule(window.location.hash.replace('#', '') || dashboardModules[0].id);
  });

  loadDashboard();
};
