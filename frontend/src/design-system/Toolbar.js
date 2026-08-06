import { html } from './html.js';

export const createToolbar = ({ content = '', className = '' } = {}) => html`
  <div class="toolbar ${className}">${content}</div>
`;
