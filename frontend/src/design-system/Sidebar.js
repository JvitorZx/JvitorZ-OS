import { html } from './html.js';

export const createSidebarSection = ({ title, body = '' } = {}) =>
  html`
    <section class="sidebar-section">
      <h4>${title}</h4>
      <div class="sidebar-body">${body}</div>
    </section>
  `;

export const createSidebar = ({ sections = [] } = {}) =>
  html`
    <aside class="planner-side">
      ${sections.map((section) => createSidebarSection(section)).join('')}
    </aside>
  `;
