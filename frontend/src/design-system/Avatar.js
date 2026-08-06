import { html } from './html.js';

export const createAvatar = ({ src = '', initials = '', alt = '', className = '' } = {}) => html`
  <div class="avatar ${className}">
    ${src ? `<img src="${src}" alt="${alt}" />` : `<span class="avatar-initials">${initials}</span>`}
  </div>
`;
