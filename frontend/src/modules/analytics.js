import { createPanel, html } from '../design-system/index.js';

const STATUS = {
  connected: ['Conectado', 'connected'],
  synchronized: ['Sincronizado', 'connected'],
  not_authorized: ['Autorizacao necessaria', 'pending'],
  not_configured: ['Nao configurado', 'pending'],
  temporary_error: ['Erro temporario', 'pending'],
};

const METRICS = [
  ['views', 'Views', 'number'],
  ['engagedViews', 'Views engajadas', 'number'],
  ['watchTimeMinutes', 'Watch time', 'minutes'],
  ['averageViewDurationSeconds', 'Duracao media', 'duration'],
  ['averageViewPercentage', 'Percentual medio', 'percent'],
  ['subscribersGained', 'Inscritos ganhos', 'number'],
  ['subscribersLost', 'Inscritos perdidos', 'number'],
  ['likes', 'Likes', 'number'],
  ['comments', 'Comentarios', 'number'],
];

const BASELINES = [
  ['views', 'Views'],
  ['watchTimeMinutes', 'Watch time'],
  ['averageViewDurationSeconds', 'Duracao media'],
  ['averageViewPercentage', 'Percentual medio'],
  ['subscribersGained', 'Inscritos por conteudo'],
  ['subscribersPerThousandViews', 'Inscritos por mil views'],
];

const CHANNEL_OPERATOR_VIEWS = new Map([
  ['ctr', 'CTR'],
  ['retention', 'Retenção'],
  ['long-form', 'Long-form'],
  ['shorts', 'Shorts'],
]);

const renderAnalyticsNavigation = (active = 'overview') => html`
  <nav class="analytics-subnav" aria-label="Áreas de Analytics">
    ${[
      ['overview', '/analytics', 'Visão geral'],
      ['ctr', '/analytics/ctr', 'CTR'],
      ['retention', '/analytics/retention', 'Retenção'],
      ['long-form', '/analytics/long-form', 'Long-form'],
      ['shorts', '/analytics/shorts', 'Shorts'],
      ['outcomes', '/analytics/outcomes', 'Outcomes'],
    ].map(([id, route, label]) => `<a href="#${route}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
  </nav>
`;

const classificationLabel = (value) => ({
  real: 'Fato observado',
  inference: 'Inferencia revisavel',
  recommendation: 'Recomendacao',
  unknown: 'Dados insuficientes',
}[value] ?? 'Classificacao indisponivel');

export const formatPerformanceValue = (value, kind = 'number') => {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  if (kind === 'percent') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(numeric)}%`;
  if (kind === 'minutes') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(numeric)} min`;
  if (kind === 'duration') {
    const seconds = Math.round(numeric);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(numeric);
};

const formatDateTime = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const dateInputValue = (date) => date.toISOString().slice(0, 10);

const defaultPeriod = () => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 28);
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) };
};

const createTextElement = (tag, text, className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

const replaceWithEmpty = (container, message) => {
  container.replaceChildren(createTextElement('p', message, 'performance-empty'));
};

const createMetricMarkup = () => METRICS.map(([field, label]) => html`
  <div class="performance-metric">
    <span>${label}</span>
    <strong data-performance-metric="${field}">--</strong>
  </div>
`).join('');

const createBaselineMarkup = () => BASELINES.map(([field, label]) => html`
  <div class="performance-baseline-row">
    <span>${label}</span>
    <strong data-baseline-median="${field}">--</strong>
    <small data-baseline-average="${field}">Media: --</small>
  </div>
`).join('');

const renderAnalytics = (active = 'overview') => {
  const period = defaultPeriod();
  return createPanel({
    eyebrow: 'Analytics',
    title: 'Performance do canal',
    className: 'analytics-panel performance-operations',
    body: html`
      ${renderAnalyticsNavigation(active)}
      <div class="performance-feedback" data-performance-feedback role="status" aria-live="polite" aria-atomic="true" hidden></div>

      <section class="performance-toolbar" aria-label="Sincronizacao do YouTube Analytics">
        <div class="performance-provider-state">
          <span>Provider YouTube Analytics</span>
          <strong class="status-pill pending" data-youtube-performance-status>Pendente</strong>
          <small>Ultima sincronizacao: <time data-youtube-last-sync>--</time></small>
        </div>
        <form class="performance-sync-form" data-performance-sync-form>
          <label>
            <span>Escopo</span>
            <select data-performance-mode>
              <option value="recent">Videos recentes</option>
              <option value="period">Periodo</option>
              <option value="video">Video especifico</option>
            </select>
          </label>
          <label>
            <span>Inicio</span>
            <input type="date" value="${period.startDate}" data-performance-start required>
          </label>
          <label>
            <span>Fim</span>
            <input type="date" value="${period.endDate}" data-performance-end required>
          </label>
          <label>
            <span>Limite</span>
            <input type="number" min="1" max="50" value="20" data-performance-limit required>
          </label>
          <label data-performance-video-field hidden>
            <span>ID do video</span>
            <input type="text" maxlength="64" data-performance-video-id>
          </label>
          <button class="button performance-sync-button" type="submit" data-performance-sync>
            Sincronizar
          </button>
        </form>
      </section>

      <section class="performance-section" aria-labelledby="performance-latest-title">
        <div class="performance-section-heading">
          <div>
            <p class="eyebrow">Ultimo snapshot</p>
            <h3 id="performance-latest-title" data-performance-video-title>Nenhuma coleta</h3>
          </div>
          <time data-performance-collected-at>--</time>
        </div>
        <div class="performance-metrics-grid">${createMetricMarkup()}</div>
      </section>

      <section class="performance-section" aria-labelledby="performance-baseline-title">
        <div class="performance-section-heading">
          <div>
            <p class="eyebrow">Baseline</p>
            <h3 id="performance-baseline-title">Referencia observada do canal</h3>
          </div>
          <span data-baseline-sample>Sem dados</span>
        </div>
        <div class="performance-baseline-grid">${createBaselineMarkup()}</div>
        <div class="performance-format-list" data-performance-formats></div>
      </section>

      <div class="performance-columns">
        <section class="performance-section" aria-labelledby="performance-signals-title">
          <div class="performance-section-heading">
            <div>
              <p class="eyebrow">Sinais</p>
              <h3 id="performance-signals-title">Evidencias de performance</h3>
            </div>
          </div>
          <div class="performance-list" data-performance-signals></div>
        </section>

        <section class="performance-section" aria-labelledby="channel-memory-title">
          <div class="performance-section-heading">
            <div>
              <p class="eyebrow">Memoria do canal</p>
              <h3 id="channel-memory-title">Aprendizados revisaveis</h3>
            </div>
          </div>
          <div class="performance-list" data-channel-learnings></div>
        </section>
      </div>

      <section class="performance-section" aria-labelledby="decision-evidence-title">
        <div class="performance-section-heading">
          <div>
            <p class="eyebrow">Decisoes</p>
            <h3 id="decision-evidence-title">Por que o sistema recomendou</h3>
          </div>
          <button class="button" type="button" data-review-outcomes>Revisar outcomes disponíveis</button>
        </div>
        <div class="performance-decision-layout">
          <div class="performance-list" data-performance-decisions></div>
          <div class="performance-decision-detail" data-decision-evidence>
            <p class="performance-empty">Selecione uma decisao para ver evidencias, riscos e dados ausentes.</p>
          </div>
        </div>
        <div class="performance-outcome-list" data-decision-outcomes></div>
      </section>
    `,
  });
};

const renderChannelOperator = (id) => createPanel({
  eyebrow: 'Operador especializado',
  title: CHANNEL_OPERATOR_VIEWS.get(id) ?? 'Analytics',
  className: 'analytics-panel channel-operator-workspace',
  body: html`
    ${renderAnalyticsNavigation(id)}
    <div class="performance-feedback" data-channel-operator-feedback role="status" aria-live="polite" aria-atomic="true">Carregando análise...</div>
    <section class="channel-operator-summary" data-channel-operator-summary data-operator-id="${id}" aria-busy="true">
      <div class="channel-operator-heading">
        <div><p class="eyebrow">Responsabilidade</p><p data-channel-operator-responsibility>Consultando dados persistidos...</p></div>
        <strong class="operator-status" data-channel-operator-status>Pendente</strong>
      </div>
      <dl class="channel-operator-meta" data-channel-operator-meta></dl>
      <div class="channel-operator-columns">
        <section><h3>Fatos</h3><div data-channel-operator-facts></div></section>
        <section><h3>Sinais</h3><div data-channel-operator-signals></div></section>
        <section><h3>Insights</h3><div data-channel-operator-insights></div></section>
        <section><h3>Recomendações</h3><div data-channel-operator-recommendations></div></section>
      </div>
      <section class="channel-operator-evidence"><h3>Evidências</h3><div data-channel-operator-evidence></div></section>
      <section class="channel-operator-missing"><h3>Dados ausentes</h3><div data-channel-operator-missing></div></section>
    </section>
  `,
});

const createChannelOperatorController = ({ api }) => {
  let mountedPanel = null;
  let generation = 0;

  const mount = (root) => {
    const panel = root?.querySelector?.('.channel-operator-workspace');
    if (!panel || panel === mountedPanel) return;
    mountedPanel = panel;
    const token = ++generation;
    const summary = panel.querySelector('[data-channel-operator-summary]');
    const id = summary?.dataset.operatorId;
    const feedback = panel.querySelector('[data-channel-operator-feedback]');
    const isCurrent = () => panel === mountedPanel && token === generation;
    const setList = (selector, items, formatter) => {
      const container = panel.querySelector(selector);
      const values = Array.isArray(items) ? items : [];
      if (!values.length) {
        container.replaceChildren(createTextElement('p', 'Nenhum dado disponível.', 'performance-empty'));
        return;
      }
      const list = document.createElement('ul');
      list.append(...values.map((item) => createTextElement('li', formatter(item))));
      container.replaceChildren(list);
    };
    api.getChannelOperator(id).then((analysis) => {
      if (!isCurrent()) return;
      panel.querySelector('[data-channel-operator-responsibility]').textContent = analysis.responsibility;
      const status = panel.querySelector('[data-channel-operator-status]');
      status.textContent = ({ AVAILABLE: 'Disponível', LIMITED: 'Limitado', NOT_CONFIGURED: 'Não configurado' })[analysis.status] ?? analysis.status;
      status.className = `operator-status ${String(analysis.status).toLowerCase().replace('_', '-')}`;
      const meta = panel.querySelector('[data-channel-operator-meta]');
      const metadata = [
        ['Fonte', analysis.source],
        ['Amostra', String(analysis.sampleSize ?? 0)],
        ['Confiança', `${Math.round(Number(analysis.confidence ?? 0) * 100)}%`],
        ['Último dado', formatDateTime(analysis.lastDataAt)],
      ];
      meta.replaceChildren(...metadata.map(([label, value]) => {
        const row = document.createElement('div');
        row.append(createTextElement('dt', label), createTextElement('dd', value));
        return row;
      }));
      setList('[data-channel-operator-facts]', analysis.facts, (fact) => `${fact.label}: ${formatPerformanceValue(fact.value, fact.unit === 'seconds' ? 'duration' : fact.unit)}`);
      setList('[data-channel-operator-signals]', analysis.signals, (signal) => `${classificationLabel(signal.classification)}: ${signal.summary}`);
      setList('[data-channel-operator-insights]', analysis.insights, (value) => value);
      setList('[data-channel-operator-recommendations]', analysis.recommendations, (value) => value);
      setList('[data-channel-operator-missing]', analysis.missingData, (value) => value);
      setList('[data-channel-operator-evidence]', analysis.evidence, (item) => `${item.title} (${item.videoId}) — ${formatDateTime(item.collectedAt)}`);
      feedback.textContent = '';
      feedback.hidden = true;
      summary.setAttribute('aria-busy', 'false');
    }).catch((error) => {
      if (!isCurrent()) return;
      feedback.textContent = error?.status === 404 ? 'Este operador não está disponível.' : 'Não foi possível carregar esta análise.';
      feedback.className = 'performance-feedback error';
      summary.setAttribute('aria-busy', 'false');
    });
  };

  const unmount = () => {
    mountedPanel = null;
    generation += 1;
  };
  return { mount, unmount };
};

const errorMessage = (error, action = 'load') => {
  if (error?.status === 401) return 'Autorize o Google para acessar o YouTube Analytics.';
  if (error?.status === 429) return 'A cota do YouTube Analytics esta temporariamente indisponivel.';
  if (error?.status === 404) return action === 'decision'
    ? 'Esta decisao nao esta mais disponivel.'
    : 'O video informado nao foi encontrado.';
  if (error?.status === 503) return 'O YouTube Analytics esta indisponivel ou ainda nao foi configurado.';
  if (error?.status === 400) return 'Revise o periodo e os parametros da sincronizacao.';
  if (error instanceof TypeError) return 'Nao foi possivel conectar ao backend.';
  return action === 'sync'
    ? 'Nao foi possivel sincronizar os dados. Tente novamente.'
    : 'Nao foi possivel carregar todos os dados de performance.';
};

export const createAnalyticsController = ({ api }) => {
  let mountedRoot = null;
  let generation = 0;
  let syncing = false;
  let reviewingAll = false;
  const reviewingOutcomes = new Set();
  let decisionRequest = 0;
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.performance-operations');
    if (!panel || panel === mountedRoot) return;
    cleanup();
    mountedRoot = panel;
    const mountToken = ++generation;
    const isCurrent = () => mountedRoot === panel && generation === mountToken;

    const elements = {
      feedback: panel.querySelector('[data-performance-feedback]'),
      status: panel.querySelector('[data-youtube-performance-status]'),
      lastSync: panel.querySelector('[data-youtube-last-sync]'),
      form: panel.querySelector('[data-performance-sync-form]'),
      mode: panel.querySelector('[data-performance-mode]'),
      start: panel.querySelector('[data-performance-start]'),
      end: panel.querySelector('[data-performance-end]'),
      limit: panel.querySelector('[data-performance-limit]'),
      videoField: panel.querySelector('[data-performance-video-field]'),
      videoId: panel.querySelector('[data-performance-video-id]'),
      syncButton: panel.querySelector('[data-performance-sync]'),
      videoTitle: panel.querySelector('[data-performance-video-title]'),
      collectedAt: panel.querySelector('[data-performance-collected-at]'),
      formats: panel.querySelector('[data-performance-formats]'),
      signals: panel.querySelector('[data-performance-signals]'),
      learnings: panel.querySelector('[data-channel-learnings]'),
      decisions: panel.querySelector('[data-performance-decisions]'),
      decisionEvidence: panel.querySelector('[data-decision-evidence]'),
      outcomes: panel.querySelector('[data-decision-outcomes]'),
      reviewOutcomes: panel.querySelector('[data-review-outcomes]'),
      baselineSample: panel.querySelector('[data-baseline-sample]'),
    };
    if (Object.values(elements).some((element) => !element)) return;

    const setFeedback = (message = '', variant = 'info') => {
      elements.feedback.textContent = message;
      elements.feedback.hidden = !message;
      elements.feedback.className = `performance-feedback ${variant}`;
    };

    const setStatus = (state) => {
      const [label, variant] = STATUS[state] ?? ['Pendente', 'pending'];
      elements.status.textContent = label;
      elements.status.className = `status-pill ${variant}`;
    };

    const setSyncBusy = (busy) => {
      elements.syncButton.disabled = busy;
      elements.syncButton.setAttribute('aria-busy', String(busy));
      panel.setAttribute('aria-busy', String(busy));
    };

    const renderRecords = (records) => {
      const latest = Array.isArray(records) ? records[0] : null;
      elements.videoTitle.textContent = latest?.title ?? 'Nenhuma coleta';
      elements.collectedAt.textContent = formatDateTime(latest?.collectedAt);
      for (const [field, , kind] of METRICS) {
        const target = panel.querySelector(`[data-performance-metric="${field}"]`);
        if (target) target.textContent = formatPerformanceValue(latest?.[field], kind);
      }
    };

    const renderBaseline = (baseline) => {
      const sampleSizes = [];
      for (const [field] of BASELINES) {
        const metric = baseline?.[field];
        const medianTarget = panel.querySelector(`[data-baseline-median="${field}"]`);
        const averageTarget = panel.querySelector(`[data-baseline-average="${field}"]`);
        const kind = field === 'averageViewPercentage' ? 'percent'
          : field === 'watchTimeMinutes' ? 'minutes'
            : field === 'averageViewDurationSeconds' ? 'duration' : 'number';
        if (medianTarget) medianTarget.textContent = formatPerformanceValue(metric?.median, kind);
        if (averageTarget) averageTarget.textContent = `Media: ${formatPerformanceValue(metric?.average, kind)}`;
        if (Number.isInteger(metric?.sampleSize)) sampleSizes.push(metric.sampleSize);
      }
      const sample = sampleSizes.length > 0 ? Math.max(...sampleSizes) : 0;
      elements.baselineSample.textContent = sample === 0
        ? 'Sem dados'
        : sample < 3 ? `Amostra inicial: ${sample}` : `${sample} videos na amostra`;

      const formats = Object.entries(baseline?.byFormat ?? {});
      if (formats.length === 0) {
        replaceWithEmpty(elements.formats, 'Sem comparacoes por formato.');
        return;
      }
      elements.formats.replaceChildren(...formats.map(([format, values]) => {
        const row = document.createElement('div');
        row.className = 'performance-format-row';
        row.append(
          createTextElement('strong', format),
          createTextElement('span', `Mediana de views: ${formatPerformanceValue(values?.views?.median)}`),
          createTextElement('small', `Amostra: ${values?.views?.sampleSize ?? 0}`),
        );
        return row;
      }));
    };

    const renderSignals = (signals) => {
      if (!Array.isArray(signals) || signals.length === 0) {
        replaceWithEmpty(elements.signals, 'Nenhum sinal de performance disponivel.');
        return;
      }
      elements.signals.replaceChildren(...signals.slice(0, 12).map((signal) => {
        const row = document.createElement('article');
        row.className = 'performance-list-item';
        row.append(
          createTextElement('strong', signal.metric ?? 'Sinal'),
          createTextElement('span', `${classificationLabel(signal.classification)} · Score ${formatPerformanceValue(signal.value)}`),
          createTextElement('small', `${signal.source ?? 'Fonte indisponivel'} · Confianca ${formatPerformanceValue((signal.confidence ?? 0) * 100, 'percent')} · ${formatDateTime(signal.measuredAt)}`),
        );
        return row;
      }));
    };

    const renderLearnings = (learnings) => {
      if (!Array.isArray(learnings) || learnings.length === 0) {
        replaceWithEmpty(elements.learnings, 'Nenhum aprendizado consolidado ainda.');
        return;
      }
      elements.learnings.replaceChildren(...learnings.slice(0, 12).map((learning) => {
        const row = document.createElement('article');
        row.className = 'performance-list-item';
        const sample = learning.evidence && typeof learning.evidence === 'object'
          ? learning.evidence.sampleSize : undefined;
        row.append(
          createTextElement('strong', learning.subject ?? 'Aprendizado'),
          createTextElement('span', learning.statement ?? 'Conteudo indisponivel'),
          createTextElement('small', `${classificationLabel(learning.classification)} · Confianca ${formatPerformanceValue((learning.confidence ?? 0) * 100, 'percent')}${Number.isInteger(sample) ? ` · Amostra ${sample}` : ''}`),
        );
        return row;
      }));
    };

    const renderDecisions = (context) => {
      const decisions = context?.previousDecisions;
      if (!Array.isArray(decisions) || decisions.length === 0) {
        replaceWithEmpty(elements.decisions, 'Nenhuma decisao persistida para explicar.');
        return;
      }
      elements.decisions.replaceChildren(...decisions.slice(0, 10).map((decision) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'performance-decision-button';
        button.dataset.decisionId = decision.id;
        button.append(
          createTextElement('strong', `${decision.category ?? 'Decisao'} · ${formatPerformanceValue(decision.score)}`),
          createTextElement('span', decision.rationale ?? 'Justificativa indisponivel'),
        );
        return button;
      }));
    };

    const renderDecisionEvidence = (decision) => {
      const evidence = decision?.evidence && typeof decision.evidence === 'object'
        ? decision.evidence : {};
      const content = document.createElement('div');
      content.className = 'performance-evidence-content';
      content.append(
        createTextElement('strong', `${decision?.category ?? 'Decisao'} · Score ${formatPerformanceValue(decision?.score)}`),
        createTextElement('p', decision?.rationale ?? 'Justificativa indisponivel'),
        createTextElement('small', `${classificationLabel(evidence.classification)} · Confianca ${formatPerformanceValue((evidence.confidence ?? 0) * 100, 'percent')}`),
      );
      const groups = [
        ['Evidencias usadas', Array.isArray(evidence.components) ? evidence.components.map((item) => item.rationale).filter(Boolean) : []],
        ['Riscos', Array.isArray(evidence.risks) ? evidence.risks : []],
        ['Dados ausentes', Array.isArray(evidence.missingData) ? evidence.missingData : []],
      ];
      for (const [title, items] of groups) {
        const section = document.createElement('section');
        section.append(createTextElement('h4', title));
        if (items.length === 0) section.append(createTextElement('p', 'Nenhum item registrado.', 'performance-empty'));
        else {
          const list = document.createElement('ul');
          list.append(...items.map((item) => createTextElement('li', String(item))));
          section.append(list);
        }
        content.append(section);
      }
      elements.decisionEvidence.replaceChildren(content);
    };

    const renderOutcomes = (reviewStates) => {
      if (!Array.isArray(reviewStates) || reviewStates.length === 0) {
        replaceWithEmpty(elements.outcomes, 'Nenhum vídeo ligado a uma decisão foi avaliado ainda.');
        return;
      }
      elements.outcomes.replaceChildren(...reviewStates.slice(0, 8).map((reviewState) => {
        const outcome = reviewState?.outcome ?? reviewState;
        const row = document.createElement('article');
        row.className = 'performance-outcome-item';
        const decision = outcome.decisionVideoLink?.decision;
        const snapshot = outcome.snapshot;
        const supporting = Array.isArray(outcome.supportingMetrics) ? outcome.supportingMetrics : [];
        const contradicting = Array.isArray(outcome.contradictingMetrics) ? outcome.contradictingMetrics : [];
        const state = reviewState?.state ?? 'current';
        const stateLabels = {
          current: 'Atual',
          review_available: 'Revisão disponível',
          stale: 'Histórico',
          insufficient_data: 'Dados insuficientes',
        };
        row.dataset.outcomeId = outcome.id;
        row.append(
          createTextElement('strong', snapshot?.title ?? outcome.decisionVideoLink?.videoId ?? 'Vídeo avaliado'),
          createTextElement('span', decision?.recommendation ?? 'Recomendação original indisponível'),
          createTextElement('small', `${outcome.classification ?? 'INCONCLUSIVE'} · Confiança ${formatPerformanceValue((outcome.confidence ?? 0) * 100, 'percent')}`),
          createTextElement('p', outcome.interpretation?.summary ?? 'Interpretação indisponível'),
          createTextElement('small', `Sustentam: ${supporting.map((item) => item.label ?? item.metric).filter(Boolean).slice(0, 3).join(', ') || '--'} · Contradizem: ${contradicting.map((item) => item.label ?? item.metric).filter(Boolean).slice(0, 3).join(', ') || '--'}`),
          createTextElement('small', `${stateLabels[state] ?? state} · Última avaliação ${formatDateTime(reviewState?.lastEvaluationAt ?? outcome.evaluatedAt)}`),
        );
        if (state === 'review_available' && typeof api.reviewDecisionOutcome === 'function') {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'button performance-outcome-review';
          button.dataset.reviewOutcome = outcome.id;
          button.textContent = 'Reavaliar';
          button.disabled = reviewingOutcomes.has(outcome.id);
          row.append(button);
        }
        return row;
      }));
    };

    const load = async ({ quiet = false } = {}) => {
      if (!quiet) {
        panel.setAttribute('aria-busy', 'true');
        setFeedback('Carregando dados de performance...');
      }
      const requests = await Promise.allSettled([
        api.getYouTubePerformanceStatus(),
        api.getYouTubeLastSync(),
        api.listPerformanceRecords(),
        api.getPerformanceBaseline(),
        api.listPerformanceSignals(),
        api.listChannelLearnings(),
        api.getCreatorIntelligenceContext(),
        typeof api.listOutcomeReviewStates === 'function'
          ? api.listOutcomeReviewStates()
          : typeof api.listDecisionOutcomes === 'function'
            ? api.listDecisionOutcomes({ limit: 8 })
            : Promise.resolve([]),
      ]);
      if (!isCurrent()) return false;
      const [status, lastSync, records, baseline, signals, learnings, context, outcomes] = requests;
      if (status.status === 'fulfilled') setStatus(status.value?.state);
      if (lastSync.status === 'fulfilled') elements.lastSync.textContent = formatDateTime(lastSync.value?.lastSyncAt);
      if (records.status === 'fulfilled') renderRecords(records.value);
      else renderRecords([]);
      if (baseline.status === 'fulfilled') renderBaseline(baseline.value);
      else renderBaseline(null);
      if (signals.status === 'fulfilled') renderSignals(signals.value);
      else replaceWithEmpty(elements.signals, 'Nao foi possivel carregar os sinais.');
      if (learnings.status === 'fulfilled') renderLearnings(learnings.value);
      else replaceWithEmpty(elements.learnings, 'Nao foi possivel carregar os aprendizados.');
      if (context.status === 'fulfilled') renderDecisions(context.value);
      else replaceWithEmpty(elements.decisions, 'Nao foi possivel carregar as decisoes.');
      if (outcomes.status === 'fulfilled') renderOutcomes(outcomes.value);
      else replaceWithEmpty(elements.outcomes, 'Nao foi possivel carregar os resultados editoriais.');
      const failed = requests.find((request) => request.status === 'rejected');
      if (failed && !quiet) setFeedback(errorMessage(failed.reason), 'error');
      else if (!quiet) setFeedback('');
      if (!quiet) panel.setAttribute('aria-busy', 'false');
      return !failed;
    };

    const updateVideoField = () => {
      const visible = elements.mode.value === 'video';
      elements.videoField.hidden = !visible;
      elements.videoId.disabled = !visible;
      elements.videoId.required = visible;
    };

    const handleSync = async (event) => {
      event.preventDefault();
      if (syncing) return;
      syncing = true;
      setSyncBusy(true);
      setFeedback('Sincronizando dados do YouTube Analytics...');
      const input = {
        mode: elements.mode.value,
        startDate: elements.start.value,
        endDate: elements.end.value,
        limit: Number(elements.limit.value),
      };
      if (input.mode === 'video') input.videoId = elements.videoId.value.trim();
      try {
        const result = await api.syncYouTubePerformance(input);
        if (!isCurrent()) return;
        const refreshed = await load({ quiet: true });
        if (!isCurrent()) return;
        const processed = Number(result?.created ?? 0) + Number(result?.updated ?? 0);
        const suffix = refreshed ? '' : ' Alguns paineis nao puderam ser atualizados.';
        setFeedback(`Sincronizacao concluida: ${processed} registro(s) processado(s).${suffix}`, refreshed ? 'success' : 'warning');
      } catch (error) {
        if (isCurrent()) setFeedback(errorMessage(error, 'sync'), 'error');
      } finally {
        syncing = false;
        if (isCurrent()) setSyncBusy(false);
      }
    };

    const handleDecisionClick = async (event) => {
      const button = event.target.closest?.('[data-decision-id]');
      if (!button) return;
      const token = ++decisionRequest;
      elements.decisionEvidence.setAttribute('aria-busy', 'true');
      try {
        const decision = await api.getDecisionEvidence(button.dataset.decisionId);
        if (!isCurrent() || token !== decisionRequest) return;
        renderDecisionEvidence(decision);
        setFeedback('');
      } catch (error) {
        if (isCurrent() && token === decisionRequest) setFeedback(errorMessage(error, 'decision'), 'error');
      } finally {
        if (isCurrent() && token === decisionRequest) elements.decisionEvidence.setAttribute('aria-busy', 'false');
      }
    };

    const handleOutcomeClick = async (event) => {
      const button = event.target.closest?.('[data-review-outcome]');
      const outcomeId = button?.dataset.reviewOutcome;
      if (!outcomeId || reviewingOutcomes.has(outcomeId)) return;
      reviewingOutcomes.add(outcomeId);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const result = await api.reviewDecisionOutcome(outcomeId);
        if (!isCurrent()) return;
        await load({ quiet: true });
        if (!isCurrent()) return;
        setFeedback(result?.status === 'failed'
          ? 'Não foi possível concluir a revisão deste outcome.'
          : 'Outcome revisado com os dados disponíveis.', result?.status === 'failed' ? 'error' : 'success');
      } catch {
        if (isCurrent()) setFeedback('Não foi possível revisar este outcome.', 'error');
      } finally {
        reviewingOutcomes.delete(outcomeId);
        if (isCurrent()) {
          button.disabled = false;
          button.setAttribute('aria-busy', 'false');
        }
      }
    };

    const handleReviewAll = async () => {
      if (reviewingAll || typeof api.reviewAvailableOutcomes !== 'function') return;
      reviewingAll = true;
      elements.reviewOutcomes.disabled = true;
      elements.reviewOutcomes.setAttribute('aria-busy', 'true');
      try {
        const summary = await api.reviewAvailableOutcomes();
        if (!isCurrent()) return;
        await load({ quiet: true });
        if (!isCurrent()) return;
        setFeedback(`Revisão concluída: ${summary?.reviewed ?? 0} alterado(s), ${summary?.unchanged ?? 0} sem mudança e ${summary?.failed ?? 0} falha(s).`, summary?.failed ? 'warning' : 'success');
      } catch {
        if (isCurrent()) setFeedback('Não foi possível revisar os outcomes disponíveis.', 'error');
      } finally {
        reviewingAll = false;
        if (isCurrent()) {
          elements.reviewOutcomes.disabled = false;
          elements.reviewOutcomes.setAttribute('aria-busy', 'false');
        }
      }
    };

    elements.form.addEventListener('submit', handleSync);
    elements.mode.addEventListener('change', updateVideoField);
    elements.decisions.addEventListener('click', handleDecisionClick);
    elements.outcomes.addEventListener('click', handleOutcomeClick);
    elements.reviewOutcomes.addEventListener('click', handleReviewAll);
    updateVideoField();
    load();

    cleanup = () => {
      elements.form.removeEventListener('submit', handleSync);
      elements.mode.removeEventListener('change', updateVideoField);
      elements.decisions.removeEventListener('click', handleDecisionClick);
      elements.outcomes.removeEventListener('click', handleOutcomeClick);
      elements.reviewOutcomes.removeEventListener('click', handleReviewAll);
    };
  };

  const unmount = () => {
    cleanup();
    cleanup = () => {};
    mountedRoot = null;
    generation += 1;
    decisionRequest += 1;
  };

  return { mount, unmount };
};

export const analyticsModule = {
  id: 'analytics',
  route: '/analytics',
  allowSubroutes: true,
  pageTitle: 'Analytics',
  pageEyebrow: 'Inteligencia de performance',
  label: 'Analytics',
  render(_data, context = {}) {
    const view = context.route?.subpath || 'overview';
    return CHANNEL_OPERATOR_VIEWS.has(view) ? renderChannelOperator(view) : renderAnalytics(view);
  },
  createController(context) {
    const overview = createAnalyticsController(context);
    const channelOperator = createChannelOperatorController(context);
    return {
      mount(root) {
        if (root?.querySelector?.('.channel-operator-workspace')) channelOperator.mount(root);
        else overview.mount(root);
      },
      unmount() {
        overview.unmount();
        channelOperator.unmount();
      },
    };
  },
};
