import { createPanel, html, createChatMessage, createSidebarSection, createEditablePrompt, createFixedInput, createOperatorHeader, createChatArea, createSidebar, createWorkspaceLayout } from '../design-system/index.js';

export const plannerModule = {
  id: 'content-planner',
  fullscreen: true,
  label: 'Planejador de Conteúdo',
  fullscreen: true,
  render() {
    const header = createOperatorHeader({ title: 'Planejador de Conteúdo', subtitle: 'Organize ideias, pautas e próximas publicações.', status: 'Pronto' });
    const chat = createChatArea({ initial: [{ who: 'them', text: 'Bem-vindo ao Planejador de Conteúdo. Use o campo abaixo para escrever.' }] });
    const sidebarHtml = createSidebar({ sections: [
      { title: 'Biblioteca', body: '<p>Recursos e templates salvos.</p>' },
      { title: 'Histórico', body: '<p>Conversas e atividades anteriores.</p>' },
    ]});

    const promptSection = html`<section class="sidebar-section"><h4>Prompt Base</h4><div class="sidebar-body">${createEditablePrompt({ id: 'planner-prompt', content: 'Escreva seu prompt base aqui...' })}</div></section>`;

    return createPanel({
      eyebrow: 'Operador',
      title: 'Planejador de Conteúdo',
      className: 'planner-panel',
      body: createWorkspaceLayout({ header, chat, sidebar: sidebarHtml + promptSection }),
    });
  },
};

export function initPlanner(root = document) {
  const panel = root.querySelector('.planner-panel');
  if (!panel) return;

  const chatBody = panel.querySelector('[data-chat-body]');
  const sendBtn = panel.querySelector('.fixed-input-send');
  const textarea = panel.querySelector('.fixed-input-textarea');
  const promptBase = panel.querySelector('[data-prompt-id="planner-prompt"]');

  const appendMessage = (text) => {
    const msg = createChatMessage({ who: 'me', text, time: new Date().toLocaleTimeString() });
    chatBody.insertAdjacentHTML('beforeend', msg);
    chatBody.scrollTop = chatBody.scrollHeight;
  };

  sendBtn.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) return;
    appendMessage(text);
    textarea.value = '';
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // Persist prompt base to localStorage
  if (promptBase) {
    const key = 'planner.prompt.base';
    const saved = localStorage.getItem(key);
    if (saved) promptBase.textContent = saved;

    promptBase.addEventListener('blur', () => {
      localStorage.setItem(key, promptBase.textContent.trim());
    });
  }
}
