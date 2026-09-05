import { createPanel, html } from '../design-system/index.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = String(text ?? ''); node.className = className; return node; };
const action = (text, name, id) => { const node = el('button', text, 'button secondary'); node.type = 'button'; node.dataset.mediaAction = name; if (id) node.dataset.sourceId = id; return node; };
const statuses = { READY: 'Disponível', OFFLINE: 'Arquivo não encontrado', CHANGED: 'Arquivo alterado — inspecione novamente', UNAVAILABLE: 'Inspeção indisponível', ERROR: 'Não foi possível inspecionar' };
const render = () => createPanel({
  eyebrow: 'Biblioteca de mídia local', title: 'Fontes de vídeo', className: 'media-panel',
  body: html`
    <p class="research-disclaimer">Conecte o arquivo original à Biblioteca e à produção. A inspeção lê duração, imagem e áudio; não copia, altera ou publica o vídeo.</p>
    <p data-media-health role="status">Verificando capacidade de inspeção…</p>
    <div data-media-feedback class="performance-feedback" role="status" aria-live="polite" hidden></div>
    <form data-media-form class="research-form-grid">
      <label>Pasta de mídia <select data-media-root required><option value="">Selecione a pasta configurada</option></select></label>
      <label>Arquivo dentro da pasta <input data-media-path required placeholder="episodio-09/video-editado.mp4" maxlength="1024"></label>
      <label>Título na Biblioteca <input data-media-title maxlength="200" placeholder="Opcional; usa o nome do arquivo"></label>
      <label>Produção relacionada <select data-media-production><option value="">Somente Biblioteca</option></select></label>
      <label>Papel na produção <select data-media-role><option value="EDITED_VIDEO">Vídeo editado</option><option value="RAW_VIDEO">Gravação original</option></select></label>
      <div class="research-actions"><button type="submit" class="button" data-media-submit>Conectar e inspecionar vídeo</button></div>
    </form>
    <p class="research-disclaimer">Informe o caminho do vídeo dentro da pasta escolhida. Links da internet e arquivos fora dessas pastas não são aceitos.</p>
    <div class="media-workspace">
      <section><div class="research-section-heading"><h3>Vídeos conectados</h3><button type="button" class="button secondary" data-media-action="refresh">Atualizar</button></div><div data-media-list></div></section>
      <section data-media-detail aria-live="polite"><p class="performance-empty">Escolha um vídeo para conferir sua origem e visualização.</p></section>
    </div>
  `,
});

export const createMediaController = ({ api }) => {
  let mounted = null; let cleanup = () => {};
  const mount = (root, context = {}) => {
    const panel = root?.querySelector?.('.media-panel'); if (!panel || panel === mounted) return;
    cleanup(); mounted = panel;
    let alive = true; let listRequest = 0; let detailRequest = 0; let pending = false; let activeId = null;
    const form = panel.querySelector('[data-media-form]'); const roots = panel.querySelector('[data-media-root]'); const path = panel.querySelector('[data-media-path]');
    const title = panel.querySelector('[data-media-title]'); const production = panel.querySelector('[data-media-production]'); const role = panel.querySelector('[data-media-role]');
    const list = panel.querySelector('[data-media-list]'); const detail = panel.querySelector('[data-media-detail]'); const feedback = panel.querySelector('[data-media-feedback]'); const health = panel.querySelector('[data-media-health]');
    if (![form, roots, path, title, production, role, list, detail, feedback, health].every(Boolean)) return;
    const current = () => alive && mounted === panel;
    const message = (text = '', kind = '') => { if (current()) { feedback.textContent = text; feedback.hidden = !text; feedback.className = `performance-feedback ${kind}`; } };
    const busy = (value) => {
      pending = value; panel.setAttribute('aria-busy', String(value));
      for (const control of [roots, path, title, production, role, panel.querySelector('[data-media-submit]'), ...panel.querySelectorAll('[data-media-action]')]) if (control) control.disabled = value;
    };
    const stopPreview = () => { const video = detail.querySelector('video'); if (video) { video.pause?.(); video.removeAttribute('src'); video.load?.(); } };
    const renderList = (rows) => {
      list.replaceChildren(...rows.map((source) => {
        const card = action('', 'open', source.id); card.className = `media-source-card${source.id === activeId ? ' active' : ''}`;
        card.append(el('strong', source.title), el('span', statuses[source.status] ?? source.status), el('small', source.relativePath)); return card;
      }));
      if (!rows.length) list.append(el('p', 'Nenhum vídeo conectado ainda.', 'performance-empty'));
    };
    const renderSource = (source) => {
      activeId = source.id; stopPreview();
      const article = el('article', '', 'planning-detail-content'); article.append(el('h3', source.title), el('strong', statuses[source.status] ?? source.status), el('p', source.relativePath));
      const metrics = el('dl', '', 'media-metadata');
      for (const [label, value] of [
        ['Duração', source.durationMs == null ? 'Indisponível' : `${(source.durationMs / 1000).toFixed(2)} segundos`],
        ['Imagem', source.width && source.height ? `${source.width} × ${source.height}` : 'Indisponível'],
        ['Vídeo', source.videoCodec ?? 'Indisponível'], ['Áudio', source.hasAudio ? source.audioCodec ?? 'Presente' : 'Sem faixa de áudio'],
        ['Tamanho', source.sizeBytes == null ? 'Indisponível' : `${(Number(source.sizeBytes) / 1048576).toFixed(1)} MB`],
      ]) { metrics.append(el('dt', label), el('dd', value)); }
      article.append(metrics);
      if (source.status === 'READY') {
        const video = el('video'); video.controls = true; video.preload = 'metadata'; video.className = 'media-preview';
        video.src = api.mediaPreviewUrl(source.id); video.setAttribute('aria-label', `Prévia de ${source.title}`);
        video.addEventListener('error', () => { if (current() && activeId === source.id) message('A prévia não pôde ser reproduzida. O navegador pode não suportar o codec, ou a fonte pode ter mudado. Inspecione novamente para conferir.', 'warning'); });
        article.append(video);
        article.append(el('small', 'A reprodução depende dos codecs suportados pelo navegador. A inspeção não converte o arquivo.'));
      } else article.append(el('p', 'A visualização fica indisponível até confirmar uma fonte válida. O arquivo original permanece preservado.', 'research-warning'));
      article.append(action('Inspecionar novamente', 'reprobe', source.id));
      const links = el('div', '', 'research-actions');
      for (const relation of source.productions ?? []) { const link = el('a', `Abrir produção · ${relation.role === 'EDITED_VIDEO' ? 'Vídeo editado' : 'Gravação original'}`); link.href = `#/production/${encodeURIComponent(relation.productionId)}`; links.append(link); }
      if (!links.children.length) links.append(el('small', 'Conectado somente à Biblioteca. Para associar a uma produção, use o mesmo arquivo no formulário acima.'));
      article.append(links); detail.replaceChildren(article);
      if (pending) busy(true);
    };
    const load = async () => {
      const own = ++listRequest; const rows = await api.listMediaSources();
      if (current() && own === listRequest) { renderList(rows); if (activeId) { const row = rows.find((item) => item.id === activeId); if (row) renderSource(row); } }
    };
    const open = async (id) => {
      const own = ++detailRequest; activeId = id;
      try { const source = await api.getMediaSource(id); if (current() && own === detailRequest && activeId === id) renderSource(source); }
      catch { if (current() && own === detailRequest) message('Não foi possível abrir esta fonte de vídeo.', 'error'); }
    };
    const submit = async (event) => {
      event.preventDefault(); if (pending) return;
      if (!roots.value || !path.value.trim()) return message('Escolha a pasta e informe o arquivo relativo a ela.', 'warning');
      const input = { rootId: roots.value, relativePath: path.value.trim(), ...(title.value.trim() ? { title: title.value.trim() } : {}), ...(production.value ? { productionId: production.value, role: role.value } : {}) };
      busy(true); message();
      try { const result = await api.registerMediaSource(input); if (!current()) return; activeId = result.source.id; await load(); if (current()) { renderSource(result.source); message(result.source.status === 'READY' ? result.created ? 'Vídeo conectado à Biblioteca e inspecionado.' : 'Fonte existente reutilizada; nenhum vídeo foi duplicado.' : 'Fonte registrada; confira o estado da inspeção.', result.source.status === 'READY' ? 'success' : 'warning'); } }
      catch (error) { if (current()) message(error.status === 400 ? 'Confira a pasta, o caminho relativo e o formato do vídeo.' : error.status === 404 ? 'Arquivo ou produção não encontrado. Confira o caminho informado.' : error.status === 409 ? 'A fonte mudou ou não está disponível. Confira o arquivo antes de tentar novamente.' : 'Não foi possível conectar o vídeo. Nenhum resultado foi presumido.', 'error'); }
      finally { if (current()) busy(false); }
    };
    const click = async (event) => {
      const target = event.target.closest?.('[data-media-action]'); if (!target || pending) return;
      const name = target.dataset.mediaAction; const id = target.dataset.sourceId;
      if (name === 'open') return open(id);
      busy(true); message();
      try {
        if (name === 'refresh') await load();
        else if (name === 'reprobe') { const result = await api.reprobeMediaSource(id); if (!current()) return; activeId = id; await load(); if (current() && activeId === id) { renderSource(result.source); message(result.source.status === 'READY' ? result.changed ? 'Fonte atualizada. Cortes dependentes precisam de nova revisão.' : 'Inspeção concluída; fonte confirmada.' : 'A fonte continua indisponível. Confira o arquivo e a capacidade de inspeção.', result.source.status === 'READY' ? 'success' : 'warning'); } }
      } catch { if (current()) message('Não foi possível atualizar a inspeção da mídia.', 'error'); }
      finally { if (current()) busy(false); }
    };
    form.addEventListener('submit', submit); panel.addEventListener('click', click);
    cleanup = () => { alive = false; listRequest++; detailRequest++; stopPreview(); form.removeEventListener('submit', submit); panel.removeEventListener('click', click); };
    Promise.all([api.mediaHealth(), api.listMediaRoots(), api.listProductions({ limit: 200 })]).then(async ([capability, folders, productions]) => {
      if (!current()) return;
      health.textContent = capability.available ? 'Inspeção local disponível.' : 'A ferramenta de inspeção local não está disponível. Fontes e arquivos existentes continuam preservados.';
      for (const folder of folders) { const option = el('option', folder.label); option.value = folder.id; roots.append(option); }
      if (folders[0]) roots.value = folders[0].id;
      for (const row of productions) { const option = el('option', row.title); option.value = row.id; production.append(option); }
      const requested = productions.find((row) => encodeURIComponent(row.id) === context.route?.subpath); if (requested) production.value = requested.id;
      await load();
    }).catch(() => { if (current()) message('Não foi possível carregar as fontes e a configuração de mídia.', 'error'); });
  };
  return { mount, unmount: () => { cleanup(); cleanup = () => {}; mounted = null; } };
};
export const mediaModule = { id: 'media', route: '/media', allowSubroutes: true, label: 'Mídia local', icon: 'library', fullscreen: true, pageTitle: 'Fontes de vídeo', pageEyebrow: 'Biblioteca · Mídia local', render, createController: createMediaController };
