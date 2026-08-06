import { html } from './html.js';

export const createBadge = ({ label = '', className = '' } = {}) => html`
  <span class="badge ${className}">${label}</span>
`;
