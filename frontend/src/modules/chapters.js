import { createPanel, html } from '../design-system/index.js';

const node = (tag, text, className = '') => { const value = document.createElement(tag); value.textContent = String(text ?? ''); if (className) value.className = className; return value; };
const button = (text, data, primary = false) => { const value = document.createElement('button'); value.type = 'button'; value.textContent = text; value.className = primary ? 'button' : 'button secondary'; Object.assign(value.dataset, data); return value; };

const renderChapters = () => createPanel({
  eyebrow: 'Timed Transcript Pipeline', title: 'Chapters Intelligence', className: 'chapters-panel',
  body: html`
    <div class="performance-feedback" data-chapters-feedback role="status" aria-live="polite" hidden></div>
    <div class="monitoring-toolbar">
      <label>Producao <select data-chapters-production><option value="">Selecione uma producao long-form</option></select></label>
      <label>Formato <select data-chapters-format><option>SBV</option><option>SRT</option><option>VTT</option></select></label>
      <button class="button" type="button" data-chapters-action="generate">Gerar capitulos</button>
      <button class="button secondary" type="button" data-chapters-action="regenerate">Regenerar</button>
    </div>
    <label class="chapters-import">Transcript temporal<textarea data-chapters-content placeholder="Cole aqui SBV, SRT ou VTT"></textarea></label>
    <div class="planning-item-actions"><button class="button secondary" type="button" data-chapters-action="import">Importar transcript</button></div>
    <div class="monitoring-workspace">
      <section><div class="planning-section-heading"><div><p class="eyebrow">Versoes preservadas</p><h3>Capitulos</h3></div></div><div data-chapters-versions><p class="performance-empty">Selecione uma producao.</p></div></section>
      <aside class="planning-detail" data-chapters-detail aria-live="polite"><p class="performance-empty">Nenhuma versao aberta.</p></aside>
    </div>
  `,
});

export const createChaptersController = ({ api }) => {
  let mounted = null; let generation = 0; let request = 0; let pending = false; let activeProductionId = null; let activeVersionId = null; let cleanup = () => {};
  const mount = (root) => {
    const panel = root?.querySelector?.('.chapters-panel'); if (!panel || panel === mounted) return; cleanup(); mounted = panel;
    const token = ++generation; const current = () => mounted === panel && generation === token;
    const productionSelect = panel.querySelector('[data-chapters-production]'); const format = panel.querySelector('[data-chapters-format]'); const content = panel.querySelector('[data-chapters-content]'); const versions = panel.querySelector('[data-chapters-versions]'); const detail = panel.querySelector('[data-chapters-detail]'); const feedback = panel.querySelector('[data-chapters-feedback]');
    if (![productionSelect, format, content, versions, detail, feedback].every(Boolean)) return;
    const message = (text = '', variant = '') => { feedback.textContent = text; feedback.hidden = !text; feedback.className = `performance-feedback ${variant}`.trim(); };
    const renderVersions = (rows) => { if (!rows.length) return versions.replaceChildren(node('p', 'Nenhuma versao gerada.', 'performance-empty')); versions.replaceChildren(...rows.map((row) => { const item = button('', { chapterVersion: row.id }); item.className = `operator-card${row.id === activeVersionId ? ' active' : ''}`; item.append(node('strong', `Versao ${row.version}`), node('span', row.status), node('small', `${row.entries?.length ?? 0} capitulos`)); return item; })); };
    const renderDetail = (set) => {
      activeVersionId = set.id; const article = document.createElement('article'); article.className = 'planning-detail-content'; article.append(node('p', `Versao ${set.version} - ${set.status}`, 'eyebrow'), node('h3', set.production?.title ?? 'Capitulos'));
      const form = document.createElement('form'); form.dataset.chapterEditForm = ''; form.className = 'chapters-editor';
      for (const entry of set.entries ?? []) { const row = document.createElement('div'); row.className = 'chapters-entry'; row.dataset.chapterEntry = entry.id; const time = document.createElement('input'); time.type = 'number'; time.min = '0'; time.value = String(entry.startMs); time.dataset.chapterStart = ''; time.setAttribute('aria-label', 'Timestamp em milissegundos'); const title = document.createElement('input'); title.value = entry.title; title.maxLength = 100; title.dataset.chapterTitle = ''; title.setAttribute('aria-label', 'Titulo do capitulo'); const remove = button('Remover', { chapterRemove: entry.id }); row.append(time, title, remove); form.append(row); }
      const controls = document.createElement('div'); controls.className = 'planning-item-actions'; controls.append(button('Adicionar', { chaptersAction: 'add' }), button('Salvar', { chaptersAction: 'save' }, true), button('Selecionar versao', { chaptersAction: 'select' }, true), button('Copiar formato final', { chaptersAction: 'copy' })); form.append(controls); article.append(form);
      const evidence = document.createElement('details'); evidence.append(node('summary', 'Evidencias e justificativas')); const list = document.createElement('ul'); (set.entries ?? []).forEach((entry) => list.append(node('li', `${entry.title}: ${entry.rationale} [segmentos ${entry.segmentStartPosition}-${entry.segmentEndPosition}]`))); evidence.append(list); article.append(evidence); detail.replaceChildren(article); renderVersions(panel._chapterVersions ?? []);
    };
    const loadVersions = async (productionId) => { const own = ++request; try { const rows = await api.listChapterVersions(productionId); if (!current() || own !== request || activeProductionId !== productionId) return; panel._chapterVersions = rows; renderVersions(rows); if (rows[0]) renderDetail(rows[0]); else detail.replaceChildren(node('p', 'Importe um transcript e gere os capitulos.', 'performance-empty')); message(); } catch { if (current() && own === request) message('Nao foi possivel carregar os capitulos.', 'error'); } };
    const loadProductions = async () => { const own = ++request; try { const rows = await api.listProductions({ format: 'LONG_FORM', limit: 100 }); if (!current() || own !== request) return; for (const row of rows) { const option = document.createElement('option'); option.value = row.id; option.textContent = row.title; productionSelect.append(option); } if (rows[0]) { activeProductionId = rows[0].id; productionSelect.value = rows[0].id; await loadVersions(rows[0].id); } } catch { if (current() && own === request) message('Nao foi possivel carregar as producoes.', 'error'); } };
    const change = () => { activeProductionId = productionSelect.value || null; activeVersionId = null; request += 1; if (activeProductionId) loadVersions(activeProductionId); else { versions.replaceChildren(node('p', 'Selecione uma producao.', 'performance-empty')); detail.replaceChildren(node('p', 'Nenhuma versao aberta.', 'performance-empty')); } };
    const click = async (event) => {
      const version = event.target.closest?.('[data-chapter-version]'); if (version && !pending) { const id = version.dataset.chapterVersion; const own = ++request; activeVersionId = id; try { const set = await api.getChapterVersion(id); if (current() && own === request && activeVersionId === id) renderDetail(set); } catch { if (current() && own === request) message('Nao foi possivel abrir esta versao.', 'error'); } return; }
      const target = event.target.closest?.('[data-chapters-action],[data-chapter-remove]'); if (!target || pending) return; const action = target.dataset.chaptersAction; if (!activeProductionId && ['import', 'generate', 'regenerate'].includes(action)) return message('Selecione uma producao.', 'warning'); pending = true; panel.setAttribute('aria-busy', 'true');
      try {
        if (action === 'import') { await api.importTimedTranscript({ productionId: activeProductionId, format: format.value, content: content.value, source: 'USER_IMPORT' }); message('Transcript importado e relacionado a Library.', 'success'); await loadVersions(activeProductionId); }
        else if (action === 'generate' || action === 'regenerate') { const result = await api.generateChapters(activeProductionId, action === 'regenerate'); if (current()) { panel._chapterVersions = await api.listChapterVersions(activeProductionId); renderVersions(panel._chapterVersions); renderDetail(result.chapterSet); message(result.created ? 'Capitulos gerados para revisao.' : 'Versao selecionada reutilizada.', 'success'); } }
        else if (target.dataset.chapterRemove) { const set = await api.removeChapter(activeVersionId, target.dataset.chapterRemove); if (current() && set.id === activeVersionId) { renderDetail(set); message('Capitulo removido.', 'success'); } }
        else if (action === 'add') { const rows = [...detail.querySelectorAll('[data-chapter-entry]')]; const startMs = rows.length ? Number(rows.at(-1).querySelector('[data-chapter-start]').value) + 60_000 : 0; const set = await api.addChapter(activeVersionId, { startMs, title: 'Novo capitulo' }); if (current()) renderDetail(set); }
        else if (action === 'save') { const entries = [...detail.querySelectorAll('[data-chapter-entry]')].map((row) => ({ id: row.dataset.chapterEntry, startMs: Number(row.querySelector('[data-chapter-start]').value), title: row.querySelector('[data-chapter-title]').value })); const set = await api.updateChapterVersion(activeVersionId, entries, 'Edicao manual no workspace'); if (current()) { renderDetail(set); message('Edicao salva e versionada.', 'success'); } }
        else if (action === 'select') { const result = await api.selectChapterVersion(activeVersionId); if (current()) { panel._chapterVersions = await api.listChapterVersions(activeProductionId); renderVersions(panel._chapterVersions); renderDetail(result.chapterSet); message('Versao final selecionada; etapa CHAPTERS concluida.', 'success'); } }
        else if (action === 'copy') { const output = await api.formatChapterVersion(activeVersionId); await navigator.clipboard?.writeText?.(output.text); if (current()) message('Formato final copiado.', 'success'); }
      } catch (error) { if (current()) message(error?.status === 409 ? 'A acao nao e valida no estado atual.' : 'Nao foi possivel concluir a acao de Chapters.', 'error'); }
      finally { pending = false; if (current()) panel.removeAttribute('aria-busy'); }
    };
    productionSelect.addEventListener('change', change); panel.addEventListener('click', click); cleanup = () => { productionSelect.removeEventListener('change', change); panel.removeEventListener('click', click); }; loadProductions();
  };
  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; request += 1; pending = false; activeProductionId = null; activeVersionId = null; };
  return { mount, unmount };
};

export const chaptersModule = { id: 'chapters', route: '/chapters', label: 'Chapters', icon: 'planning', fullscreen: true, pageTitle: 'Chapters Intelligence', pageEyebrow: 'Transcript temporal e navegacao', render: renderChapters, createController: createChaptersController };
