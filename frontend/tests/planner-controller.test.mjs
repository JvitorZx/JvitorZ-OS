import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  toggle(name, force) {
    const names = new Set(this.element.className.split(/\s+/).filter(Boolean));
    if (force) names.add(name);
    else names.delete(name);
    this.element.className = [...names].join(' ');
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.selectorMap = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
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

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((current) => current !== listener));
  }

  dispatch(type, event = {}) {
    const payload = {
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...event,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(payload);
    return payload;
  }

  click() {
    if (!this.disabled) this.dispatch('click');
  }

  append(...elements) {
    this.children.push(...elements);
    this.scrollHeight = this.children.length;
  }

  replaceChildren(...elements) {
    this.children = elements;
    this.scrollHeight = this.children.length;
  }

  querySelector(selector) {
    return this.selectorMap.get(selector) ?? null;
  }

  querySelectorAll(selector) {
    return selector === '[data-conversation-id]'
      ? this.children.filter((child) => child.dataset.conversationId)
      : [];
  }

  closest(selector) {
    if (selector === '[data-conversation-id]' && this.dataset.conversationId) return this;
    return null;
  }

  focus() {}
}

globalThis.document = {
  createElement: (tagName) => new FakeElement(tagName),
};

const { createPlannerController, plannerModule } = await import('../src/modules/planner.js');

const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const conversation = (id, { context = null, messages = [] } = {}) => ({
  id,
  projectId: null,
  title: `Conversa ${id}`,
  context,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z',
  messages,
});

const message = (id, conversationId, text) => ({
  id,
  conversationId,
  sender: 'user',
  text,
  createdAt: '2026-08-21T12:00:00.000Z',
});

const createMemoryApi = (initialConversations = []) => {
  const records = new Map(initialConversations.map((item) => [item.id, clone(item)]));
  const calls = {
    createConversation: 0,
    getConversation: [],
    createMessage: 0,
    updateConversationContext: 0,
  };
  let nextConversation = records.size + 1;
  let nextMessage = 1;
  const failures = new Set();

  const api = {
    records,
    calls,
    failures,

    async createConversation() {
      calls.createConversation += 1;
      if (failures.delete('createConversation')) throw new TypeError('create failed');
      const created = conversation(`new-${nextConversation++}`);
      records.set(created.id, created);
      return clone(created);
    },

    async listConversations() {
      if (failures.delete('listConversations')) throw new TypeError('list failed');
      return [...records.values()].reverse().map(clone);
    },

    async getConversation(id) {
      calls.getConversation.push(id);
      if (failures.delete(`getConversation:${id}`)) throw new TypeError('get failed');
      const current = records.get(id);
      if (!current) throw new TypeError('not found');
      return clone(current);
    },

    async createMessage(id, input) {
      calls.createMessage += 1;
      if (failures.delete('createMessage')) throw new TypeError('message failed');
      const current = records.get(id);
      const created = message(`message-${nextMessage++}`, id, input.text);
      current.messages.push(created);
      return clone(created);
    },

    async updateConversationContext(id, contextValue) {
      calls.updateConversationContext += 1;
      if (failures.delete('updateConversationContext')) throw new TypeError('context failed');
      const current = records.get(id);
      current.context = contextValue.trim() || null;
      return clone(current);
    },
  };

  return api;
};

const createPlannerDom = () => {
  const root = new FakeElement('main');
  const panel = new FakeElement('section');
  const chatBody = new FakeElement('div');
  const sendBtn = new FakeElement('button');
  const textarea = new FakeElement('textarea');
  const promptBase = new FakeElement('div');
  const historyList = new FakeElement('div');
  const newConversationBtn = new FakeElement('button');
  const feedback = new FakeElement('div');
  const globalStatePanel = new FakeElement('section');
  feedback.hidden = true;
  globalStatePanel.textContent = 'Estado global preservado';
  globalStatePanel.hidden = false;

  root.selectorMap.set('.planner-panel', panel);
  root.selectorMap.set('#statePanel', globalStatePanel);
  panel.selectorMap.set('[data-chat-body]', chatBody);
  panel.selectorMap.set('.fixed-input-send', sendBtn);
  panel.selectorMap.set('.fixed-input-textarea', textarea);
  panel.selectorMap.set('[data-prompt-id="planner-prompt"]', promptBase);
  panel.selectorMap.set('[data-conversation-history]', historyList);
  panel.selectorMap.set('[data-new-conversation]', newConversationBtn);
  panel.selectorMap.set('[data-planner-feedback]', feedback);

  return {
    root,
    panel,
    chatBody,
    sendBtn,
    textarea,
    promptBase,
    historyList,
    newConversationBtn,
    feedback,
    globalStatePanel,
  };
};

const mount = async (api) => {
  const controller = createPlannerController({ api });
  const dom = createPlannerDom();
  controller.mount(dom.root);
  await flush();
  return { controller, dom };
};

const selectConversation = async (dom, id) => {
  const item = dom.historyList.children.find((child) => child.dataset.conversationId === id);
  assert.ok(item, `conversation ${id} should be in history`);
  dom.historyList.dispatch('click', { target: item });
  await flush();
};

const withoutConsoleError = async (callback) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = original;
  }
};

test('initializes the Planner with persisted history, messages and context', async () => {
  const persisted = conversation('A', {
    context: 'Contexto A',
    messages: [message('M1', 'A', 'Mensagem A')],
  });
  const api = createMemoryApi([persisted]);
  const { dom } = await mount(api);

  assert.equal(dom.historyList.children.length, 1);
  assert.equal(dom.promptBase.textContent, 'Contexto A');
  assert.equal(dom.chatBody.children.length, 1);
  assert.equal(dom.chatBody.children[0].dataset.id, 'M1');
});

test('automatically creates one conversation when history is empty', async () => {
  const api = createMemoryApi();
  const { dom } = await mount(api);

  assert.equal(api.calls.createConversation, 1);
  assert.equal(api.records.size, 1);
  assert.equal(dom.historyList.children.length, 1);
});

test('creates a new conversation once and makes it active', async () => {
  const api = createMemoryApi([conversation('A')]);
  const { dom } = await mount(api);

  dom.newConversationBtn.click();
  dom.newConversationBtn.click();
  await flush();

  assert.equal(api.calls.createConversation, 1);
  assert.equal(api.records.size, 2);
  const active = dom.historyList.children.find((item) => item.className.includes('active'));
  assert.match(active.dataset.conversationId, /^new-/);
  assert.equal(dom.chatBody.children.length, 0);
});

test('switches conversations without mixing messages', async () => {
  const api = createMemoryApi([
    conversation('B', { messages: [message('MB', 'B', 'Mensagem B')] }),
    conversation('A', { messages: [message('MA', 'A', 'Mensagem A')] }),
  ]);
  const { dom } = await mount(api);

  assert.equal(dom.chatBody.children[0].dataset.id, 'MA');
  await selectConversation(dom, 'B');
  assert.equal(dom.chatBody.children.length, 1);
  assert.equal(dom.chatBody.children[0].dataset.id, 'MB');
});

test('sends each message once and keeps one listener per action', async () => {
  const api = createMemoryApi([conversation('A')]);
  const controller = createPlannerController({ api });
  const dom = createPlannerDom();
  controller.mount(dom.root);
  controller.mount(dom.root);
  await flush();

  dom.textarea.value = 'Mensagem única';
  dom.sendBtn.click();
  await flush();

  assert.equal(api.calls.createMessage, 1);
  assert.equal(dom.chatBody.children.length, 1);
  assert.equal(dom.sendBtn.listeners.get('click').length, 1);
  assert.equal(dom.newConversationBtn.listeners.get('click').length, 1);
  assert.equal(dom.historyList.listeners.get('click').length, 1);
  assert.equal(dom.textarea.listeners.get('keydown').length, 1);
  assert.equal(dom.promptBase.listeners.get('blur').length, 1);
});

test('Shift+Enter adds a line while Enter sends', async () => {
  const api = createMemoryApi([conversation('A')]);
  const { dom } = await mount(api);

  dom.textarea.value = 'Linha um';
  const shiftEnter = dom.textarea.dispatch('keydown', { key: 'Enter', shiftKey: true });
  await flush();
  assert.equal(shiftEnter.defaultPrevented, false);
  assert.equal(api.calls.createMessage, 0);

  const enter = dom.textarea.dispatch('keydown', { key: 'Enter', shiftKey: false });
  await flush();
  assert.equal(enter.defaultPrevented, true);
  assert.equal(api.calls.createMessage, 1);
});

test('keeps context independent for each conversation', async () => {
  const api = createMemoryApi([
    conversation('B', { context: 'Contexto B' }),
    conversation('A', { context: 'Contexto A' }),
  ]);
  const { dom } = await mount(api);

  dom.promptBase.textContent = 'Contexto A atualizado';
  dom.promptBase.dispatch('blur');
  await flush();
  await selectConversation(dom, 'B');
  assert.equal(dom.promptBase.textContent, 'Contexto B');
  await selectConversation(dom, 'A');
  assert.equal(dom.promptBase.textContent, 'Contexto A atualizado');
  assert.equal(api.records.get('B').context, 'Contexto B');
});

test('does not show false state after API errors and clears feedback after retry', async () => {
  await withoutConsoleError(async () => {
    const api = createMemoryApi([conversation('A', { context: 'Contexto original' })]);
    const { dom } = await mount(api);

    api.failures.add('createMessage');
    dom.textarea.value = 'Mensagem não persistida';
    dom.sendBtn.click();
    await flush();
    assert.equal(dom.chatBody.children.length, 0);
    assert.equal(dom.textarea.value, 'Mensagem não persistida');
    assert.match(dom.feedback.textContent, /enviar a mensagem/);
    assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
    assert.equal(dom.globalStatePanel.hidden, false);

    dom.sendBtn.click();
    await flush();
    assert.equal(dom.chatBody.children.length, 1);
    assert.equal(dom.feedback.hidden, true);

    api.failures.add('updateConversationContext');
    dom.promptBase.textContent = 'Contexto não persistido';
    dom.promptBase.dispatch('blur');
    await flush();
    assert.equal(dom.promptBase.textContent, 'Contexto original');
    assert.equal(dom.promptBase.getAttribute('aria-invalid'), 'true');
    assert.match(dom.feedback.textContent, /salvar o contexto/);
  });
});

test('Planner exposes an accessible local feedback channel without statePanel', () => {
  const markup = plannerModule.render();

  assert.match(markup, /data-planner-feedback/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.doesNotMatch(markup, /statePanel/);
});

test('ignores stale conversation responses resolved out of order', async () => {
  const lateA = deferred();
  const fastB = deferred();
  const api = createMemoryApi([conversation('B'), conversation('A'), conversation('current')]);
  api.getConversation = (id) => {
    if (id === 'A') return lateA.promise;
    if (id === 'B') return fastB.promise;
    return Promise.resolve(clone(api.records.get(id)));
  };
  const { dom } = await mount(api);

  dom.historyList.dispatch('click', {
    target: dom.historyList.children.find((item) => item.dataset.conversationId === 'A'),
  });
  dom.historyList.dispatch('click', {
    target: dom.historyList.children.find((item) => item.dataset.conversationId === 'B'),
  });
  fastB.resolve(conversation('B', {
    context: 'Contexto B',
    messages: [message('MB', 'B', 'Mensagem B')],
  }));
  await flush();
  lateA.resolve(conversation('A', {
    context: 'Contexto A',
    messages: [message('MA', 'A', 'Mensagem A')],
  }));
  await flush();

  assert.equal(dom.promptBase.textContent, 'Contexto B');
  assert.equal(dom.chatBody.children[0].dataset.id, 'MB');
});

test('ignores a stale context response after switching conversations', async () => {
  const contextUpdate = deferred();
  const api = createMemoryApi([
    conversation('B', { context: 'Contexto B' }),
    conversation('A', { context: 'Contexto A' }),
  ]);
  api.updateConversationContext = () => contextUpdate.promise;
  const { dom } = await mount(api);

  dom.promptBase.textContent = 'Contexto A atrasado';
  dom.promptBase.dispatch('blur');
  await selectConversation(dom, 'B');
  contextUpdate.resolve(conversation('A', { context: 'Contexto A atrasado' }));
  await flush();

  assert.equal(dom.promptBase.textContent, 'Contexto B');
  assert.equal(dom.feedback.hidden, true);
});

test('ignores initialization, creation and message responses from old mounts', async () => {
  const list = deferred();
  const api = createMemoryApi();
  api.listConversations = () => list.promise;
  const controller = createPlannerController({ api });
  const firstDom = createPlannerDom();
  controller.mount(firstDom.root);
  controller.unmount();
  list.resolve([conversation('A')]);
  await flush();
  assert.equal(firstDom.historyList.children.length, 0);

  const create = deferred();
  api.listConversations = async () => [conversation('A')];
  api.getConversation = async () => conversation('A');
  api.createConversation = () => create.promise;
  const secondDom = createPlannerDom();
  controller.mount(secondDom.root);
  await flush();
  secondDom.newConversationBtn.click();
  controller.unmount();
  create.resolve(conversation('late-new'));
  await flush();
  assert.equal(secondDom.historyList.children.length, 1);

  const send = deferred();
  api.createMessage = () => send.promise;
  const thirdDom = createPlannerDom();
  controller.mount(thirdDom.root);
  await flush();
  thirdDom.textarea.value = 'Mensagem tardia';
  thirdDom.sendBtn.click();
  controller.unmount();

  api.listConversations = async () => [conversation('B', { context: 'Contexto B' })];
  api.getConversation = async () => conversation('B', { context: 'Contexto B' });
  const currentDom = createPlannerDom();
  controller.mount(currentDom.root);
  await flush();

  send.resolve(message('late-message', 'A', 'Mensagem tardia'));
  await flush();
  assert.equal(thirdDom.chatBody.children.length, 0);
  assert.equal(currentDom.chatBody.children.length, 0);
  assert.equal(currentDom.promptBase.textContent, 'Contexto B');
});

test('preserves persisted Planner state and unique listeners after leaving and returning', async () => {
  const persisted = conversation('A', {
    context: 'Contexto persistido',
    messages: [message('M1', 'A', 'Mensagem persistida')],
  });
  const api = createMemoryApi([persisted]);
  const controller = createPlannerController({ api });
  const firstDom = createPlannerDom();

  controller.mount(firstDom.root);
  await flush();
  controller.unmount();

  assert.equal(firstDom.sendBtn.listeners.get('click').length, 0);
  assert.equal(firstDom.newConversationBtn.listeners.get('click').length, 0);
  assert.equal(firstDom.historyList.listeners.get('click').length, 0);
  assert.equal(firstDom.textarea.listeners.get('keydown').length, 0);
  assert.equal(firstDom.promptBase.listeners.get('blur').length, 0);

  const secondDom = createPlannerDom();
  controller.mount(secondDom.root);
  controller.mount(secondDom.root);
  await flush();

  assert.equal(secondDom.historyList.children.length, 1);
  assert.equal(secondDom.promptBase.textContent, 'Contexto persistido');
  assert.equal(secondDom.chatBody.children.length, 1);
  assert.equal(secondDom.chatBody.children[0].dataset.id, 'M1');
  assert.equal(secondDom.sendBtn.listeners.get('click').length, 1);
  assert.equal(secondDom.newConversationBtn.listeners.get('click').length, 1);
  assert.equal(secondDom.historyList.listeners.get('click').length, 1);
  assert.equal(secondDom.textarea.listeners.get('keydown').length, 1);
  assert.equal(secondDom.promptBase.listeners.get('blur').length, 1);

  secondDom.textarea.value = 'Mensagem depois da volta';
  secondDom.sendBtn.click();
  await flush();

  assert.equal(api.calls.createMessage, 1);
  assert.equal(secondDom.chatBody.children.length, 2);
  assert.equal(firstDom.chatBody.children.length, 1);
});
