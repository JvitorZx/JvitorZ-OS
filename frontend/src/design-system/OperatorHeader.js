import { html } from './html.js';

export const createOperatorHeader = ({ title = '', subtitle = '', status = '' } = {}) => html`
  <header class="planner-header operator-header">
    <div class="planner-header-left">
      <h3>${title}</h3>
      ${subtitle ? `<p class="planner-subtitle">${subtitle}</p>` : ''}
    </div>
    <div class="planner-header-right">
      ${status ? `<small class="planner-status">Status: ${status}</small>` : ''}
    </div>
  </header>
`;
