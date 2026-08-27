import { createPanel, html } from '../design-system/index.js';

const renderAutomations = () => createPanel({
  eyebrow: 'Operadores', title: 'Automações controladas', className: 'automations-panel',
  body: html`
    <div class="automation-feedback" data-automation-feedback role="status" aria-live="polite" hidden></div>
    <section class="automation-runtime" aria-labelledby="automation-runtime-title">
      <h3 id="automation-runtime-title">Runtime local</h3>
      <div data-automation-runtime><p class="performance-empty">Carregando runtime...</p></div>
      <div class="automation-actions"><button class="button" type="button" data-runtime-start>Iniciar runtime</button>
        <button class="button secondary" type="button" data-runtime-stop>Parar runtime</button>
        <button class="button secondary" type="button" data-runtime-tick>Executar tick</button></div>
    </section>
    <div class="automation-workspace">
      <form class="automation-form" data-automation-form>
        <input type="hidden" data-automation-id>
        <label>Nome <input data-automation-name maxlength="120" required></label>
        <label>Rotina <select data-automation-template>
          <option value="summary">Resumo operacional</option>
          <option value="outcome">Revisar outcomes disponíveis</option>
          <option value="youtube">Sincronizar YouTube e revisar outcomes</option>
        </select></label>
        <label>Agenda <select data-automation-trigger>
          <option value="MANUAL_ONLY">Somente manual</option><option value="DAILY">Diária</option><option value="WEEKLY">Semanal</option>
        </select></label>
        <label data-automation-weekday hidden>Dia da semana <select>
          <option value="1">Segunda</option><option value="2">Terça</option><option value="3">Quarta</option>
          <option value="4">Quinta</option><option value="5">Sexta</option><option value="6">Sábado</option><option value="0">Domingo</option>
        </select></label>
        <label data-automation-time hidden>Horário <input type="time" value="09:00"></label>
        <label>Fuso <input data-automation-timezone value="America/Sao_Paulo" maxlength="80" required></label>
        <label><input type="checkbox" data-automation-enabled> Ativar após salvar</label>
        <div class="automation-actions"><button class="button" type="submit" data-automation-save>Salvar automação</button>
          <button class="button secondary" type="button" data-automation-cancel hidden>Cancelar edição</button></div>
      </form>
      <section aria-labelledby="automation-list-title"><h3 id="automation-list-title">Rotinas</h3>
        <div data-automation-list><p class="performance-empty">Carregando automações...</p></div></section>
      <section aria-labelledby="automation-runs-title"><h3 id="automation-runs-title">Execuções</h3>
        <div data-automation-runs><p class="performance-empty">Selecione o histórico de uma rotina.</p></div></section>
    </div>
  `,
});

const node = (tag, content, className = '') => {
  const element = document.createElement(tag); element.textContent = String(content ?? '');
  if (className) element.className = className; return element;
};

const templateData = (template) => {
  if (template === 'youtube') {
    const end = new Date(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
    return { intent: 'Sincronize o YouTube e revise outcomes', orchestrationInput: {
      sync: { mode: 'recent', startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), limit: 20 },
    } };
  }
  if (template === 'outcome') return { intent: 'Revise o resultado editorial e os outcomes disponíveis', orchestrationInput: {} };
  return { intent: 'Como está o estado operacional do canal?', orchestrationInput: {} };
};

export const createAutomationsController = ({ api }) => {
  let mounted = null; let generation = 0; let cleanup = () => {}; let busy = false;
  const mount = (root) => {
    const panel = root?.querySelector?.('.automations-panel'); if (!panel || panel === mounted) return;
    cleanup(); mounted = panel; const token = ++generation; const current = () => mounted === panel && generation === token;
    const form = panel.querySelector('[data-automation-form]'); const id = panel.querySelector('[data-automation-id]');
    const name = panel.querySelector('[data-automation-name]'); const template = panel.querySelector('[data-automation-template]');
    const trigger = panel.querySelector('[data-automation-trigger]'); const weekdayLabel = panel.querySelector('[data-automation-weekday]');
    const weekday = weekdayLabel?.querySelector?.('select'); const timeLabel = panel.querySelector('[data-automation-time]');
    const time = timeLabel?.querySelector?.('input'); const timezone = panel.querySelector('[data-automation-timezone]');
    const enabled = panel.querySelector('[data-automation-enabled]'); const save = panel.querySelector('[data-automation-save]');
    const cancel = panel.querySelector('[data-automation-cancel]'); const feedback = panel.querySelector('[data-automation-feedback]');
    const list = panel.querySelector('[data-automation-list]'); const runs = panel.querySelector('[data-automation-runs]');
    const runtime = panel.querySelector('[data-automation-runtime]'); const runtimeStart = panel.querySelector('[data-runtime-start]');
    const runtimeStop = panel.querySelector('[data-runtime-stop]'); const runtimeTick = panel.querySelector('[data-runtime-tick]');
    if (![form, id, name, template, trigger, weekdayLabel, weekday, timeLabel, time, timezone, enabled, save, cancel, feedback, list, runs,
      runtime, runtimeStart, runtimeStop, runtimeTick].every(Boolean)) return;
    const setFeedback = (message = '', variant = 'info') => { feedback.textContent = message; feedback.hidden = !message; feedback.className = `automation-feedback ${variant}`; };
    const setBusy = (value) => { busy = value; save.disabled = value; save.setAttribute('aria-busy', String(value)); };
    const syncScheduleFields = () => { timeLabel.hidden = trigger.value === 'MANUAL_ONLY'; weekdayLabel.hidden = trigger.value !== 'WEEKLY'; };
    const clearForm = () => { id.value = ''; name.value = ''; template.value = 'summary'; trigger.value = 'MANUAL_ONLY'; enabled.checked = false;
      cancel.hidden = true; save.textContent = 'Salvar automação'; syncScheduleFields(); };
    const getSchedule = () => trigger.value === 'MANUAL_ONLY' ? null
      : trigger.value === 'WEEKLY' ? { time: time.value, weekday: Number(weekday.value) } : { time: time.value };
    const renderRuntime = (health) => { const article = document.createElement('article'); article.className = 'automation-runtime-status';
      article.append(node('strong', health.status), node('span', health.enabled ? 'Habilitado por configuração' : 'Desabilitado por configuração'),
        node('small', health.lastTickAt ? `Último tick: ${new Date(health.lastTickAt).toLocaleString('pt-BR')}` : 'Nenhum tick executado'),
        node('small', health.nextTickAt ? `Próximo tick: ${new Date(health.nextTickAt).toLocaleString('pt-BR')}` : 'Sem próximo tick'),
        node('small', `Due: ${health.dueCount ?? 0} · iniciadas: ${health.runsStarted ?? 0} · falhas: ${health.runsFailed ?? 0}`));
      if (health.lastError) article.append(node('small', `Último erro: ${health.lastError}`)); runtime.replaceChildren(article);
      runtimeStart.disabled = !health.enabled || ['RUNNING', 'STARTING'].includes(health.status); runtimeStop.disabled = health.status === 'STOPPED';
      runtimeTick.disabled = !health.enabled; };
    const loadRuntime = async () => { try { const health = await api.getAutomationRuntimeStatus(); if (current()) renderRuntime(health); }
      catch { if (current()) setFeedback('Não foi possível consultar o runtime.', 'error'); } };
    const renderRuns = (items) => {
      if (!items.length) { runs.replaceChildren(node('p', 'Nenhuma execução registrada.', 'performance-empty')); return; }
      runs.replaceChildren(...items.map((item) => { const article = document.createElement('article'); article.className = 'automation-run-item';
        article.append(node('strong', item.status), node('span', item.triggerSource), node('small', new Date(item.createdAt).toLocaleString('pt-BR')),
          node('p', item.resultSummary ?? item.failureReason ?? 'Sem resumo.'));
        if (item.orchestrationExecutionId) article.append(node('small', `Plano: ${item.orchestrationExecutionId}`)); return article; }));
    };
    const loadRuns = async (automationId) => { try { const items = await api.listAutomationRuns(automationId); if (current()) renderRuns(items); }
      catch { if (current()) setFeedback('Não foi possível carregar as execuções.', 'error'); } };
    const actionButton = (label, action, automation) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = label;
      button.addEventListener('click', async () => { if (busy) return; setBusy(true); setFeedback('Atualizando automação...');
        try {
          if (action === 'run') await api.runAutomationNow(automation.id);
          else if (action === 'retry' || action === 'recover') await api.controlAutomationRun(automation.diagnostic.lastResult.id, action);
          else if (action === 'clear-block' || action === 'skip') await api.controlAutomationGovernance(automation.id, action);
          else if (action === 'override') {
            const policies = automation.diagnostic?.block?.policies?.map((policy) => policy.includes('Quota') ? 'quota' : policy === 'executionWindow' ? 'window' : policy).filter((policy) => ['quota', 'window', 'cooldown'].includes(policy)) ?? [];
            if (!policies.length || !(globalThis.confirm?.('Confirmar override operacional desta execução?') ?? false)) return;
            await api.controlAutomationGovernance(automation.id, 'override', { policies: [...new Set(policies)], reason: 'Confirmação explícita na workspace de Automações', authorizedBy: 'local-workspace' });
          }
          else if (action === 'history') { await loadRuns(automation.id); return; }
          else if (action === 'edit') { id.value = automation.id; name.value = automation.name; trigger.value = automation.triggerType;
            timezone.value = automation.timezone; enabled.checked = automation.enabled;
            if (automation.schedule?.time) time.value = automation.schedule.time;
            if (automation.schedule?.weekday !== undefined) weekday.value = String(automation.schedule.weekday);
            cancel.hidden = false; save.textContent = 'Atualizar automação'; syncScheduleFields(); return;
          } else await api.setAutomationState(automation.id, action);
          if (current()) { setFeedback(['run', 'retry', 'recover', 'override'].includes(action) ? 'Execução solicitada com segurança.' : 'Estado atualizado.', 'success'); await load(); }
        } catch (error) { if (current()) setFeedback(error?.status === 409 ? 'A automação já está em execução ou aguarda revisão.' : 'Não foi possível concluir a ação.', 'error'); }
        finally { if (current()) setBusy(false); }
      }); return button;
    };
    const renderList = (items, diagnostics = []) => {
      if (!items.length) { list.replaceChildren(node('p', 'Nenhuma automação configurada.', 'performance-empty')); return; }
      list.replaceChildren(...items.map((automation) => { const diagnostic = diagnostics.find((item) => item.automationId === automation.id); automation = { ...automation, diagnostic };
        const article = document.createElement('article'); article.className = 'automation-item';
        article.append(node('strong', automation.name), node('span', automation.status, `operator-status ${automation.enabled ? 'ready' : 'planned'}`),
          node('small', `${automation.triggerType} · ${automation.timezone}`), node('small', `Risco ${automation.riskLevel ?? '--'} · efeito ${automation.sideEffectLevel ?? '--'}`),
          node('small', automation.nextRunAt ? `Próxima: ${new Date(automation.nextRunAt).toLocaleString('pt-BR')}` : 'Sem próxima execução agendada'));
        if (diagnostic) article.append(node('small', `Health ${diagnostic.health} · quota hoje ${diagnostic.quota.daily.remaining}/${diagnostic.quota.daily.limit} · falhas ${diagnostic.consecutiveFailures}`),
          node('small', diagnostic.nextEligibleAt ? `Elegível: ${new Date(diagnostic.nextEligibleAt).toLocaleString('pt-BR')}` : `Cooldown: ${diagnostic.cooldownMinutes} min`),
          node('p', diagnostic.recommendation));
        const actions = document.createElement('div'); actions.className = 'automation-actions';
        actions.append(actionButton('Executar agora', 'run', automation), actionButton('Histórico', 'history', automation), actionButton('Editar', 'edit', automation));
        if (!automation.enabled) actions.append(actionButton('Ativar', 'enable', automation));
        else if (automation.status === 'PAUSED' || ['BLOCKED', 'ERROR'].includes(automation.status)) actions.append(actionButton('Retomar', 'resume', automation));
        else actions.append(actionButton('Pausar', 'pause', automation));
        if (automation.enabled) actions.append(actionButton('Desativar', 'disable', automation));
        if (diagnostic?.lastResult?.status === 'FAILED') actions.append(actionButton('Retry', 'retry', automation));
        if (diagnostic?.lastResult?.failureReason === 'Interrupted') actions.append(actionButton('Recover', 'recover', automation));
        if (['BLOCKED', 'PAUSED', 'ERROR'].includes(automation.status)) actions.append(actionButton('Limpar bloqueio', 'clear-block', automation));
        if (automation.nextRunAt) actions.append(actionButton('Pular ocorrência', 'skip', automation));
        if (diagnostic?.block?.policies?.some((policy) => ['dailyQuota', 'weeklyQuota', 'executionWindow', 'cooldown'].includes(policy))) actions.append(actionButton('Override', 'override', automation));
        article.append(actions); return article; }));
    };
    async function load() { try { const [items, diagnostics] = await Promise.all([api.listAutomations(),
        typeof api.listAutomationDiagnostics === 'function' ? api.listAutomationDiagnostics() : Promise.resolve([])]); if (current()) renderList(items, diagnostics); }
      catch { if (current()) { list.replaceChildren(); setFeedback('Não foi possível carregar as automações.', 'error'); } } }
    const submit = async (event) => { event.preventDefault(); if (busy || !name.value.trim()) return; setBusy(true); setFeedback('Salvando automação...');
      const payload = { name: name.value.trim(), triggerType: trigger.value, schedule: getSchedule(), timezone: timezone.value.trim(), ...templateData(template.value) };
      try { if (id.value) await api.updateAutomation(id.value, payload); else await api.createAutomation({ ...payload, enabled: enabled.checked });
        if (!current()) return; clearForm(); setFeedback('Automação salva.', 'success'); await load();
      } catch { if (current()) setFeedback('Não foi possível salvar a automação.', 'error'); } finally { if (current()) setBusy(false); } };
    const runtimeAction = async (action) => { if (busy) return; setBusy(true); setFeedback('Atualizando runtime...');
      try { await api.controlAutomationRuntime(action); if (!current()) return; await Promise.all([loadRuntime(), load()]);
        setFeedback(action === 'tick' ? 'Tick concluído.' : 'Runtime atualizado.', 'success');
      } catch (error) { if (current()) setFeedback(error?.status === 409 ? 'O runtime está desabilitado ou ocupado.' : 'Não foi possível controlar o runtime.', 'error'); }
      finally { if (current()) setBusy(false); } };
    const cancelEdit = () => clearForm(); form.addEventListener('submit', submit); trigger.addEventListener('change', syncScheduleFields);
    const startRuntime = () => runtimeAction('start'); const stopRuntime = () => runtimeAction('stop'); const tickRuntime = () => runtimeAction('tick');
    cancel.addEventListener('click', cancelEdit); runtimeStart.addEventListener('click', startRuntime); runtimeStop.addEventListener('click', stopRuntime);
    runtimeTick.addEventListener('click', tickRuntime); syncScheduleFields(); load(); loadRuntime();
    cleanup = () => { form.removeEventListener('submit', submit); trigger.removeEventListener('change', syncScheduleFields); cancel.removeEventListener('click', cancelEdit);
      runtimeStart.removeEventListener('click', startRuntime); runtimeStop.removeEventListener('click', stopRuntime); runtimeTick.removeEventListener('click', tickRuntime); };
  };
  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; busy = false; generation += 1; };
  return { mount, unmount };
};

export const automationsModule = { id: 'automation-runner', route: '/automations', aliases: ['automations'],
  pageTitle: 'Automações', pageEyebrow: 'Runtime controlado', label: 'Automações', fullscreen: true,
  render: renderAutomations, createController: createAutomationsController };
