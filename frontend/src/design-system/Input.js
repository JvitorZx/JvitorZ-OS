import { html } from './html.js';

export const createInput = ({ id = '', placeholder = '', value = '', className = '' } = {}) => html`
  <input id="${id}" class="input ${className}" placeholder="${placeholder}" value="${value}" />
`;
