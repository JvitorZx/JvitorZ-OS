import { html } from './html.js';

export const createTag = ({ label = '', className = '' } = {}) => html`
  <span class="tag ${className}">${label}</span>
`;
