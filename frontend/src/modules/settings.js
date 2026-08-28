import { createPanel, createStatusPill, escapeHtml, html } from '../design-system/index.js';
import { operationalStatus } from '../utils/operational-status.js';

const LABELS = {
  backend: 'Backend API', database: 'SQLite', googleOAuth: 'Google OAuth',
  youtubeData: 'YouTube Data API', youtubeAnalytics: 'YouTube Analytics',
  openai: 'OpenAI', automationRuntime: 'Automation Runtime',
};

export const settingsModule = {
  id: 'settings',
  route: '/settings',
  pageTitle: 'Configurações',
  pageEyebrow: 'Sistema local',
  label: 'Configuracoes',
  refreshOnDashboardData: true,
  render(data, context) {
    const integrations = data.integrations ?? {};
    const rows = Object.entries(LABELS).map(([id, label]) => {
      const integration = integrations[id] ?? {};
      const state = operationalStatus(integration.state);
      const action = ['googleOAuth', 'youtubeData', 'youtubeAnalytics'].includes(id)
        && ['AUTH_REQUIRED', 'NOT_CONFIGURED'].includes(integration.state)
        ? html`<a class="button secondary" href="${escapeHtml(data.authUrl ?? `${context.apiBaseUrl}/api/auth/google`)}">${integration.state === 'AUTH_REQUIRED' ? 'Reconectar' : 'Conectar'}</a>`
        : '';
      return html`<div class="settings-integration-row"><div><strong>${label}</strong><small>${escapeHtml(integration.summary ?? 'Estado não carregado.')}</small></div>${createStatusPill(state.label, state.variant)}${action}</div>`;
    }).join('');
    return createPanel({
      eyebrow: 'Configuracoes',
      title: 'Estado das integrações',
      className: 'settings-panel',
      body: html`<div class="settings-integration-list">${rows}</div>`,
    });
  },
};
