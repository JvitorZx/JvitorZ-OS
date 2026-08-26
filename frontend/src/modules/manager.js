import { createPanel, html } from '../design-system/index.js';

const syncPeriod = () => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const renderManager = () => {
  const period = syncPeriod();
  return createPanel({
  eyebrow: 'Gerente',
  title: 'Orquestração controlada',
  className: 'manager-panel',
  body: html`
    <div class="manager-feedback" data-manager-feedback role="status" aria-live="polite" hidden></div>
    <form class="manager-form" data-manager-form>
      <label for="managerIntent">Solicitação</label>
      <textarea id="managerIntent" data-manager-intent rows="3" maxlength="1000" required></textarea>
      <div class="manager-sync-controls">
        <label><input type="checkbox" data-manager-sync-confirm> Autorizar sincronização manual do YouTube</label>
        <label>Início <input type="date" value="${period.start}" data-manager-sync-start></label>
        <label>Fim <input type="date" value="${period.end}" data-manager-sync-end></label>
      </div>
      <button class="button" type="submit" data-manager-run>Executar plano</button>
    </form>
    <section class="manager-result" data-manager-result aria-live="polite">
      <p class="performance-empty">Envie uma solicitação para coordenar as capacidades disponíveis.</p>
    </section>
    <section class="manager-history" aria-labelledby="manager-history-title">
      <h3 id="manager-history-title">Execuções recentes</h3>
      <div data-manager-history><p class="performance-empty">Nenhuma execução carregada.</p></div>
    </section>
  `,
  });
};

const text = (tag, value, className = '') => {
  const element = document.createElement(tag);
  element.textContent = String(value ?? '');
  if (className) element.className = className;
  return element;
};

export const createManagerController = ({ api }) => {
  let mounted = null;
  let generation = 0;
  let running = false;
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.manager-panel');
    if (!panel || panel === mounted) return;
    cleanup();
    mounted = panel;
    const token = ++generation;
    const current = () => mounted === panel && generation === token;
    const form = panel.querySelector('[data-manager-form]');
    const intent = panel.querySelector('[data-manager-intent]');
    const button = panel.querySelector('[data-manager-run]');
    const syncConfirm = panel.querySelector('[data-manager-sync-confirm]');
    const syncStart = panel.querySelector('[data-manager-sync-start]');
    const syncEnd = panel.querySelector('[data-manager-sync-end]');
    const feedback = panel.querySelector('[data-manager-feedback]');
    const result = panel.querySelector('[data-manager-result]');
    const history = panel.querySelector('[data-manager-history]');
    if (![form, intent, button, syncConfirm, syncStart, syncEnd, feedback, result, history].every(Boolean)) return;

    const setFeedback = (message = '', variant = 'info') => {
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.className = `manager-feedback ${variant}`;
    };

    const renderEvidence = (executionResult) => {
      const evidence = executionResult?.evidence ?? {};
      const article = document.createElement('article');
      article.className = 'manager-result-content';
      article.append(
        text('small', executionResult?.interpretation ?? 'Interpretação indisponível'),
        text('p', executionResult?.response ?? 'Resposta indisponível'),
        text('strong', `Confiança: ${Math.round(Number(evidence.confidence ?? 0) * 100)}%`),
        text('small', `Capabilities: ${(executionResult?.capabilities ?? []).join(', ') || '--'}`),
      );
      for (const [title, items] of [
        ['Fatos', evidence.facts], ['Inferências', evidence.inferences],
        ['Recomendações', evidence.recommendations], ['Riscos', evidence.risks],
        ['Dados ausentes', evidence.missingData],
      ]) {
        if (!Array.isArray(items) || items.length === 0) continue;
        const section = document.createElement('section');
        section.append(text('h4', title));
        const list = document.createElement('ul');
        list.append(...items.map((item) => text('li', item)));
        section.append(list);
        article.append(section);
      }
      result.replaceChildren(article);
    };

    const renderHistory = (executions) => {
      if (!Array.isArray(executions) || executions.length === 0) {
        history.replaceChildren(text('p', 'Nenhuma execução registrada.', 'performance-empty'));
        return;
      }
      history.replaceChildren(...executions.map((execution) => {
        const row = document.createElement('article');
        row.className = 'manager-history-item';
        row.append(
          text('strong', execution.objective),
          text('span', execution.status),
          text('small', new Date(execution.createdAt).toLocaleString('pt-BR')),
        );
        return row;
      }));
    };

    const loadHistory = async () => {
      try {
        const executions = await api.listOrchestrationExecutions({ limit: 10 });
        if (current()) renderHistory(executions);
      } catch {
        if (current()) setFeedback('Não foi possível carregar o histórico do Gerente.', 'error');
      }
    };

    const submit = async (event) => {
      event.preventDefault();
      const value = intent.value.trim();
      if (!value || running) return;
      running = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      setFeedback('Executando plano controlado...');
      try {
        const request = { intent: value };
        if (syncConfirm.checked) {
          request.confirmExternalSideEffect = true;
          request.sync = {
            mode: 'recent',
            startDate: syncStart.value,
            endDate: syncEnd.value,
            limit: 20,
          };
        }
        const response = await api.runOrchestration(request);
        if (!current()) return;
        renderEvidence(response.result);
        setFeedback(response.result.status === 'partial'
          ? 'Execução concluída parcialmente.' : 'Execução concluída.',
        response.result.status === 'partial' ? 'warning' : 'success');
        await loadHistory();
      } catch {
        if (current()) setFeedback('Não foi possível executar esta solicitação.', 'error');
      } finally {
        running = false;
        if (current()) {
          button.disabled = false;
          button.setAttribute('aria-busy', 'false');
        }
      }
    };

    form.addEventListener('submit', submit);
    loadHistory();
    cleanup = () => form.removeEventListener('submit', submit);
  };

  const unmount = () => {
    cleanup();
    cleanup = () => {};
    mounted = null;
    generation += 1;
  };

  return { mount, unmount };
};

export const managerModule = {
  id: 'manager',
  label: 'Gerente',
  fullscreen: true,
  render: renderManager,
  createController: createManagerController,
};
