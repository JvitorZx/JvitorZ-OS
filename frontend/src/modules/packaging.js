import { createPanel, html } from '../design-system/index.js';

const element = (tag, value, className = '') => { const node = document.createElement(tag); node.textContent = String(value ?? ''); if (className) node.className = className; return node; };
const button = (label, data, className = 'button secondary') => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = className; Object.assign(node.dataset, data); return node; };

const renderPackaging = () => createPanel({
  eyebrow: 'Packaging Intelligence', title: 'Embalagem orientada por contexto', className: 'packaging-panel',
  body: html`
    <div class="performance-feedback" data-packaging-feedback role="status" aria-live="polite" hidden></div>
    <form class="monitoring-toolbar" data-packaging-form>
      <label>Jogo <input name="game" required placeholder="City Car Driving 2.0"></label>
      <label>Serie <input name="series" placeholder="Nome da serie"></label>
      <label>Episodio <input name="episode" type="number" min="1"></label>
      <label>Formato <select name="format"><option value="LONG_FORM">Long-form</option><option value="SHORT">Short</option></select></label>
      <label>Acontecimento principal <input name="event" required maxlength="120" placeholder="O que realmente aconteceu"></label>
      <label>Resumo <textarea name="summary" required maxlength="2000"></textarea></label>
      <button class="button" type="submit" data-packaging-generate>Gerar variantes</button>
    </form>
    <div class="monitoring-workspace">
      <section aria-labelledby="packaging-list-title">
        <div class="planning-section-heading"><div><p class="eyebrow">Historico preservado</p><h3 id="packaging-list-title">Embalagens</h3></div></div>
        <div data-packaging-list aria-live="polite"><p class="performance-empty">Carregando embalagens...</p></div>
      </section>
      <aside class="planning-detail" data-packaging-detail aria-live="polite"><p class="performance-empty">Selecione uma embalagem para comparar variantes.</p></aside>
    </div>
  `,
});

export const createPackagingController = ({ api }) => {
  let mounted = null; let generation = 0; let listRequest = 0; let detailRequest = 0; let pending = false; let activeId = null; let cleanup = () => {};
  const mount = (root) => {
    const panel = root?.querySelector?.('.packaging-panel'); if (!panel || panel === mounted) return;
    cleanup(); mounted = panel; const token = ++generation; const current = () => mounted === panel && generation === token;
    const form = panel.querySelector('[data-packaging-form]'); const list = panel.querySelector('[data-packaging-list]');
    const detail = panel.querySelector('[data-packaging-detail]'); const feedback = panel.querySelector('[data-packaging-feedback]');
    if (![form, list, detail, feedback].every(Boolean)) return;
    const setFeedback = (message = '', variant = '') => { feedback.textContent = message; feedback.hidden = !message; feedback.className = `performance-feedback ${variant}`.trim(); };
    const renderList = (rows) => {
      if (!Array.isArray(rows) || !rows.length) { list.replaceChildren(element('p', 'Nenhuma embalagem gerada ainda.', 'performance-empty')); return; }
      list.replaceChildren(...rows.map((row) => {
        const card = button('', { packagingOpen: row.id }, 'operator-card'); card.setAttribute('aria-label', `Abrir embalagem ${row.game ?? row.series ?? row.id}`);
        card.append(element('strong', row.game ?? row.series ?? 'Conteudo'), element('span', `${row.status} - ${row.variants?.length ?? 0} variantes`), element('small', row.summary)); return card;
      }));
    };
    const appendList = (parent, title, values) => { if (!Array.isArray(values) || !values.length) return; parent.append(element('h4', title)); const ul = document.createElement('ul'); values.forEach((value) => ul.append(element('li', value))); parent.append(ul); };
    const renderDetail = (packaging) => {
      const article = document.createElement('article'); article.className = 'planning-detail-content'; article.append(element('p', packaging.game ?? 'Conteudo', 'eyebrow'), element('h3', packaging.series ?? packaging.game ?? 'Embalagem'), element('p', packaging.summary));
      for (const variant of packaging.variants ?? []) {
        const card = document.createElement('section'); card.className = 'planning-item'; card.dataset.packagingVariant = variant.id;
        const brief = variant.thumbnailBrief && typeof variant.thumbnailBrief === 'object' ? variant.thumbnailBrief : {};
        card.append(element('strong', `${variant.key}: ${variant.title}`), element('span', `${variant.status} - score relativo ${Math.round(Number(variant.internalScore ?? 0) * 100)}`),
          element('p', variant.rationale), element('p', `Thumbnail: ${brief.concept ?? ''} Texto: ${brief.text ?? 'sem texto'}`), element('p', `Descricao: ${variant.description}`), element('small', `Tags: ${(variant.tags ?? []).join(', ')}`));
        const actions = document.createElement('div'); actions.className = 'planning-item-actions';
        const title = document.createElement('input'); title.value = variant.title; title.maxLength = 100; title.dataset.packagingTitle = variant.id; title.setAttribute('aria-label', `Editar titulo da variante ${variant.key}`);
        const thumb = document.createElement('input'); thumb.value = brief.text ?? ''; thumb.maxLength = 80; thumb.dataset.packagingThumb = variant.id; thumb.setAttribute('aria-label', `Editar texto da thumbnail ${variant.key}`);
        actions.append(title, thumb, button('Salvar edicao', { packagingAction: 'edit', variantId: variant.id }), button('Selecionar', { packagingAction: 'select', variantId: variant.id }, 'button'),
          button('Rejeitar', { packagingAction: 'reject', variantId: variant.id }), button('Revisar', { packagingAction: 'review', variantId: variant.id }));
        if (variant.status === 'SELECTED' || variant.status === 'PUBLISHED') {
          const video = document.createElement('input'); video.placeholder = 'Video ID publicado'; video.value = variant.publishedVideoId ?? ''; video.dataset.packagingVideo = variant.id; video.setAttribute('aria-label', `Video publicado da variante ${variant.key}`);
          actions.append(video, button(variant.publishedVideoId ? 'Atualizar metricas' : 'Registrar publicacao', { packagingAction: variant.publishedVideoId ? 'observe' : 'publish', variantId: variant.id }));
        }
        for (const control of actions.children) control.disabled = pending; card.append(actions);
        if (variant.metricSnapshots?.length) appendList(card, 'Resultados observados', variant.metricSnapshots.map((snapshot) => `${snapshot.source}: ${JSON.stringify(snapshot.metrics)} (associacao, nao causalidade)`));
        article.append(card);
      }
      if ((packaging.variants ?? []).length >= 2) article.append(button('Registrar experimento', { packagingAction: 'experiment', packagingId: packaging.id }, 'button secondary'));
      if ((packaging.variants ?? []).reduce((sum, variant) => sum + (variant.metricSnapshots?.length ?? 0), 0) >= 2) article.append(button('Registrar aprendizado', { packagingAction: 'learning', packagingId: packaging.id }, 'button secondary'));
      appendList(article, 'Historico', (packaging.history ?? []).map((entry) => `${entry.event}${entry.reason ? `: ${entry.reason}` : ''}`));
      appendList(article, 'Experimentos', (packaging.experiments ?? []).map((entry) => `${entry.status}: ${entry.hypothesis}`)); detail.replaceChildren(article);
    };
    const load = async () => { const request = ++listRequest; list.setAttribute('aria-busy', 'true'); try { const rows = await api.listPackagings({ limit: 100 }); if (current() && request === listRequest) { renderList(rows); setFeedback(''); } } catch { if (current() && request === listRequest) { list.replaceChildren(); setFeedback('Nao foi possivel carregar as embalagens.', 'error'); } } finally { if (current() && request === listRequest) list.setAttribute('aria-busy', 'false'); } };
    const open = async (id) => { activeId = id; const request = ++detailRequest; detail.setAttribute('aria-busy', 'true'); try { const row = await api.getPackaging(id); if (current() && request === detailRequest && activeId === id) { renderDetail(row); setFeedback(''); } } catch { if (current() && request === detailRequest && activeId === id) setFeedback('Nao foi possivel abrir esta embalagem.', 'error'); } finally { if (current() && request === detailRequest) detail.setAttribute('aria-busy', 'false'); } };
    const submit = async (event) => { event.preventDefault(); if (pending) return; pending = true; form.querySelector('[data-packaging-generate]').disabled = true; const data = new FormData(form);
      try { const created = await api.generatePackaging({ game: data.get('game'), series: data.get('series') || null, episode: data.get('episode') ? Number(data.get('episode')) : null, format: data.get('format'), summary: data.get('summary'), keyEvents: [data.get('event')], variationCount: 3 }); if (!current()) return; activeId = created.id; await load(); if (current()) renderDetail(created); setFeedback('Variantes geradas com contexto auditavel.', 'success'); }
      catch { if (current()) setFeedback('Nao foi possivel gerar a embalagem.', 'error'); } finally { pending = false; if (current()) form.querySelector('[data-packaging-generate]').disabled = false; } };
    const click = async (event) => { const openTarget = event.target.closest?.('[data-packaging-open]'); if (openTarget) return open(openTarget.dataset.packagingOpen); const target = event.target.closest?.('[data-packaging-action]'); if (!target || pending) return; pending = true; const action = target.dataset.packagingAction; const variantId = target.dataset.variantId;
      try {
        let result;
        if (action === 'edit') { const title = detail.querySelector(`[data-packaging-title="${variantId}"]`); const thumb = detail.querySelector(`[data-packaging-thumb="${variantId}"]`); result = await api.editPackagingVariant(variantId, { title: title.value, thumbnailBrief: { text: thumb.value, concept: 'Edicao manual do criador', focus: 'acontecimento real', composition: 'preservada pelo criador', requiredElements: [], optionalElements: [], avoidElements: ['clickbait falso'], complementsTitle: 'Edicao manual registrada.' }, reason: 'Edicao manual pela interface.' }); }
        else if (action === 'select') result = await api.selectPackagingVariant(variantId);
        else if (action === 'reject') result = await api.rejectPackagingVariant(variantId);
        else if (action === 'review') { const review = await api.reviewPackagingVariant(variantId); if (current()) setFeedback(review.findings.map(({ message }) => message).join(' '), review.valid ? 'success' : 'warning'); return; }
        else if (action === 'publish') { const video = detail.querySelector(`[data-packaging-video="${variantId}"]`); if (!video.value.trim()) { setFeedback('Informe o ID do video publicado.', 'warning'); return; } result = await api.publishPackagingVariant(variantId, { videoId: video.value.trim() }); }
        else if (action === 'observe') { await api.observePackagingVariant(variantId); result = await api.getPackaging(activeId); }
        else if (action === 'experiment') { const row = await api.getPackaging(target.dataset.packagingId); result = await api.createPackagingExperiment(row.id, { hypothesis: 'As variantes observadas podem apresentar diferenca de CTR em janelas comparaveis.', variantIds: row.variants.slice(0, 2).map(({ id }) => id) }); result = await api.getPackaging(row.id); }
        else if (action === 'learning') { await api.recordPackagingLearning(target.dataset.packagingId); result = await api.getPackaging(target.dataset.packagingId); }
        if (!current()) return; if (result?.id === activeId) renderDetail(result); else await open(activeId); await load(); setFeedback('Embalagem atualizada e historico preservado.', 'success');
      } catch (error) { if (current()) setFeedback(error?.status === 409 ? 'A acao conflita com o estado atual da embalagem.' : 'Nao foi possivel atualizar a embalagem.', 'error'); }
      finally { pending = false; }
    };
    form.addEventListener('submit', submit); list.addEventListener('click', click); detail.addEventListener('click', click); cleanup = () => { form.removeEventListener('submit', submit); list.removeEventListener('click', click); detail.removeEventListener('click', click); }; load();
  };
  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; listRequest += 1; detailRequest += 1; activeId = null; pending = false; };
  return { mount, unmount };
};

export const packagingModule = { id: 'packaging', route: '/packaging', label: 'Packaging', icon: 'image', fullscreen: true, pageTitle: 'Packaging Intelligence', pageEyebrow: 'Embalagem orientada por dados', render: renderPackaging, createController: createPackagingController };
