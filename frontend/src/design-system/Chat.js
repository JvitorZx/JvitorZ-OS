import { html } from './html.js';
import { createFixedInput } from './FixedInput.js';

export const createChatMessage = ({ id = '', who = 'me', text = '', time = '' } = {}) =>
  html`
    <div class="chat-message ${who}" data-id="${id}">
      <div class="chat-message-body">
        <div class="chat-message-text">${text}</div>
        <div class="chat-message-meta">${time}</div>
      </div>
    </div>
  `;

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
