import { createPanel, html, createChatMessageElement, createSidebarSection, createFixedInput, createOperatorHeader, createChatArea, createSidebar, createWorkspaceLayout } from '../design-system/index.js';

export const plannerModule = {
  id: 'content-planner',
  fullscreen: true,
  label: 'Planejador de Conteúdo',
  createController(context) {
    return createPlannerController(context);
  },
  render() {
    const header = createOperatorHeader({ title: 'Planejador de Conteúdo', subtitle: 'Organize ideias, pautas e próximas publicações.', status: 'Pronto' });
    const chat = createChatArea();
    const sidebarHtml = createSidebar({ sections: [
      {
        title: 'Biblioteca',
        body: html`
          <div class="planner-library-list" data-library-list></div>
          <article class="planner-library-reader" data-library-reader hidden>
            <h5 data-library-item-title></h5>
            <div class="planner-library-content" data-library-item-content></div>
          </article>
        `,
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
      renderMessages(conversation.messages ?? []);
      renderPrompt(context);
      renderHistory();
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
        conversations = [
          conversation,
          ...conversations.filter((item) => item.id !== conversation.id),
        ];
        renderMessages([]);
        renderPrompt(conversation.context);
        renderHistory();
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
    newConversationBtn.addEventListener('click', createNewConversation);
    historyList.addEventListener('click', handleHistoryClick);
    textarea.addEventListener('keydown', handleTextareaKeydown);
    promptBase.addEventListener('blur', saveContext);

    removeMountedListeners = () => {
      sendBtn.removeEventListener('click', sendMessage);
      chatBody.removeEventListener('click', handleChatClick);
      libraryList.removeEventListener('click', handleLibraryClick);
      newConversationBtn.removeEventListener('click', createNewConversation);
      historyList.removeEventListener('click', handleHistoryClick);
      textarea.removeEventListener('keydown', handleTextareaKeydown);
      promptBase.removeEventListener('blur', saveContext);
    };
  };

  return { mount, unmount };
};
