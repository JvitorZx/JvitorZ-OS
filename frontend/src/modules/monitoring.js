import { createPanel, html } from '../design-system/index.js';

const SIGNAL_TYPES = [
  'TREND_DECLINING', 'TREND_RISING', 'DATA_STALE', 'DATA_MISSING', 'SERIES_DECLINING',
  'SERIES_DORMANT', 'OPPORTUNITY_EXPIRING', 'OPPORTUNITY_STALE', 'PLANNING_BLOCKED',
  'EXPERIMENT_INCONCLUSIVE', 'LEARNING_CONTRADICTED', 'LEARNING_STALE',
];

const element = (tag, value, className = '') => {
  const node = document.createElement(tag);
  node.textContent = String(value ?? '');
  if (className) node.className = className;
  return node;
};

const option = (value, label) => `<option value="${value}">${label}</option>`;

const renderMonitoring = () => createPanel({
  eyebrow: 'Inteligência operacional',
  title: 'Monitoramento estratégico',
  className: 'strategic-monitoring-panel',
  body: html`
    <div class="performance-feedback" data-monitoring-feedback role="status" aria-live="polite" hidden></div>
    <div class="monitoring-toolbar">
      <label>Severidade <select data-monitoring-severity>
        ${option('', 'Todas')}${['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => option(value, value)).join('')}
      </select></label>
      <label>Estado <select data-monitoring-state>
        ${option('', 'Todos')}${['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'STALE', 'DISMISSED'].map((value) => option(value, value)).join('')}
      </select></label>
      <label>Tipo <select data-monitoring-type>
        ${option('', 'Todos')}${SIGNAL_TYPES.map((value) => option(value, value)).join('')}
      </select></label>
      <button class="button" type="button" data-monitoring-evaluate>Avaliar agora</button>
    </div>
    <div class="monitoring-workspace">
      <section aria-labelledby="monitoring-list-title">
        <div class="planning-section-heading"><div><p class="eyebrow">Sinais</p><h3 id="monitoring-list-title">Atenção estratégica</h3></div></div>
        <div data-monitoring-list aria-live="polite"><p class="performance-empty">Carregando sinais...</p></div>
      </section>
      <aside class="monitoring-detail" data-monitoring-detail aria-live="polite">
        <p class="performance-empty">Selecione um sinal para ver evidências e limitações.</p>
      </aside>
    </div>
  `,
});

export const createMonitoringController = ({ api }) => {
  let mounted = null;
  let generation = 0;
  let listRequest = 0;
  let detailRequest = 0;
  let evaluating = false;
  const pendingSignals = new Set();
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.strategic-monitoring-panel');
    if (!panel || panel === mounted) return;
    cleanup(); mounted = panel;
    const token = ++generation;
    const current = () => mounted === panel && generation === token;
    const severity = panel.querySelector('[data-monitoring-severity]');
    const state = panel.querySelector('[data-monitoring-state]');
    const type = panel.querySelector('[data-monitoring-type]');
    const evaluate = panel.querySelector('[data-monitoring-evaluate]');
    const feedback = panel.querySelector('[data-monitoring-feedback]');
    const list = panel.querySelector('[data-monitoring-list]');
    const detail = panel.querySelector('[data-monitoring-detail]');
    if (![severity, state, type, evaluate, feedback, list, detail].every(Boolean)) return;

    const setFeedback = (message = '', variant = '') => {
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.className = `performance-feedback ${variant}`.trim();
    };
    const filters = () => ({
      ...(severity.value ? { severity: severity.value } : {}),
      ...(state.value ? { state: state.value } : {}),
      ...(type.value ? { type: type.value } : {}),
      limit: 100,
    });
    const renderList = (signals) => {
      if (!Array.isArray(signals) || signals.length === 0) {
        list.replaceChildren(element('p', 'Nenhum sinal encontrado para estes filtros.', 'performance-empty'));
        return;
      }
      list.replaceChildren(...signals.map((signal) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `monitoring-signal severity-${String(signal.severity).toLowerCase()} state-${String(signal.state).toLowerCase()}`;
        button.dataset.monitoringSignal = signal.id;
        button.append(
          element('strong', signal.subject),
          element('span', `${signal.severity} · ${signal.state}`),
          element('p', signal.summary),
          element('small', `${signal.type} · ${signal.source} · ${new Date(signal.detectedAt).toLocaleString('pt-BR')}`),
        );
        return button;
      }));
    };
    const renderDetail = (signal) => {
      const article = document.createElement('article'); article.className = 'monitoring-detail-content';
      article.append(
        element('p', signal.type, 'eyebrow'),
        element('h3', signal.subject),
        element('span', `${signal.severity} · ${signal.state}`, `monitoring-badge severity-${String(signal.severity).toLowerCase()}`),
        element('p', signal.summary),
        element('p', `Possível impacto: ${signal.impact}`),
        element('small', `Confiança: ${Math.round(Number(signal.confidence ?? 0) * 100)}% · origem ${signal.source}`),
      );
      const appendList = (title, values, mapper = (value) => value) => {
        if (!Array.isArray(values) || values.length === 0) return;
        article.append(element('h4', title));
        const entries = document.createElement('ul');
        entries.append(...values.map((value) => element('li', mapper(value))));
        article.append(entries);
      };
      appendList('Evidências', signal.evidence, (entry) => `${entry.kind}: ${entry.summary}`);
      appendList('Limitações', signal.limitations);
      if (signal.state === 'STALE' || signal.type === 'DATA_STALE') {
        article.append(element('p', 'Este sinal depende de dados stale ou de uma fonte degradada.', 'monitoring-degraded'));
      }
      if (!['RESOLVED', 'DISMISSED'].includes(signal.state)) {
        const reason = document.createElement('input'); reason.type = 'text'; reason.maxLength = 500;
        reason.placeholder = 'Motivo opcional'; reason.dataset.monitoringReason = signal.id;
        const actions = document.createElement('div'); actions.className = 'monitoring-actions'; actions.append(reason);
        if (signal.state === 'NEW') actions.append(actionButton('Reconhecer', signal.id, 'acknowledge'));
        actions.append(actionButton('Resolver', signal.id, 'resolve'), actionButton('Dispensar', signal.id, 'dismiss'));
        article.append(actions);
      }
      detail.replaceChildren(article);
    };
    const actionButton = (label, id, action) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = action === 'acknowledge' ? 'button' : 'button secondary';
      button.textContent = label; button.dataset.monitoringAction = action; button.dataset.monitoringSignalId = id;
      button.disabled = pendingSignals.has(id); return button;
    };
    const load = async () => {
      const request = ++listRequest; list.setAttribute('aria-busy', 'true');
      try {
        const signals = await api.listStrategicSignals(filters());
        if (!current() || request !== listRequest) return;
        renderList(signals); setFeedback('');
      } catch {
        if (current() && request === listRequest) {
          list.replaceChildren(element('p', 'Não foi possível carregar os sinais.', 'performance-empty'));
          setFeedback('Não foi possível carregar o Monitoramento. Tente novamente.', 'error');
        }
      } finally { if (current() && request === listRequest) list.setAttribute('aria-busy', 'false'); }
    };
    const openSignal = async (id) => {
      const request = ++detailRequest; detail.setAttribute('aria-busy', 'true');
      try {
        const signal = await api.getStrategicSignal(id);
        if (current() && request === detailRequest) { renderDetail(signal); setFeedback(''); }
      } catch (error) {
        if (current() && request === detailRequest) setFeedback(error?.status === 404
          ? 'Este sinal não está mais disponível.' : 'Não foi possível abrir o sinal.', 'error');
      } finally { if (current() && request === detailRequest) detail.setAttribute('aria-busy', 'false'); }
    };
    const onListClick = (event) => {
      const button = event.target.closest?.('[data-monitoring-signal]');
      if (button) void openSignal(button.dataset.monitoringSignal);
    };
    const onDetailClick = async (event) => {
      const button = event.target.closest?.('[data-monitoring-action]');
      if (!button) return;
      const id = button.dataset.monitoringSignalId; const action = button.dataset.monitoringAction;
      if (pendingSignals.has(id)) return;
      pendingSignals.add(id); button.disabled = true; button.setAttribute('aria-busy', 'true');
      const reason = detail.querySelector?.(`[data-monitoring-reason="${id}"]`)?.value?.trim() || undefined;
      try {
        const method = action === 'acknowledge' ? 'acknowledgeStrategicSignal'
          : action === 'dismiss' ? 'dismissStrategicSignal' : 'resolveStrategicSignal';
        const signal = await api[method](id, reason);
        if (!current()) return;
        renderDetail(signal); await load(); setFeedback('Sinal atualizado.', 'success');
      } catch {
        if (current()) setFeedback('Não foi possível atualizar o sinal. Tente novamente.', 'error');
      } finally { pendingSignals.delete(id); }
    };
    const onEvaluate = async () => {
      if (evaluating) return;
      evaluating = true; evaluate.disabled = true; evaluate.setAttribute('aria-busy', 'true'); setFeedback('Avaliando fontes estratégicas...');
      try {
        const result = await api.evaluateStrategicMonitoring();
        if (!current()) return;
        await load();
        if (current()) setFeedback(result.unchanged ? 'Avaliação concluída sem mudanças.' : 'Monitoramento atualizado.', 'success');
      } catch {
        if (current()) setFeedback('Não foi possível executar a avaliação. As fontes válidas foram preservadas.', 'error');
      } finally {
        evaluating = false;
        if (current()) { evaluate.disabled = false; evaluate.setAttribute('aria-busy', 'false'); }
      }
    };
    const onFilter = () => { void load(); };
    severity.addEventListener('change', onFilter); state.addEventListener('change', onFilter); type.addEventListener('change', onFilter);
    evaluate.addEventListener('click', onEvaluate); list.addEventListener('click', onListClick); detail.addEventListener('click', onDetailClick);
    cleanup = () => {
      severity.removeEventListener('change', onFilter); state.removeEventListener('change', onFilter); type.removeEventListener('change', onFilter);
      evaluate.removeEventListener('click', onEvaluate); list.removeEventListener('click', onListClick); detail.removeEventListener('click', onDetailClick);
    };
    void load();
  };

  const unmount = () => {
    cleanup(); cleanup = () => {}; mounted = null; generation += 1; listRequest += 1; detailRequest += 1;
    pendingSignals.clear(); evaluating = false;
  };
  return { mount, unmount };
};

export const monitoringModule = {
  id: 'monitoring', route: '/monitoring', label: 'Monitoramento', icon: 'monitoring', fullscreen: true,
  pageTitle: 'Monitoramento Estratégico', pageEyebrow: 'Sinais proativos',
  render: renderMonitoring, createController: createMonitoringController,
};
