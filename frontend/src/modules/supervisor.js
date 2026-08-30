import { createPanel, createStatusPill, escapeHtml, html } from '../design-system/index.js';
import { integrationFrom, operationalStatus } from '../utils/operational-status.js';

const youtubeAnalyticsStatus = {
  connected: { label: 'Conectado', variant: 'connected' },
  synchronized: { label: 'Sincronizado', variant: 'connected' },
  not_authorized: { label: 'Autorizacao necessaria', variant: 'pending' },
  not_configured: { label: 'Nao configurado', variant: 'pending' },
  temporary_error: { label: 'Erro temporario', variant: 'pending' },
};

export const supervisorModule = {
  id: 'supervisor',
  route: '/supervisor',
  pageTitle: 'Supervisor',
  pageEyebrow: 'Estado operacional',
  refreshOnDashboardData: true,
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
    const insufficientDecisions = editorial.insufficientData ?? 0;
    const conflictingDecisions = editorial.conflictingSignals ?? 0;
    const outcomeReviews = data.supervisor?.outcomeReviews ?? {};
    const orchestrationReviews = data.supervisor?.orchestrationReviews ?? {};
    const automations = data.supervisor?.automations ?? {};
    const automationRuntime = automations.runtime ?? {};
    const automationGovernance = automations.governance ?? {};
    const channelOperators = Array.isArray(data.supervisor?.channelOperators)
      ? data.supervisor.channelOperators
      : [];
    const dataQuality = Array.isArray(data.supervisor?.dataQuality) ? data.supervisor.dataQuality : [];
    const temporal = data.supervisor?.temporalIntelligence ?? {};
    const temporalHighlights = Array.isArray(temporal.highlights) ? temporal.highlights : [];
    const research = data.supervisor?.research ?? {};
    const integrationPill = (id, fallback) => {
      const integration = integrationFrom(data, id);
      if (!integration && fallback) {
        return createStatusPill(fallback.label, fallback.variant);
      }
      const value = operationalStatus(integration?.state);
      return createStatusPill(value.label, value.variant);
    };
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
            ${integrationPill('youtubeData', status.youtubeConnected
              ? { label: 'Conectado', variant: 'connected' }
              : { label: 'Nao conectado', variant: 'pending' })}
          </div>
          <div>
            <span>YouTube Analytics</span>
            ${integrationPill('youtubeAnalytics', analytics)}
          </div>
          <div>
            <span>YouTube Reach</span>
            ${integrationPill('youtubeReach')}
          </div>
          <div>
            <span>IA</span>
            ${integrationPill('openai', status.aiConfigured
              ? { label: 'Configurada', variant: 'connected' }
              : { label: 'Nao configurada', variant: 'pending' })}
          </div>
          <div>
            <span>Automacoes</span>
            ${integrationPill('automationRuntime', status.automationConfigured
              ? { label: 'Ativas', variant: 'connected' }
              : { label: 'Sem rotinas ativas', variant: 'pending' })}
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
            <h3>Automações controladas</h3>
            <ul>
              <li>Ativas: ${escapeHtml(automations.active ?? 0)}</li>
              <li>Vencidas: ${escapeHtml(automations.due ?? 0)}</li>
              <li>Pausadas: ${escapeHtml(automations.paused ?? 0)}</li>
              <li>Bloqueadas: ${escapeHtml(automations.blocked ?? 0)}</li>
              <li>Com erro: ${escapeHtml(automations.error ?? 0)}</li>
              <li>Em execução: ${escapeHtml(automations.running ?? 0)}</li>
              <li>Runtime: ${escapeHtml(automationRuntime.status ?? 'STOPPED')}</li>
              <li>Último tick: ${escapeHtml(automationRuntime.lastTickAt ?? '--')}</li>
              <li>Saudáveis: ${escapeHtml(automationGovernance.healthy ?? 0)}</li>
              <li>Degradadas: ${escapeHtml(automationGovernance.degraded ?? 0)}</li>
              <li>Bloqueadas: ${escapeHtml(automationGovernance.blocked ?? 0)}</li>
              <li>Falhando: ${escapeHtml(automationGovernance.failing ?? 0)}</li>
              <li>Quotas atingidas: ${escapeHtml(automationGovernance.quotasReached ?? 0)}</li>
              <li>Pausadas por falha: ${escapeHtml(automationGovernance.pausedByFailure ?? 0)}</li>
              <li>Retries pendentes: ${escapeHtml(automationGovernance.retriesPending ?? 0)}</li>
              <li>Aprovações pendentes: ${escapeHtml(automationGovernance.approvalsPending ?? 0)}</li>
            </ul>
          </section>
          <section>
            <h3>Operadores do canal</h3>
            ${channelOperators.length > 0 ? `<ul>${channelOperators.map((operator) => `<li>${escapeHtml(operator.summary ?? `${operator.id}: ${operator.status}`)} · confiança ${escapeHtml(Math.round(Number(operator.confidence ?? 0) * 100))}%</li>`).join('')}</ul>` : '<p class="performance-empty">Sem estado dos operadores especializados.</p>'}
          </section>
          <section>
            <h3>Tendências e séries</h3>
            ${renderItems(temporalHighlights, 'Ainda não há sinais temporais com evidência suficiente.')}
          </section>
          <section>
            <h3>Pesquisa e oportunidades</h3>
            <ul>
              <li>Pesquisas recentes: ${escapeHtml(research.totalResearches ?? 0)}</li>
              <li>Oportunidades: ${escapeHtml(research.opportunities ?? 0)}</li>
              <li>Baixa confiança: ${escapeHtml(research.lowConfidence ?? 0)}</li>
              <li>Conflitos: ${escapeHtml(research.conflicts ?? 0)}</li>
              <li>Qualidade: ${escapeHtml(research.quality ?? 'MISSING')} · ${escapeHtml(research.freshness ?? 'MISSING')}</li>
            </ul>
          </section>
          <section>
            <h3>Qualidade dos dados</h3>
            ${dataQuality.length > 0 ? `<ul>${dataQuality.map((item) => `<li>${escapeHtml(item.area)}: ${escapeHtml(item.state)} · ${escapeHtml(item.summary)}</li>`).join('')}</ul>` : '<p class="performance-empty">Sem diagnóstico de qualidade.</p>'}
          </section>
          <section>
            <h3>Prioridades editoriais</h3>
            ${renderItems(priorities, 'Nenhuma decisão editorial recente.')}
          </section>
          <section>
            <h3>Riscos</h3>
            <p>Dados insuficientes: ${escapeHtml(insufficientDecisions)} · Sinais conflitantes: ${escapeHtml(conflictingDecisions)}</p>
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
