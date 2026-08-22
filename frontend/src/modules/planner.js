import { createPanel, html, createChatMessageElement, createSidebarSection, createFixedInput, createOperatorHeader, createChatArea, createSidebar, createWorkspaceLayout } from '../design-system/index.js';

export const plannerModule = {
  id: 'content-planner',
  fullscreen: true,
  label: 'Planejador de Conteúdo',
  fullscreen: true,
  render() {
    const header = createOperatorHeader({ title: 'Planejador de Conteúdo', subtitle: 'Organize ideias, pautas e próximas publicações.', status: 'Pronto' });
    const chat = createChatArea();
    const sidebarHtml = createSidebar({ sections: [
      { title: 'Biblioteca', body: '<p>Recursos e templates salvos.</p>' },
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

export const createPlannerController = ({ api }) => {
  let activeConversationId = null;
  let conversations = [];
  const persistedContexts = new Map();
  let conversationCreationPromise = null;
  let mountGeneration = 0;
  let mountedPanel = null;

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

  const init = (root = document, activeModuleId = null) => {
    if (activeModuleId !== plannerModule.id) {
      if (mountedPanel) {
        mountedPanel = null;
        mountGeneration += 1;
      }
      return;
    }

    const panel = root.querySelector('.planner-panel');
    if (!panel) {
      if (mountedPanel) {
        mountedPanel = null;
        mountGeneration += 1;
      }
      return;
    }

    if (panel === mountedPanel && panel.dataset.plannerInitialized === 'true') return;

    const mountToken = ++mountGeneration;
    mountedPanel = panel;

    const chatBody = panel.querySelector('[data-chat-body]');
    const sendBtn = panel.querySelector('.fixed-input-send');
    const textarea = panel.querySelector('.fixed-input-textarea');
    const promptBase = panel.querySelector('[data-prompt-id="planner-prompt"]');
    const historyList = panel.querySelector('[data-conversation-history]');
    const newConversationBtn = panel.querySelector('[data-new-conversation]');
    const feedback = panel.querySelector('[data-planner-feedback]');

    if (
      !chatBody
      || !sendBtn
      || !textarea
      || !promptBase
      || !historyList
      || !newConversationBtn
      || !feedback
    ) return;

    panel.dataset.plannerInitialized = 'true';

    const isCurrentMount = () => mountedPanel === panel && mountGeneration === mountToken;

    const setFeedback = (message = '') => {
      if (!isCurrentMount()) return;
      feedback.textContent = message;
      feedback.hidden = !message;
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
      activeConversationId = conversation.id;
      renderMessages(conversation.messages ?? []);
      renderPrompt(context);
      renderHistory();
    };

    const setBusy = (isBusy) => {
      sendBtn.disabled = isBusy;
      textarea.disabled = isBusy;
      newConversationBtn.disabled = isBusy;
      sendBtn.setAttribute('aria-busy', String(isBusy));
      newConversationBtn.setAttribute('aria-busy', String(isBusy));
      historyList.querySelectorAll('[data-conversation-id]').forEach((item) => {
        item.disabled = isBusy;
      });
    };

    let isInitializing = true;
    let isSending = false;
    let isCreating = false;
    let isSwitching = false;
    let pendingConversationId = null;
    let createRequestGeneration = 0;
    let switchRequestGeneration = 0;
    let messageRequestGeneration = 0;
    let contextRequestGeneration = 0;
    const updateBusy = () => setBusy(isInitializing || isSending || isCreating || isSwitching);

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

    const createNewConversation = async () => {
      if (isInitializing || isSending || isCreating || isSwitching) return;

      const requestToken = ++createRequestGeneration;
      const isCurrentRequest = () =>
        isCurrentMount() && requestToken === createRequestGeneration;

      isCreating = true;
      updateBusy();

      try {
        const conversation = await createConversationOnce();
        if (!isCurrentRequest()) return;

        activeConversationId = conversation.id;
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
        || isSending
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
      if (!text || isInitializing || isSending || isCreating || isSwitching) return;

      const conversationId = activeConversationId;
      const requestToken = ++messageRequestGeneration;
      const isCurrentRequest = () =>
        isCurrentMount()
        && requestToken === messageRequestGeneration
        && activeConversationId === conversationId;

      isSending = true;
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
      } catch (error) {
        if (!isCurrentRequest()) return;

        setFeedback('Não foi possível enviar a mensagem. Tente novamente.');
        console.error('Planner message persistence failed', {
          error_name: getSafeErrorName(error),
        });
      } finally {
        if (isCurrentMount() && requestToken === messageRequestGeneration) {
          isSending = false;
          updateBusy();
          textarea.focus();
        }
      }
    };

    sendBtn.addEventListener('click', sendMessage);
    newConversationBtn.addEventListener('click', createNewConversation);
    historyList.addEventListener('click', (event) => {
      const item = event.target?.closest?.('[data-conversation-id]');
      const conversationId = item?.dataset?.conversationId;
      if (conversationId) selectConversation(conversationId);
    });

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendBtn.click();
      }
    });

    promptBase.addEventListener('blur', async () => {
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
    });
  };

  return { init };
};
