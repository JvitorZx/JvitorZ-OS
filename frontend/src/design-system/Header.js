import { html } from './html.js';

export const createHeader = ({ eyebrow = '', title = '', subtitle = '', action = '' } = {}) => html`
  <header class="header">
    <div>
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      ${title ? `<h1>${title}</h1>` : ''}
      ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
    </div>
    ${action}
  </header>
`;
