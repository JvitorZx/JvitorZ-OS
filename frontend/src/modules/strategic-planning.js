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
  `,
});

export const createStrategicPlanningController = ({ api }) => {
  let mounted = null;
  let generation = 0;
  let loadRequest = 0;
  let plan = null;
  let selectedItemId = null;
  let generating = false;
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
    const actionBar = (item, index, allItems) => {
      const actions = document.createElement('div'); actions.className = 'planning-item-actions';
      const open = button('Detalhes', 'Abrir detalhes', { planningOpen: item.id }, 'button secondary'); actions.append(open);
      const up = button('↑', 'Mover para cima', { planningMove: item.id, direction: 'up' });
      const down = button('↓', 'Mover para baixo', { planningMove: item.id, direction: 'down' });
      up.disabled = index === 0; down.disabled = index === allItems.length - 1; actions.append(up, down);
      if (!['COMPLETED', 'CANCELLED'].includes(item.status)) {
        if (item.status !== 'PAUSED') actions.append(button('Ⅱ', 'Pausar item', { planningPause: item.id }));
        actions.append(button('✓', 'Marcar como concluído', { planningComplete: item.id }));
      }
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
      queue.replaceChildren(...groups); renderDetail();
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
        article.append(text('strong', currentItem.title), text('p', currentItem.rationale),
          text('span', `${currentItem.priority} · ${currentItem.readiness}${currentItem.queue === 'BLOCKED' ? ' · bloqueado' : ''}`));
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
    const load = async () => {
      const request = ++loadRequest; panel.setAttribute('aria-busy', 'true');
      try {
        const loaded = await api.getCurrentContentPlan();
        if (!current() || request !== loadRequest) return;
        plan = loaded; renderPlan(); qualityWarning();
      } catch (error) {
        if (!current() || request !== loadRequest) return;
        if (error?.status === 404) { plan = null; renderPlan(); setFeedback(''); }
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
        renderPlan(); qualityWarning();
      } catch { if (current()) setFeedback('Não foi possível gerar o plano. Tente novamente.', 'error'); }
      finally { if (current()) { setGenerating(false); renderQueue(); } }
    };
    const updateItem = async (id, operation) => {
      if (!plan || generating || pendingItems.has(id)) return;
      pendingItems.add(id); renderQueue();
      try {
        const updated = await operation();
        if (!current()) return;
        plan = { ...plan, items: plan.items.map((item) => item.id === id ? updated : item) };
        selectedItemId = id; renderPlan(); qualityWarning();
      } catch { if (current()) setFeedback('Não foi possível atualizar o item. Tente novamente.', 'error'); }
      finally { pendingItems.delete(id); if (current()) renderQueue(); }
    };
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
      const open = event.target.closest?.('[data-planning-open]');
      if (open) { selectedItemId = open.dataset.planningOpen; renderDetail(); return; }
      const move = event.target.closest?.('[data-planning-move]');
      if (move) { reorder(move.dataset.planningMove, move.dataset.direction); return; }
      const complete = event.target.closest?.('[data-planning-complete]');
      if (complete) updateItem(complete.dataset.planningComplete, () => api.completePlannedContentItem(complete.dataset.planningComplete, 'Conteúdo concluído pela interface.'));
      const pause = event.target.closest?.('[data-planning-pause]');
      if (pause) updateItem(pause.dataset.planningPause, () => api.updatePlannedContentItem(pause.dataset.planningPause, { status: 'PAUSED', reason: 'Item pausado pela interface.' }));
    };
    const handleChange = (event) => {
      const id = event.target?.dataset?.planningPriority;
      if (id) updateItem(id, () => api.updatePlannedContentItem(id, { priority: event.target.value, reason: 'Prioridade alterada pela interface.' }));
    };
    form.addEventListener('submit', generate); queue.addEventListener('click', handleClick); queue.addEventListener('change', handleChange);
    cleanup = () => { form.removeEventListener('submit', generate); queue.removeEventListener('click', handleClick); queue.removeEventListener('change', handleChange); };
    load();
  };

  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; loadRequest += 1; pendingItems.clear(); };
  return { mount, unmount };
};

export const strategicPlanningModule = {
  id: 'planning', route: '/planning', label: 'Planejamento', icon: 'planning', fullscreen: true,
  pageTitle: 'Planejamento Estratégico', pageEyebrow: 'Fila editorial',
  render: renderStrategicPlanning,
  createController: createStrategicPlanningController,
};
