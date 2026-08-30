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
    title: 'Gerente do canal',
    className: 'manager-panel',
    body: html`
      <div class="manager-feedback" data-manager-feedback role="status" aria-live="polite" hidden></div>
      <section class="manager-query" aria-labelledby="manager-query-title">
        <h3 id="manager-query-title">Consultar o Gerente</h3>
        <form class="manager-form" data-manager-query-form>
          <label for="managerQuestion">Pergunta sobre o canal</label>
          <textarea id="managerQuestion" data-manager-question rows="3" maxlength="1000" required></textarea>
          <button class="button" type="submit" data-manager-query>Consultar</button>
        </form>
      </section>
      <details class="manager-controlled-plan">
        <summary>Planejar operação controlada</summary>
      <form class="manager-form" data-manager-form>
        <label for="managerIntent">Solicitação</label>
        <textarea id="managerIntent" data-manager-intent rows="3" maxlength="1000" required></textarea>
        <div class="manager-sync-controls">
          <label><input type="checkbox" data-manager-sync-confirm> Incluir sincronização manual do YouTube no plano</label>
          <label>Início <input type="date" value="${period.start}" data-manager-sync-start></label>
          <label>Fim <input type="date" value="${period.end}" data-manager-sync-end></label>
        </div>
        <button class="button" type="submit" data-manager-preview>Gerar preview</button>
      </form>
      <section class="manager-plan" data-manager-plan aria-live="polite">
        <p class="performance-empty">Gere um preview para revisar serviços, ordem e efeitos antes da execução.</p>
      </section>
      <section class="manager-review-actions" data-manager-review-actions hidden>
        <label for="managerReviewReason">Motivo da decisão</label>
        <input id="managerReviewReason" data-manager-review-reason maxlength="500">
        <div class="manager-action-row">
          <button class="button" type="button" data-manager-approve>Aprovar</button>
          <button class="button secondary" type="button" data-manager-reject>Rejeitar</button>
          <button class="button" type="button" data-manager-execute>Executar plano aprovado</button>
        </div>
      </section>
      </details>
      <section class="manager-result" data-manager-result aria-live="polite"></section>
      <section class="manager-history" aria-labelledby="manager-history-title">
        <h3 id="manager-history-title">Execuções recentes</h3>
        <div data-manager-history><p class="performance-empty">Nenhuma execução carregada.</p></div>
      </section>
      <section class="manager-history" aria-labelledby="manager-automations-title">
        <h3 id="manager-automations-title">Automações controladas</h3>
        <div data-manager-automations><p class="performance-empty">Nenhuma automação carregada.</p></div>
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
  let busy = false;
  let activePreview = null;
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.manager-panel');
    if (!panel || panel === mounted) return;
    cleanup();
    mounted = panel;
    const token = ++generation;
    const current = () => mounted === panel && generation === token;
    const form = panel.querySelector('[data-manager-form]');
    const queryForm = panel.querySelector('[data-manager-query-form]');
    const question = panel.querySelector('[data-manager-question]');
    const queryButton = panel.querySelector('[data-manager-query]');
    const intent = panel.querySelector('[data-manager-intent]');
    const previewButton = panel.querySelector('[data-manager-preview]');
    const syncConfirm = panel.querySelector('[data-manager-sync-confirm]');
    const syncStart = panel.querySelector('[data-manager-sync-start]');
    const syncEnd = panel.querySelector('[data-manager-sync-end]');
    const feedback = panel.querySelector('[data-manager-feedback]');
    const planPanel = panel.querySelector('[data-manager-plan]');
    const actions = panel.querySelector('[data-manager-review-actions]');
    const reason = panel.querySelector('[data-manager-review-reason]');
    const approveButton = panel.querySelector('[data-manager-approve]');
    const rejectButton = panel.querySelector('[data-manager-reject]');
    const executeButton = panel.querySelector('[data-manager-execute]');
    const result = panel.querySelector('[data-manager-result]');
    const history = panel.querySelector('[data-manager-history]');
    const automationSummary = panel.querySelector('[data-manager-automations]');
    if (![form, intent, previewButton, syncConfirm, syncStart, syncEnd, feedback, planPanel,
      actions, reason, approveButton, rejectButton, executeButton, result, history].every(Boolean)) return;

    const approve = () => decide('approve');
    const reject = () => decide('reject');

    const setFeedback = (message = '', variant = 'info') => {
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.className = `manager-feedback ${variant}`;
    };

    const setBusy = (value) => {
      busy = value;
      for (const button of [queryButton, previewButton, approveButton, rejectButton, executeButton].filter(Boolean)) {
        button.disabled = value;
        button.setAttribute('aria-busy', String(value));
      }
    };

    const renderActions = () => {
      const state = activePreview?.review?.state;
      actions.hidden = !state || ['rejected', 'expired', 'executed'].includes(state);
      approveButton.hidden = state !== 'review_required';
      rejectButton.hidden = state !== 'review_required';
      executeButton.hidden = state !== 'approved';
    };

    const renderPlan = (preview) => {
      const article = document.createElement('article');
      article.className = 'manager-plan-content';
      article.append(
        text('strong', preview.plan.objective),
        text('span', `Risco: ${preview.review.riskLevel}`),
        text('span', `Efeito: ${preview.review.sideEffectLevel}`),
        text('span', `Estado: ${preview.review.state}`),
        text('small', `Aprovações necessárias: ${preview.review.requiredApprovals}`),
      );
      const list = document.createElement('ol');
      for (const step of preview.plan.steps ?? []) {
        const affected = step.maxAffectedItems ? ` — até ${step.maxAffectedItems} item(ns)` : '';
        list.append(text('li', `${step.capabilityId} — ${step.objective} — ${step.sideEffect}${affected}`));
        if (step.inputs?.length) list.append(text('small', `Dados usados: ${step.inputs.join(', ')}`));
        if (step.outputs?.length) list.append(text('small', `Saídas previstas: ${step.outputs.join(', ')}`));
      }
      article.append(list);
      for (const item of preview.review.reasons ?? []) article.append(text('small', item));
      planPanel.replaceChildren(article);
      renderActions();
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

    const renderManagerAnswer = (answer) => {
      const article = document.createElement('article');
      article.className = 'manager-result-content';
      article.append(
        text('small', `Intenção: ${answer.intent}`),
        text('p', answer.answer),
        text('strong', `Confiança: ${Math.round(Number(answer.confidence ?? 0) * 100)}%`),
        text('small', `Operadores: ${(answer.operatorsUsed ?? []).map(({ operatorId }) => operatorId).join(', ') || '--'}`),
      );
      for (const [title, items, value] of [
        ['Evidências', answer.evidence, (item) => `${item.classification}: ${item.summary}`],
        ['Conflitos', answer.conflicts, (item) => item.summary],
        ['Dados ausentes', answer.missingData, (item) => item],
      ]) {
        if (!Array.isArray(items) || items.length === 0) continue;
        const section = document.createElement('section');
        section.append(text('h4', title));
        const list = document.createElement('ul');
        list.append(...items.map((item) => text('li', value(item))));
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
        row.append(text('strong', execution.answer ?? execution.objective), text('span', execution.outcome ?? execution.status),
          text('small', new Date(execution.createdAt).toLocaleString('pt-BR')));
        return row;
      }));
    };

    const loadHistory = async () => {
      try {
        const executions = typeof api.listManagerHistory === 'function'
          ? await api.listManagerHistory({ limit: 10 })
          : await api.listOrchestrationExecutions({ limit: 10 });
        if (current()) renderHistory(executions);
      } catch {
        if (current()) setFeedback('Não foi possível carregar o histórico do Gerente.', 'error');
      }
    };

    const loadAutomations = async () => {
      if (!automationSummary || typeof api.listAutomations !== 'function') return;
      try {
        const [automations, runtime, diagnostics] = await Promise.all([
          api.listAutomations(),
          typeof api.getAutomationRuntimeStatus === 'function' ? api.getAutomationRuntimeStatus() : Promise.resolve(null),
          typeof api.listAutomationDiagnostics === 'function' ? api.listAutomationDiagnostics() : Promise.resolve([]),
        ]);
        if (!current()) return;
        const runtimeRow = runtime ? text('p', `Runtime ${runtime.status} · último tick ${runtime.lastTickAt
          ? new Date(runtime.lastTickAt).toLocaleString('pt-BR') : '--'} · falhas ${runtime.runsFailed ?? 0}`) : null;
        if (!automations.length) {
          automationSummary.replaceChildren(...[runtimeRow, text('p', 'Nenhuma automação configurada.', 'performance-empty')].filter(Boolean));
          return;
        }
        const rows = automations.slice(0, 5).map((automation) => { const diagnostic = diagnostics.find((item) => item.automationId === automation.id);
          const row = document.createElement('article'); row.className = 'manager-history-item';
          row.append(text('strong', automation.name), text('span', automation.status),
            text('small', automation.nextRunAt ? `Próxima: ${new Date(automation.nextRunAt).toLocaleString('pt-BR')}` : 'Sem agenda ativa'),
            text('small', diagnostic ? `${diagnostic.health} · hoje ${diagnostic.quota.daily.remaining} restantes · ${diagnostic.recommendation}` : 'Diagnóstico indisponível'));
          return row;
        });
        automationSummary.replaceChildren(...[runtimeRow, ...rows].filter(Boolean));
      } catch {
        if (current()) automationSummary.replaceChildren(text('p', 'Automações indisponíveis.', 'performance-empty'));
      }
    };

    const requestInput = () => {
      const request = { intent: intent.value.trim() };
      if (syncConfirm.checked) {
        request.sync = { mode: 'recent', startDate: syncStart.value, endDate: syncEnd.value, limit: 20 };
      }
      return request;
    };

    const submit = async (event) => {
      event.preventDefault();
      if (!intent.value.trim() || busy) return;
      setBusy(true);
      setFeedback('Gerando preview seguro...');
      try {
        const preview = await api.previewOrchestration(requestInput());
        if (!current()) return;
        activePreview = preview;
        result.replaceChildren();
        renderPlan(preview);
        setFeedback(preview.review.state === 'review_required'
          ? 'Revise o plano antes de aprovar ou rejeitar.' : 'Plano de baixo risco pronto para execução.', 'success');
      } catch {
        if (current()) setFeedback('Não foi possível gerar o preview do plano.', 'error');
      } finally {
        if (current()) setBusy(false);
      }
    };

    const submitQuery = async (event) => {
      event.preventDefault();
      if (!question?.value.trim() || busy || typeof api.queryManager !== 'function') return;
      setBusy(true);
      setFeedback('Consultando operadores necessários...');
      try {
        const answer = await api.queryManager({ message: question.value.trim() });
        if (!current()) return;
        renderManagerAnswer(answer);
        setFeedback(answer.outcome === 'DEGRADED'
          ? 'Resposta concluída em modo degradado.'
          : answer.outcome === 'INSUFFICIENT_DATA'
            ? 'Ainda faltam dados para uma conclusão segura.'
            : 'Consulta concluída.', answer.outcome === 'ANSWERED' ? 'success' : 'warning');
        await loadHistory();
      } catch {
        if (current()) setFeedback('Não foi possível consultar o Gerente. Tente novamente.', 'error');
      } finally {
        if (current()) setBusy(false);
      }
    };

    async function decide(decision) {
      if (!activePreview || busy) return;
      if (decision === 'reject' && !reason.value.trim()) {
        setFeedback('Informe o motivo da rejeição.', 'error');
        return;
      }
      setBusy(true);
      try {
        const payload = { reviewer: 'local-operator', reason: reason.value.trim(),
          expectedVersion: activePreview.review.version };
        const response = decision === 'approve'
          ? await api.approveOrchestrationPlan(activePreview.executionId, payload)
          : await api.rejectOrchestrationPlan(activePreview.executionId, payload);
        if (!current()) return;
        activePreview.review = { ...activePreview.review, ...response.review };
        renderPlan(activePreview);
        setFeedback(decision === 'approve' ? 'Plano aprovado.' : 'Plano rejeitado.', 'success');
        await loadHistory();
      } catch {
        if (current()) setFeedback('Não foi possível registrar a revisão do plano.', 'error');
      } finally {
        if (current()) setBusy(false);
      }
    }

    const execute = async () => {
      if (!activePreview || activePreview.review.state !== 'approved' || busy) return;
      setBusy(true);
      setFeedback('Executando plano aprovado...');
      try {
        const response = await api.executeOrchestrationPlan(activePreview.executionId);
        if (!current()) return;
        activePreview.review.state = 'executed';
        renderPlan(activePreview);
        renderEvidence(response.result);
        setFeedback(response.result.status === 'partial'
          ? 'Execução concluída parcialmente.' : 'Execução concluída.',
        response.result.status === 'partial' ? 'warning' : 'success');
        await loadHistory();
      } catch {
        if (current()) setFeedback('Não foi possível executar o plano aprovado.', 'error');
      } finally {
        if (current()) setBusy(false);
      }
    };

    form.addEventListener('submit', submit);
    queryForm?.addEventListener('submit', submitQuery);
    approveButton.addEventListener('click', approve);
    rejectButton.addEventListener('click', reject);
    executeButton.addEventListener('click', execute);
    loadHistory();
    loadAutomations();
    cleanup = () => {
      form.removeEventListener('submit', submit);
      queryForm?.removeEventListener('submit', submitQuery);
      approveButton.removeEventListener('click', approve);
      rejectButton.removeEventListener('click', reject);
      executeButton.removeEventListener('click', execute);
    };
  };

  const unmount = () => {
    cleanup();
    cleanup = () => {};
    mounted = null;
    activePreview = null;
    busy = false;
    generation += 1;
  };

  return { mount, unmount };
};

export const managerModule = {
  id: 'manager',
  route: '/manager',
  pageTitle: 'Gerente',
  pageEyebrow: 'Orquestração autônoma e controlada',
  label: 'Gerente',
  fullscreen: true,
  render: renderManager,
  createController: createManagerController,
};
