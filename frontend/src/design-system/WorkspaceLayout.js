import { html } from './html.js';

export const createFullscreenWorkspace = ({ moduleId, content = '' }) => html`
  <div class="workspace-wrap" data-workspace-module="${moduleId}">
    <section id="${moduleId}" class="module-section workspace-module">
      ${content}
    </section>
  </div>
`;

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
