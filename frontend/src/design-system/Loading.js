import { html } from './html.js';

export const createLoading = ({ label = 'Carregando...', className = '' } = {}) => html`
  <div class="loading ${className}">
    <div class="loading-spinner"></div>
    <span>${label}</span>
  </div>
`;
