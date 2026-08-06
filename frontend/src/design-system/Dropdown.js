import { html } from './html.js';

export const createDropdown = ({ label = '', options = [], className = '' } = {}) => html`
  <div class="dropdown ${className}">
    ${label ? `<span class="dropdown-label">${label}</span>` : ''}
    <select class="dropdown-select">
      ${options.map((option) => html`<option value="${option.value}">${option.label}</option>`).join('')}
    </select>
  </div>
`;
