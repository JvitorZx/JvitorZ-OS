import { html } from './html.js';

export const createFixedInput = ({ placeholder = 'Escreva uma mensagem...', sendLabel = 'Enviar' } = {}) => html`
  <div class="fixed-input">
    <textarea class="fixed-input-textarea" placeholder="${placeholder}" rows="1"></textarea>
    <button class="fixed-input-send" type="button">${sendLabel}</button>
  </div>
`;
