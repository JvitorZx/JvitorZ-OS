import { createPanel, createStatusPill, html } from '../design-system/index.js';

const youtubeAnalyticsStatus = {
  connected: { label: 'Conectado', variant: 'connected' },
  synchronized: { label: 'Sincronizado', variant: 'connected' },
  not_authorized: { label: 'Autorizacao necessaria', variant: 'pending' },
  not_configured: { label: 'Nao configurado', variant: 'pending' },
  temporary_error: { label: 'Erro temporario', variant: 'pending' },
};

export const supervisorModule = {
  id: 'supervisor',
  label: 'Supervisor',
  render(data) {
    const status = data.status ?? {};
    const analyticsState = data.supervisor?.youtubeAnalytics?.state;
    const analytics = youtubeAnalyticsStatus[analyticsState]
      ?? { label: 'Pendente', variant: 'pending' };

    return createPanel({
      eyebrow: 'Supervisor',
      title: 'Estado operacional',
      className: 'supervisor-panel',
      body: html`
        <div class="status-stack">
          <div>
            <span>YouTube</span>
            ${createStatusPill(status.youtubeConnected ? 'Conectado' : 'Pendente', status.youtubeConnected ? 'connected' : 'pending')}
          </div>
          <div>
            <span>YouTube Analytics</span>
            ${createStatusPill(analytics.label, analytics.variant)}
          </div>
          <div>
            <span>IA</span>
            ${createStatusPill(status.aiEnabled ? 'Configurada' : 'Nao configurada', status.aiEnabled ? 'connected' : 'pending')}
          </div>
          <div>
            <span>Automacoes</span>
            ${createStatusPill(status.automationsEnabled ? 'Operacionais' : 'Nao implementadas', status.automationsEnabled ? 'connected' : 'pending')}
          </div>
        </div>
      `,
    });
  },
};
