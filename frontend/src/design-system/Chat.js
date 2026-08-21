import { html } from './html.js';
import { createFixedInput } from './FixedInput.js';

export const createChatMessageElement = ({ id = '', who = 'me', text = '', time = '' } = {}) => {
  const message = document.createElement('div');
  message.className = `chat-message ${who}`;
  message.dataset.id = id;

  const body = document.createElement('div');
  body.className = 'chat-message-body';

  const messageText = document.createElement('div');
  messageText.className = 'chat-message-text';
  messageText.textContent = text;

  const messageMeta = document.createElement('div');
  messageMeta.className = 'chat-message-meta';
  messageMeta.textContent = time;

  body.append(messageText, messageMeta);
  message.append(body);

  return message;
};

export const createChatMessage = (options = {}) => createChatMessageElement(options).outerHTML;

export const createChatArea = ({ initial = [] } = {}) =>
  html`
    <section class="planner-chat" aria-live="polite">
      <div class="chat-header">Conversa</div>
      <div class="chat-body" data-chat-body>
        ${initial.map((m) => createChatMessage(m)).join('')}
      </div>
      ${createFixedInput()}
    </section>
  `;
