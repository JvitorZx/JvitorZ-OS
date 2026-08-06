import { html } from './html.js';

export const createNotification = ({ message = '', variant = 'info', className = '' } = {}) => html`
  <div class="notification notification-${variant} ${className}">${message}</div>
`;
