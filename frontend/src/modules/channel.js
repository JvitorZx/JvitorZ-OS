import { createDetailList, createMetricCard, createPanel, createStatusPill, html } from '../design-system/index.js';
import { emptyValue, formatDate, formatNumber } from '../utils/formatters.js';

export const channelModule = {
  id: 'channel',
  route: '/channel',
  pageTitle: 'Canal',
  pageEyebrow: 'Fonte de dados',
  refreshOnDashboardData: true,
  label: 'Canal',
  render(data) {
    const channel = data.channel ?? {};
    const metrics = data.metrics ?? {};

    return html`
      <section class="summary-grid" aria-label="Metricas principais">
        ${createMetricCard({
          label: 'Inscritos',
          value: formatNumber(metrics.subscribers),
          caption: 'YouTube',
        })}
        ${createMetricCard({
          label: 'Videos',
          value: formatNumber(metrics.videos),
          caption: 'Canal',
        })}
        ${createMetricCard({
          label: 'Visualizacoes',
          value: formatNumber(metrics.views),
          caption: 'Total historico',
        })}
      </section>

      ${createPanel({
        eyebrow: 'Canal conectado',
        title: channel.title ?? emptyValue,
        className: 'channel-panel',
        action: createStatusPill(
          data.status?.youtubeConnected ? 'Conectado' : 'Pendente',
          data.status?.youtubeConnected ? 'connected' : 'pending',
        ),
        body: createDetailList([
          { label: 'ID', value: channel.id ?? emptyValue },
          { label: 'Pais', value: channel.country ?? emptyValue },
          { label: 'Publicado em', value: formatDate(channel.publishedAt) },
        ]),
      })}
    `;
  },
};
