import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDashboard } from '../src/dashboard.js';
import { dashboardModules } from '../src/modules/index.js';
import { operatorsModule } from '../src/modules/operators.js';
import { supervisorModule } from '../src/modules/supervisor.js';
import { homeModule } from '../src/modules/home.js';
import { operatorRegistry } from '../src/operators/registry.js';

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(name) {
    const names = this.names();
    names.add(name);
    this.write(names);
  }

  remove(name) {
    const names = this.names();
    names.delete(name);
    this.write(names);
  }

  toggle(name, force) {
    const names = this.names();
    const shouldAdd = force ?? !names.has(name);
    if (shouldAdd) names.add(name);
    else names.delete(name);
    this.write(names);
    return shouldAdd;
  }

  contains(name) {
    return this.names().has(name);
  }

  names() {
    return new Set(this.element.className.split(/\s+/).filter(Boolean));
  }

  write(names) {
    this.element.className = [...names].join(' ');
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.className = '';
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.scrollCount = 0;
    this._innerHTML = '';
    this._textContent = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent ?? '').join('');
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this._textContent = '';
    this.children = children;
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, ...event });
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  querySelector() {
    return null;
  }

  scrollIntoView() {
    this.scrollCount += 1;
  }
}

class FakeModuleHost extends FakeElement {
  constructor() {
    super('section');
    this.id = 'moduleHost';
    this.sections = new Map();
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    this.sections = new Map();

    const sectionPattern = /<section id="([^"]+)" class="([^"]*)">/g;
    for (const match of this._innerHTML.matchAll(sectionPattern)) {
      const section = new FakeElement('section');
      section.id = match[1];
      section.className = match[2];
      this.sections.set(section.id, section);
    }

    if (this._innerHTML.includes('class="workspace-wrap"')) {
      const wrap = new FakeElement('div');
      wrap.className = 'workspace-wrap';
      const section = [...this.sections.values()][0];
      wrap.children = section ? [section] : [];
      this.children = [wrap];
      return;
    }

    this.children = [...this.sections.values()];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (selector === '.workspace-wrap') {
      return this.children.find((child) => child.classList.contains('workspace-wrap')) ?? null;
    }
    if (selector.startsWith('#')) return this.sections.get(selector.slice(1)) ?? null;
    return null;
  }

  querySelectorAll(selector) {
    const match = this.querySelector(selector);
    return match ? [match] : [];
  }
}

class FakeWindow {
  constructor(initialHash = '') {
    this.listeners = new Map();
    this.currentHash = initialHash;
    this.hashChangeCount = 0;
    this.location = {};
    Object.defineProperty(this.location, 'hash', {
      get: () => this.currentHash,
      set: (value) => this.setHash(value),
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  setHash(value) {
    const hash = value && !String(value).startsWith('#') ? `#${value}` : String(value);
    if (hash === this.currentHash) return;
    this.currentHash = hash;
    this.hashChangeCount += 1;
    for (const listener of this.listeners.get('hashchange') ?? []) listener();
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }
}

class FakeRoot extends FakeElement {
  constructor(fakeWindow) {
    super('div');
    this.fakeWindow = fakeWindow;
    this.elements = new Map();
    this.navLinks = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    const workspace = new FakeElement('main');
    workspace.className = 'workspace';
    const statePanel = new FakeElement('section');
    statePanel.id = 'statePanel';
    const moduleHost = new FakeModuleHost();
    const refreshButton = new FakeElement('button');
    refreshButton.id = 'refreshButton';
    const pageTitle = new FakeElement('h1');
    const pageEyebrow = new FakeElement('p');

    this.elements = new Map([
      ['.workspace', workspace],
      ['#statePanel', statePanel],
      ['#moduleHost', moduleHost],
      ['#refreshButton', refreshButton],
      ['[data-page-title]', pageTitle],
      ['[data-page-eyebrow]', pageEyebrow],
    ]);

    this.navLinks = [...this._innerHTML.matchAll(/href="#([^"]+)" data-module-link="([^"]+)"/g)]
      .map((match) => {
        const link = new FakeElement('a');
        link.className = 'nav-link';
        link.dataset.moduleLink = match[2];
        link.href = `#${match[1]}`;
        link.click = () => {
          link.dispatch('click', { currentTarget: link });
          this.fakeWindow.location.hash = link.href;
        };
        return link;
      });
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    const direct = this.elements.get(selector);
    if (direct) return direct;
    return this.elements.get('#moduleHost')?.querySelector(selector) ?? null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-module-link]') return this.navLinks;
    return this.elements.get('#moduleHost')?.querySelectorAll(selector) ?? [];
  }
}

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createHarness = async ({ hash = '', modules = dashboardModules, api: apiOverride } = {}) => {
  const fakeWindow = new FakeWindow(hash);
  globalThis.window = fakeWindow;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (value) => {
      const node = new FakeElement('#text');
      node.textContent = value;
      return node;
    },
  };
  const root = new FakeRoot(fakeWindow);
  const api = apiOverride ?? {
    async getDashboard() {
      return {
        status: {
          youtubeConnected: false,
          automationsEnabled: false,
          aiEnabled: false,
        },
      };
    },
  };

  const dashboard = createDashboard({
    root,
    apiBaseUrl: 'http://localhost:3000',
    api,
    modules,
  });
  await flush();

  const navLink = (id) => root.navLinks.find((link) => link.dataset.moduleLink === id);
  const activeLink = () => root.navLinks.find((link) => link.classList.contains('active'));

  return { fakeWindow, root, navLink, activeLink, dashboard };
};

test('sidebar navigation changes hash, activates the module and keeps one hash listener', async () => {
  const harness = await createHarness();

  harness.navLink('operators').click();
  harness.navLink('operators').click();

  assert.equal(harness.fakeWindow.location.hash, '#/operators');
  assert.equal(harness.activeLink().dataset.moduleLink, 'operators');
  assert.equal(harness.root.querySelector('#operators').scrollCount, 1);
  assert.equal(harness.fakeWindow.listenerCount('hashchange'), 1);
  assert.equal(harness.root.querySelector('#refreshButton').listenerCount('click'), 1);
  assert.equal(harness.navLink('operators').listenerCount('click'), 1);
});

test('registered shell routes match the operational navigation contract', () => {
  assert.deepEqual(dashboardModules.map(({ route }) => route), [
    '/dashboard', '/channel', '/analytics', '/planner', '/planning', '/library', '/research', '/manager',
    '/supervisor', '/automations', '/operators', '/settings',
  ]);
});

test('sidebar selection follows click intent before the hash navigation commits', async () => {
  const harness = await createHarness({ hash: '#/dashboard' });
  const link = harness.navLink('analytics');
  link.dispatch('click', { currentTarget: link });
  assert.equal(harness.activeLink().dataset.moduleLink, 'analytics');
  assert.equal(harness.fakeWindow.location.hash, '#/dashboard');
});

test('browser-like backward and forward hash changes preserve route and lifecycle', async () => {
  const harness = await createHarness({ hash: '#/channel' });
  harness.fakeWindow.location.hash = '#/planner';
  assert.equal(harness.activeLink().dataset.moduleLink, 'content-planner');
  harness.fakeWindow.location.hash = '#/channel';
  assert.equal(harness.activeLink().dataset.moduleLink, 'channel');
  harness.fakeWindow.location.hash = '#/planner';
  assert.equal(harness.activeLink().dataset.moduleLink, 'content-planner');
  assert.equal(harness.root.querySelector('#moduleHost').children.length, 1);
});

test('destroy removes shell listeners and unmounts the active page', async () => {
  const calls = [];
  const module = {
    id: 'dashboard', route: '/dashboard', label: 'Dashboard', render: () => '<p>Home</p>',
    createController: () => ({ mount: () => calls.push('mount'), unmount: () => calls.push('unmount') }),
  };
  const harness = await createHarness({ modules: [module] });
  harness.dashboard.destroy();
  assert.deepEqual(calls, ['mount', 'unmount']);
  assert.equal(harness.fakeWindow.listenerCount('hashchange'), 0);
  assert.equal(harness.navLink('dashboard').listenerCount('click'), 0);
  assert.equal(harness.root.querySelector('#refreshButton').listenerCount('click'), 0);
});

test('Dashboard home links summaries to responsible pages without rendering untrusted HTML', () => {
  const markup = homeModule.render({
    status: { youtubeConnected: true, aiEnabled: true },
    supervisor: {
      editorial: { priorities: ['Prioridade <script>alert(1)</script>'], risks: ['Amostra curta'] },
      automations: { active: 2 },
      channelOperators: [{ status: 'AVAILABLE' }, { status: 'LIMITED' }],
    },
  });
  for (const route of ['/channel', '/planner', '/automations', '/operators', '/analytics', '/manager', '/supervisor']) {
    assert.match(markup, new RegExp(`href="#${route}"`));
  }
  assert.match(markup, /Prioridade &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/);
});

test('an Analytics subroute keeps one module mounted and the sidebar synchronized', async () => {
  const harness = await createHarness({ hash: '#/analytics/ctr' });
  assert.equal(harness.fakeWindow.location.hash, '#/analytics/ctr');
  assert.equal(harness.activeLink().dataset.moduleLink, 'analytics');
  assert.equal(harness.root.querySelector('#moduleHost').children.length, 1);
  assert.ok(harness.root.querySelector('#analytics'));
});

test('a legacy initial hash is canonicalized and survives a dashboard reload', async () => {
  const firstLoad = await createHarness({ hash: '#content-planner' });
  assert.equal(firstLoad.activeLink().dataset.moduleLink, 'content-planner');
  assert.equal(firstLoad.fakeWindow.location.hash, '#/planner');
  assert.equal(firstLoad.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), true);

  const reloaded = await createHarness({ hash: firstLoad.fakeWindow.location.hash });
  assert.equal(reloaded.activeLink().dataset.moduleLink, 'content-planner');
  assert.ok(reloaded.root.querySelector('#content-planner'));
  assert.equal(reloaded.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), true);
});

test('an invalid hash is normalized to Dashboard without a hashchange loop', async () => {
  const harness = await createHarness({ hash: '#module-that-does-not-exist' });

  assert.equal(harness.fakeWindow.location.hash, '#/dashboard');
  assert.equal(harness.fakeWindow.hashChangeCount, 1);
  assert.equal(harness.activeLink().dataset.moduleLink, 'dashboard');
  assert.equal(harness.root.querySelector('#dashboard').scrollCount, 1);
});

test('invalid hash mounts the default module once and keeps later navigation functional', async () => {
  const lifecycleCalls = [];
  const createModule = (id) => ({
    id,
    label: id,
    render: () => `<p>${id}</p>`,
    createController: () => ({
      mount() {
        lifecycleCalls.push(`mount:${id}`);
      },
      unmount() {
        lifecycleCalls.push(`unmount:${id}`);
      },
    }),
  });
  const harness = await createHarness({
    hash: '#invalid',
    modules: [createModule('channel'), createModule('analytics')],
  });

  assert.deepEqual(lifecycleCalls, ['mount:channel']);
  assert.equal(harness.fakeWindow.hashChangeCount, 1);

  harness.navLink('analytics').click();
  assert.deepEqual(lifecycleCalls, [
    'mount:channel',
    'unmount:channel',
    'mount:analytics',
  ]);
  assert.equal(harness.fakeWindow.location.hash, '#/analytics');
});

test('fullscreen workspace is replaced cleanly when switching modules', async () => {
  const harness = await createHarness();

  harness.navLink('content-planner').click();
  assert.equal(harness.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), true);
  assert.equal(harness.root.querySelectorAll('.workspace-wrap').length, 1);
  assert.equal(harness.root.querySelector('#moduleHost').children.length, 1);

  harness.navLink('analytics').click();
  assert.equal(harness.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), false);
  assert.equal(harness.root.querySelectorAll('.workspace-wrap').length, 0);
  assert.ok(harness.root.querySelector('#analytics'));

  harness.navLink('content-planner').click();
  assert.equal(harness.root.querySelectorAll('.workspace-wrap').length, 1);
  assert.equal(harness.root.querySelector('#moduleHost').children.length, 1);
});

test('module lifecycle unmounts the previous module before mounting the next one', async () => {
  const lifecycleCalls = [];
  const createModule = (id) => ({
    id,
    label: id,
    render: () => `<p>${id}</p>`,
    createController: () => ({
      mount(container) {
        lifecycleCalls.push(`mount:${id}:${container.id}`);
      },
      unmount() {
        lifecycleCalls.push(`unmount:${id}`);
      },
    }),
  });
  const harness = await createHarness({
    hash: '#alpha',
    modules: [createModule('alpha'), createModule('beta')],
  });

  assert.deepEqual(lifecycleCalls, ['mount:alpha:alpha']);

  harness.navLink('beta').click();
  assert.deepEqual(lifecycleCalls, [
    'mount:alpha:alpha',
    'unmount:alpha',
    'mount:beta:beta',
  ]);

  harness.navLink('beta').click();
  assert.equal(lifecycleCalls.length, 3);

  harness.fakeWindow.location.hash = '#alpha';
  assert.deepEqual(lifecycleCalls, [
    'mount:alpha:alpha',
    'unmount:alpha',
    'mount:beta:beta',
    'unmount:beta',
    'mount:alpha:alpha',
  ]);
});

test('sidebar and hash leave fullscreen workspace without a Back button', async () => {
  const harness = await createHarness({ hash: '#content-planner' });

  assert.equal(harness.root.querySelector('#workspaceBack'), null);
  harness.navLink('channel').click();

  assert.equal(harness.fakeWindow.location.hash, '#/channel');
  assert.equal(harness.activeLink().dataset.moduleLink, 'channel');
  assert.equal(harness.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), false);
});

test('multiple fullscreen operators share one workspace and preserve lifecycle order', async () => {
  const lifecycleCalls = [];
  const createFullscreenModule = (id) => ({
    id,
    label: id,
    fullscreen: true,
    render: () => `<p>${id}</p>`,
    createController: () => ({
      mount() {
        lifecycleCalls.push(`mount:${id}`);
      },
      unmount() {
        lifecycleCalls.push(`unmount:${id}`);
      },
    }),
  });
  const harness = await createHarness({
    hash: '#operator-a',
    modules: [
      { id: 'channel', label: 'Canal', render: () => '<p>Canal</p>' },
      createFullscreenModule('operator-a'),
      createFullscreenModule('operator-b'),
    ],
  });

  assert.match(harness.root.querySelector('#moduleHost').innerHTML, /data-workspace-module="operator-a"/);
  assert.equal(harness.root.querySelectorAll('.workspace-wrap').length, 1);

  harness.navLink('operator-b').click();
  assert.match(harness.root.querySelector('#moduleHost').innerHTML, /data-workspace-module="operator-b"/);
  assert.doesNotMatch(harness.root.querySelector('#moduleHost').innerHTML, /data-workspace-module="operator-a"/);
  assert.equal(harness.root.querySelectorAll('.workspace-wrap').length, 1);

  harness.navLink('operator-a').click();
  assert.deepEqual(lifecycleCalls, [
    'mount:operator-a',
    'unmount:operator-a',
    'mount:operator-b',
    'unmount:operator-b',
    'mount:operator-a',
  ]);
});

test('Operators registry points available capabilities only to registered routes', () => {
  const registered = (route) => dashboardModules.some((module) => module.route === route
    || (module.allowSubroutes && route?.startsWith(`${module.route}/`)));
  const navigable = operatorRegistry.filter(({ status }) => status !== 'PLANNED');

  assert.ok(navigable.every(({ route }) => registered(route)));
  assert.deepEqual(operatorRegistry.filter(({ dynamic }) => dynamic).map(({ id }) => id), [
    'ctr', 'retention', 'long-form', 'shorts', 'trends', 'series',
  ]);
});

test('planned Operators remain non-navigable without producing an invalid hash', () => {
  const planned = operatorRegistry.filter(({ status }) => status === 'PLANNED');

  assert.ok(planned.length > 0);
  assert.ok(planned.every(({ route }) => route === null));
  assert.match(operatorsModule.render(), /data-operator-list/);
});

test('a global Dashboard failure is reported through statePanel', async () => {
  const harness = await createHarness({
    api: {
      async getDashboard() {
        throw new Error('dashboard unavailable');
      },
    },
  });
  const statePanel = harness.root.querySelector('#statePanel');

  assert.equal(statePanel.hidden, false);
  assert.equal(statePanel.className, 'state-panel error');
  assert.match(statePanel.textContent, /Não foi possível carregar o estado global/);
  assert.match(harness.root.innerHTML, /data-state-scope="global"/);
  assert.match(harness.root.innerHTML, /aria-live="polite"/);
  assert.equal(harness.activeLink().dataset.moduleLink, 'dashboard');
  assert.ok(harness.root.querySelector('#dashboard'));
});

test('initial hash selection is visible while Dashboard data is still loading', async () => {
  const dashboardRequest = new Promise(() => {});
  const harness = await createHarness({
    hash: '#supervisor',
    api: {
      getDashboard() {
        return dashboardRequest;
      },
    },
  });

  assert.equal(harness.activeLink().dataset.moduleLink, 'supervisor');
  assert.equal(harness.fakeWindow.location.hash, '#/supervisor');
});

test('global OAuth state remains global while navigating between modules', async () => {
  const harness = await createHarness({
    api: {
      async getDashboard() {
        return {
          unauthorized: true,
          authUrl: '/api/auth/google',
        };
      },
    },
  });
  const statePanel = harness.root.querySelector('#statePanel');
  const globalMessage = statePanel.textContent;

  assert.equal(statePanel.className, 'state-panel warning');
  assert.match(globalMessage, /YouTube precisa ser reconectado/);

  harness.navLink('content-planner').click();
  harness.navLink('channel').click();

  assert.equal(statePanel.hidden, false);
  assert.equal(statePanel.className, 'state-panel warning');
  assert.equal(statePanel.textContent, globalMessage);
});

test('temporary YouTube failure keeps local modules operational and reports a global warning', async () => {
  const harness = await createHarness({
    api: {
      async getDashboard() {
        return {
          youtubeUnavailable: true,
          status: { youtubeConnected: false, automationsEnabled: true, aiEnabled: true },
        };
      },
    },
  });
  const statePanel = harness.root.querySelector('#statePanel');

  assert.equal(statePanel.hidden, false);
  assert.equal(statePanel.className, 'state-panel warning');
  assert.match(statePanel.textContent, /temporariamente indisponível/);

  harness.navLink('library').click();
  assert.equal(harness.fakeWindow.location.hash, '#/library');
  assert.equal(harness.activeLink().dataset.moduleLink, 'library');
  assert.ok(harness.root.querySelector('#library'));
  assert.match(statePanel.textContent, /temporariamente indisponível/);
});

test('module context does not expose the global statePanel channel', async () => {
  let receivedContext;
  const module = {
    id: 'isolated-module',
    label: 'Isolated',
    render(_data, context) {
      receivedContext = context;
      return '<p>Isolated</p>';
    },
  };

  await createHarness({ modules: [module] });

  assert.ok(receivedContext);
  assert.equal('statePanel' in receivedContext, false);
  assert.equal('globalStatePanel' in receivedContext, false);
  assert.equal('setGlobalState' in receivedContext, false);
});

test('Supervisor renders the YouTube Analytics provider state without activating operators', () => {
  const synchronized = supervisorModule.render({
    status: { youtubeConnected: true, aiEnabled: false, automationsEnabled: false },
    supervisor: {
      youtubeAnalytics: {
        state: 'synchronized',
        lastSyncAt: '2026-08-24T15:00:00.000Z',
        lastErrorType: null,
      },
      editorial: {
        priorities: ['Prioridade real'],
        risks: ['Risco real'],
        opportunities: ['Oportunidade <script>alert(1)</script>'],
        actions: ['Ação recomendada'],
      },
      outcomeReviews: {
        current: 3,
        reviewAvailable: 2,
        insufficientData: 1,
        recentFailures: 0,
      },
      automations: {
        governance: {
          healthy: 2, degraded: 1, blocked: 3, failing: 1,
          quotasReached: 1, pausedByFailure: 1, retriesPending: 2, approvalsPending: 4,
        },
      },
    },
  });
  const unauthorized = supervisorModule.render({
    status: { youtubeConnected: false, aiEnabled: false, automationsEnabled: false },
    supervisor: { youtubeAnalytics: { state: 'not_authorized' } },
  });

  assert.match(synchronized, /YouTube Analytics[\s\S]*?Sincronizado/);
  assert.match(unauthorized, /YouTube Analytics[\s\S]*?Autorizacao necessaria/);
  assert.match(synchronized, /IA[\s\S]*?Nao configurada/);
  assert.match(synchronized, /Automacoes[\s\S]*?Sem rotinas ativas/);
  assert.match(synchronized, /Prioridades editoriais[\s\S]*?Prioridade real/);
  assert.match(synchronized, /Oportunidades[\s\S]*?Oportunidade &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(synchronized, /Revisão de outcomes[\s\S]*?Atuais: 3[\s\S]*?Revisão disponível: 2/);
  assert.match(synchronized, /Saudáveis: 2[\s\S]*?Bloqueadas: 3[\s\S]*?Aprovações pendentes: 4/);
  assert.doesNotMatch(synchronized, /<script>alert\(1\)<\/script>/);
});
