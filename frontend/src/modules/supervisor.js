import { createPanel, createStatusPill, html } from '../components.js';

export const supervisorModule = {
  id: 'supervisor',
  label: 'Supervisor',
  render(data) {
    const status = data.status ?? {};

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
            <span>IA</span>
            ${createStatusPill(status.aiEnabled ? 'Ativa' : 'Desativada', 'pending')}
          </div>
          <div>
            <span>Automacoes</span>
            ${createStatusPill(status.automationsEnabled ? 'Ativas' : 'Desativadas', 'pending')}
          </div>
        </div>
      `,
    });
  },
};
