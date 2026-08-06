import { html } from './html.js';

export const createTable = ({ columns = [], rows = [], className = '' } = {}) => html`
  <table class="table ${className}">
    <thead>
      <tr>
        ${columns.map((column) => html`<th>${column}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => html`
            <tr>
              ${row.map((cell) => html`<td>${cell}</td>`).join('')}
            </tr>
          `,
        )
        .join('')}
    </tbody>
  </table>
`;
