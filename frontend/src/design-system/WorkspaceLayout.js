import { html } from './html.js';

export const createWorkspaceLayout = ({ header = '', chat = '', sidebar = '' } = {}) =>
  html`
    <div class="planner-shell">
      ${header}
      <main class="planner-main">
        ${chat}
        ${sidebar}
      </main>
    </div>
  `;
