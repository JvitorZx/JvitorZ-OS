import { createPanel, html } from '../design-system/index.js';

const TYPES = ['FACT', 'HYPOTHESIS', 'DECISION', 'EXPERIMENT', 'LEARNING', 'PLATFORM_CHANGE'];
const STATUSES = ['ACTIVE', 'CONFIRMED', 'REJECTED', 'SUPERSEDED'];
const option = (value, label) => `<option value="${value}">${label}</option>`;
const node = (tag, value, className = '') => {
  const element = document.createElement(tag); element.textContent = String(value ?? '');
  if (className) element.className = className; return element;
};

const renderChannelContext = () => createPanel({
  eyebrow: 'Memoria temporal', title: 'Contexto do canal', className: 'channel-context-panel',
  body: html`
    <div class="performance-feedback" data-context-feedback role="status" aria-live="polite" hidden></div>
    <div class="monitoring-toolbar channel-context-filters">
      <label>Tipo <select data-context-type>${option('', 'Todos')}${TYPES.map((value) => option(value, value)).join('')}</select></label>
      <label>Estado <select data-context-status>${option('', 'Todos')}${STATUSES.map((value) => option(value, value)).join('')}</select></label>
      <label>De <input type="date" data-context-from></label>
      <label>Ate <input type="date" data-context-to></label>
      <label>Entidade <input type="text" data-context-entity placeholder="Ex.: City Car Driving"></label>
    </div>
    <div class="monitoring-workspace channel-context-workspace">
      <section aria-labelledby="context-timeline-title">
        <div class="planning-section-heading"><div><p class="eyebrow">Historico preservado</p><h3 id="context-timeline-title">Timeline</h3></div></div>
        <div data-context-list aria-live="polite"><p class="performance-empty">Carregando contexto...</p></div>
      </section>
      <aside class="monitoring-detail" data-context-detail aria-live="polite">
        <p class="performance-empty">Selecione um registro para ver origem, periodo, relacoes e sucessao.</p>
      </aside>
    </div>
  `,
});

export const createChannelContextController = ({ api }) => {
  let mounted = null; let generation = 0; let listRequest = 0; let detailRequest = 0; let cleanup = () => {};
  const mount = (root) => {
    const panel = root?.querySelector?.('.channel-context-panel');
    if (!panel || panel === mounted) return;
    cleanup(); mounted = panel; const token = ++generation; const current = () => mounted === panel && generation === token;
    const type = panel.querySelector('[data-context-type]'); const status = panel.querySelector('[data-context-status]');
    const from = panel.querySelector('[data-context-from]'); const to = panel.querySelector('[data-context-to]'); const entity = panel.querySelector('[data-context-entity]');
    const feedback = panel.querySelector('[data-context-feedback]'); const list = panel.querySelector('[data-context-list]'); const detail = panel.querySelector('[data-context-detail]');
    if (![type, status, from, to, entity, feedback, list, detail].every(Boolean)) return;
    const setFeedback = (message = '', variant = '') => { feedback.textContent = message; feedback.hidden = !message; feedback.className = `performance-feedback ${variant}`.trim(); };
    const filters = () => ({ ...(type.value ? { type: type.value } : {}), ...(status.value ? { status: status.value } : {}),
      ...(from.value ? { periodFrom: new Date(`${from.value}T00:00:00.000Z`).toISOString() } : {}), ...(to.value ? { periodTo: new Date(`${to.value}T23:59:59.999Z`).toISOString() } : {}), limit: 200 });
    const matchesEntity = (entry) => !entity.value.trim() || [entry.subject, entry.entityType, entry.entityId, entry.game, entry.series, entry.format]
      .some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(entity.value.trim().toLocaleLowerCase('pt-BR')));
    const dateLabel = (entry) => entry.periodStart || entry.periodEnd
      ? `${entry.periodStart ? new Date(entry.periodStart).toLocaleDateString('pt-BR') : '?'} - ${entry.periodEnd ? new Date(entry.periodEnd).toLocaleDateString('pt-BR') : '?'}`
      : entry.occurredAt ? new Date(entry.occurredAt).toLocaleDateString('pt-BR') : 'Sem periodo informado';
    const renderList = (items) => {
      const visible = Array.isArray(items) ? items.filter(matchesEntity) : [];
      if (!visible.length) { list.replaceChildren(node('p', 'Nenhum contexto encontrado para estes filtros.', 'performance-empty')); return; }
      list.replaceChildren(...visible.map((entry) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = `operator-card context-${String(entry.type).toLowerCase()}`; button.dataset.contextId = entry.id;
        button.append(node('strong', entry.subject), node('span', `${entry.type} · ${entry.status}`), node('small', `${dateLabel(entry)} · confianca ${Math.round(Number(entry.confidence ?? 0) * 100)}%`));
        return button;
      }));
    };
    const renderDetail = (entry) => {
      const article = document.createElement('article'); article.className = 'manager-result-content';
      article.append(node('p', entry.category, 'eyebrow'), node('h3', entry.subject), node('p', entry.statement),
        node('span', `${entry.type} · ${entry.status} · confianca ${Math.round(Number(entry.confidence ?? 0) * 100)}%`),
        node('p', `Periodo: ${dateLabel(entry)}`), node('p', `Origem: ${entry.source}${entry.sourceReference ? ` / ${entry.sourceReference}` : ''}`));
      if (entry.supersedes) article.append(node('p', `Substitui: ${entry.supersedes.subject ?? entry.supersedes.stableKey}`));
      if (entry.supersededBy) article.append(node('p', `Substituido por: ${entry.supersededBy.subject ?? entry.supersededBy.stableKey}`));
      if (Array.isArray(entry.relations) && entry.relations.length) {
        article.append(node('h4', 'Relacoes')); const relations = document.createElement('ul');
        relations.append(...entry.relations.map((relation) => node('li', `${relation.relation}: ${relation.entityType} / ${relation.entityId}`))); article.append(relations);
      }
      detail.replaceChildren(article);
    };
    const load = async () => {
      const request = ++listRequest; list.setAttribute('aria-busy', 'true');
      try { const items = await api.listChannelContext(filters()); if (current() && request === listRequest) { renderList(items); setFeedback(''); } }
      catch { if (current() && request === listRequest) { list.replaceChildren(); setFeedback('Nao foi possivel carregar o contexto do canal.', 'error'); } }
      finally { if (current() && request === listRequest) list.setAttribute('aria-busy', 'false'); }
    };
    const open = async (event) => {
      const target = event.target.closest?.('[data-context-id]'); if (!target) return; const request = ++detailRequest; detail.setAttribute('aria-busy', 'true');
      try { const entry = await api.getChannelContext(target.dataset.contextId); if (current() && request === detailRequest) { renderDetail(entry); setFeedback(''); } }
      catch { if (current() && request === detailRequest) setFeedback('Nao foi possivel abrir este contexto.', 'error'); }
      finally { if (current() && request === detailRequest) detail.setAttribute('aria-busy', 'false'); }
    };
    const change = () => load();
    for (const control of [type, status, from, to, entity]) control.addEventListener('change', change);
    list.addEventListener('click', open);
    cleanup = () => { for (const control of [type, status, from, to, entity]) control.removeEventListener('change', change); list.removeEventListener('click', open); };
    load();
  };
  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; listRequest += 1; detailRequest += 1; };
  return { mount, unmount };
};

export const channelContextModule = {
  id: 'context', route: '/context', label: 'Contexto', icon: 'database', fullscreen: true,
  pageTitle: 'Contexto e Memoria do Canal', pageEyebrow: 'Creator Memory', render: renderChannelContext,
  createController: createChannelContextController,
};
