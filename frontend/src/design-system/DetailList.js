import { html } from './html.js';

export const createDetailList = (items = []) =>
  html`
    <dl class="details-list">
      ${items
        .map(
          (item) => html`
            <div>
              <dt>${item.label}</dt>
              <dd>${item.value}</dd>
            </div>
          `,
        )
        .join('')}
    </dl>
  `;
