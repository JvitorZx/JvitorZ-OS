import { html } from './html.js';

export const createEmptyState = ({ title = '', description = '', action = '' } = {}) => html`
  <div class="empty-state">
    ${title ? `<h2>${title}</h2>` : ''}
    ${description ? `<p>${description}</p>` : ''}
    ${action}
  </div>
`;
