import { createPanel, html } from '../design-system/index.js';

const QUEUES = ['NEXT', 'LATER', 'WAITING', 'BLOCKED', 'DONE'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'EXPERIMENTAL'];

const text = (tag, value, className = '') => {
  const element = document.createElement(tag);
  element.textContent = String(value ?? '');
  if (className) element.className = className;
  return element;
};

const button = (label, title, dataset = {}, className = 'icon-button') => {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className; element.textContent = label;
  element.title = title; element.setAttribute('aria-label', title);
  Object.assign(element.dataset, dataset);
  return element;
};

const renderStrategicPlanning = () => createPanel({
  eyebrow: 'Planejamento',
  title: 'Plano estratégico de conteúdo',
  className: 'strategic-planning-panel',
  body: html`
    <div class="performance-feedback" data-planning-feedback role="status" aria-live="polite" hidden></div>
    <form class="planning-toolbar" data-planning-generate-form>
      <label for="planningHorizon">Horizonte</label>
      <select id="planningHorizon" data-planning-horizon>
        <option value="TODAY">Hoje</option>
        <option value="NEXT_3_DAYS">Próximos 3 dias</option>
        <option value="NEXT_7_DAYS" selected>Próximos 7 dias</option>
        <option value="NEXT_14_DAYS">Próximos 14 dias</option>
      </select>
      <button class="button" type="submit" data-planning-generate>Gerar plano</button>
    </form>
    <section class="planning-now" aria-labelledby="planning-now-title">
      <div class="planning-section-heading">
        <div><p class="eyebrow">Prioridade operacional</p><h3 id="planning-now-title">O que fazer agora</h3></div>
        <div data-planning-meta></div>
      </div>
      <div data-planning-now><p class="performance-empty">Carregando plano atual...</p></div>
    </section>
    <div class="planning-workspace">
      <section aria-labelledby="planning-queue-title">
        <h3 id="planning-queue-title">Fila editorial</h3>
        <div class="planning-queue" data-planning-queue aria-live="polite"></div>
      </section>
      <aside class="planning-detail" aria-labelledby="planning-detail-title">
        <h3 id="planning-detail-title">Detalhes e evidências</h3>
        <div data-planning-detail><p class="performance-empty">Selecione um item da fila.</p></div>
      </aside>
    </div>
    <section class="planning-execution-history" aria-labelledby="planning-execution-history-title">
      <div class="planning-section-heading">
        <div><p class="eyebrow">Auditoria</p><h3 id="planning-execution-history-title">Histórico de execução</h3></div>
      </div>
      <div data-planning-execution-history><p class="performance-empty">Nenhuma ação executada neste plano.</p></div>
    </section>
    <section class="planning-outcomes" aria-labelledby="planning-outcomes-title">
      <div class="planning-section-heading">
        <div><p class="eyebrow">Feedback loop</p><h3 id="planning-outcomes-title">Resultados</h3></div>
      </div>
      <div data-planning-outcomes><p class="performance-empty">Selecione um item concluido para acompanhar o resultado.</p></div>
    </section>
    <section class="planning-learnings" aria-labelledby="planning-learnings-title">
      <div class="planning-section-heading">
        <div><p class="eyebrow">Memoria estrategica</p><h3 id="planning-learnings-title">Aprendizados</h3></div>
        <button class="button secondary" type="button" data-planning-learning-refresh>Atualizar aprendizados</button>
      </div>
      <div class="planning-learning-workspace">
        <div data-planning-learnings aria-live="polite"><p class="performance-empty">Carregando aprendizados...</p></div>
        <aside data-planning-learning-detail><p class="performance-empty">Selecione um aprendizado para ver as evidencias.</p></aside>
      </div>
    </section>
    <section class="planning-experiments" aria-labelledby="planning-experiments-title">
      <div class="planning-section-heading">
        <div><p class="eyebrow">Teste controlado</p><h3 id="planning-experiments-title">Experimentos</h3></div>
      </div>
      <form class="planning-experiment-form" data-planning-experiment-form>
        <input type="text" data-experiment-title placeholder="Nome do experimento" maxlength="180" required>
        <input type="text" data-experiment-hypothesis placeholder="Hipotese observacional" maxlength="1000" required>
        <select data-experiment-metric aria-label="Metrica primaria">
          <option value="views">Views</option><option value="ctr">CTR</option><option value="watchTimeMinutes">Watch time</option>
          <option value="averageViewPercentage">Retencao media</option><option value="subscribersGained">Inscritos</option>
        </select>
        <input type="text" data-experiment-variant-a placeholder="Variante A" maxlength="180" required>
        <input type="text" data-experiment-variant-b placeholder="Variante B" maxlength="180" required>
        <button class="button" type="submit" data-experiment-create>Criar experimento</button>
      </form>
      <div class="planning-experiment-workspace">
        <div data-planning-experiments aria-live="polite"><p class="performance-empty">Carregando experimentos...</p></div>
        <aside data-planning-experiment-detail><p class="performance-empty">Selecione um experimento para ver variantes e evidencias.</p></aside>
      </div>
    </section>
  `,
});

export const createStrategicPlanningController = ({ api }) => {
  let mounted = null;
  let generation = 0;
  let loadRequest = 0;
  let plan = null;
  let selectedItemId = null;
  let generating = false;
  let executionHistory = [];
  let historyRequest = 0;
  let outcomeRequest = 0;
  let outcomeState = null;
  let outcomePending = false;
  let learningRequest = 0;
  let learningDetailRequest = 0;
  let learningPending = false;
  let strategicLearnings = [];
  let selectedLearningId = null;
  let experimentRequest = 0;
  let experimentDetailRequest = 0;
  let experimentPending = false;
  let strategicExperiments = [];
  let selectedExperimentId = null;
  const executionNotes = new Map();
  const pendingItems = new Set();
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.strategic-planning-panel');
    if (!panel || panel === mounted) return;
    cleanup(); mounted = panel;
    const token = ++generation;
    const current = () => mounted === panel && generation === token;
    const form = panel.querySelector('[data-planning-generate-form]');
    const horizon = panel.querySelector('[data-planning-horizon]');
    const generateButton = panel.querySelector('[data-planning-generate]');
    const feedback = panel.querySelector('[data-planning-feedback]');
    const meta = panel.querySelector('[data-planning-meta]');
    const now = panel.querySelector('[data-planning-now]');
    const queue = panel.querySelector('[data-planning-queue]');
    const detail = panel.querySelector('[data-planning-detail]');
    const history = panel.querySelector('[data-planning-execution-history]');
    const outcomes = panel.querySelector('[data-planning-outcomes]');
    const learnings = panel.querySelector('[data-planning-learnings]');
    const learningDetail = panel.querySelector('[data-planning-learning-detail]');
    const learningRefresh = panel.querySelector('[data-planning-learning-refresh]');
    const experiments = panel.querySelector('[data-planning-experiments]');
    const experimentDetail = panel.querySelector('[data-planning-experiment-detail]');
    const experimentForm = panel.querySelector('[data-planning-experiment-form]');
    if (![form, horizon, generateButton, feedback, meta, now, queue, detail].every(Boolean)) return;

    const setFeedback = (message = '', variant = '') => {
      feedback.textContent = message; feedback.hidden = !message;
      feedback.className = `performance-feedback ${variant}`.trim();
    };
    const setGenerating = (value) => {
      generating = value; generateButton.disabled = value;
      generateButton.setAttribute('aria-busy', String(value)); panel.setAttribute('aria-busy', String(value));
    };
    const itemById = (id) => plan?.items?.find((item) => item.id === id) ?? null;
    const renderList = (title, values, mapper = (value) => value) => {
      if (!Array.isArray(values) || values.length === 0) return null;
      const section = document.createElement('section'); section.append(text('h4', title));
      const list = document.createElement('ul'); list.append(...values.map((value) => text('li', mapper(value)))); section.append(list);
      return section;
    };
    const renderDetail = () => {
      const item = itemById(selectedItemId);
      if (!item) { detail.replaceChildren(text('p', 'Selecione um item da fila.', 'performance-empty')); return; }
      const article = document.createElement('article'); article.className = 'planning-detail-content';
      article.append(text('strong', item.title), text('p', item.rationale),
        text('small', `${item.priority} · ${item.status} · ${item.readiness} · esforço ${item.effort}`));
      const sections = [
        renderList('Evidências', item.evidence, (entry) => `${entry.classification}: ${entry.summary} · confiança ${Math.round(Number(entry.confidence ?? 0) * 100)}%${entry.freshness ? ` · ${entry.freshness}` : ''}`),
        renderList('Riscos', item.risks, (entry) => `${entry.severity}: ${entry.summary}`),
        renderList('Bloqueios e restrições', item.constraints, (entry) => `${entry.blocking ? 'Bloqueio' : 'Restrição'}: ${entry.summary}`),
        renderList('Dados ausentes', item.missingData),
        renderList('Dependências', item.dependencies, (entry) => `${entry.type} · ${entry.status}: ${entry.summary}`),
      ].filter(Boolean);
      if (!sections.length) article.append(text('p', 'Nenhuma evidência adicional registrada.', 'performance-empty'));
      else article.append(...sections);
      detail.replaceChildren(article);
    };
    const renderHistory = () => {
      if (!history) return;
      if (!executionHistory.length) {
        history.replaceChildren(text('p', 'Nenhuma ação executada neste plano.', 'performance-empty'));
        return;
      }
      const list = document.createElement('ol'); list.className = 'planning-history-list';
      for (const entry of executionHistory) {
        const row = document.createElement('li');
        row.append(text('strong', entry.itemTitle), text('span', `${entry.state} · ${new Date(entry.createdAt).toLocaleString('pt-BR')}`),
          text('p', entry.reason || entry.action));
        list.append(row);
      }
      history.replaceChildren(list);
    };
    const outcomeLabel = (classification) => ({
      AWAITING_DATA: 'Aguardando dados',
      INSUFFICIENT_DATA: 'Dados insuficientes',
      BELOW_REFERENCE: 'Abaixo da referencia',
      WITHIN_REFERENCE: 'Dentro da referencia',
      ABOVE_REFERENCE: 'Acima da referencia',
      INCONCLUSIVE: 'Resultado inconclusivo',
    })[classification] ?? classification;
    const renderOutcome = () => {
      if (!outcomes) return;
      const item = itemById(selectedItemId);
      if (!item || item.executionState !== 'completed') {
        outcomes.replaceChildren(text('p', 'Selecione um item concluido para acompanhar o resultado.', 'performance-empty'));
        return;
      }
      if (!outcomeState || outcomeState.itemId !== item.id) {
        outcomes.replaceChildren(text('p', 'Carregando resultado...', 'performance-empty'));
        return;
      }
      const article = document.createElement('article'); article.className = 'planning-outcome-content';
      const timeline = document.createElement('ol'); timeline.className = 'planning-outcome-timeline';
      const activeLink = outcomeState.bundle?.activeLink ?? null;
      const latestOutcome = activeLink?.outcomes?.[0] ?? null;
      for (const [label, done] of [['Planejado', true], ['Executado', true], ['Publicado', Boolean(activeLink)], ['Resultado', Boolean(latestOutcome)]]) {
        const step = text('li', label); step.dataset.state = done ? 'complete' : 'pending'; timeline.append(step);
      }
      article.append(timeline);
      const linkSection = document.createElement('section'); linkSection.append(text('h4', 'Video publicado'));
      if (activeLink) {
        linkSection.append(text('strong', activeLink.videoTitle), text('p', `Video ID: ${activeLink.videoId}`),
          text('small', `Associado em ${new Date(activeLink.linkedAt).toLocaleString('pt-BR')}`));
      } else linkSection.append(text('p', 'Nenhum video associado. A associacao e sempre explicita.', 'performance-empty'));
      const controls = document.createElement('div'); controls.className = 'planning-outcome-actions';
      const select = document.createElement('select'); select.dataset.planningVideoCandidate = item.id;
      select.setAttribute('aria-label', `Video publicado para ${item.title}`);
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecionar video sincronizado'; select.append(placeholder);
      for (const candidate of outcomeState.candidates ?? []) {
        const option = document.createElement('option'); option.value = candidate.snapshotId;
        option.textContent = `${candidate.title} - ${candidate.format ?? 'formato ausente'}${candidate.linkedItemId && candidate.linkedItemId !== item.id ? ' - ja associado' : ''}`;
        option.disabled = Boolean(candidate.linkedItemId && candidate.linkedItemId !== item.id); select.append(option);
      }
      const reason = document.createElement('input'); reason.type = 'text'; reason.dataset.planningOutcomeReason = item.id;
      reason.placeholder = activeLink ? 'Motivo da correcao/remocao' : 'Nota da associacao (opcional)'; reason.maxLength = 500;
      reason.setAttribute('aria-label', `Motivo da associacao de ${item.title}`);
      controls.append(select, reason,
        button(activeLink ? 'Corrigir video' : 'Associar video', 'Associar video sincronizado', { planningOutcomeLink: item.id }, 'button secondary'));
      if (activeLink) {
        controls.append(button('Atualizar resultado', 'Capturar snapshot e avaliar resultado', { planningOutcomeCapture: item.id }, 'button'));
        controls.append(button('Remover vinculo', 'Remover associacao atual', { planningOutcomeUnlink: item.id }, 'button secondary'));
      }
      for (const control of controls.children) control.disabled = outcomePending;
      linkSection.append(controls); article.append(linkSection);
      const resultSection = document.createElement('section'); resultSection.append(text('h4', 'Resultado observado'));
      if (!latestOutcome) resultSection.append(text('p', activeLink ? 'Ainda nao ha snapshot avaliado para este video.' : 'Associe um video antes de avaliar.', 'performance-empty'));
      else {
        resultSection.append(text('strong', outcomeLabel(latestOutcome.classification)),
          text('p', `Confianca ${Math.round(Number(latestOutcome.confidence ?? 0) * 100)}% - ${latestOutcome.dataQuality} - ${latestOutcome.freshness}`),
          text('small', `Janela: ${latestOutcome.windowStart ? new Date(latestOutcome.windowStart).toLocaleDateString('pt-BR') : 'ausente'} a ${latestOutcome.windowEnd ? new Date(latestOutcome.windowEnd).toLocaleDateString('pt-BR') : 'ausente'}`));
        const benchmark = latestOutcome.benchmark ?? {};
        resultSection.append(text('p', `Referencia: ${benchmark.comparableVideos ?? 0} videos do mesmo formato, janela e idade de publicacao.`));
        const metrics = Object.entries(latestOutcome.metrics ?? {}).filter(([, value]) => value !== null);
        const metricList = renderList('Metricas observadas', metrics, ([name, value]) => `${name}: ${value}`);
        const evidenceList = renderList('Evidencias', latestOutcome.evidence, (entry) => `${entry.classification}: ${entry.summary}`);
        const limitationList = renderList('Limitacoes', latestOutcome.limitations);
        resultSection.append(...[metricList, evidenceList, limitationList].filter(Boolean));
      }
      article.append(resultSection); outcomes.replaceChildren(article);
    };
    const learningStatus = (status) => ({
      WEAK: 'Observacao individual', EMERGING: 'Padrao emergente', SUPPORTED: 'Aprendizado sustentado',
      STALE: 'Evidencia stale', CONTRADICTED: 'Evidencia contraditoria',
    })[status] ?? status;
    const renderLearningDetail = (learning = null) => {
      if (!learningDetail) return;
      if (!learning) { learningDetail.replaceChildren(text('p', 'Selecione um aprendizado para ver as evidencias.', 'performance-empty')); return; }
      const article = document.createElement('article'); article.className = 'planning-detail-content';
      article.append(text('strong', learning.description),
        text('p', `${learningStatus(learning.status)} - confianca ${Math.round(Number(learning.confidence ?? 0) * 100)}% - ${learning.freshness}`),
        text('small', `${learning.dimension}: ${learning.subject}`));
      const counts = text('p', `${learning.observationCount} observacoes comparaveis: ${learning.favorableCount} acima, ${learning.neutralCount} dentro e ${learning.contraryCount} abaixo da referencia.`);
      article.append(counts);
      const evidenceList = document.createElement('ul');
      for (const entry of learning.evidence ?? []) {
        const row = document.createElement('li');
        row.append(text('span', `${entry.stance}: ${entry.summary}`));
        const itemId = entry.outcome?.itemId;
        if (itemId && itemById(itemId)) row.append(button('Ver resultado', 'Abrir outcome que sustenta este aprendizado', { planningLearningOutcome: itemId }, 'button secondary'));
        evidenceList.append(row);
      }
      if (evidenceList.children.length) article.append(text('h4', 'Evidencias rastreaveis'), evidenceList);
      const limitations = renderList('Limitacoes', learning.limitations);
      const revisions = renderList('Mudancas de interpretacao', learning.revisions, (entry) => `${entry.event}: ${entry.previousStatus ?? 'novo'} -> ${entry.currentStatus}`);
      article.append(...[limitations, revisions].filter(Boolean)); learningDetail.replaceChildren(article);
    };
    const renderLearnings = () => {
      if (!learnings) return;
      if (!strategicLearnings.length) {
        learnings.replaceChildren(text('p', 'Ainda nao temos dados suficientes para formar aprendizados estrategicos.', 'performance-empty'));
        selectedLearningId = null; renderLearningDetail(); return;
      }
      const list = document.createElement('div'); list.className = 'planning-learning-list';
      for (const learning of strategicLearnings) {
        const row = document.createElement('article'); row.className = 'planning-learning-item'; row.dataset.planningLearning = learning.id;
        row.append(text('strong', learning.description), text('span', `${learningStatus(learning.status)} - ${Math.round(Number(learning.confidence ?? 0) * 100)}%`),
          text('small', `${learning.observationCount} observacoes - ${learning.freshness}`),
          button('Evidencias', 'Abrir evidencias e historico do aprendizado', { planningLearningOpen: learning.id }, 'button secondary'));
        list.append(row);
      }
      learnings.replaceChildren(list);
    };
    const loadLearnings = async () => {
      if (!learnings || typeof api.listStrategicLearnings !== 'function') return;
      const request = ++learningRequest;
      try {
        const loaded = await api.listStrategicLearnings({ limit: 100 });
        if (!current() || request !== learningRequest) return;
        strategicLearnings = Array.isArray(loaded) ? loaded : []; renderLearnings();
      } catch {
        if (!current() || request !== learningRequest) return;
        strategicLearnings = []; renderLearnings(); setFeedback('Nao foi possivel carregar os aprendizados estrategicos.', 'warning');
      }
    };
    const openLearning = async (id) => {
      if (typeof api.getStrategicLearning !== 'function') return;
      selectedLearningId = id; const request = ++learningDetailRequest;
      learningDetail?.replaceChildren(text('p', 'Carregando evidencias...', 'performance-empty'));
      try {
        const loaded = await api.getStrategicLearning(id);
        if (!current() || request !== learningDetailRequest || selectedLearningId !== id) return;
        renderLearningDetail(loaded);
      } catch {
        if (!current() || request !== learningDetailRequest || selectedLearningId !== id) return;
        renderLearningDetail(); setFeedback('Nao foi possivel abrir este aprendizado.', 'error');
      }
    };
    const refreshLearnings = async () => {
      if (learningPending || typeof api.refreshStrategicLearnings !== 'function') return;
      learningPending = true; learningRefresh.disabled = true; learningRefresh.setAttribute('aria-busy', 'true');
      try {
        const result = await api.refreshStrategicLearnings({});
        if (!current()) return;
        setFeedback(result.insufficientData ? 'Ainda nao existem outcomes comparaveis suficientes.' : 'Aprendizados reavaliados com os outcomes atuais.', result.insufficientData ? 'warning' : 'success');
        await loadLearnings();
      } catch { if (current()) setFeedback('Nao foi possivel reavaliar os aprendizados.', 'error'); }
      finally { learningPending = false; if (current()) { learningRefresh.disabled = false; learningRefresh.setAttribute('aria-busy', 'false'); } }
    };
    const experimentById = (experimentId) => strategicExperiments.find(({ id }) => id === experimentId) ?? null;
    const renderExperimentDetail = (experiment = null) => {
      if (!experimentDetail) return;
      if (!experiment) { experimentDetail.replaceChildren(text('p', 'Selecione um experimento para ver variantes e evidencias.', 'performance-empty')); return; }
      const article = document.createElement('article'); article.className = 'planning-detail-content';
      article.append(text('strong', experiment.title), text('p', experiment.hypothesis?.description ?? ''),
        text('span', `${experiment.status} - ${experiment.primaryMetric} - confianca ${Math.round(Number(experiment.result?.confidence ?? experiment.confidence ?? 0) * 100)}%`));
      const variants = document.createElement('ul');
      for (const variant of experiment.variants ?? []) {
        const row = document.createElement('li'); row.append(text('span', `${variant.key}: ${variant.label} - ${variant.observations?.length ?? 0} observacoes`));
        const outcome = document.createElement('input'); outcome.type = 'text'; outcome.placeholder = 'ID de outcome auditavel'; outcome.dataset.experimentOutcome = variant.id;
        outcome.setAttribute('aria-label', `Outcome para ${variant.label}`); row.append(outcome,
          button('Adicionar observacao', 'Vincular outcome a variante', { experimentObserve: experiment.id, variantId: variant.id }, 'button secondary'));
        variants.append(row);
      }
      article.append(text('h4', 'Variantes'), variants);
      if (experiment.result) article.append(text('h4', 'Resultado observado'), text('p', experiment.result.summary),
        text('small', `${experiment.result.classification} - associacao observada, nao causalidade.`));
      const limitations = Array.isArray(experiment.limitations) ? experiment.limitations : [];
      if (limitations.length) { const list = document.createElement('ul'); limitations.forEach((entry) => list.append(text('li', entry))); article.append(text('h4', 'Limitacoes'), list); }
      const actions = document.createElement('div'); actions.className = 'planning-item-actions';
      if (['DRAFT', 'READY', 'WAITING_FOR_DATA'].includes(experiment.status)) actions.append(button('Iniciar', 'Iniciar experimento', { experimentAction: 'start', experimentId: experiment.id }, 'button secondary'));
      if (['RUNNING', 'WAITING_FOR_DATA'].includes(experiment.status)) actions.append(button('Analisar', 'Analisar observacoes comparaveis', { experimentAction: 'analyze', experimentId: experiment.id }, 'button'));
      if (!['COMPLETED', 'INCONCLUSIVE', 'CANCELLED'].includes(experiment.status)) actions.append(button('Cancelar', 'Cancelar experimento', { experimentAction: 'cancel', experimentId: experiment.id }, 'button secondary'));
      for (const control of actions.children) control.disabled = experimentPending; article.append(actions); experimentDetail.replaceChildren(article);
    };
    const renderExperiments = () => {
      if (!experiments) return;
      if (!strategicExperiments.length) { experiments.replaceChildren(text('p', 'Nenhum experimento estrategico registrado.', 'performance-empty')); selectedExperimentId = null; renderExperimentDetail(); return; }
      const list = document.createElement('div'); list.className = 'planning-learning-list';
      for (const experiment of strategicExperiments) {
        const row = document.createElement('article'); row.className = 'planning-learning-item'; row.dataset.planningExperiment = experiment.id;
        row.append(text('strong', experiment.title), text('span', `${experiment.status} - ${experiment.primaryMetric}`),
          text('small', `${experiment._count?.observations ?? 0} observacoes`), button('Abrir', 'Abrir experimento', { experimentOpen: experiment.id }, 'button secondary')); list.append(row);
      }
      experiments.replaceChildren(list);
    };
    const loadExperiments = async () => {
      if (!experiments || typeof api.listStrategicExperiments !== 'function') return;
      const request = ++experimentRequest;
      try { const loaded = await api.listStrategicExperiments({ limit: 100 }); if (!current() || request !== experimentRequest) return;
        strategicExperiments = Array.isArray(loaded) ? loaded : []; renderExperiments(); }
      catch { if (current() && request === experimentRequest) { strategicExperiments = []; renderExperiments(); setFeedback('Nao foi possivel carregar os experimentos.', 'warning'); } }
    };
    const openExperiment = async (experimentId) => {
      if (typeof api.getStrategicExperiment !== 'function') return; selectedExperimentId = experimentId; const request = ++experimentDetailRequest;
      experimentDetail?.replaceChildren(text('p', 'Carregando experimento...', 'performance-empty'));
      try { const loaded = await api.getStrategicExperiment(experimentId); if (!current() || request !== experimentDetailRequest || selectedExperimentId !== experimentId) return; renderExperimentDetail(loaded); }
      catch { if (current() && request === experimentDetailRequest) { renderExperimentDetail(); setFeedback('Nao foi possivel abrir este experimento.', 'error'); } }
    };
    const createExperiment = async (event) => {
      event.preventDefault(); if (experimentPending || typeof api.createStrategicExperiment !== 'function') return;
      const titleInput = experimentForm.querySelector('[data-experiment-title]'); const hypothesis = experimentForm.querySelector('[data-experiment-hypothesis]');
      const metric = experimentForm.querySelector('[data-experiment-metric]'); const variantA = experimentForm.querySelector('[data-experiment-variant-a]'); const variantB = experimentForm.querySelector('[data-experiment-variant-b]');
      if (![titleInput, hypothesis, metric, variantA, variantB].every((entry) => entry?.value?.trim())) return;
      experimentPending = true; experimentForm.querySelector('[data-experiment-create]').disabled = true;
      try { const created = await api.createStrategicExperiment({ title: titleInput.value.trim(), hypothesis: hypothesis.value.trim(), expectedVariantKey: 'A',
        primaryMetric: metric.value, metricDirection: 'HIGHER_BETTER', variants: [{ key: 'A', label: variantA.value.trim() }, { key: 'B', label: variantB.value.trim() }] });
        if (!current()) return; selectedExperimentId = created.id; experimentForm.reset?.(); await loadExperiments(); await openExperiment(created.id); setFeedback('Experimento criado como teste controlado.', 'success'); }
      catch { if (current()) setFeedback('Nao foi possivel criar o experimento.', 'error'); }
      finally { experimentPending = false; if (current()) experimentForm.querySelector('[data-experiment-create]').disabled = false; }
    };
    const experimentAction = async (experimentId, action, variantId = null) => {
      if (experimentPending) return; experimentPending = true; const currentExperiment = experimentById(experimentId); renderExperimentDetail(currentExperiment);
      try {
        if (action === 'start') await api.startStrategicExperiment(experimentId);
        else if (action === 'analyze') await api.analyzeStrategicExperiment(experimentId);
        else if (action === 'cancel') await api.cancelStrategicExperiment(experimentId, 'Cancelado explicitamente pela interface.');
        else if (action === 'observe') {
          const input = experimentDetail?.querySelector?.(`[data-experiment-outcome="${variantId}"]`); if (!input?.value?.trim()) { setFeedback('Informe um outcome auditavel para a variante.', 'warning'); return; }
          await api.addStrategicExperimentObservation(experimentId, variantId, input.value.trim());
        }
        if (!current()) return; await loadExperiments(); await openExperiment(experimentId); setFeedback('Experimento atualizado.', 'success');
      } catch (error) { if (current()) setFeedback(error?.status === 422 ? 'O experimento ainda possui bloqueios ou dados insuficientes.' : error?.status === 409 ? 'A operacao conflita com o estado atual do experimento.' : 'Nao foi possivel atualizar o experimento.', 'error'); }
      finally { experimentPending = false; if (current() && selectedExperimentId === experimentId) openExperiment(experimentId); }
    };
    const actionBar = (item, index, allItems) => {
      const actions = document.createElement('div'); actions.className = 'planning-item-actions';
      const open = button('Detalhes', 'Abrir detalhes', { planningOpen: item.id }, 'button secondary'); actions.append(open);
      const up = button('↑', 'Mover para cima', { planningMove: item.id, direction: 'up' });
      const down = button('↓', 'Mover para baixo', { planningMove: item.id, direction: 'down' });
      up.disabled = index === 0; down.disabled = index === allItems.length - 1; actions.append(up, down);
      if (!['COMPLETED', 'CANCELLED'].includes(item.status)) {
        if (item.executionState !== 'in_progress') actions.append(button('Iniciar', 'Iniciar execução', { planningExecution: item.id, state: 'in_progress' }, 'button secondary'));
        if (item.executionState !== 'paused') actions.append(button('Ⅱ', 'Pausar item', { planningPause: item.id, planningExecution: item.id, state: 'paused' }));
        actions.append(button('✓', 'Marcar como concluído', { planningComplete: item.id }));
        actions.append(button('Pular', 'Pular item', { planningExecution: item.id, state: 'skipped' }, 'button secondary'));
      }
      const note = document.createElement('input'); note.type = 'text'; note.dataset.planningNote = item.id;
      note.value = executionNotes.get(item.id) ?? ''; note.placeholder = 'Nota ou motivo (opcional)';
      note.setAttribute('aria-label', `Nota de execução de ${item.title}`); note.maxLength = 500; actions.append(note);
      const select = document.createElement('select'); select.dataset.planningPriority = item.id;
      select.setAttribute('aria-label', `Prioridade de ${item.title}`);
      for (const priority of PRIORITIES) {
        const option = document.createElement('option'); option.value = priority; option.textContent = priority; option.selected = priority === item.priority; select.append(option);
      }
      actions.append(select);
      for (const control of actions.children) control.disabled = control.disabled || generating || pendingItems.has(item.id);
      return actions;
    };
    const renderQueue = () => {
      const items = Array.isArray(plan?.items) ? [...plan.items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) : [];
      if (!items.length) { queue.replaceChildren(text('p', 'Nenhum item no plano atual.', 'performance-empty')); return; }
      const groups = QUEUES.map((queueName) => {
        const group = document.createElement('section'); group.className = 'planning-queue-group'; group.dataset.queue = queueName;
        const groupItems = items.filter((item) => item.queue === queueName);
        group.append(text('h4', `${queueName} · ${groupItems.length}`));
        if (!groupItems.length) group.append(text('p', 'Sem itens.', 'performance-empty'));
        for (const item of groupItems) {
          const row = document.createElement('article'); row.className = `planning-item priority-${String(item.priority).toLowerCase()}`; row.dataset.planningItem = item.id;
          row.append(text('strong', item.title), text('span', `${item.priority} · ${item.readiness} · esforço ${item.effort}`),
            text('p', item.rationale), actionBar(item, items.findIndex(({ id }) => id === item.id), items));
          group.append(row);
        }
        return group;
      });
      queue.replaceChildren(...groups); renderDetail(); renderOutcome();
    };
    const renderPlan = () => {
      if (!plan) {
        meta.replaceChildren(); now.replaceChildren(text('p', 'Nenhum plano ativo. Gere um plano para organizar a próxima execução.', 'performance-empty'));
        queue.replaceChildren(text('p', 'A fila editorial ainda está vazia.', 'performance-empty')); selectedItemId = null; renderDetail(); return;
      }
      meta.replaceChildren(text('span', `${plan.horizon} · ${plan.status}`));
      const next = plan.items?.find((item) => item.queue === 'NEXT');
      const blocked = plan.items?.find((item) => item.queue === 'BLOCKED');
      const currentItem = next ?? blocked;
      if (!currentItem) now.replaceChildren(text('p', 'Nenhum item pronto agora. Consulte WAITING e BLOCKED.', 'performance-empty'));
      else {
        const article = document.createElement('article'); article.className = 'planning-now-content';
        article.append(text('strong', currentItem.title), text('p', currentItem.executionAction || currentItem.rationale),
          text('small', `Por quê: ${currentItem.rationale}`),
          text('span', `${currentItem.priority} · ${currentItem.readiness}${currentItem.executionConfidence == null ? '' : ` · confiança ${Math.round(currentItem.executionConfidence * 100)}%`}${currentItem.queue === 'BLOCKED' ? ' · bloqueado' : ''}`));
        now.replaceChildren(article);
      }
      if (selectedItemId && !itemById(selectedItemId)) selectedItemId = null;
      renderQueue();
    };
    const qualityWarning = () => {
      const items = plan?.items ?? [];
      const stale = items.some((item) => item.evidence?.some((entry) => entry.freshness === 'STALE'));
      const missing = items.some((item) => item.missingData?.length);
      if (stale || missing) setFeedback('Plano carregado em modo degradado: há dados stale ou ausentes.', 'warning');
      else setFeedback('');
    };
    const loadHistory = async (planId) => {
      if (!history || typeof api.listPlanningExecutionHistory !== 'function' || !planId) {
        executionHistory = []; renderHistory(); return;
      }
      const request = ++historyRequest;
      try {
        const loaded = await api.listPlanningExecutionHistory({ planId, limit: 100 });
        if (!current() || request !== historyRequest || plan?.id !== planId) return;
        executionHistory = Array.isArray(loaded) ? loaded : []; renderHistory();
      } catch {
        if (!current() || request !== historyRequest || plan?.id !== planId) return;
        setFeedback('O plano foi carregado, mas o histórico de execução está indisponível.', 'warning');
      }
    };
    const loadOutcome = async (itemId) => {
      const item = itemById(itemId); const request = ++outcomeRequest;
      if (!item || item.executionState !== 'completed' || typeof api.getPlanningItemOutcome !== 'function') {
        outcomeState = item ? { itemId, bundle: null, candidates: [] } : null; renderOutcome(); return;
      }
      outcomeState = null; renderOutcome();
      try {
        const [bundle, candidates] = await Promise.all([
          api.getPlanningItemOutcome(itemId),
          typeof api.listPlanningVideoCandidates === 'function' ? api.listPlanningVideoCandidates(itemId) : [],
        ]);
        if (!current() || request !== outcomeRequest || selectedItemId !== itemId) return;
        outcomeState = { itemId, bundle, candidates: Array.isArray(candidates) ? candidates : [] }; renderOutcome();
      } catch {
        if (!current() || request !== outcomeRequest || selectedItemId !== itemId) return;
        outcomeState = { itemId, bundle: null, candidates: [] }; renderOutcome();
        setFeedback('Nao foi possivel carregar os resultados deste item.', 'error');
      }
    };
    const performOutcomeAction = async (itemId, operation, successMessage) => {
      if (outcomePending || selectedItemId !== itemId) return;
      outcomePending = true; renderOutcome();
      try {
        await operation();
        if (!current() || selectedItemId !== itemId) return;
        setFeedback(successMessage, 'success'); await loadOutcome(itemId);
      } catch (error) {
        if (!current() || selectedItemId !== itemId) return;
        const message = error?.status === 404 ? 'O item ou video nao esta mais disponivel.'
          : error?.status === 409 ? 'Este video ja esta associado ou a correcao conflita com outro item.'
            : error?.status === 422 ? 'Conclua a execucao antes de associar um resultado.'
              : 'Nao foi possivel atualizar o resultado. Tente novamente.';
        setFeedback(message, 'error');
      } finally { outcomePending = false; if (current() && selectedItemId === itemId) renderOutcome(); }
    };
    const load = async () => {
      const request = ++loadRequest; panel.setAttribute('aria-busy', 'true');
      try {
        const loaded = await api.getCurrentContentPlan();
        if (!current() || request !== loadRequest) return;
        plan = loaded; renderPlan(); qualityWarning(); loadHistory(plan.id);
      } catch (error) {
        if (!current() || request !== loadRequest) return;
        if (error?.status === 404) { plan = null; executionHistory = []; renderPlan(); renderHistory(); setFeedback(''); }
        else { plan = null; renderPlan(); setFeedback('Não foi possível carregar o planejamento. Tente novamente.', 'error'); }
      } finally { if (current() && request === loadRequest) panel.setAttribute('aria-busy', 'false'); }
    };
    const generate = async (event) => {
      event.preventDefault(); if (generating || pendingItems.size) return;
      const request = ++loadRequest;
      setGenerating(true); renderQueue(); setFeedback('Gerando fila editorial com as evidências disponíveis...');
      try {
        const generated = await api.generateContentPlan({ horizon: horizon.value });
        if (!current() || request !== loadRequest) return;
        plan = generated; selectedItemId = generated.items?.find(({ queue: state }) => state === 'NEXT')?.id ?? null;
        executionHistory = []; renderPlan(); renderHistory(); qualityWarning(); loadHistory(plan.id);
      } catch { if (current()) setFeedback('Não foi possível gerar o plano. Tente novamente.', 'error'); }
      finally { if (current()) { setGenerating(false); renderQueue(); } }
    };
    const updateItem = async (id, operation) => {
      if (!plan || generating || pendingItems.has(id)) return;
      pendingItems.add(id); renderQueue();
      try {
        const updated = await operation();
        if (!current()) return;
        if (updated?.plan) plan = updated.plan;
        else plan = { ...plan, items: plan.items.map((item) => item.id === id ? updated : item) };
        selectedItemId = id; renderPlan(); qualityWarning();
        if (updated?.event) {
          executionHistory = [updated.event, ...executionHistory.filter((entry) => entry.id !== updated.event.id)];
          renderHistory();
        }
        if (updated?.item?.executionState === 'completed' || updated?.executionState === 'completed') loadOutcome(id);
      } catch { if (current()) setFeedback('Não foi possível atualizar o item. Tente novamente.', 'error'); }
      finally { pendingItems.delete(id); if (current()) renderQueue(); }
    };
    const transitionExecution = (id, state, reason) => updateItem(id, async () => {
      if (typeof api.updatePlanningExecution === 'function') return api.updatePlanningExecution(id, { state, reason });
      if (state === 'completed') return api.completePlannedContentItem(id, reason);
      return api.updatePlannedContentItem(id, {
        status: state === 'paused' ? 'PAUSED' : state === 'in_progress' ? 'IN_PROGRESS' : 'CANCELLED', reason,
      });
    });
    const reorder = async (id, direction) => {
      if (!plan || generating || pendingItems.size) return;
      const ordered = [...plan.items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const index = ordered.findIndex((item) => item.id === id); const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      pendingItems.add(id); renderQueue();
      try {
        const items = await api.reorderContentPlan(plan.id, ordered.map((item) => item.id), 'Ordem editorial alterada pela interface.');
        if (!current()) return;
        plan = { ...plan, items }; selectedItemId = id; renderPlan(); setFeedback('Ordem atualizada.', 'success');
      } catch { if (current()) setFeedback('Não foi possível reordenar a fila.', 'error'); }
      finally { pendingItems.delete(id); if (current()) renderQueue(); }
    };
    const handleClick = (event) => {
      const experimentOpen = event.target.closest?.('[data-experiment-open]');
      if (experimentOpen) { openExperiment(experimentOpen.dataset.experimentOpen); return; }
      const experimentControl = event.target.closest?.('[data-experiment-action]');
      if (experimentControl) { experimentAction(experimentControl.dataset.experimentId, experimentControl.dataset.experimentAction); return; }
      const experimentObserve = event.target.closest?.('[data-experiment-observe]');
      if (experimentObserve) { experimentAction(experimentObserve.dataset.experimentObserve, 'observe', experimentObserve.dataset.variantId); return; }
      const learningOpen = event.target.closest?.('[data-planning-learning-open]');
      if (learningOpen) { openLearning(learningOpen.dataset.planningLearningOpen); return; }
      const learningOutcome = event.target.closest?.('[data-planning-learning-outcome]');
      if (learningOutcome) { selectedItemId = learningOutcome.dataset.planningLearningOutcome; renderDetail(); loadOutcome(selectedItemId); return; }
      const open = event.target.closest?.('[data-planning-open]');
      if (open) { selectedItemId = open.dataset.planningOpen; renderDetail(); loadOutcome(selectedItemId); return; }
      const move = event.target.closest?.('[data-planning-move]');
      if (move) { reorder(move.dataset.planningMove, move.dataset.direction); return; }
      const complete = event.target.closest?.('[data-planning-complete]');
      if (complete) { transitionExecution(complete.dataset.planningComplete, 'completed', executionNotes.get(complete.dataset.planningComplete)?.trim() || 'Conteúdo concluído pela interface.'); return; }
      const pause = event.target.closest?.('[data-planning-pause]');
      if (pause) { transitionExecution(pause.dataset.planningPause, 'paused', executionNotes.get(pause.dataset.planningPause)?.trim() || 'Item pausado pela interface.'); return; }
      const execution = event.target.closest?.('[data-planning-execution]');
      if (execution) transitionExecution(execution.dataset.planningExecution, execution.dataset.state,
        executionNotes.get(execution.dataset.planningExecution)?.trim()
          || (execution.dataset.state === 'skipped' ? 'Item pulado pela interface.' : 'Execução iniciada pela interface.'));
      const link = event.target.closest?.('[data-planning-outcome-link]');
      if (link) {
        const itemId = link.dataset.planningOutcomeLink;
        const candidate = outcomes?.querySelector?.(`[data-planning-video-candidate="${itemId}"]`);
        const reason = outcomes?.querySelector?.(`[data-planning-outcome-reason="${itemId}"]`)?.value?.trim() || undefined;
        if (!candidate?.value) { setFeedback('Selecione um video sincronizado.', 'warning'); return; }
        performOutcomeAction(itemId, () => api.associatePlanningVideo(itemId, { snapshotId: candidate.value, ...(reason ? { reason } : {}) }), 'Video associado ao item.'); return;
      }
      const capture = event.target.closest?.('[data-planning-outcome-capture]');
      if (capture) {
        const itemId = capture.dataset.planningOutcomeCapture;
        performOutcomeAction(itemId, () => api.capturePlanningOutcome(itemId), 'Resultado atualizado com dados observados.'); return;
      }
      const unlink = event.target.closest?.('[data-planning-outcome-unlink]');
      if (unlink) {
        const itemId = unlink.dataset.planningOutcomeUnlink;
        const reason = outcomes?.querySelector?.(`[data-planning-outcome-reason="${itemId}"]`)?.value?.trim();
        if (!reason) { setFeedback('Informe o motivo para remover ou corrigir o vinculo.', 'warning'); return; }
        performOutcomeAction(itemId, () => api.unlinkPlanningVideo(itemId, reason), 'Associacao removida sem apagar o historico.');
      }
    };
    const handleChange = (event) => {
      const noteId = event.target?.dataset?.planningNote;
      if (noteId) { executionNotes.set(noteId, event.target.value); return; }
      const id = event.target?.dataset?.planningPriority;
      if (id) updateItem(id, () => api.updatePlannedContentItem(id, { priority: event.target.value, reason: 'Prioridade alterada pela interface.' }));
    };
    form.addEventListener('submit', generate); queue.addEventListener('click', handleClick); queue.addEventListener('change', handleChange);
    outcomes?.addEventListener('click', handleClick);
    learnings?.addEventListener('click', handleClick); learningDetail?.addEventListener('click', handleClick); learningRefresh?.addEventListener('click', refreshLearnings);
    experiments?.addEventListener('click', handleClick); experimentDetail?.addEventListener('click', handleClick); experimentForm?.addEventListener('submit', createExperiment);
    cleanup = () => { form.removeEventListener('submit', generate); queue.removeEventListener('click', handleClick); queue.removeEventListener('change', handleChange); outcomes?.removeEventListener('click', handleClick);
      learnings?.removeEventListener('click', handleClick); learningDetail?.removeEventListener('click', handleClick); learningRefresh?.removeEventListener('click', refreshLearnings);
      experiments?.removeEventListener('click', handleClick); experimentDetail?.removeEventListener('click', handleClick); experimentForm?.removeEventListener('submit', createExperiment); };
    load(); loadLearnings(); loadExperiments();
  };

  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; loadRequest += 1; historyRequest += 1; outcomeRequest += 1; learningRequest += 1; learningDetailRequest += 1; experimentRequest += 1; experimentDetailRequest += 1; outcomeState = null; outcomePending = false; learningPending = false; experimentPending = false; strategicLearnings = []; selectedLearningId = null; strategicExperiments = []; selectedExperimentId = null; pendingItems.clear(); executionNotes.clear(); };
  return { mount, unmount };
};

export const strategicPlanningModule = {
  id: 'planning', route: '/planning', label: 'Planejamento', icon: 'planning', fullscreen: true,
  pageTitle: 'Planejamento Estratégico', pageEyebrow: 'Fila editorial',
  render: renderStrategicPlanning,
  createController: createStrategicPlanningController,
};
