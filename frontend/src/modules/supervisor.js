import { createPanel, createStatusPill, escapeHtml, html } from '../design-system/index.js';

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
    const editorial = data.supervisor?.editorial ?? {};
    const priorities = Array.isArray(editorial.priorities) ? editorial.priorities : [];
    const risks = Array.isArray(editorial.risks) ? editorial.risks : [];
    const opportunities = Array.isArray(editorial.opportunities) ? editorial.opportunities : [];
    const actions = Array.isArray(editorial.actions) ? editorial.actions : [];
    const outcomeReviews = data.supervisor?.outcomeReviews ?? {};
    const orchestrationReviews = data.supervisor?.orchestrationReviews ?? {};
    const renderItems = (items, empty) => items.length > 0
      ? `<ul>${items.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : `<p class="performance-empty">${empty}</p>`;

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
        <div class="supervisor-editorial-grid">
          <section>
            <h3>Planos operacionais</h3>
            <ul>
              <li>Aguardando revisão: ${escapeHtml(orchestrationReviews.awaitingReview ?? 0)}</li>
              <li>Aprovados: ${escapeHtml(orchestrationReviews.approved ?? 0)}</li>
              <li>Rejeitados: ${escapeHtml(orchestrationReviews.rejected ?? 0)}</li>
              <li>Bloqueados (24h): ${escapeHtml(orchestrationReviews.blockedRecently ?? 0)}</li>
              <li>Executados (24h): ${escapeHtml(orchestrationReviews.executedRecently ?? 0)}</li>
            </ul>
          </section>
          <section>
            <h3>Revisão de outcomes</h3>
            <ul>
              <li>Atuais: ${escapeHtml(outcomeReviews.current ?? 0)}</li>
              <li>Revisão disponível: ${escapeHtml(outcomeReviews.reviewAvailable ?? 0)}</li>
              <li>Inconclusivos: ${escapeHtml(outcomeReviews.insufficientData ?? 0)}</li>
              <li>Falhas recentes: ${escapeHtml(outcomeReviews.recentFailures ?? 0)}</li>
            </ul>
          </section>
          <section>
            <h3>Prioridades editoriais</h3>
            ${renderItems(priorities, 'Nenhuma decisão editorial recente.')}
          </section>
          <section>
            <h3>Riscos</h3>
            ${renderItems(risks, 'Nenhum risco editorial registrado.')}
          </section>
          <section>
            <h3>Oportunidades</h3>
            ${renderItems(opportunities, 'Nenhuma oportunidade editorial registrada.')}
          </section>
          <section>
            <h3>Próximas ações</h3>
            ${renderItems(actions, 'Nenhuma ação recomendada ainda.')}
          </section>
        </div>
      `,
    });
  },
};
