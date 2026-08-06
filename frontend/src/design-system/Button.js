import { html } from './html.js';

export const createButton = ({ type = 'button', label = '', className = '', icon = '', attributes = {} } = {}) => {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');

  return html`
    <button type="${type}" class="button ${className}" ${attrs}>
      ${icon ? `<span class="button-icon">${icon}</span>` : ''}
      ${label}
    </button>
  `;
};
