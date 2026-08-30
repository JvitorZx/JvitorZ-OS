import { createPanel, html, createChatMessageElement, createSidebarSection, createFixedInput, createOperatorHeader, createChatArea, createSidebar, createWorkspaceLayout } from '../design-system/index.js';
import { integrationFrom, operationalStatus } from '../utils/operational-status.js';

export const plannerModule = {
  id: 'content-planner',
  route: '/planner',
  aliases: ['planner'],
  pageTitle: 'Planejador de Conteúdo',
  pageEyebrow: 'Operador inteligente',
  fullscreen: true,
  label: 'Planejador de Conteúdo',
  createController(context) {
    return createPlannerController(context);
  },
  render(data = {}) {
    const ai = operationalStatus(integrationFrom(data, 'openai')?.state);
    const header = createOperatorHeader({ title: 'Planejador de Conteúdo', subtitle: 'Organize ideias, pautas e próximas publicações.', status: ai.label });
    const chat = createChatArea();
    const sidebarHtml = createSidebar({ sections: [
      {
        title: 'Biblioteca',
        body: html`
          <div class="planner-library-list" data-library-list></div>
          <article class="planner-library-reader" data-library-reader hidden>
            <h5 data-library-item-title></h5>
            <div class="planner-library-content" data-library-item-content></div>
            <button
              class="planner-memory-toggle"
              type="button"
              data-library-memory-toggle
              hidden
            ></button>
          </article>
        `,
      },
      {
        title: 'Memória ativa',
        body: html`<div class="planner-active-memory-list" data-active-memory-list></div>`,
      },
      {
        title: 'Decisões editoriais',
        body: html`<div class="planner-editorial-decisions" data-editorial-decisions></div>`,
      },
      {
        title: 'Histórico',
        body: html`
          <button class="planner-new-conversation" type="button" data-new-conversation>Nova Conversa</button>
          <div class="planner-history-list" data-conversation-history></div>
        `,
      },
    ]});

    const promptSection = html`<section class="sidebar-section"><h4>Prompt Base</h4><div class="sidebar-body"><div class="prompt-base" data-prompt-id="planner-prompt" contenteditable="true">Escreva seu prompt base aqui...</div></div></section>`;

    return createPanel({
      eyebrow: 'Operador',
      title: 'Planejador de Conteúdo',
      className: 'planner-panel',
      body: html`
        <div
          class="planner-feedback"
          data-planner-feedback
          role="status"
          aria-live="polite"
          aria-atomic="true"
          hidden
        ></div>
        ${createWorkspaceLayout({ header, chat, sidebar: sidebarHtml + promptSection })}
      `,
    });
  },
};

const getSafeErrorName = (error) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : 'UnknownError';

const getSafeErrorStatus = (error) =>
  Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : null;

export const createPlannerController = ({ api }) => {
  let activeConversationId = null;
  let conversations = [];
  const persistedContexts = new Map();
  const savedLibraryMessages = new Set();
  let conversationCreationPromise = null;
  let mountGeneration = 0;
  let mountedPanel = null;
  let removeMountedListeners = null;

  const createConversationOnce = async () => {
    if (!conversationCreationPromise) {
      conversationCreationPromise = api
        .createConversation()
        .finally(() => {
          conversationCreationPromise = null;
        });
    }

    return conversationCreationPromise;
  };

  const unmount = () => {
    if (!mountedPanel) return;

    removeMountedListeners?.();
    removeMountedListeners = null;
    mountedPanel = null;
    mountGeneration += 1;
  };

  const mount = (root = document) => {
    const panel = root.querySelector('.planner-panel');
    if (!panel) return;

    if (panel === mountedPanel && panel.dataset.plannerInitialized === 'true') return;

    unmount();

    const mountToken = ++mountGeneration;
    mountedPanel = panel;

    const chatBody = panel.querySelector('[data-chat-body]');
    const sendBtn = panel.querySelector('.fixed-input-send');
    const textarea = panel.querySelector('.fixed-input-textarea');
    const promptBase = panel.querySelector('[data-prompt-id="planner-prompt"]');
    const historyList = panel.querySelector('[data-conversation-history]');
    const newConversationBtn = panel.querySelector('[data-new-conversation]');
    const libraryList = panel.querySelector('[data-library-list]');
    const libraryReader = panel.querySelector('[data-library-reader]');
    const libraryItemTitle = panel.querySelector('[data-library-item-title]');
    const libraryItemContent = panel.querySelector('[data-library-item-content]');
    const libraryMemoryToggle = panel.querySelector('[data-library-memory-toggle]');
    const activeMemoryList = panel.querySelector('[data-active-memory-list]');
    const editorialDecisionList = panel.querySelector('[data-editorial-decisions]');
    const feedback = panel.querySelector('[data-planner-feedback]');

    if (
      !chatBody
      || !sendBtn
      || !textarea
      || !promptBase
      || !historyList
      || !newConversationBtn
      || !libraryList
      || !libraryReader
      || !libraryItemTitle
      || !libraryItemContent
      || !libraryMemoryToggle
      || !activeMemoryList
      || !editorialDecisionList
      || !feedback
    ) return;

    panel.dataset.plannerInitialized = 'true';

    const isCurrentMount = () => mountedPanel === panel && mountGeneration === mountToken;
    const pendingLibrarySaves = new Set();
    let conversationViewGeneration = 0;
    let libraryFeedbackGeneration = 0;
    let libraryFeedbackMessage = '';
    let libraryItems = [];
    let libraryHasLoaded = false;
    let openedLibraryItemId = null;
    let pendingLibraryItemId = null;
    let libraryListGeneration = 0;
    let libraryOpenGeneration = 0;
    let activeMemoryItems = [];
    let activeMemoryGeneration = 0;
    let editorialDecisions = [];
    let editorialDecisionGeneration = 0;
    let performanceRecords = [];
    let decisionLinks = new Map();
    const pendingDecisionActions = new Set();
    const pendingMemoryItems = new Set();

    const setFeedback = (message = '') => {
      if (!isCurrentMount()) return;
      feedback.textContent = message;
      feedback.hidden = !message;
    };

    const clearLibraryFeedback = (feedbackToken) => {
      if (feedbackToken !== libraryFeedbackGeneration) return;
      if (libraryFeedbackMessage && feedback.textContent === libraryFeedbackMessage) {
        setFeedback();
      }
      libraryFeedbackMessage = '';
    };

    const showLibraryFeedback = (feedbackToken, message) => {
      if (feedbackToken !== libraryFeedbackGeneration) return;
      libraryFeedbackMessage = message;
      setFeedback(message);
    };

    const renderLibraryList = () => {
      if (!libraryHasLoaded) {
        libraryList.replaceChildren();
        return;
      }

      if (libraryItems.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'planner-library-empty';
        empty.textContent = 'Biblioteca vazia.';
        libraryList.replaceChildren(empty);
        return;
      }

      const elements = libraryItems.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'planner-library-item';
        button.dataset.libraryItemId = item.id;
        button.setAttribute('aria-current', item.id === openedLibraryItemId ? 'true' : 'false');
        button.setAttribute('aria-busy', item.id === pendingLibraryItemId ? 'true' : 'false');
        button.classList.toggle('active', item.id === openedLibraryItemId);
        button.dataset.memoryActive = String(
          activeMemoryItems.some((activeItem) => activeItem.id === item.id),
        );

        const title = document.createElement('span');
        title.className = 'planner-library-item-title';
        title.textContent = item.title?.trim() || 'Item da Biblioteca';

        const type = document.createElement('small');
        type.className = 'planner-library-item-type';
        type.textContent = item.type?.trim() || 'resource';

        button.append(title, type);
        return button;
      });

      libraryList.replaceChildren(...elements);
    };

    const updateMemoryToggle = () => {
      const itemId = openedLibraryItemId;
      if (!itemId) {
        libraryMemoryToggle.hidden = true;
        return;
      }

      const isActive = activeMemoryItems.some((item) => item.id === itemId);
      const isPending = pendingMemoryItems.has(itemId);
      libraryMemoryToggle.hidden = false;
      libraryMemoryToggle.disabled = isPending;
      libraryMemoryToggle.dataset.libraryItemId = itemId;
      libraryMemoryToggle.setAttribute('aria-busy', String(isPending));
      libraryMemoryToggle.textContent = isPending
        ? 'Atualizando...'
        : isActive
          ? 'Remover da memória ativa'
          : 'Usar nesta conversa';
    };

    const renderActiveMemory = () => {
      if (activeMemoryItems.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'planner-memory-empty';
        empty.textContent = 'Nenhum artefato ativo nesta conversa.';
        activeMemoryList.replaceChildren(empty);
        updateMemoryToggle();
        renderLibraryList();
        return;
      }

      const rows = activeMemoryItems.map((item) => {
        const row = document.createElement('div');
        row.className = 'planner-memory-item';

        const title = document.createElement('span');
        title.textContent = item.title?.trim() || 'Item da Biblioteca';

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.unlinkMemoryItem = item.id;
        remove.textContent = 'Remover';
        remove.disabled = pendingMemoryItems.has(item.id);
        remove.setAttribute('aria-busy', String(pendingMemoryItems.has(item.id)));

        row.append(title, remove);
        return row;
      });
      activeMemoryList.replaceChildren(...rows);
      updateMemoryToggle();
      renderLibraryList();
    };

    const loadActiveMemory = async (conversationId) => {
      const requestToken = ++activeMemoryGeneration;
      const viewToken = conversationViewGeneration;
      const isCurrentRequest = () =>
        isCurrentMount()
        && activeConversationId === conversationId
        && conversationViewGeneration === viewToken
        && requestToken === activeMemoryGeneration;

      try {
        const items = await api.listConversationLibraryItems(conversationId);
        if (!isCurrentRequest()) return;
        if (!Array.isArray(items)) throw new TypeError('Invalid active memory list');
        activeMemoryItems = items;
        renderActiveMemory();
      } catch (error) {
        if (!isCurrentRequest()) return;
        activeMemoryItems = [];
        renderActiveMemory();
        setFeedback('Não foi possível carregar a memória ativa.');
        console.error('Planner active memory loading failed', {
          error_name: getSafeErrorName(error),
          status: getSafeErrorStatus(error),
        });
      }
    };

    const loadLibraryItems = async () => {
      const requestToken = ++libraryListGeneration;
      const feedbackToken = ++libraryFeedbackGeneration;
      const isCurrentRequest = () =>
        isCurrentMount() && requestToken === libraryListGeneration;

      try {
        const items = await api.listLibraryItems();
        if (!isCurrentRequest()) return;
        if (!Array.isArray(items)) throw new TypeError('Invalid library list');

        libraryItems = items;
        libraryHasLoaded = true;
        renderLibraryList();
        clearLibraryFeedback(feedbackToken);
      } catch (error) {
        if (!isCurrentRequest()) return;

        showLibraryFeedback(
          feedbackToken,
          'Não foi possível carregar a Biblioteca. Tente novamente.',
        );
        console.error('Planner library listing failed', {
          error_name: getSafeErrorName(error),
          status: getSafeErrorStatus(error),
        });
      }
    };

    const openLibraryItem = async (id) => {
      if (!id || id === pendingLibraryItemId) return;

      const requestToken = ++libraryOpenGeneration;
      const viewToken = conversationViewGeneration;
      const feedbackToken = ++libraryFeedbackGeneration;
      const isCurrentRequest = () =>
        isCurrentMount()
        && requestToken === libraryOpenGeneration
        && conversationViewGeneration === viewToken;

      pendingLibraryItemId = id;
      renderLibraryList();

      try {
        const item = await api.getLibraryItem(id);
        if (!isCurrentRequest()) return;

        openedLibraryItemId = item.id;
        pendingLibraryItemId = null;
        libraryItemTitle.textContent = item.title?.trim() || 'Item da Biblioteca';
        libraryItemContent.textContent = typeof item.content === 'string' ? item.content : '';
        libraryReader.hidden = false;
        renderLibraryList();
        updateMemoryToggle();
        clearLibraryFeedback(feedbackToken);
      } catch (error) {
        if (!isCurrentRequest()) return;

        pendingLibraryItemId = null;
        renderLibraryList();
        const message = getSafeErrorStatus(error) === 404
          ? 'Este item não está mais disponível.'
          : 'Não foi possível carregar a Biblioteca. Tente novamente.';
        showLibraryFeedback(feedbackToken, message);
        console.error('Planner library item loading failed', {
          error_name: getSafeErrorName(error),
          status: getSafeErrorStatus(error),
        });
      }
    };

    const invalidatePendingLibraryItem = () => {
      libraryOpenGeneration += 1;
      pendingLibraryItemId = null;
      renderLibraryList();
    };

    const createEditorialDecisionElement = (decision, compact = false) => {
      const details = document.createElement('details');
      details.className = compact ? 'planner-decision-inline' : 'planner-decision-item';
      details.dataset.editorialDecisionId = decision.id ?? '';
      const summary = document.createElement('summary');
      const confidence = Number.isFinite(decision.confidence)
        ? `${Math.round(decision.confidence * 100)}%`
        : 'indisponível';
      const category = typeof decision.category === 'string' ? decision.category : 'RECOMMENDATION';
      const score = Number.isFinite(decision.score) ? ` · Score ${Math.round(decision.score)}/100` : '';
      summary.textContent = `Inteligência do canal · ${category}${score} · Confiança ${confidence}`;
      const recommendation = document.createElement('p');
      recommendation.className = 'planner-decision-recommendation';
      recommendation.textContent = decision.recommendation ?? 'Recomendação indisponível.';
      details.append(summary, recommendation);

      const evidenceLabels = {
        fact: 'Fato',
        inference: 'Inferência',
        recommendation: 'Recomendação',
      };
      const groups = [
        ['Evidências favoráveis', Array.isArray(decision.favorableEvidence)
          ? decision.favorableEvidence.map((item) => item?.summary).filter(Boolean) : []],
        ['Evidências contrárias', Array.isArray(decision.contraryEvidence)
          ? decision.contraryEvidence.map((item) => item?.summary).filter(Boolean) : []],
        ['Por que', Array.isArray(decision.evidence) ? decision.evidence.map((item) => {
          if (!item?.summary) return null;
          const label = evidenceLabels[item.classification] ?? 'Evidência';
          return `${label}: ${item.summary}`;
        }).filter(Boolean) : []],
        ['Riscos', Array.isArray(decision.risks) ? decision.risks : []],
        ['Restrições', Array.isArray(decision.constraints)
          ? decision.constraints.map((item) => typeof item === 'string' ? item : item?.summary).filter(Boolean) : []],
        ['Dados ausentes', Array.isArray(decision.missingData) ? decision.missingData : []],
      ];
      for (const [title, items] of groups) {
        if (items.length === 0) continue;
        const heading = document.createElement('strong');
        heading.textContent = title;
        const list = document.createElement('ul');
        list.append(...items.slice(0, compact ? 2 : 4).map((item) => {
          const row = document.createElement('li');
          row.textContent = String(item);
          return row;
        }));
        details.append(heading, list);
      }
      const action = document.createElement('p');
      action.className = 'planner-decision-action';
      action.textContent = `Próxima ação: ${decision.nextAction ?? 'não definida'}`;
      details.append(action);

      const links = decisionLinks.get(decision.id) ?? [];
      const reviewAvailable = links.some((link) => link.reviewState?.state === 'review_available');
      const status = links.length === 0
        ? 'Aguardando publicação'
        : reviewAvailable
          ? 'Revisão disponível'
        : links.some((link) => link.status === 'evaluated')
          ? 'Avaliada'
          : links.some((link) => link.status === 'evaluable')
            ? 'Avaliável'
            : 'Aguardando dados';
      const statusElement = document.createElement('small');
      statusElement.className = 'planner-decision-status';
      statusElement.textContent = status;
      if (reviewAvailable) {
        statusElement.title = 'Existem dados de performance mais novos; a avaliação anterior deve ser tratada como desatualizada.';
      }
      details.append(statusElement);
      if (compact) return details;

      const availableByVideo = new Map();
      for (const record of performanceRecords) {
        if (record?.videoId && !availableByVideo.has(record.videoId)) availableByVideo.set(record.videoId, record);
      }
      if (
        typeof api.linkEditorialDecisionVideo === 'function'
        && availableByVideo.size > 0
      ) {
        const controls = document.createElement('div');
        controls.className = 'planner-decision-controls';
        const select = document.createElement('select');
        select.dataset.decisionVideoSelect = decision.id;
        select.setAttribute('aria-label', 'Vídeo publicado');
        for (const record of availableByVideo.values()) {
          const option = document.createElement('option');
          option.value = record.id;
          option.textContent = record.title ?? record.videoId;
          select.append(option);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button planner-decision-button';
        button.dataset.linkDecisionVideo = decision.id;
        button.textContent = 'Associar vídeo';
        button.disabled = pendingDecisionActions.has(`link:${decision.id}`);
        controls.append(select, button);
        details.append(controls);
      } else if (links.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'performance-empty';
        hint.textContent = 'Sincronize um vídeo em Analytics para associá-lo a esta decisão.';
        details.append(hint);
      }

      for (const link of links) {
        const linked = document.createElement('div');
        linked.className = 'planner-decision-linked-video';
        const title = document.createElement('span');
        title.textContent = link.sourceSnapshot?.title ?? link.videoId;
        linked.append(title);
        if (link.status === 'evaluable' && typeof api.evaluateEditorialDecisionOutcome === 'function') {
          const evaluate = document.createElement('button');
          evaluate.type = 'button';
          evaluate.className = 'button planner-decision-button';
          evaluate.dataset.evaluateDecision = decision.id;
          evaluate.dataset.decisionLinkId = link.id;
          evaluate.textContent = 'Avaliar resultado';
          evaluate.disabled = pendingDecisionActions.has(`evaluate:${link.id}`);
          linked.append(evaluate);
        }
        details.append(linked);
      }
      return details;
    };

    const renderEditorialDecisions = () => {
      if (editorialDecisions.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'performance-empty';
        empty.textContent = 'Nenhuma decisão editorial nesta conversa.';
        editorialDecisionList.replaceChildren(empty);
        return;
      }
      editorialDecisionList.replaceChildren(
        ...editorialDecisions.slice(0, 5).map((decision) => createEditorialDecisionElement(decision)),
      );
    };

    const loadEditorialDecisions = async (conversationId) => {
      if (typeof api.listEditorialDecisions !== 'function') {
        editorialDecisions = [];
        renderEditorialDecisions();
        return;
      }
      const token = ++editorialDecisionGeneration;
      const viewToken = conversationViewGeneration;
      try {
        const [decisions, records] = await Promise.all([
          api.listEditorialDecisions({ conversationId, limit: 5 }),
          typeof api.listPerformanceRecords === 'function' ? api.listPerformanceRecords() : Promise.resolve([]),
        ]);
        if (
          !isCurrentMount()
          || token !== editorialDecisionGeneration
          || viewToken !== conversationViewGeneration
          || activeConversationId !== conversationId
        ) return;
        editorialDecisions = Array.isArray(decisions) ? decisions : [];
        performanceRecords = Array.isArray(records) ? records : [];
        const links = typeof api.listEditorialDecisionVideos === 'function'
          ? await Promise.all(editorialDecisions.map(async (decision) => [
            decision.id,
            await api.listEditorialDecisionVideos(decision.id),
          ]))
          : [];
        if (
          !isCurrentMount()
          || token !== editorialDecisionGeneration
          || viewToken !== conversationViewGeneration
          || activeConversationId !== conversationId
        ) return;
        decisionLinks = new Map(links);
        renderEditorialDecisions();
      } catch (error) {
        if (
          !isCurrentMount()
          || token !== editorialDecisionGeneration
          || activeConversationId !== conversationId
        ) return;
        editorialDecisions = [];
        performanceRecords = [];
        decisionLinks = new Map();
        renderEditorialDecisions();
        setFeedback('Não foi possível carregar as decisões editoriais.');
        console.error('Planner editorial decisions loading failed', {
          error_name: getSafeErrorName(error),
        });
      }
    };

    const handleEditorialDecisionClick = async (event) => {
      const linkButton = event.target?.closest?.('[data-link-decision-video]');
      const evaluateButton = event.target?.closest?.('[data-evaluate-decision]');
      if (!linkButton && !evaluateButton) return;
      const conversationId = activeConversationId;
      const viewToken = conversationViewGeneration;
      if (!conversationId) return;

      if (linkButton) {
        const decisionId = linkButton.dataset.linkDecisionVideo;
        const select = linkButton.closest('details')?.querySelector?.(`[data-decision-video-select="${decisionId}"]`);
        const snapshotId = select?.value;
        const key = `link:${decisionId}`;
        if (!decisionId || !snapshotId || pendingDecisionActions.has(key)) return;
        pendingDecisionActions.add(key);
        linkButton.disabled = true;
        linkButton.setAttribute('aria-busy', 'true');
        try {
          await api.linkEditorialDecisionVideo(decisionId, { snapshotId, origin: 'manual' });
          if (!isCurrentMount() || activeConversationId !== conversationId || viewToken !== conversationViewGeneration) return;
          await loadEditorialDecisions(conversationId);
          setFeedback();
        } catch (error) {
          if (isCurrentMount() && activeConversationId === conversationId && viewToken === conversationViewGeneration) {
            setFeedback(error?.status === 409
              ? 'Este vídeo não pertence ao mesmo projeto da decisão.'
              : 'Não foi possível associar o vídeo à decisão.');
          }
        } finally {
          pendingDecisionActions.delete(key);
          if (isCurrentMount()) {
            linkButton.disabled = false;
            linkButton.setAttribute('aria-busy', 'false');
          }
        }
        return;
      }

      const decisionId = evaluateButton.dataset.evaluateDecision;
      const linkId = evaluateButton.dataset.decisionLinkId;
      const key = `evaluate:${linkId}`;
      if (!decisionId || !linkId || pendingDecisionActions.has(key)) return;
      pendingDecisionActions.add(key);
      evaluateButton.disabled = true;
      evaluateButton.setAttribute('aria-busy', 'true');
      try {
        await api.evaluateEditorialDecisionOutcome(decisionId, linkId);
        if (!isCurrentMount() || activeConversationId !== conversationId || viewToken !== conversationViewGeneration) return;
        await loadEditorialDecisions(conversationId);
        setFeedback();
      } catch {
        if (isCurrentMount() && activeConversationId === conversationId && viewToken === conversationViewGeneration) {
          setFeedback('Não foi possível avaliar o resultado editorial.');
        }
      } finally {
        pendingDecisionActions.delete(key);
        if (isCurrentMount()) {
          evaluateButton.disabled = false;
          evaluateButton.setAttribute('aria-busy', 'false');
        }
      }
    };

    const appendMessage = (message) => {
      const createdAt = new Date(message.createdAt);
      const time = Number.isNaN(createdAt.getTime())
        ? ''
        : createdAt.toLocaleTimeString();
      const element = createChatMessageElement({
        id: message.id,
        who: message.sender === 'user' ? 'me' : 'them',
        text: message.text,
        time,
      });

      if (message.sender === 'operator' && message.id) {
        const libraryKey = `${activeConversationId}:${message.id}`;
        const isSaved = savedLibraryMessages.has(libraryKey);
        const actions = document.createElement('div');
        actions.className = 'chat-message-actions';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'chat-message-library-action';
        saveButton.dataset.saveToLibrary = 'true';
        saveButton.dataset.messageId = message.id;
        saveButton.textContent = isSaved ? 'Salvo na Biblioteca' : 'Salvar na Biblioteca';
        saveButton.disabled = isSaved;
        saveButton.setAttribute('aria-busy', 'false');

        actions.append(saveButton);
        element.children[0]?.append(actions);
      }

      if (message.sender === 'operator' && message.editorialDecision) {
        element.children[0]?.append(createEditorialDecisionElement(message.editorialDecision, true));
      }

      chatBody.append(element);
      chatBody.scrollTop = chatBody.scrollHeight;
    };

    const renderMessages = (messages) => {
      chatBody.replaceChildren();
      messages.forEach(appendMessage);
    };

    const renderPrompt = (context) => {
      promptBase.textContent = context ?? '';
      promptBase.setAttribute('aria-invalid', 'false');
    };

    const renderHistory = () => {
      const items = conversations.map((conversation) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'planner-history-item';
        button.dataset.conversationId = conversation.id;
        button.textContent = conversation.title?.trim() || 'Nova conversa';

        const isActive = conversation.id === activeConversationId;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-current', isActive ? 'true' : 'false');
        return button;
      });

      historyList.replaceChildren(...items);
    };

    const applyConversation = (conversation) => {
      const context = conversation.context ?? '';
      persistedContexts.set(conversation.id, context);
      conversationViewGeneration += 1;
      invalidatePendingLibraryItem();
      activeConversationId = conversation.id;
      openedLibraryItemId = null;
      libraryReader.hidden = true;
      activeMemoryItems = [];
      editorialDecisions = [];
      renderActiveMemory();
      renderEditorialDecisions();
      renderMessages(conversation.messages ?? []);
      renderPrompt(context);
      renderHistory();
      loadActiveMemory(conversation.id);
      loadEditorialDecisions(conversation.id);
    };

    const setBusy = ({ inputBusy, navigationBusy, generating }) => {
      sendBtn.disabled = inputBusy;
      textarea.disabled = inputBusy;
      newConversationBtn.disabled = navigationBusy;
      sendBtn.setAttribute('aria-busy', String(inputBusy));
      newConversationBtn.setAttribute('aria-busy', String(navigationBusy));
      chatBody.setAttribute('aria-busy', String(generating));
      historyList.querySelectorAll('[data-conversation-id]').forEach((item) => {
        item.disabled = navigationBusy;
      });
    };

    let isInitializing = true;
    let isPersistingMessage = false;
    let isGeneratingReply = false;
    let isCreating = false;
    let isSwitching = false;
    let pendingConversationId = null;
    let createRequestGeneration = 0;
    let switchRequestGeneration = 0;
    let messageRequestGeneration = 0;
    let contextRequestGeneration = 0;
    const updateBusy = () => setBusy({
      inputBusy:
        isInitializing
        || isPersistingMessage
        || isGeneratingReply
        || isCreating
        || isSwitching,
      navigationBusy: isInitializing || isPersistingMessage || isCreating || isSwitching,
      generating: isGeneratingReply,
    });

    updateBusy();
    const hydrationPromise = (async () => {
      try {
        const history = await api.listConversations();
        if (!isCurrentMount()) return;

        conversations = history;

        const activeStillExists = conversations.some(
          (conversation) => conversation.id === activeConversationId,
        );
        let conversationId = activeStillExists
          ? activeConversationId
          : conversations[0]?.id;

        if (!conversationId) {
          const conversation = await createConversationOnce();
          if (!isCurrentMount()) return;
          conversations = [conversation];
          conversationId = conversation.id;
        }

        renderHistory();
        const conversation = await api.getConversation(conversationId);
        if (!isCurrentMount()) return;

        applyConversation(conversation);
        setFeedback();
      } catch (error) {
        if (!isCurrentMount()) return;

        setFeedback('Não foi possível carregar o Planner. Tente novamente.');
        console.error('Planner conversation initialization failed', {
          error_name: getSafeErrorName(error),
        });
      } finally {
        if (!isCurrentMount()) return;

        isInitializing = false;
        updateBusy();
      }
    })();
    hydrationPromise.then(() => {
      if (isCurrentMount()) loadLibraryItems();
    });

    const createNewConversation = async () => {
      if (isInitializing || isPersistingMessage || isCreating || isSwitching) return;

      const requestToken = ++createRequestGeneration;
      const isCurrentRequest = () =>
        isCurrentMount() && requestToken === createRequestGeneration;

      isCreating = true;
      updateBusy();

      try {
        const conversation = await createConversationOnce();
        if (!isCurrentRequest()) return;

        activeConversationId = conversation.id;
        conversationViewGeneration += 1;
        invalidatePendingLibraryItem();
        persistedContexts.set(conversation.id, conversation.context ?? '');
        openedLibraryItemId = null;
        libraryReader.hidden = true;
        activeMemoryItems = [];
        editorialDecisions = [];
        renderActiveMemory();
        renderEditorialDecisions();
        conversations = [
          conversation,
          ...conversations.filter((item) => item.id !== conversation.id),
        ];
        renderMessages([]);
        renderPrompt(conversation.context);
        renderHistory();
        loadActiveMemory(conversation.id);
        loadEditorialDecisions(conversation.id);
        setFeedback();

        try {
          const history = await api.listConversations();
          if (!isCurrentRequest()) return;

          conversations = history;
          renderHistory();
          setFeedback();
        } catch (error) {
          if (!isCurrentRequest()) return;

          setFeedback('Conversa criada, mas não foi possível atualizar o histórico.');
          console.error('Planner history refresh failed', {
            error_name: getSafeErrorName(error),
          });
        }
      } catch (error) {
        if (!isCurrentRequest()) return;

        setFeedback('Não foi possível criar uma nova conversa. Tente novamente.');
        console.error('Planner conversation creation failed', {
          error_name: getSafeErrorName(error),
        });
      } finally {
        if (!isCurrentRequest()) return;

        isCreating = false;
        updateBusy();
        textarea.focus();
      }
    };

    const selectConversation = async (conversationId) => {
      if (
        conversationId === activeConversationId
        || conversationId === pendingConversationId
        || isInitializing
        || isPersistingMessage
        || isCreating
      ) return;

      if (!conversations.some((conversation) => conversation.id === conversationId)) return;

      const requestToken = ++switchRequestGeneration;
      const isCurrentRequest = () =>
        isCurrentMount() && requestToken === switchRequestGeneration;

      pendingConversationId = conversationId;
      isSwitching = true;
      updateBusy();

      try {
        const conversation = await api.getConversation(conversationId);
        if (!isCurrentRequest()) return;

        applyConversation(conversation);
        setFeedback();
      } catch (error) {
        if (!isCurrentRequest()) return;

        setFeedback('Não foi possível carregar a conversa. Tente novamente.');
        console.error('Planner conversation selection failed', {
          error_name: getSafeErrorName(error),
        });
      } finally {
        if (!isCurrentRequest()) return;

        pendingConversationId = null;
        isSwitching = false;
        updateBusy();
        textarea.focus();
      }
    };

    const sendMessage = async () => {
      const text = textarea.value.trim();
      if (
        !text
        || isInitializing
        || isPersistingMessage
        || isGeneratingReply
        || isCreating
        || isSwitching
      ) return;

      const conversationId = activeConversationId;
      const requestToken = ++messageRequestGeneration;
      const isCurrentRequest = () =>
        isCurrentMount()
        && requestToken === messageRequestGeneration
        && activeConversationId === conversationId;

      let userMessagePersisted = false;
      isPersistingMessage = true;
      updateBusy();

      try {
        await hydrationPromise;
        if (!isCurrentRequest() || !conversationId) return;

        const message = await api.createMessage(conversationId, {
          sender: 'user',
          text,
        });
        if (!isCurrentRequest()) return;

        appendMessage(message);
        textarea.value = '';
        setFeedback();

        userMessagePersisted = true;
        isPersistingMessage = false;
        isGeneratingReply = true;
        updateBusy();

        const reply = await api.generatePlannerReply(conversationId);
        if (!isCurrentRequest()) return;

        appendMessage(reply);
        if (reply.editorialDecision) {
          await loadEditorialDecisions(conversationId);
          if (!isCurrentRequest()) return;
        }
        setFeedback();
      } catch (error) {
        if (!isCurrentRequest()) return;

        if (!userMessagePersisted) {
          setFeedback('Não foi possível enviar a mensagem. Tente novamente.');
          console.error('Planner message persistence failed', {
            error_name: getSafeErrorName(error),
          });
          return;
        }

        const status = getSafeErrorStatus(error);
        const feedbackMessage = status === 503
          ? 'A IA não está configurada no momento.'
          : status === 502
            ? 'Não foi possível gerar a resposta. Tente novamente.'
            : 'Não foi possível obter a resposta da IA. Tente novamente.';

        setFeedback(feedbackMessage);
        console.error('Planner reply generation failed', {
          error_name: getSafeErrorName(error),
          status,
        });
      } finally {
        if (isCurrentMount() && requestToken === messageRequestGeneration) {
          isPersistingMessage = false;
          isGeneratingReply = false;
          updateBusy();
          if (activeConversationId === conversationId) textarea.focus();
        }
      }
    };

    const handleHistoryClick = (event) => {
      const item = event.target?.closest?.('[data-conversation-id]');
      const conversationId = item?.dataset?.conversationId;
      if (conversationId) selectConversation(conversationId);
    };

    const saveMessageToLibrary = async (button, messageId) => {
      const conversationId = activeConversationId;
      if (!conversationId || !messageId) return;

      const libraryKey = `${conversationId}:${messageId}`;
      if (pendingLibrarySaves.has(libraryKey) || savedLibraryMessages.has(libraryKey)) return;

      const viewToken = conversationViewGeneration;
      const feedbackToken = ++libraryFeedbackGeneration;
      const isCurrentView = () =>
        isCurrentMount()
        && activeConversationId === conversationId
        && conversationViewGeneration === viewToken;

      pendingLibrarySaves.add(libraryKey);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Salvando...';

      try {
        await api.saveMessageToLibrary(conversationId, messageId);
        if (!isCurrentView()) return;

        savedLibraryMessages.add(libraryKey);
        button.textContent = 'Salvo na Biblioteca';
        button.setAttribute('aria-busy', 'false');
        clearLibraryFeedback(feedbackToken);
        await loadLibraryItems();
      } catch (error) {
        if (!isCurrentView()) return;

        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
        button.textContent = 'Salvar na Biblioteca';

        const status = getSafeErrorStatus(error);
        const feedbackMessage = status === 404
          ? 'Não foi possível localizar a resposta para salvar.'
          : status === 409
            ? 'Esta resposta não pertence à conversa atual.'
            : status === 422
              ? 'Apenas respostas do operador podem ser salvas.'
              : 'Não foi possível salvar na Biblioteca. Tente novamente.';

        showLibraryFeedback(feedbackToken, feedbackMessage);
        console.error('Planner library save failed', {
          error_name: getSafeErrorName(error),
          status,
        });
      } finally {
        pendingLibrarySaves.delete(libraryKey);
      }
    };

    const handleChatClick = (event) => {
      const button = event.target?.closest?.('[data-save-to-library]');
      const messageId = button?.dataset?.messageId;
      if (button && messageId) saveMessageToLibrary(button, messageId);
    };

    const handleLibraryClick = (event) => {
      const item = event.target?.closest?.('[data-library-item-id]');
      const id = item?.dataset?.libraryItemId;
      if (id) openLibraryItem(id);
    };

    const updateActiveMemoryItem = async (libraryItemId, shouldLink) => {
      const conversationId = activeConversationId;
      if (!conversationId || !libraryItemId || pendingMemoryItems.has(libraryItemId)) return;

      const viewToken = conversationViewGeneration;
      const feedbackToken = ++libraryFeedbackGeneration;
      const isCurrentView = () =>
        isCurrentMount()
        && activeConversationId === conversationId
        && conversationViewGeneration === viewToken;

      pendingMemoryItems.add(libraryItemId);
      renderActiveMemory();
      try {
        if (shouldLink) {
          await api.linkLibraryItemToConversation(conversationId, libraryItemId);
        } else {
          await api.unlinkLibraryItemFromConversation(conversationId, libraryItemId);
        }
        if (!isCurrentView()) return;
        await loadActiveMemory(conversationId);
        if (!isCurrentView()) return;
        clearLibraryFeedback(feedbackToken);
      } catch (error) {
        if (!isCurrentView()) return;
        const status = getSafeErrorStatus(error);
        const message = status === 404
          ? 'Não foi possível localizar a conversa ou o artefato.'
          : status === 422
            ? 'A conversa já atingiu o limite de memória ativa.'
            : 'Não foi possível atualizar a memória ativa.';
        showLibraryFeedback(feedbackToken, message);
        console.error('Planner active memory update failed', {
          error_name: getSafeErrorName(error),
          status,
        });
      } finally {
        pendingMemoryItems.delete(libraryItemId);
        if (isCurrentView()) renderActiveMemory();
      }
    };

    const handleMemoryToggle = () => {
      const libraryItemId = libraryMemoryToggle.dataset.libraryItemId;
      if (!libraryItemId) return;
      const isActive = activeMemoryItems.some((item) => item.id === libraryItemId);
      updateActiveMemoryItem(libraryItemId, !isActive);
    };

    const handleActiveMemoryClick = (event) => {
      const button = event.target?.closest?.('[data-unlink-memory-item]');
      const libraryItemId = button?.dataset?.unlinkMemoryItem;
      if (libraryItemId) updateActiveMemoryItem(libraryItemId, false);
    };

    const handleTextareaKeydown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendBtn.click();
      }
    };

    const saveContext = async () => {
      const conversationId = activeConversationId;
      if (!conversationId) return;

      const previousContext = persistedContexts.get(conversationId) ?? '';
      const context = promptBase.textContent.trim();
      if (context === previousContext) return;

      const requestToken = ++contextRequestGeneration;
      const isCurrentRequest = () =>
        isCurrentMount()
        && requestToken === contextRequestGeneration
        && activeConversationId === conversationId;

      try {
        const conversation = await api.updateConversationContext(conversationId, context);
        if (!isCurrentRequest()) return;

        const persistedContext = conversation.context ?? '';
        persistedContexts.set(conversationId, persistedContext);
        renderPrompt(persistedContext);
        setFeedback();
      } catch (error) {
        if (!isCurrentRequest()) return;

        promptBase.textContent = previousContext;
        promptBase.setAttribute('aria-invalid', 'true');
        setFeedback('Não foi possível salvar o contexto.');

        console.error('Planner context persistence failed', {
          error_name: getSafeErrorName(error),
        });
      }
    };

    sendBtn.addEventListener('click', sendMessage);
    chatBody.addEventListener('click', handleChatClick);
    libraryList.addEventListener('click', handleLibraryClick);
    libraryMemoryToggle.addEventListener('click', handleMemoryToggle);
    activeMemoryList.addEventListener('click', handleActiveMemoryClick);
    newConversationBtn.addEventListener('click', createNewConversation);
    historyList.addEventListener('click', handleHistoryClick);
    editorialDecisionList.addEventListener('click', handleEditorialDecisionClick);
    textarea.addEventListener('keydown', handleTextareaKeydown);
    promptBase.addEventListener('blur', saveContext);

    removeMountedListeners = () => {
      sendBtn.removeEventListener('click', sendMessage);
      chatBody.removeEventListener('click', handleChatClick);
      libraryList.removeEventListener('click', handleLibraryClick);
      libraryMemoryToggle.removeEventListener('click', handleMemoryToggle);
      activeMemoryList.removeEventListener('click', handleActiveMemoryClick);
      newConversationBtn.removeEventListener('click', createNewConversation);
      historyList.removeEventListener('click', handleHistoryClick);
      editorialDecisionList.removeEventListener('click', handleEditorialDecisionClick);
      textarea.removeEventListener('keydown', handleTextareaKeydown);
      promptBase.removeEventListener('blur', saveContext);
    };
  };

  return { mount, unmount };
};
