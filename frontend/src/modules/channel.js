import { createDetailList, createMetricCard, createPanel, createStatusPill, html } from '../design-system/index.js';
import { emptyValue, formatDate, formatNumber } from '../utils/formatters.js';
import { integrationFrom, operationalStatus } from '../utils/operational-status.js';

const channelErrorMessage = (error) => {
  if (error?.status === 401 || error?.code === 'AUTH_REQUIRED') return 'Reconecte sua conta Google para atualizar o canal.';
  if (error?.status === 503 || error?.code === 'PROVIDER_UNAVAILABLE') return 'O YouTube está temporariamente indisponível. O último dado válido foi preservado.';
  if (error?.code === 'CONFIG_MISSING') return 'A integração Google ainda não está configurada.';
  return 'Não foi possível sincronizar o canal. Tente novamente.';
};

export const createChannelController = ({ api, refreshDashboard }) => {
  let mountedRoot = null;
  let generation = 0;
  let syncing = false;
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.channel-panel');
    if (!panel || panel === mountedRoot) return;
    cleanup();
    mountedRoot = panel;
    const token = ++generation;
    const current = () => mountedRoot === panel && generation === token;
    const button = panel.querySelector('[data-channel-sync]');
    const feedback = panel.querySelector('[data-channel-feedback]');
    const sync = async () => {
      if (syncing || !button) return;
      syncing = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      feedback.textContent = 'Sincronizando dados do canal...';
      feedback.hidden = false;
      feedback.className = 'performance-feedback';
      try {
        await api.syncYouTubeChannel();
        if (!current()) return;
        feedback.textContent = 'Canal sincronizado com sucesso.';
        feedback.className = 'performance-feedback success';
        await refreshDashboard?.();
      } catch (error) {
        if (!current()) return;
        feedback.textContent = channelErrorMessage(error);
        feedback.className = 'performance-feedback error';
      } finally {
        syncing = false;
        if (current()) {
          button.disabled = false;
          button.setAttribute('aria-busy', 'false');
        }
      }
    };
    button?.addEventListener('click', sync);
    cleanup = () => button?.removeEventListener('click', sync);
  };

  const unmount = () => {
    cleanup(); cleanup = () => {};
    mountedRoot = null; generation += 1; syncing = false;
  };

  return { mount, unmount };
};

export const channelModule = {
  id: 'channel',
  route: '/channel',
  pageTitle: 'Canal',
  pageEyebrow: 'Fonte de dados',
  refreshOnDashboardData: true,
  label: 'Canal',
  createController: createChannelController,
  render(data, context = {}) {
    const channel = data.channel ?? {};
    const metrics = data.metrics ?? {};
    const integration = integrationFrom(data, 'youtubeData') ?? channel.integration ?? {};
    const state = operationalStatus(integration.state);
    const needsReconnect = integration.state === 'AUTH_REQUIRED' || integration.state === 'NOT_CONFIGURED';
    const isDegraded = integration.state === 'DEGRADED' || integration.stale;
    const actions = html`<div class="channel-actions">
      ${createStatusPill(state.label, state.variant)}
      ${needsReconnect || isDegraded ? html`<a class="button secondary" href="${data.authUrl ?? `${context.apiBaseUrl ?? ''}/api/auth/google`}">Reconectar Google</a>` : ''}
      ${integration.state !== 'NOT_CONFIGURED' ? html`<button class="button secondary" type="button" data-channel-sync>Sincronizar canal</button>` : ''}
    </div>`;

    return html`
      <section class="summary-grid" aria-label="Metricas principais">
        ${createMetricCard({
          label: 'Inscritos',
          value: formatNumber(metrics.subscribers),
          caption: integration.stale ? 'Último dado conhecido' : 'YouTube',
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
        action: actions,
        body: html`${createDetailList([
          { label: 'ID', value: channel.id ?? emptyValue },
          { label: 'Pais', value: channel.country ?? emptyValue },
          { label: 'Publicado em', value: formatDate(channel.publishedAt) },
          { label: 'Última atualização', value: formatDate(integration.lastSuccessAt) },
          { label: 'Estado', value: integration.summary ?? state.label },
        ])}<div class="performance-feedback" data-channel-feedback role="status" aria-live="polite" aria-atomic="true" hidden></div>`,
      })}
    `;
  },
};
