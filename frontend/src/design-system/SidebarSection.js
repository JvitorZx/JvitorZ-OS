import { html } from './html.js';

export const createSidebarSection = ({ title, body = '' } = {}) => html`
  <section class="sidebar-section">
    <h4>${title}</h4>
    <div class="sidebar-body">${body}</div>
  </section>
`;
