import { createPanel, html } from '../design-system/index.js';

const el = (tag, value, className = '') => { const node = document.createElement(tag); node.textContent = String(value ?? ''); if (className) node.className = className; return node; };
const action = (label, data, primary = false) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = primary ? 'button' : 'button secondary'; Object.assign(node.dataset, data); return node; };

const renderProduction = () => createPanel({
  eyebrow: 'Content Production Pipeline', title: 'Producoes', className: 'production-panel',
  body: html`
    <div class="performance-feedback" data-production-feedback role="status" aria-live="polite" hidden></div>
    <form class="monitoring-toolbar" data-production-form>
      <label>Titulo interno <input name="title" required maxlength="200" placeholder="City Car - Episodio 9"></label>
      <label>Formato <select name="format"><option value="LONG_FORM">Long-form</option><option value="SHORT">Short</option></select></label>
      <label>Jogo <input name="game" maxlength="160"></label>
      <label>Serie <input name="series" maxlength="160"></label>
      <label>Resumo <textarea name="summary" maxlength="2000"></textarea></label>
      <label>Acontecimento <input name="event" maxlength="300" placeholder="O que realmente aconteceu"></label>
      <button class="button" type="submit" data-production-create>Criar producao</button>
    </form>
    <div class="monitoring-workspace">
      <section><div class="planning-section-heading"><div><p class="eyebrow">Pipeline persistente</p><h3>Producoes</h3></div></div><div data-production-list aria-live="polite"><p class="performance-empty">Carregando producoes...</p></div></section>
      <aside class="planning-detail" data-production-detail aria-live="polite"><p class="performance-empty">Selecione uma producao.</p></aside>
    </div>
  `,
});

export const createProductionController = ({ api }) => {
  let mounted = null; let generation = 0; let listRequest = 0; let detailRequest = 0; let pending = false; let activeId = null; let cleanup = () => {};
  const mount = (root) => {
    const panel = root?.querySelector?.('.production-panel'); if (!panel || panel === mounted) return; cleanup(); mounted = panel;
    const token = ++generation; const current = () => mounted === panel && generation === token; const form = panel.querySelector('[data-production-form]'); const list = panel.querySelector('[data-production-list]'); const detail = panel.querySelector('[data-production-detail]'); const feedback = panel.querySelector('[data-production-feedback]');
    if (![form, list, detail, feedback].every(Boolean)) return;
    const message = (value = '', variant = '') => { feedback.textContent = value; feedback.hidden = !value; feedback.className = `performance-feedback ${variant}`.trim(); };
    const renderList = (rows) => { if (!Array.isArray(rows) || !rows.length) return list.replaceChildren(el('p', 'Nenhuma producao criada ainda.', 'performance-empty')); list.replaceChildren(...rows.map((row) => { const card = action('', { productionOpen: row.id }); card.className = 'operator-card'; card.setAttribute('aria-label', `Abrir producao ${row.title}`); card.append(el('strong', row.title), el('span', `${row.status} - ${row.currentStage}`), el('small', row.nextAction?.label ?? 'Sem proxima acao')); return card; })); };
    const lineList = (title, values) => { const section = document.createElement('section'); section.append(el('h4', title)); if (!values.length) section.append(el('p', 'Nenhum registro.', 'performance-empty')); else { const ul = document.createElement('ul'); values.forEach((value) => ul.append(el('li', value))); section.append(ul); } return section; };
    const renderDetail = (row) => {
      const article = document.createElement('article'); article.className = 'planning-detail-content'; article.append(el('p', `${row.format}${row.game ? ` - ${row.game}` : ''}`, 'eyebrow'), el('h3', row.title), el('p', row.summary ?? 'Sem resumo.'), el('strong', `Proxima acao: ${row.nextAction?.label ?? 'Nenhuma'}`), el('p', row.nextAction?.reason ?? ''));
      const timeline = document.createElement('div'); timeline.className = 'planning-list';
      for (const step of row.steps ?? []) { const card = document.createElement('section'); card.className = 'planning-item'; card.dataset.productionStep = step.key; card.append(el('strong', `${step.position}. ${step.label}`), el('span', `${step.state} - ${step.mode}`), el('small', step.capability ? `Capacidade: ${step.capability}` : step.mode === 'MANUAL' ? 'Etapa manual' : ''));
        const controls = document.createElement('div'); controls.className = 'planning-item-actions';
        if (step.key === 'CHAPTERS' && !['NOT_STARTED', 'BLOCKED', 'CANCELLED'].includes(step.state)) controls.append(action('Abrir Chapters', { productionChaptersOpen: row.id }, true));
        if (['AVAILABLE', 'FAILED', 'OUTDATED'].includes(step.state)) controls.append(action(step.state === 'FAILED' ? 'Retry' : step.state === 'OUTDATED' ? 'Revisar novamente' : 'Iniciar', { productionAction: step.state === 'FAILED' ? 'retry' : step.state === 'OUTDATED' ? 'repeat' : 'start', stepKey: step.key }, true));
        if (step.key === 'PACKAGING' && ['AVAILABLE', 'FAILED', 'OUTDATED'].includes(step.state)) controls.append(action('Gerar Packaging', { productionAction: 'packaging', stepKey: step.key }, true));
        if (['IN_PROGRESS', 'WAITING_USER'].includes(step.state) && !['REVIEW', 'CHAPTERS'].includes(step.key)) controls.append(action('Concluir', { productionAction: 'complete', stepKey: step.key }, true));
        if (step.key === 'REVIEW' && ['AVAILABLE', 'IN_PROGRESS', 'WAITING_USER'].includes(step.state)) controls.append(action('Revisar com Supervisor', { productionAction: 'review', stepKey: step.key }, true));
        if (step.skippable && ['AVAILABLE', 'IN_PROGRESS', 'WAITING_USER'].includes(step.state)) controls.append(action('Pular', { productionAction: 'skip', stepKey: step.key }));
        if (['COMPLETED', 'SKIPPED'].includes(step.state)) controls.append(action('Repetir', { productionAction: 'repeat', stepKey: step.key }));
        for (const control of controls.children) control.disabled = pending; card.append(controls); timeline.append(card); }
      article.append(timeline);
      if (row.packaging) article.append(action('Abrir Packaging associado', { productionPackagingOpen: row.packaging.id }));
      if (row.status === 'READY_TO_PUBLISH') { const publication = document.createElement('div'); publication.className = 'planning-item-actions'; const video = document.createElement('input'); video.placeholder = 'YouTube videoId'; video.dataset.productionVideo = ''; video.setAttribute('aria-label', 'YouTube videoId publicado'); publication.append(video, action('Associar publicacao externa', { productionAction: 'publish' }, true)); article.append(publication); }
      article.append(lineList('Assets da Library', (row.assets ?? []).map(({ role, libraryItem }) => `${role}: ${libraryItem.title}`)), lineList('Timeline', (row.events ?? []).map(({ event, stepKey, reason }) => `${event}${stepKey ? ` - ${stepKey}` : ''}${reason ? `: ${reason}` : ''}`))); detail.replaceChildren(article);
    };
    const load = async () => { const request = ++listRequest; try { const rows = await api.listProductions({ limit: 100 }); if (current() && request === listRequest) { renderList(rows); message(); } } catch { if (current() && request === listRequest) { list.replaceChildren(); message('Nao foi possivel carregar as producoes.', 'error'); } } };
    const open = async (id) => { activeId = id; const request = ++detailRequest; try { const row = await api.getProduction(id); if (current() && request === detailRequest && activeId === id) { renderDetail(row); message(); } } catch { if (current() && request === detailRequest && activeId === id) message('Nao foi possivel abrir esta producao.', 'error'); } };
    const submit = async (event) => { event.preventDefault(); if (pending) return; pending = true; const data = new FormData(form); try { const row = await api.createProduction({ title: data.get('title'), format: data.get('format'), game: data.get('game') || null, series: data.get('series') || null, summary: data.get('summary') || null, keyEvents: data.get('event') ? [data.get('event')] : [], origin: 'DIRECT' }); if (!current()) return; activeId = row.id; await load(); if (current()) renderDetail(row); message('Producao criada e workflow preservado.', 'success'); } catch { if (current()) message('Nao foi possivel criar a producao.', 'error'); } finally { pending = false; } };
    const click = async (event) => { const openTarget = event.target.closest?.('[data-production-open]'); if (openTarget) return open(openTarget.dataset.productionOpen); const packagingOpen = event.target.closest?.('[data-production-packaging-open]'); if (packagingOpen) { location.hash = '#/packaging'; return; } const chaptersOpen = event.target.closest?.('[data-production-chapters-open]'); if (chaptersOpen) { location.hash = '#/chapters'; return; } const target = event.target.closest?.('[data-production-action]'); if (!target || pending || !activeId) return; pending = true;
      try { const name = target.dataset.productionAction; let row; if (name === 'packaging') row = (await api.runProductionPackaging(activeId)).production; else if (name === 'review') row = await api.reviewProduction(activeId); else if (name === 'publish') { const video = detail.querySelector('[data-production-video]'); if (!video?.value.trim()) { message('Informe o videoId publicado.', 'warning'); return; } row = await api.publishProduction(activeId, { videoId: video.value.trim() }); } else row = await api.transitionProductionStep(activeId, target.dataset.stepKey, name, name === 'skip' ? { reason: 'Etapa pulada pelo usuario.' } : {}); if (!current() || activeId !== row.id) return; renderDetail(row); await load(); message('Workflow atualizado e historico preservado.', 'success'); }
      catch (error) { if (current()) message(error?.status === 409 ? 'Esta acao nao e valida no estado atual.' : 'Nao foi possivel atualizar a producao.', 'error'); } finally { pending = false; } };
    form.addEventListener('submit', submit); list.addEventListener('click', click); detail.addEventListener('click', click); cleanup = () => { form.removeEventListener('submit', submit); list.removeEventListener('click', click); detail.removeEventListener('click', click); }; load();
  };
  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; listRequest += 1; detailRequest += 1; pending = false; activeId = null; };
  return { mount, unmount };
};

export const productionModule = { id: 'production', route: '/production', label: 'Producao', icon: 'planning', fullscreen: true, pageTitle: 'Content Production Pipeline', pageEyebrow: 'Do plano ao resultado', render: renderProduction, createController: createProductionController };
