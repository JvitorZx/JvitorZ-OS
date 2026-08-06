import { html } from './html.js';

export const createModal = ({ title = '', body = '', footer = '', className = '' } = {}) => html`
  <div class="modal ${className}">
    <div class="modal-content">
      ${title ? `<header class="modal-header"><h2>${title}</h2></header>` : ''}
      <section class="modal-body">${body}</section>
      ${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}
    </div>
  </div>
`;
