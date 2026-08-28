import { createPanel, escapeHtml, html } from '../design-system/index.js';
import { integrationFrom, operationalStatus } from '../utils/operational-status.js';

const integrationLabel = (data, id) => operationalStatus(integrationFrom(data, id)?.state).label;
const safeList = (items, empty) => {
  const values = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim()).slice(0, 4) : [];
  if (!values.length) return html`<p class="home-empty">${escapeHtml(empty)}</p>`;
  return html`<ul class="home-priority-list">${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
};

export const homeModule = {
  id: 'dashboard',
  route: '/dashboard',
  aliases: ['home'],
  icon: 'dashboard',
  label: 'Dashboard',
  pageTitle: 'Dashboard',
  pageEyebrow: 'Visão operacional',
  refreshOnDashboardData: true,
  render(data) {
    const status = data.status ?? {};
    const supervisor = data.supervisor ?? {};
    const editorial = supervisor.editorial ?? {};
    const automations = supervisor.automations ?? {};
    const operators = Array.isArray(supervisor.channelOperators) ? supervisor.channelOperators : [];
    const availableOperators = operators.filter(({ status: operatorStatus }) => operatorStatus === 'AVAILABLE').length;
    const qualityAlerts = (Array.isArray(data.dataQuality) ? data.dataQuality : [])
      .filter(({ state }) => state !== 'GOOD')
      .map(({ area, state, summary }) => `${area}: ${state}. ${summary ?? ''}`);

    return html`
      <section class="home-status-grid" aria-label="Estado operacional">
        <a class="home-status-card" href="#/channel"><span>YouTube</span><strong>${integrationLabel(data, 'youtubeData')}</strong></a>
        <a class="home-status-card" href="#/analytics/ctr"><span>Alcance / CTR</span><strong>${integrationLabel(data, 'youtubeReach')}</strong></a>
        <a class="home-status-card" href="#/planner"><span>Planner IA</span><strong>${integrationLabel(data, 'openai')}</strong></a>
        <a class="home-status-card" href="#/automations"><span>Automações</span><strong>${integrationLabel(data, 'automationRuntime')}</strong></a>
        <a class="home-status-card" href="#/operators"><span>Operadores disponíveis</span><strong>${availableOperators}/${operators.length || 4}</strong></a>
      </section>

      <section class="home-content-grid">
        ${createPanel({
          eyebrow: 'Prioridades',
          title: 'Próximas decisões editoriais',
          className: 'home-summary-panel',
          body: safeList(editorial.priorities, 'Nenhuma prioridade editorial registrada.'),
        })}
        ${createPanel({
          eyebrow: 'Riscos',
          title: 'Pontos que pedem atenção',
          className: 'home-summary-panel',
          body: safeList(editorial.risks, 'Nenhum risco editorial registrado.'),
        })}
        ${createPanel({
          eyebrow: 'Qualidade',
          title: 'Freshness e dados ausentes',
          className: 'home-summary-panel',
          body: safeList(qualityAlerts, 'Fontes principais com qualidade adequada.'),
        })}
      </section>

      <nav class="home-actions" aria-label="Ações rápidas">
        <a class="button" href="#/planner">Abrir Planner</a>
        <a class="button" href="#/analytics">Ver Analytics</a>
        <a class="button" href="#/manager">Abrir Gerente</a>
        <a class="button" href="#/supervisor">Ver Supervisor</a>
      </nav>
    `;
  },
};
