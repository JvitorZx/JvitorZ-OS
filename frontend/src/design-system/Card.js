import { html } from './html.js';

export const createMetricCard = ({ label, value, caption, icon = '' } = {}) => html`
  <article class="metric-card">
    ${icon ? `<span class="metric-card-icon">${icon}</span>` : ''}
    <div>
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
    </div>
    <small>${caption}</small>
  </article>
`;

export const createCard = ({ eyebrow = '', title = '', body = '', footer = '', className = '' } = {}) => html`
  <article class="card ${className}">
    ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
    ${title ? `<h2>${title}</h2>` : ''}
    <div class="card-body">${body}</div>
    ${footer ? `<div class="card-footer">${footer}</div>` : ''}
  </article>
`;
