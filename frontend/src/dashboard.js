import { ApiRequestError, createApiClient } from './api/client.js';
import { createFullscreenWorkspace, createIcon, html } from './design-system/index.js';
import { dashboardModules } from './modules/index.js';
import { createModuleLifecycle } from './modules/lifecycle.js';

const moduleRoute = (module) => module.route ?? `/${module.id}`;
const navigationModules = (modules) => modules.filter(({ navigation = true }) => navigation);

const createShell = (modules) => html`
  <aside class="sidebar" aria-label="Navegacao principal">
    <details id="channelProfileMenu" class="brand-channel-menu">
      <summary class="brand" aria-label="Selecionar canal ativo">
        <span class="channel-profile-avatar" aria-hidden="true">
          <img id="channelProfileImage" alt="" hidden />
          <span id="channelProfileInitials">OS</span>
        </span>
        <span class="brand-copy"><strong id="channelProfileTitle">Canal do OSS</strong><span id="channelProfileSubtitle">Selecione um canal</span></span>
        <span class="brand-menu-indicator" aria-hidden="true">v</span>
      </summary>
      <section class="channel-profile-menu-panel" aria-label="Canais do workspace">
        <p class="channel-profile-menu-title">Canais conectados</p>
        <label class="channel-profile-menu-label" for="channelProfileSelect">Canal ativo</label>
        <select id="channelProfileSelect" disabled aria-describedby="channelProfileFeedback"><option>Carregando perfis...</option></select>
        <div class="channel-profile-menu-actions">
          <button id="authorizeChannelProfile" class="button secondary" type="button">Autorizar Google</button>
          <button id="connectChannelProfile" class="button secondary" type="button" disabled>Vincular conta</button>
        </div>
        <div class="channel-profile-add">
          <label class="channel-profile-menu-label" for="channelProfileName">Adicionar canal</label>
          <div class="channel-profile-add-row">
            <input id="channelProfileName" type="text" maxlength="120" placeholder="Nome do canal" aria-label="Nome do novo canal" />
            <button id="createChannelProfile" class="button secondary" type="button">+ Adicionar</button>
          </div>
        </div>
        <button id="adoptLegacyChannelData" class="button secondary" type="button" hidden>Usar histórico existente</button>
        <span id="channelProfileFeedback" class="channel-profile-feedback" role="status" aria-live="polite"></span>
      </section>
    </details>
    <nav class="nav">
      ${navigationModules(modules).map((module) => html`
        <a class="nav-link" href="#${moduleRoute(module)}" data-module-link="${module.id}">
          <span class="nav-icon">${createIcon(module.icon ?? module.id)}</span>${module.label}
        </a>
      `).join('')}
    </nav>
    <div class="sidebar-footer"><span>Workspace local</span><strong>OSS</strong></div>
  </aside>
  <main class="workspace">
    <header class="topbar">
      <div><p class="eyebrow" data-page-eyebrow>Workspace</p><h1 data-page-title>JvitorZ OS</h1></div>
      <div class="topbar-actions">
        <button id="refreshButton" class="icon-button" type="button" aria-label="Atualizar dados" title="Atualizar">${createIcon('refresh')}</button>
      </div>
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
    channelProfileSelect: root.querySelector('#channelProfileSelect'), channelProfileName: root.querySelector('#channelProfileName'),
    createChannelProfile: root.querySelector('#createChannelProfile'), authorizeChannelProfile: root.querySelector('#authorizeChannelProfile'),
    connectChannelProfile: root.querySelector('#connectChannelProfile'), channelProfileFeedback: root.querySelector('#channelProfileFeedback'),
    channelProfileMenu: root.querySelector('#channelProfileMenu'),
    adoptLegacyChannelData: root.querySelector('#adoptLegacyChannelData'),
    channelProfileImage: root.querySelector('#channelProfileImage'), channelProfileInitials: root.querySelector('#channelProfileInitials'),
    channelProfileTitle: root.querySelector('#channelProfileTitle'), channelProfileSubtitle: root.querySelector('#channelProfileSubtitle'),
  };
  const setGlobalState = (message = '', variant = 'info', action = null) => {
    elements.globalStatePanel.replaceChildren(); elements.globalStatePanel.hidden = !message; elements.globalStatePanel.className = `state-panel ${variant}`;
    if (!message) return;
    elements.globalStatePanel.append(document.createTextNode(message));
    if (action?.href && action?.label) { const link = document.createElement('a'); link.href = action.href; link.textContent = action.label; elements.globalStatePanel.append(document.createTextNode(' '), link); }
  };
  const setLoading = (loading) => { elements.refreshButton.disabled = loading; elements.refreshButton.setAttribute('aria-busy', String(loading)); };
  const setProfileFeedback = (message = '') => { if (elements.channelProfileFeedback) elements.channelProfileFeedback.textContent = message; };
  const setProfileLoading = (loading) => {
    for (const element of [elements.channelProfileSelect, elements.createChannelProfile, elements.authorizeChannelProfile, elements.connectChannelProfile, elements.adoptLegacyChannelData]) {
      if (element) { element.disabled = loading || (element === elements.connectChannelProfile && !elements.channelProfileSelect?.value); element.setAttribute('aria-busy', String(loading)); }
    }
  };
  const renderActiveProfileIdentity = (profiles, activeProfileId) => {
    const profile = Array.isArray(profiles) ? profiles.find((item) => item.id === activeProfileId) : null;
    const title = profile?.displayName || 'Canal do OSS';
    const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'OS';
    const thumbnailUrl = typeof profile?.thumbnailUrl === 'string' && /^https:\/\//.test(profile.thumbnailUrl)
      ? profile.thumbnailUrl
      : null;
    if (elements.channelProfileTitle) elements.channelProfileTitle.textContent = title;
    if (elements.channelProfileSubtitle) {
      elements.channelProfileSubtitle.textContent = profile?.connectionState === 'CONNECTED'
        ? 'Canal conectado'
        : 'Conecte este canal';
    }
    if (elements.channelProfileInitials) elements.channelProfileInitials.textContent = initials;
    if (elements.channelProfileImage) {
      elements.channelProfileImage.hidden = !thumbnailUrl;
      if (thumbnailUrl) elements.channelProfileImage.src = thumbnailUrl;
      else elements.channelProfileImage.removeAttribute('src');
    }
  };
  const renderProfiles = ({ profiles = [], activeProfileId = null } = {}) => {
    const select = elements.channelProfileSelect;
    if (!select) return;
    renderActiveProfileIdentity(profiles, activeProfileId);
    const activeProfile = Array.isArray(profiles) ? profiles.find((item) => item.id === activeProfileId) : null;
    if (elements.adoptLegacyChannelData) {
      elements.adoptLegacyChannelData.hidden = !activeProfile || Boolean(activeProfile.projectId || activeProfile.usesLegacyWorkspaceData);
      elements.adoptLegacyChannelData.disabled = !activeProfile;
    }
    select.replaceChildren();
    if (!Array.isArray(profiles) || profiles.length === 0) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Nenhum canal configurado'; select.append(option); select.disabled = true;
      if (elements.connectChannelProfile) elements.connectChannelProfile.disabled = true;
      setProfileFeedback('Adicione um perfil para separar os dados de cada canal.');
      return;
    }
    for (const profile of profiles) {
      const option = document.createElement('option'); option.value = String(profile.id); option.textContent = `${profile.displayName}${profile.connectionState === 'CONNECTED' ? '' : ' (sem conta vinculada)'}`;
      option.selected = profile.id === activeProfileId; select.append(option);
    }
    select.disabled = false;
    if (elements.connectChannelProfile) elements.connectChannelProfile.disabled = !select.value;
    context.activeChannelProfileId = activeProfileId;
    setProfileFeedback('');
  };
  const loadProfiles = async () => {
    if (typeof api.listChannelProfiles !== 'function') return;
    try { renderProfiles(await api.listChannelProfiles()); }
    catch { setProfileFeedback('Perfis de canal indisponiveis no momento.'); }
  };
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
      const youtubeState = data.integrations?.youtubeData?.state;
      if (youtubeState === 'AUTH_REQUIRED' || data.unauthorized) setGlobalState('YouTube precisa ser reconectado.', 'warning', { href: data.authUrl, label: 'Conectar agora' });
      else if (youtubeState === 'NOT_CONFIGURED') setGlobalState('A integração do YouTube ainda não está configurada.', 'warning');
      else if (youtubeState === 'DEGRADED' || data.youtubeUnavailable) setGlobalState('YouTube está temporariamente indisponível. O último dado válido continua visível.', 'warning');
      else if (youtubeState === 'ERROR') setGlobalState('Não foi possível carregar dados do YouTube.', 'error');
      else setGlobalState();
      if (activeModule?.refreshOnDashboardData) activateFromHash({ rerender: true });
    } catch (error) {
      const message = error instanceof ApiRequestError ? 'O estado global não pôde ser carregado pelo backend.'
        : error instanceof TypeError ? 'Não foi possível conectar ao backend.' : 'Não foi possível carregar o estado global.';
      setGlobalState(message, 'error');
    } finally { setLoading(false); }
  };
  context.refreshDashboard = loadDashboard;
  const handleHashChange = () => activateFromHash();
  const handleRefresh = () => loadDashboard();
  const handleProfileChange = async () => {
    const profileId = elements.channelProfileSelect?.value;
    if (!profileId || typeof api.activateChannelProfile !== 'function') return;
    setProfileLoading(true); setProfileFeedback('Trocando canal...');
    try {
      await api.activateChannelProfile(profileId);
      await Promise.all([loadProfiles(), loadDashboard()]);
      setProfileFeedback('Canal ativo atualizado.');
      if (elements.channelProfileMenu) elements.channelProfileMenu.open = false;
    } catch { setProfileFeedback('Nao foi possivel trocar o canal.'); }
    finally { setProfileLoading(false); }
  };
  const handleCreateProfile = async () => {
    const displayName = elements.channelProfileName?.value?.trim();
    if (!displayName || typeof api.createChannelProfile !== 'function') { setProfileFeedback('Informe o nome do novo canal.'); return; }
    setProfileLoading(true); setProfileFeedback('Criando perfil de canal...');
    try {
      const profile = await api.createChannelProfile({ displayName });
      if (elements.channelProfileName) elements.channelProfileName.value = '';
      await api.activateChannelProfile?.(profile.id);
      await Promise.all([loadProfiles(), loadDashboard()]);
      setProfileFeedback('Perfil criado. Autorize e vincule a conta Google deste canal.');
    } catch { setProfileFeedback('Nao foi possivel criar o perfil de canal.'); }
    finally { setProfileLoading(false); }
  };
  const handleAuthorizeProfile = () => {
    if (!elements.channelProfileSelect?.value) { setProfileFeedback('Selecione um perfil antes de autorizar.'); return; }
    setProfileFeedback('Conclua a autorizacao do Google e depois use Vincular conta.');
    if (typeof window.location?.assign === 'function') window.location.assign(`${apiBaseUrl}/api/auth/google`);
  };
  const handleConnectProfile = async () => {
    const profileId = elements.channelProfileSelect?.value;
    if (!profileId || typeof api.connectChannelProfile !== 'function') return;
    setProfileLoading(true); setProfileFeedback('Vinculando a conta Google atual...');
    try {
      await api.connectChannelProfile(profileId);
      await Promise.all([loadProfiles(), loadDashboard()]);
      setProfileFeedback('Conta vinculada ao perfil ativo.');
    } catch (error) {
      setProfileFeedback(error instanceof ApiRequestError && error.status === 409
        ? 'A conta Google atual pertence a outro perfil.' : 'Nao foi possivel vincular a conta Google.');
    } finally { setProfileLoading(false); }
  };
  const handleAdoptLegacyChannelData = async () => {
    const profileId = elements.channelProfileSelect?.value;
    if (!profileId || typeof api.adoptLegacyChannelData !== 'function') return;
    setProfileLoading(true); setProfileFeedback('Associando o histórico existente a este canal...');
    try {
      await api.adoptLegacyChannelData(profileId);
      await Promise.all([loadProfiles(), loadDashboard()]);
      setProfileFeedback('Histórico existente associado ao canal ativo.');
    } catch { setProfileFeedback('Não foi possível associar o histórico existente.'); }
    finally { setProfileLoading(false); }
  };
  const handleNavigationIntent = (event) => {
    const moduleId = event.currentTarget?.dataset?.moduleLink;
    if (moduleId) setActiveNavigation(moduleId);
  };
  elements.refreshButton.addEventListener('click', handleRefresh);
  elements.channelProfileSelect?.addEventListener('change', handleProfileChange);
  elements.createChannelProfile?.addEventListener('click', handleCreateProfile);
  elements.authorizeChannelProfile?.addEventListener('click', handleAuthorizeProfile);
  elements.connectChannelProfile?.addEventListener('click', handleConnectProfile);
  elements.adoptLegacyChannelData?.addEventListener('click', handleAdoptLegacyChannelData);
  elements.navLinks.forEach((link) => link.addEventListener('click', handleNavigationIntent));
  window.addEventListener('hashchange', handleHashChange);
  activateFromHash(); loadProfiles(); loadDashboard();
  return { destroy() { unmountActiveModule(); elements.refreshButton.removeEventListener('click', handleRefresh); elements.channelProfileSelect?.removeEventListener('change', handleProfileChange); elements.createChannelProfile?.removeEventListener('click', handleCreateProfile); elements.authorizeChannelProfile?.removeEventListener('click', handleAuthorizeProfile); elements.connectChannelProfile?.removeEventListener('click', handleConnectProfile); elements.adoptLegacyChannelData?.removeEventListener('click', handleAdoptLegacyChannelData); elements.navLinks.forEach((link) => link.removeEventListener('click', handleNavigationIntent)); window.removeEventListener('hashchange', handleHashChange); } };
};
