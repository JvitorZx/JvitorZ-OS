import { html } from './html.js';

export const createTextarea = ({ id = '', placeholder = '', value = '', rows = 4, className = '' } = {}) => html`
  <textarea id="${id}" class="textarea ${className}" placeholder="${placeholder}" rows="${rows}">${value}</textarea>
`;
