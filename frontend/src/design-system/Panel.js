import { html } from './html.js';

export const createPanel = ({ eyebrow = '', title = '', icon = '', action = '', body = '', className = '' } = {}) => html`
  <article class="panel ${className}">
    <div class="panel-header">
      <div class="panel-heading">
        ${icon ? `<span class="panel-icon">${icon}</span>` : ''}
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h2>${title}</h2>
        </div>
      </div>
      ${action}
    </div>
    ${body}
  </article>
`;
