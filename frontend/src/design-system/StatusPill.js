import { html } from './html.js';

export const createStatusPill = (label, variant = 'pending') =>
  html`<span class="status-pill ${variant}">${label}</span>`;
