import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDashboard } from '../src/dashboard.js';
import { dashboardModules } from '../src/modules/index.js';
import { operatorsModule } from '../src/modules/operators.js';
import { supervisorModule } from '../src/modules/supervisor.js';
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
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
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

    this.elements = new Map([
      ['.workspace', workspace],
      ['#statePanel', statePanel],
      ['#moduleHost', moduleHost],
      ['#refreshButton', refreshButton],
    ]);

    this.navLinks = [...this._innerHTML.matchAll(/href="#([^"]+)" data-module-link="([^"]+)"/g)]
      .map((match) => {
        const link = new FakeElement('a');
        link.className = 'nav-link';
        link.dataset.moduleLink = match[2];
        link.href = `#${match[1]}`;
        link.click = () => {
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

  createDashboard({
    root,
    apiBaseUrl: 'http://localhost:3000',
    api,
    modules,
  });
  await flush();

  const navLink = (id) => root.navLinks.find((link) => link.dataset.moduleLink === id);
  const activeLink = () => root.navLinks.find((link) => link.classList.contains('active'));

  return { fakeWindow, root, navLink, activeLink };
};

test('sidebar navigation changes hash, activates the module and keeps one hash listener', async () => {
  const harness = await createHarness();

  harness.navLink('operators').click();
  harness.navLink('operators').click();

  assert.equal(harness.fakeWindow.location.hash, '#operators');
  assert.equal(harness.activeLink().dataset.moduleLink, 'operators');
  assert.equal(harness.root.querySelector('#operators').scrollCount, 1);
  assert.equal(harness.fakeWindow.listenerCount('hashchange'), 1);
  assert.equal(harness.root.querySelector('#refreshButton').listenerCount('click'), 1);
});

test('a valid initial hash opens the same module again after a dashboard reload', async () => {
  const firstLoad = await createHarness({ hash: '#content-planner' });
  assert.equal(firstLoad.activeLink().dataset.moduleLink, 'content-planner');
  assert.equal(firstLoad.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), true);

  const reloaded = await createHarness({ hash: firstLoad.fakeWindow.location.hash });
  assert.equal(reloaded.activeLink().dataset.moduleLink, 'content-planner');
  assert.ok(reloaded.root.querySelector('#content-planner'));
  assert.equal(reloaded.root.querySelector('.workspace').classList.contains('workspace-fullscreen'), true);
});

test('an invalid hash is normalized to Channel without a hashchange loop', async () => {
  const harness = await createHarness({ hash: '#module-that-does-not-exist' });

  assert.equal(harness.fakeWindow.location.hash, '#channel');
  assert.equal(harness.fakeWindow.hashChangeCount, 1);
  assert.equal(harness.activeLink().dataset.moduleLink, 'channel');
  assert.equal(harness.root.querySelector('#channel').scrollCount, 1);
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
  assert.equal(harness.fakeWindow.location.hash, '#analytics');
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

  assert.equal(harness.fakeWindow.location.hash, '#channel');
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

const renderOperatorsCatalog = () => operatorsModule.render({}, { modules: dashboardModules });

const navigateFromCatalog = (markup, operatorId, fakeWindow) => {
  const links = [...markup.matchAll(/<a[\s\S]*?href="#([^"]+)"[\s\S]*?data-operator="([^"]+)"[\s\S]*?<\/a>/g)];
  const link = links.find((match) => match[2] === operatorId);
  if (link) fakeWindow.location.hash = `#${link[1]}`;
};

test('available Operators catalog items only link to registered modules', () => {
  const markup = renderOperatorsCatalog();
  const linkedOperators = [...markup.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*data-operator="([^"]+)"[^>]*>/g)]
    .map((match) => ({ href: match[1], id: match[2] }));
  const moduleIds = new Set(dashboardModules.map((module) => module.id));

  assert.deepEqual(linkedOperators, [
    { href: 'manager', id: 'manager' },
    { href: 'content-planner', id: 'content-planner' },
  ]);
  assert.ok(linkedOperators.every((operator) => moduleIds.has(operator.href)));
  assert.match(markup, /data-operator="content-planner"[\s\S]*?data-operator-available="true"/);
});

test('unavailable Operators remain visible with non-interactive status', () => {
  const markup = renderOperatorsCatalog();

  assert.match(markup, /<div[\s\S]*?data-operator="youtube-monitor"[\s\S]*?aria-disabled="true"[\s\S]*?Em breve[\s\S]*?<\/div>/);
  assert.match(markup, /<div[\s\S]*?data-operator="automation-runner"[\s\S]*?aria-disabled="true"[\s\S]*?Planejado[\s\S]*?<\/div>/);
  assert.doesNotMatch(markup, /href="#youtube-monitor"/);
  assert.doesNotMatch(markup, /href="#automation-runner"/);
  assert.deepEqual(
    operatorRegistry.map((operator) => operator.id),
    ['manager', 'content-planner', 'youtube-monitor', 'automation-runner'],
  );
});

test('unavailable Operators do not change the current hash', () => {
  const markup = renderOperatorsCatalog();
  const fakeWindow = new FakeWindow('#operators');

  navigateFromCatalog(markup, 'youtube-monitor', fakeWindow);
  assert.equal(fakeWindow.location.hash, '#operators');

  navigateFromCatalog(markup, 'automation-runner', fakeWindow);
  assert.equal(fakeWindow.location.hash, '#operators');

  navigateFromCatalog(markup, 'content-planner', fakeWindow);
  assert.equal(fakeWindow.location.hash, '#content-planner');
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
  assert.match(statePanel.innerHTML, /dashboard unavailable/);
  assert.match(harness.root.innerHTML, /data-state-scope="global"/);
  assert.match(harness.root.innerHTML, /aria-live="polite"/);
  assert.equal(harness.activeLink().dataset.moduleLink, 'channel');
  assert.ok(harness.root.querySelector('#channel'));
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
  assert.equal(harness.fakeWindow.location.hash, '#supervisor');
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
  const globalMessage = statePanel.innerHTML;

  assert.equal(statePanel.className, 'state-panel warning');
  assert.match(globalMessage, /Google OAuth/);

  harness.navLink('content-planner').click();
  harness.navLink('channel').click();

  assert.equal(statePanel.hidden, false);
  assert.equal(statePanel.className, 'state-panel warning');
  assert.equal(statePanel.innerHTML, globalMessage);
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
    },
  });
  const unauthorized = supervisorModule.render({
    status: { youtubeConnected: false, aiEnabled: false, automationsEnabled: false },
    supervisor: { youtubeAnalytics: { state: 'not_authorized' } },
  });

  assert.match(synchronized, /YouTube Analytics[\s\S]*?Sincronizado/);
  assert.match(unauthorized, /YouTube Analytics[\s\S]*?Autorizacao necessaria/);
  assert.match(synchronized, /IA[\s\S]*?Nao configurada/);
  assert.match(synchronized, /Automacoes[\s\S]*?Nao implementadas/);
  assert.match(synchronized, /Prioridades editoriais[\s\S]*?Prioridade real/);
  assert.match(synchronized, /Oportunidades[\s\S]*?Oportunidade &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(synchronized, /Revisão de outcomes[\s\S]*?Atuais: 3[\s\S]*?Revisão disponível: 2/);
  assert.doesNotMatch(synchronized, /<script>alert\(1\)<\/script>/);
});
