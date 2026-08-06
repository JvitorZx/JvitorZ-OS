import { createPanel, html } from '../design-system/index.js';
import { formatNumber } from '../utils/formatters.js';

export const analyticsModule = {
  id: 'analytics',
  label: 'Analytics',
  render(data) {
    const metrics = data.metrics ?? {};

    return createPanel({
      eyebrow: 'Analytics',
      title: 'Resumo do canal',
      className: 'analytics-panel',
      body: html`
        <div class="analytics-grid">
          <div>
            <span>Base atual</span>
            <strong>${formatNumber(metrics.subscribers)}</strong>
          </div>
          <div>
            <span>Catalogo</span>
            <strong>${formatNumber(metrics.videos)}</strong>
          </div>
          <div>
            <span>Alcance total</span>
            <strong>${formatNumber(metrics.views)}</strong>
          </div>
        </div>
      `,
    });
  },
};
