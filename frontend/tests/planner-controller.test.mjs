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
    for (const element of elements) element.parentElement = this;
    this.children.push(...elements);
    this.scrollHeight = this.children.length;
  }

  replaceChildren(...elements) {
    for (const element of elements) element.parentElement = this;
    this.children = elements;
    this.scrollHeight = this.children.length;
  }

  querySelector(selector) {
    const direct = this.selectorMap.get(selector);
    if (direct) return direct;
    const datasetMatch = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
    const datasetKey = datasetMatch?.[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    for (const child of this.children) {
      if (datasetKey && child.dataset[datasetKey] === datasetMatch[2]) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-conversation-id]') {
      return this.children.filter((child) => child.dataset.conversationId);
    }
    if (selector === '[data-library-item-id]') {
      return this.children.filter((child) => child.dataset.libraryItemId);
    }
    return [];
  }

  closest(selector) {
    if (selector === '[data-conversation-id]' && this.dataset.conversationId) return this;
    if (selector === '[data-save-to-library]' && this.dataset.saveToLibrary) return this;
    if (selector === '[data-library-item-id]' && this.dataset.libraryItemId) return this;
    if (selector === '[data-unlink-memory-item]' && this.dataset.unlinkMemoryItem) return this;
    if (selector === '[data-link-decision-video]' && this.dataset.linkDecisionVideo) return this;
    if (selector === '[data-evaluate-decision]' && this.dataset.evaluateDecision) return this;
    if (selector === 'details' && this.tagName === 'DETAILS') return this;
    return this.parentElement?.closest?.(selector) ?? null;
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

const message = (id, conversationId, text, sender = 'user') => ({
  id,
  conversationId,
  sender,
  text,
  createdAt: '2026-08-21T12:00:00.000Z',
});

const libraryItem = (
  id,
  title = `Artefato ${id}`,
  content = `Conteúdo ${id}`,
  sourceMessageId = null,
) => ({
  id,
  projectId: null,
  sourceMessageId,
  title,
  type: 'resource',
  content,
  createdAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:00:00.000Z',
});

const createMemoryApi = (
  initialConversations = [],
  initialLibraryItems = [],
  initialActiveMemory = {},
  initialEditorialDecisions = {},
  initialPerformanceRecords = [],
  initialDecisionLinks = {},
) => {
  const records = new Map(initialConversations.map((item) => [item.id, clone(item)]));
  const libraryRecords = initialLibraryItems.map(clone);
  const calls = {
    createConversation: 0,
    getConversation: [],
    createMessage: 0,
    generatePlannerReply: 0,
    saveMessageToLibrary: [],
    listLibraryItems: 0,
    getLibraryItem: [],
    updateConversationContext: 0,
    linkLibraryItemToConversation: [],
    listConversationLibraryItems: [],
    unlinkLibraryItemFromConversation: [],
    listEditorialDecisions: [],
    listPerformanceRecords: 0,
    listEditorialDecisionVideos: [],
    linkEditorialDecisionVideo: [],
    evaluateEditorialDecisionOutcome: [],
  };
  let nextConversation = records.size + 1;
  let nextMessage = 1;
  let nextReply = 1;
  let nextLibraryItem = libraryRecords.length + 1;
  const failures = new Set();
  const activeMemory = new Map(
    Object.entries(initialActiveMemory).map(([conversationId, ids]) => [conversationId, [...ids]]),
  );
  const editorialDecisionRecords = new Map(
    Object.entries(initialEditorialDecisions).map(([conversationId, items]) => [conversationId, items.map(clone)]),
  );
  const decisionLinkRecords = new Map(
    Object.entries(initialDecisionLinks).map(([decisionId, items]) => [decisionId, items.map(clone)]),
  );

  const api = {
    records,
    libraryRecords,
    calls,
    failures,
    replyFailureStatus: null,
    libraryFailureStatus: null,
    libraryItemFailureStatus: null,
    activeMemoryFailureStatus: null,
    nextEditorialDecision: null,

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

    async generatePlannerReply(id) {
      calls.generatePlannerReply += 1;
      if (failures.delete('generatePlannerReply')) throw new TypeError('reply failed');
      if (api.replyFailureStatus) {
        const error = new Error('safe API error');
        error.status = api.replyFailureStatus;
        throw error;
      }
      const current = records.get(id);
      const created = message(`reply-${nextReply}`, id, `Resposta ${nextReply}`, 'operator');
      if (api.nextEditorialDecision) {
        created.editorialDecision = clone(api.nextEditorialDecision);
        const currentDecisions = editorialDecisionRecords.get(id) ?? [];
        editorialDecisionRecords.set(id, [clone(api.nextEditorialDecision), ...currentDecisions]);
      }
      nextReply += 1;
      current.messages.push(created);
      return clone(created);
    },

    async listEditorialDecisions({ conversationId }) {
      calls.listEditorialDecisions.push(conversationId);
      return (editorialDecisionRecords.get(conversationId) ?? []).map(clone);
    },

    async listPerformanceRecords() {
      calls.listPerformanceRecords += 1;
      return initialPerformanceRecords.map(clone);
    },

    async listEditorialDecisionVideos(decisionId) {
      calls.listEditorialDecisionVideos.push(decisionId);
      return (decisionLinkRecords.get(decisionId) ?? []).map(clone);
    },

    async linkEditorialDecisionVideo(decisionId, input) {
      calls.linkEditorialDecisionVideo.push([decisionId, clone(input)]);
      const record = initialPerformanceRecords.find((item) => item.id === input.snapshotId);
      const existing = (decisionLinkRecords.get(decisionId) ?? [])
        .find((item) => item.videoId === record?.videoId);
      if (existing) return clone(existing);
      const created = {
        id: `link-${decisionId}-${input.snapshotId}`,
        decisionId,
        sourceSnapshotId: input.snapshotId,
        videoId: record?.videoId ?? input.snapshotId,
        status: 'evaluable',
        sourceSnapshot: clone(record ?? { id: input.snapshotId, title: input.snapshotId }),
      };
      decisionLinkRecords.set(decisionId, [...(decisionLinkRecords.get(decisionId) ?? []), created]);
      return clone(created);
    },

    async evaluateEditorialDecisionOutcome(decisionId, linkId) {
      calls.evaluateEditorialDecisionOutcome.push([decisionId, linkId]);
      const recordsForDecision = decisionLinkRecords.get(decisionId) ?? [];
      const link = recordsForDecision.find((item) => item.id === linkId);
      if (link) link.status = 'evaluated';
      return { id: `outcome-${linkId}`, classification: 'POSITIVE' };
    },

    async saveMessageToLibrary(...args) {
      calls.saveMessageToLibrary.push(args);
      if (api.libraryFailureStatus) {
        const error = new Error('safe API error');
        error.status = api.libraryFailureStatus;
        throw error;
      }

      const [conversationId, messageId] = args;
      const existing = libraryRecords.find((item) => item.sourceMessageId === messageId);
      if (existing) return clone(existing);

      const source = records.get(conversationId)?.messages.find((item) => item.id === messageId);
      const created = libraryItem(
        `library-${nextLibraryItem++}`,
        `Resposta ${conversationId}`,
        source?.text,
        messageId,
      );
      libraryRecords.unshift(created);
      return clone(created);
    },

    async listLibraryItems() {
      calls.listLibraryItems += 1;
      if (failures.delete('listLibraryItems')) throw new TypeError('library list failed');
      return libraryRecords.map(clone);
    },

    async getLibraryItem(id) {
      calls.getLibraryItem.push(id);
      if (api.libraryItemFailureStatus) {
        const error = new Error('safe API error');
        error.status = api.libraryItemFailureStatus;
        throw error;
      }
      const item = libraryRecords.find((current) => current.id === id);
      if (!item) {
        const error = new Error('not found');
        error.status = 404;
        throw error;
      }
      return clone(item);
    },

    async linkLibraryItemToConversation(conversationId, libraryItemId) {
      calls.linkLibraryItemToConversation.push([conversationId, libraryItemId]);
      if (api.activeMemoryFailureStatus) {
        const error = new Error('safe active memory error');
        error.status = api.activeMemoryFailureStatus;
        throw error;
      }
      const ids = activeMemory.get(conversationId) ?? [];
      if (!ids.includes(libraryItemId)) ids.push(libraryItemId);
      activeMemory.set(conversationId, ids);
      return clone(libraryRecords.find((item) => item.id === libraryItemId));
    },

    async listConversationLibraryItems(conversationId) {
      calls.listConversationLibraryItems.push(conversationId);
      if (failures.delete(`listConversationLibraryItems:${conversationId}`)) {
        throw new TypeError('active memory list failed');
      }
      return (activeMemory.get(conversationId) ?? [])
        .map((id) => libraryRecords.find((item) => item.id === id))
        .filter(Boolean)
        .map(clone);
    },

    async unlinkLibraryItemFromConversation(conversationId, libraryItemId) {
      calls.unlinkLibraryItemFromConversation.push([conversationId, libraryItemId]);
      if (api.activeMemoryFailureStatus) {
        const error = new Error('safe active memory error');
        error.status = api.activeMemoryFailureStatus;
        throw error;
      }
      activeMemory.set(
        conversationId,
        (activeMemory.get(conversationId) ?? []).filter((id) => id !== libraryItemId),
      );
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
  const libraryList = new FakeElement('div');
  const libraryReader = new FakeElement('article');
  const libraryItemTitle = new FakeElement('h5');
  const libraryItemContent = new FakeElement('div');
  const libraryMemoryToggle = new FakeElement('button');
  const activeMemoryList = new FakeElement('div');
  const editorialDecisionList = new FakeElement('div');
  const feedback = new FakeElement('div');
  const globalStatePanel = new FakeElement('section');
  feedback.hidden = true;
  libraryReader.hidden = true;
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
  panel.selectorMap.set('[data-library-list]', libraryList);
  panel.selectorMap.set('[data-library-reader]', libraryReader);
  panel.selectorMap.set('[data-library-item-title]', libraryItemTitle);
  panel.selectorMap.set('[data-library-item-content]', libraryItemContent);
  panel.selectorMap.set('[data-library-memory-toggle]', libraryMemoryToggle);
  panel.selectorMap.set('[data-active-memory-list]', activeMemoryList);
  panel.selectorMap.set('[data-editorial-decisions]', editorialDecisionList);
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
    libraryList,
    libraryReader,
    libraryItemTitle,
    libraryItemContent,
    libraryMemoryToggle,
    activeMemoryList,
    editorialDecisionList,
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

const getLibraryAction = (chatMessage) =>
  chatMessage?.children[0]?.children
    .find((child) => child.className === 'chat-message-actions')
    ?.children[0] ?? null;

const clickLibraryAction = (dom, button) => {
  dom.chatBody.dispatch('click', { target: button });
};

const getLibraryListItem = (dom, id) =>
  dom.libraryList.children.find((item) => item.dataset.libraryItemId === id) ?? null;

const clickLibraryListItem = (dom, id) => {
  const item = getLibraryListItem(dom, id);
  assert.ok(item, `library item ${id} should be listed`);
  dom.libraryList.dispatch('click', { target: item });
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
  assert.equal(api.calls.generatePlannerReply, 1);
  assert.equal(dom.chatBody.children.length, 2);
  assert.equal(dom.sendBtn.listeners.get('click').length, 1);
  assert.equal(dom.chatBody.listeners.get('click').length, 1);
  assert.equal(dom.libraryList.listeners.get('click').length, 1);
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
  assert.equal(api.calls.generatePlannerReply, 1);
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
    assert.equal(dom.chatBody.children.length, 2);
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
  assert.equal(firstDom.chatBody.listeners.get('click').length, 0);
  assert.equal(firstDom.libraryList.listeners.get('click').length, 0);
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
  assert.equal(secondDom.chatBody.listeners.get('click').length, 1);
  assert.equal(secondDom.libraryList.listeners.get('click').length, 1);
  assert.equal(secondDom.newConversationBtn.listeners.get('click').length, 1);
  assert.equal(secondDom.historyList.listeners.get('click').length, 1);
  assert.equal(secondDom.textarea.listeners.get('keydown').length, 1);
  assert.equal(secondDom.promptBase.listeners.get('blur').length, 1);

  secondDom.textarea.value = 'Mensagem depois da volta';
  secondDom.sendBtn.click();
  await flush();

  assert.equal(api.calls.createMessage, 1);
  assert.equal(api.calls.generatePlannerReply, 1);
  assert.equal(secondDom.chatBody.children.length, 3);
  assert.equal(firstDom.chatBody.children.length, 1);
});

test('persists user before requesting and rendering one operator reply', async () => {
  const reply = deferred();
  const api = createMemoryApi([conversation('A')]);
  const sequence = [];
  const originalCreateMessage = api.createMessage;
  api.createMessage = async (...args) => {
    sequence.push('persist-user');
    return originalCreateMessage(...args);
  };
  api.generatePlannerReply = async (id) => {
    api.calls.generatePlannerReply += 1;
    sequence.push('request-reply');
    assert.equal(api.records.get(id).messages.at(-1).sender, 'user');
    return reply.promise;
  };
  const { dom } = await mount(api);

  dom.textarea.value = 'Mensagem para IA';
  dom.sendBtn.click();
  await flush();

  assert.deepEqual(sequence, ['persist-user', 'request-reply']);
  assert.equal(dom.chatBody.children.length, 1);
  assert.equal(dom.chatBody.children[0].dataset.id, 'message-1');
  assert.equal(dom.chatBody.getAttribute('aria-busy'), 'true');
  assert.equal(dom.sendBtn.disabled, true);
  assert.equal(dom.newConversationBtn.disabled, false);

  const operator = message('operator-1', 'A', 'Resposta persistida', 'operator');
  api.records.get('A').messages.push(operator);
  reply.resolve(clone(operator));
  await flush();

  assert.equal(api.calls.generatePlannerReply, 1);
  assert.deepEqual(dom.chatBody.children.map(({ dataset }) => dataset.id), [
    'message-1',
    'operator-1',
  ]);
  assert.equal(dom.chatBody.getAttribute('aria-busy'), 'false');
});

test('keeps the persisted user message and local feedback when reply generation fails', async (t) => {
  await withoutConsoleError(async () => {
    for (const scenario of [
      { status: 503, expected: 'A IA não está configurada no momento.' },
      { status: 502, expected: 'Não foi possível gerar a resposta. Tente novamente.' },
      { status: 500, expected: 'Não foi possível obter a resposta da IA. Tente novamente.' },
    ]) {
      await t.test(`status ${scenario.status}`, async () => {
        const api = createMemoryApi([conversation('A')]);
        api.replyFailureStatus = scenario.status;
        const { dom } = await mount(api);

        dom.textarea.value = `Mensagem ${scenario.status}`;
        dom.sendBtn.click();
        await flush();

        assert.equal(api.records.get('A').messages.length, 1);
        assert.equal(api.records.get('A').messages[0].sender, 'user');
        assert.equal(dom.chatBody.children.length, 1);
        assert.equal(dom.feedback.textContent, scenario.expected);
        assert.equal(dom.feedback.hidden, false);
        assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
        assert.equal(dom.globalStatePanel.hidden, false);
      });
    }
  });
});

test('ignores a late reply after switching conversations and reloads it when returning', async () => {
  const lateReply = deferred();
  const api = createMemoryApi([conversation('B'), conversation('A')]);
  api.generatePlannerReply = async () => {
    api.calls.generatePlannerReply += 1;
    return lateReply.promise;
  };
  const { dom } = await mount(api);

  dom.textarea.value = 'Mensagem A';
  dom.sendBtn.click();
  await flush();
  await selectConversation(dom, 'B');

  const persistedReply = message('reply-A', 'A', 'Resposta tardia A', 'operator');
  api.records.get('A').messages.push(persistedReply);
  lateReply.resolve(clone(persistedReply));
  await flush();

  assert.equal(dom.chatBody.children.length, 0);
  await selectConversation(dom, 'A');
  assert.deepEqual(dom.chatBody.children.map(({ dataset }) => dataset.id), [
    'message-1',
    'reply-A',
  ]);
});

test('ignores a late reply after creating a new active conversation', async () => {
  const lateReply = deferred();
  const api = createMemoryApi([conversation('A')]);
  api.generatePlannerReply = () => lateReply.promise;
  const { dom } = await mount(api);

  dom.textarea.value = 'Mensagem A';
  dom.sendBtn.click();
  await flush();
  dom.newConversationBtn.click();
  await flush();

  const active = dom.historyList.children.find((item) => item.className.includes('active'));
  assert.notEqual(active.dataset.conversationId, 'A');

  const persistedReply = message('reply-A', 'A', 'Resposta tardia A', 'operator');
  api.records.get('A').messages.push(persistedReply);
  lateReply.resolve(clone(persistedReply));
  await flush();

  assert.equal(dom.chatBody.children.length, 0);
});

test('ignores a late reply after unmount without changing the detached DOM', async () => {
  const lateReply = deferred();
  const api = createMemoryApi([conversation('A')]);
  api.generatePlannerReply = () => lateReply.promise;
  const controller = createPlannerController({ api });
  const dom = createPlannerDom();
  controller.mount(dom.root);
  await flush();

  dom.textarea.value = 'Mensagem antes do unmount';
  dom.sendBtn.click();
  await flush();
  controller.unmount();

  const persistedReply = message('reply-after-unmount', 'A', 'Resposta tardia', 'operator');
  api.records.get('A').messages.push(persistedReply);
  lateReply.resolve(clone(persistedReply));
  await flush();

  assert.deepEqual(dom.chatBody.children.map(({ dataset }) => dataset.id), ['message-1']);
  assert.equal(dom.feedback.hidden, true);
});

test('blocks repeated send triggers while persistence and generation are pending', async () => {
  const pendingUser = deferred();
  const api = createMemoryApi([conversation('A')]);
  api.createMessage = async () => {
    api.calls.createMessage += 1;
    return pendingUser.promise;
  };
  const { dom } = await mount(api);

  dom.textarea.value = 'Mensagem única';
  dom.sendBtn.click();
  dom.sendBtn.dispatch('click');
  dom.textarea.dispatch('keydown', { key: 'Enter', shiftKey: false });
  await flush();

  assert.equal(api.calls.createMessage, 1);
  assert.equal(api.calls.generatePlannerReply, 0);

  const persistedUser = message('persisted-user', 'A', 'Mensagem única');
  api.records.get('A').messages.push(persistedUser);
  pendingUser.resolve(clone(persistedUser));
  await flush();

  assert.equal(api.calls.createMessage, 1);
  assert.equal(api.calls.generatePlannerReply, 1);
  assert.equal(dom.chatBody.children.length, 2);
});

test('shows the library action only for persisted operator messages', async (t) => {
  for (const scenario of [
    { sender: 'operator', expected: true },
    { sender: 'user', expected: false },
    { sender: 'system', expected: false },
  ]) {
    await t.test(scenario.sender, async () => {
      const persisted = message(`${scenario.sender}-1`, 'A', 'Conteudo seguro', scenario.sender);
      const api = createMemoryApi([conversation('A', { messages: [persisted] })]);
      const { dom } = await mount(api);

      assert.equal(Boolean(getLibraryAction(dom.chatBody.children[0])), scenario.expected);
    });
  }
});

test('saves an operator message with ids only and marks it after persistence', async () => {
  const persisted = message('operator-1', 'A', 'Resposta persistida', 'operator');
  const api = createMemoryApi([conversation('A', { messages: [persisted] })]);
  const { dom } = await mount(api);
  const button = getLibraryAction(dom.chatBody.children[0]);

  clickLibraryAction(dom, button);
  await flush();

  assert.equal(api.calls.saveMessageToLibrary.length, 1);
  assert.deepEqual(api.calls.saveMessageToLibrary[0], ['A', 'operator-1']);
  assert.equal(button.textContent, 'Salvo na Biblioteca');
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'false');
  assert.equal(dom.chatBody.children[0].children[0].children[0].textContent, 'Resposta persistida');
  assert.equal(dom.feedback.hidden, true);
});

test('blocks repeated library clicks while the request is pending', async () => {
  const save = deferred();
  const persisted = message('operator-1', 'A', 'Resposta persistida', 'operator');
  const api = createMemoryApi([conversation('A', { messages: [persisted] })]);
  api.saveMessageToLibrary = (...args) => {
    api.calls.saveMessageToLibrary.push(args);
    return save.promise;
  };
  const { dom } = await mount(api);
  const button = getLibraryAction(dom.chatBody.children[0]);

  clickLibraryAction(dom, button);
  clickLibraryAction(dom, button);
  await flush();

  assert.equal(api.calls.saveMessageToLibrary.length, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');

  save.resolve({ id: 'library-1' });
  await flush();

  assert.equal(button.textContent, 'Salvo na Biblioteca');
  assert.equal(button.getAttribute('aria-busy'), 'false');
});

test('maps library save failures to local safe feedback without false success', async (t) => {
  await withoutConsoleError(async () => {
    for (const scenario of [
      { status: 404, expected: 'Não foi possível localizar a resposta para salvar.' },
      { status: 409, expected: 'Esta resposta não pertence à conversa atual.' },
      { status: 422, expected: 'Apenas respostas do operador podem ser salvas.' },
      { status: 500, expected: 'Não foi possível salvar na Biblioteca. Tente novamente.' },
    ]) {
      await t.test(`status ${scenario.status}`, async () => {
        const persisted = message('operator-1', 'A', 'Resposta persistida', 'operator');
        const api = createMemoryApi([conversation('A', { messages: [persisted] })]);
        api.libraryFailureStatus = scenario.status;
        const { dom } = await mount(api);
        const button = getLibraryAction(dom.chatBody.children[0]);

        clickLibraryAction(dom, button);
        await flush();

        assert.equal(button.textContent, 'Salvar na Biblioteca');
        assert.equal(button.disabled, false);
        assert.equal(button.getAttribute('aria-busy'), 'false');
        assert.equal(dom.feedback.textContent, scenario.expected);
        assert.equal(dom.feedback.hidden, false);
        assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
        assert.equal(dom.globalStatePanel.hidden, false);
      });
    }
  });
});

test('clears its own library feedback after a successful retry', async () => {
  await withoutConsoleError(async () => {
    const persisted = message('operator-1', 'A', 'Resposta persistida', 'operator');
    const api = createMemoryApi([conversation('A', { messages: [persisted] })]);
    api.libraryFailureStatus = 500;
    const { dom } = await mount(api);
    const button = getLibraryAction(dom.chatBody.children[0]);

    clickLibraryAction(dom, button);
    await flush();
    assert.equal(dom.feedback.hidden, false);

    api.libraryFailureStatus = null;
    clickLibraryAction(dom, button);
    await flush();

    assert.equal(button.textContent, 'Salvo na Biblioteca');
    assert.equal(dom.feedback.hidden, true);
  });
});

test('ignores a late library save response after switching conversations', async () => {
  const save = deferred();
  const operatorA = message('operator-A', 'A', 'Resposta A', 'operator');
  const api = createMemoryApi([
    conversation('B'),
    conversation('A', { messages: [operatorA] }),
  ]);
  api.saveMessageToLibrary = (...args) => {
    api.calls.saveMessageToLibrary.push(args);
    return save.promise;
  };
  const { dom } = await mount(api);
  const oldButton = getLibraryAction(dom.chatBody.children[0]);

  clickLibraryAction(dom, oldButton);
  await selectConversation(dom, 'B');
  save.resolve({ id: 'library-A' });
  await flush();

  assert.equal(dom.chatBody.children.length, 0);
  assert.equal(dom.feedback.hidden, true);
  assert.equal(oldButton.textContent, 'Salvando...');
  assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
});

test('ignores a late library save response after unmount and removes its listener', async () => {
  const save = deferred();
  const operator = message('operator-1', 'A', 'Resposta', 'operator');
  const api = createMemoryApi([conversation('A', { messages: [operator] })]);
  api.saveMessageToLibrary = (...args) => {
    api.calls.saveMessageToLibrary.push(args);
    return save.promise;
  };
  const controller = createPlannerController({ api });
  const dom = createPlannerDom();
  controller.mount(dom.root);
  await flush();
  const button = getLibraryAction(dom.chatBody.children[0]);

  clickLibraryAction(dom, button);
  controller.unmount();
  save.resolve({ id: 'library-1' });
  await flush();

  assert.equal(button.textContent, 'Salvando...');
  assert.equal(dom.feedback.hidden, true);
  assert.equal(dom.chatBody.listeners.get('click').length, 0);
});

test('loads the real library on mount and renders an empty state', async () => {
  const api = createMemoryApi([conversation('A')]);
  const { dom } = await mount(api);

  assert.equal(api.calls.listLibraryItems, 1);
  assert.equal(dom.libraryList.children.length, 1);
  assert.equal(dom.libraryList.children[0].className, 'planner-library-empty');
  assert.equal(dom.libraryList.children[0].textContent, 'Biblioteca vazia.');
  assert.equal(dom.libraryReader.hidden, true);
});

test('renders persisted library items in the backend order', async () => {
  const items = [
    libraryItem('L3', 'Terceiro'),
    libraryItem('L2', 'Segundo'),
    libraryItem('L1', 'Primeiro'),
  ];
  const api = createMemoryApi([conversation('A')], items);
  const { dom } = await mount(api);

  assert.deepEqual(
    dom.libraryList.children.map(({ dataset }) => dataset.libraryItemId),
    ['L3', 'L2', 'L1'],
  );
  assert.deepEqual(
    dom.libraryList.children.map((item) => item.children[0].textContent),
    ['Terceiro', 'Segundo', 'Primeiro'],
  );
});

test('refreshes the real library once after saving an operator message', async () => {
  const operator = message('operator-1', 'A', 'Resposta para Biblioteca', 'operator');
  const api = createMemoryApi([conversation('A', { messages: [operator] })]);
  const { dom } = await mount(api);
  const saveButton = getLibraryAction(dom.chatBody.children[0]);

  assert.equal(api.calls.listLibraryItems, 1);
  clickLibraryAction(dom, saveButton);
  await flush();

  assert.equal(api.calls.saveMessageToLibrary.length, 1);
  assert.equal(api.calls.listLibraryItems, 2);
  assert.equal(dom.libraryList.children.length, 1);
  assert.equal(dom.libraryList.children[0].dataset.libraryItemId, 'library-1');
  assert.equal(dom.libraryList.children[0].children[0].textContent, 'Resposta A');
});

test('opens persisted library content as literal text', async () => {
  const unsafeContent = '<img src=x onerror=alert(1)><script>alert(1)</script><b>teste</b>';
  const item = libraryItem('L1', 'Conteúdo seguro', unsafeContent);
  const api = createMemoryApi([conversation('A')], [item]);
  const { dom } = await mount(api);

  clickLibraryListItem(dom, 'L1');
  await flush();

  assert.deepEqual(api.calls.getLibraryItem, ['L1']);
  assert.equal(dom.libraryReader.hidden, false);
  assert.equal(dom.libraryItemTitle.textContent, 'Conteúdo seguro');
  assert.equal(dom.libraryItemContent.textContent, unsafeContent);
  assert.equal(dom.libraryItemContent.children.length, 0);
  assert.equal(getLibraryListItem(dom, 'L1').getAttribute('aria-current'), 'true');
});

test('keeps the newest library selection when responses resolve out of order', async () => {
  const lateA = deferred();
  const fastB = deferred();
  const itemA = libraryItem('LA', 'Artefato A', 'Conteúdo A');
  const itemB = libraryItem('LB', 'Artefato B', 'Conteúdo B');
  const api = createMemoryApi([conversation('A')], [itemA, itemB]);
  api.getLibraryItem = (id) => {
    api.calls.getLibraryItem.push(id);
    return id === 'LA' ? lateA.promise : fastB.promise;
  };
  const { dom } = await mount(api);

  clickLibraryListItem(dom, 'LA');
  clickLibraryListItem(dom, 'LB');
  fastB.resolve(clone(itemB));
  await flush();
  lateA.resolve(clone(itemA));
  await flush();

  assert.deepEqual(api.calls.getLibraryItem, ['LA', 'LB']);
  assert.equal(dom.libraryItemTitle.textContent, 'Artefato B');
  assert.equal(dom.libraryItemContent.textContent, 'Conteúdo B');
  assert.equal(getLibraryListItem(dom, 'LB').getAttribute('aria-current'), 'true');
});

test('reports a missing library item locally without creating false content', async () => {
  await withoutConsoleError(async () => {
    const api = createMemoryApi([conversation('A')], [libraryItem('L1')]);
    api.libraryItemFailureStatus = 404;
    const { dom } = await mount(api);

    clickLibraryListItem(dom, 'L1');
    await flush();

    assert.equal(dom.libraryReader.hidden, true);
    assert.equal(dom.libraryItemContent.textContent, '');
    assert.equal(dom.feedback.textContent, 'Este item não está mais disponível.');
    assert.equal(dom.feedback.hidden, false);
    assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
    assert.equal(dom.globalStatePanel.hidden, false);
  });
});

test('keeps the library unrendered when its initial listing fails', async () => {
  await withoutConsoleError(async () => {
    const api = createMemoryApi([conversation('A')]);
    api.failures.add('listLibraryItems');
    const { dom } = await mount(api);

    assert.equal(api.calls.listLibraryItems, 1);
    assert.equal(dom.libraryList.children.length, 0);
    assert.equal(dom.feedback.textContent, 'Não foi possível carregar a Biblioteca. Tente novamente.');
    assert.equal(dom.feedback.hidden, false);
    assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
  });
});

test('ignores a late library opening after changing conversations', async () => {
  const opening = deferred();
  const item = libraryItem('L1', 'Artefato tardio', 'Conteúdo tardio');
  const api = createMemoryApi([conversation('B'), conversation('A')], [item]);
  api.getLibraryItem = (id) => {
    api.calls.getLibraryItem.push(id);
    return opening.promise;
  };
  const { dom } = await mount(api);

  clickLibraryListItem(dom, 'L1');
  await selectConversation(dom, 'B');
  opening.resolve(clone(item));
  await flush();

  assert.equal(dom.libraryReader.hidden, true);
  assert.equal(dom.libraryItemContent.textContent, '');
  assert.equal(dom.feedback.hidden, true);
});

test('ignores a late library list after unmount', async () => {
  const listing = deferred();
  const api = createMemoryApi([conversation('A')]);
  api.listLibraryItems = () => {
    api.calls.listLibraryItems += 1;
    return listing.promise;
  };
  const controller = createPlannerController({ api });
  const dom = createPlannerDom();
  controller.mount(dom.root);
  await flush();

  assert.equal(api.calls.listLibraryItems, 1);
  controller.unmount();
  listing.resolve([libraryItem('late')]);
  await flush();

  assert.equal(dom.libraryList.children.length, 0);
  assert.equal(dom.feedback.hidden, true);
  assert.equal(dom.libraryList.listeners.get('click').length, 0);
});

test('reloads the library once on remount without duplicate items or listeners', async () => {
  const api = createMemoryApi([conversation('A')], [libraryItem('L1')]);
  const controller = createPlannerController({ api });
  const firstDom = createPlannerDom();
  controller.mount(firstDom.root);
  await flush();
  controller.unmount();

  const secondDom = createPlannerDom();
  controller.mount(secondDom.root);
  controller.mount(secondDom.root);
  await flush();

  assert.equal(api.calls.listLibraryItems, 2);
  assert.equal(secondDom.libraryList.children.length, 1);
  assert.equal(secondDom.libraryList.children[0].dataset.libraryItemId, 'L1');
  assert.equal(secondDom.libraryList.listeners.get('click').length, 1);
});

test('a new controller treats an already saved message as success without duplicating it', async () => {
  const operator = message('operator-1', 'A', 'Resposta persistida', 'operator');
  const api = createMemoryApi([conversation('A', { messages: [operator] })]);

  const firstController = createPlannerController({ api });
  const firstDom = createPlannerDom();
  firstController.mount(firstDom.root);
  await flush();
  clickLibraryAction(firstDom, getLibraryAction(firstDom.chatBody.children[0]));
  await flush();
  firstController.unmount();

  const reloadedController = createPlannerController({ api });
  const reloadedDom = createPlannerDom();
  reloadedController.mount(reloadedDom.root);
  await flush();
  const retryButton = getLibraryAction(reloadedDom.chatBody.children[0]);
  clickLibraryAction(reloadedDom, retryButton);
  await flush();

  assert.equal(api.calls.saveMessageToLibrary.length, 2);
  assert.equal(api.libraryRecords.length, 1);
  assert.equal(retryButton.textContent, 'Salvo na Biblioteca');
  assert.equal(reloadedDom.feedback.hidden, true);
  assert.equal(reloadedDom.libraryList.children.length, 1);
});

test('loads active memory for the selected conversation', async () => {
  const item = libraryItem('L1');
  const api = createMemoryApi([conversation('A')], [item], { A: ['L1'] });
  const { dom } = await mount(api);

  assert.deepEqual(api.calls.listConversationLibraryItems, ['A']);
  assert.equal(dom.activeMemoryList.children.length, 1);
  assert.equal(dom.activeMemoryList.children[0].children[0].textContent, item.title);
  assert.equal(getLibraryListItem(dom, 'L1').dataset.memoryActive, 'true');
});

test('links an opened Library item to the active conversation after API success', async () => {
  const item = libraryItem('L1');
  const api = createMemoryApi([conversation('A')], [item]);
  const { dom } = await mount(api);
  clickLibraryListItem(dom, 'L1');
  await flush();

  assert.equal(dom.libraryMemoryToggle.textContent, 'Usar nesta conversa');
  dom.libraryMemoryToggle.click();
  await flush();

  assert.deepEqual(api.calls.linkLibraryItemToConversation, [['A', 'L1']]);
  assert.equal(dom.libraryMemoryToggle.textContent, 'Remover da memória ativa');
  assert.equal(dom.activeMemoryList.children.length, 1);
});

test('removes an active artifact without deleting the Library item', async () => {
  const item = libraryItem('L1');
  const api = createMemoryApi([conversation('A')], [item], { A: ['L1'] });
  const { dom } = await mount(api);
  const removeButton = dom.activeMemoryList.children[0].children[1];

  dom.activeMemoryList.dispatch('click', { target: removeButton });
  await flush();

  assert.deepEqual(api.calls.unlinkLibraryItemFromConversation, [['A', 'L1']]);
  assert.equal(dom.activeMemoryList.children[0].className, 'planner-memory-empty');
  assert.equal(api.libraryRecords.length, 1);
});

test('keeps active memories isolated while switching conversations', async () => {
  const first = libraryItem('L1');
  const second = libraryItem('L2');
  const api = createMemoryApi(
    [conversation('B'), conversation('A')],
    [first, second],
    { A: ['L1'], B: ['L2'] },
  );
  const { dom } = await mount(api);

  assert.equal(dom.activeMemoryList.children[0].children[0].textContent, first.title);
  await selectConversation(dom, 'B');
  assert.equal(dom.activeMemoryList.children[0].children[0].textContent, second.title);
});

test('ignores a late active-memory response after switching conversations', async () => {
  const late = deferred();
  const first = libraryItem('L1');
  const second = libraryItem('L2');
  const api = createMemoryApi([conversation('B'), conversation('A')], [first, second], { B: ['L2'] });
  const original = api.listConversationLibraryItems;
  api.listConversationLibraryItems = async (conversationId) => {
    if (conversationId === 'A') return late.promise;
    return original(conversationId);
  };
  const { dom } = await mount(api);
  await selectConversation(dom, 'B');
  late.resolve([first]);
  await flush();

  assert.equal(dom.activeMemoryList.children[0].children[0].textContent, second.title);
});

test('reports active-memory limit errors locally without false state', async () => {
  const item = libraryItem('L1');
  const api = createMemoryApi([conversation('A')], [item]);
  api.activeMemoryFailureStatus = 422;
  const { dom } = await mount(api);
  clickLibraryListItem(dom, 'L1');
  await flush();
  await withoutConsoleError(async () => {
    dom.libraryMemoryToggle.click();
    await flush();
  });

  assert.equal(dom.feedback.textContent, 'A conversa já atingiu o limite de memória ativa.');
  assert.equal(dom.activeMemoryList.children[0].className, 'planner-memory-empty');
  assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
});

test('renders persisted editorial intelligence inline and in conversation memory', async () => {
  const decision = {
    id: 'decision-1',
    recommendation: '<b>Teste a ideia A</b>',
    confidence: 0.78,
    evidence: [{ classification: 'fact', summary: '<img src=x onerror=alert(1)>' }],
    risks: ['Amostra pequena'],
    missingData: ['CTR'],
    nextAction: 'Criar uma pauta controlada.',
  };
  const api = createMemoryApi([conversation('A')]);
  api.nextEditorialDecision = decision;
  const { dom } = await mount(api);
  dom.textarea.value = 'O que vale gravar agora?';
  dom.sendBtn.click();
  await flush();
  await flush();

  assert.equal(api.calls.generatePlannerReply, 1);
  const operator = dom.chatBody.children.at(-1);
  const inline = operator.children[0].children.find((child) => child.className === 'planner-decision-inline');
  assert.ok(inline);
  assert.equal(inline.children[1].textContent, '<b>Teste a ideia A</b>');
  const evidenceItem = inline.children.find((child) => child.tagName === 'UL')?.children[0];
  assert.equal(evidenceItem.textContent, 'Fato: <img src=x onerror=alert(1)>');
  assert.equal(dom.editorialDecisionList.children.length, 1);
  assert.equal(dom.editorialDecisionList.children[0].dataset.editorialDecisionId, 'decision-1');
  assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
});

test('ignores a late editorial decision list after switching conversations', async () => {
  const api = createMemoryApi([conversation('B'), conversation('A')]);
  const lateA = deferred();
  api.listEditorialDecisions = ({ conversationId }) => (
    conversationId === 'A' ? lateA.promise : Promise.resolve([])
  );
  const { dom } = await mount(api);
  await selectConversation(dom, 'B');
  lateA.resolve([{
    id: 'decision-a', recommendation: 'A', confidence: 1,
    evidence: [], risks: [], missingData: [], nextAction: 'A',
  }]);
  await flush();
  assert.equal(dom.editorialDecisionList.children.length, 1);
  assert.equal(dom.editorialDecisionList.children[0].textContent, 'Nenhuma decisão editorial nesta conversa.');
});

test('renders decision publication status and links a persisted performance snapshot once', async () => {
  const decision = {
    id: 'decision-1', recommendation: 'Publicar teste controlado.', confidence: 0.8,
    evidence: [], risks: [], missingData: [], nextAction: 'Publicar.',
  };
  const snapshot = { id: 'snapshot-1', videoId: 'video-1', title: 'Video publicado' };
  const api = createMemoryApi([conversation('A')], [], {}, { A: [decision] }, [snapshot]);
  const pending = deferred();
  let calls = 0;
  api.linkEditorialDecisionVideo = async (decisionId, input) => {
    calls += 1;
    api.calls.linkEditorialDecisionVideo.push([decisionId, clone(input)]);
    return pending.promise;
  };
  const { dom } = await mount(api);
  const details = dom.editorialDecisionList.children[0];
  const status = details.children.find((child) => child.className === 'planner-decision-status');
  const controls = details.children.find((child) => child.className === 'planner-decision-controls');
  controls.children[0].value = 'snapshot-1';
  const button = controls.children[1];
  assert.equal(status.textContent, 'Aguardando publicação');

  dom.editorialDecisionList.dispatch('click', { target: button });
  dom.editorialDecisionList.dispatch('click', { target: button });
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(api.calls.linkEditorialDecisionVideo[0], [
    'decision-1',
    { snapshotId: 'snapshot-1', origin: 'manual' },
  ]);
  assert.equal(button.disabled, true);
  pending.resolve({ id: 'link-1' });
  await flush();
  assert.equal(button.disabled, false);
});

test('evaluates an eligible linked video once and refreshes its persisted status', async () => {
  const decision = {
    id: 'decision-1', recommendation: 'Testar serie.', confidence: 0.7,
    evidence: [], risks: [], missingData: [], nextAction: 'Comparar resultado.',
  };
  const link = {
    id: 'link-1', decisionId: 'decision-1', videoId: 'video-1', status: 'evaluable',
    sourceSnapshot: { id: 'snapshot-1', videoId: 'video-1', title: 'Teste publicado' },
  };
  const api = createMemoryApi(
    [conversation('A')], [], {}, { A: [decision] }, [link.sourceSnapshot], { 'decision-1': [link] },
  );
  const { dom } = await mount(api);
  const details = dom.editorialDecisionList.children[0];
  const linked = details.children.find((child) => child.className === 'planner-decision-linked-video');
  const button = linked.children[1];
  assert.equal(details.children.find((child) => child.className === 'planner-decision-status').textContent, 'Avaliável');
  dom.editorialDecisionList.dispatch('click', { target: button });
  dom.editorialDecisionList.dispatch('click', { target: button });
  await flush();
  assert.deepEqual(api.calls.evaluateEditorialDecisionOutcome, [['decision-1', 'link-1']]);
  const refreshed = dom.editorialDecisionList.children[0];
  assert.equal(refreshed.children.find((child) => child.className === 'planner-decision-status').textContent, 'Avaliada');
});

test('ignores a late outcome evaluation after switching conversations', async () => {
  const decision = {
    id: 'decision-A', recommendation: 'Decisão A', confidence: 0.7,
    evidence: [], risks: [], missingData: [], nextAction: 'Avaliar.',
  };
  const link = {
    id: 'link-A', decisionId: decision.id, videoId: 'video-A', status: 'evaluable',
    sourceSnapshot: { id: 'snapshot-A', videoId: 'video-A', title: 'Video A' },
  };
  const api = createMemoryApi(
    [conversation('B'), conversation('A')], [], {}, { A: [decision], B: [] },
    [link.sourceSnapshot], { 'decision-A': [link] },
  );
  const pending = deferred();
  api.evaluateEditorialDecisionOutcome = async (...args) => {
    api.calls.evaluateEditorialDecisionOutcome.push(args);
    return pending.promise;
  };
  const { dom } = await mount(api);
  const details = dom.editorialDecisionList.children[0];
  const button = details.children.find((child) => child.className === 'planner-decision-linked-video').children[1];
  dom.editorialDecisionList.dispatch('click', { target: button });
  await selectConversation(dom, 'B');
  pending.resolve({ id: 'outcome-A' });
  await flush();
  assert.equal(dom.editorialDecisionList.children[0].textContent, 'Nenhuma decisão editorial nesta conversa.');
  assert.equal(dom.feedback.textContent, '');
  assert.equal(dom.globalStatePanel.textContent, 'Estado global preservado');
});
