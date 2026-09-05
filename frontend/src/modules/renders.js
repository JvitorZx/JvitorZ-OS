import { createPanel, html } from '../design-system/index.js';
import { createClipCaptionsViewer } from './clip-captions.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = String(text ?? ''); node.className = className; return node; };
const action = (label, name, id) => { const node = el('button', label, 'button secondary'); node.type = 'button'; node.dataset.renderAction = name; if (id) node.dataset.jobId = id; return node; };
const labels = { QUEUED: 'Na fila', RUNNING: 'Renderizando', SUCCEEDED: 'Concluído', FAILED: 'Falhou', CANCELLED: 'Cancelado', INTERRUPTED: 'Interrompido', OUTDATED: 'Fonte ou corte alterado' };
const active = (job) => ['QUEUED', 'RUNNING'].includes(job.status);
const render = () => createPanel({ eyebrow: 'Produção local', title: 'Renderizar corte', className: 'renders-panel', body: html`
  <p>Gere um vídeo vertical a partir de um corte selecionado e revisado em Shorts. O resultado fica salvo localmente para você assistir e revisar.</p>
  <div data-render-feedback role="status" aria-live="polite" hidden></div>
  <p data-render-health>Verificando renderização local…</p>
  <div class="monitoring-toolbar">
    <label>Produção <select data-render-production><option value="">Selecione uma produção</option></select></label>
    <label>Corte selecionado <select data-render-candidate><option value="">Selecione um corte</option></select></label>
    <button type="button" class="button secondary" data-render-action="refresh">Atualizar</button>
  </div>
  <div data-render-preflight><p>Selecione um corte para conferir a fonte.</p></div>
  <label>Enquadramento <select data-render-layout><option value="FIT">Imagem inteira com faixas</option><option value="CENTER_CROP">Recortar o centro</option></select></label>
  <p class="research-disclaimer">Imagem inteira preserva as bordas e preenche o espaço restante com preto. Recortar o centro ocupa a tela vertical e pode remover informações laterais. Saída em 720 × 1280. As legendas podem ser mostradas na prévia e baixadas à parte; o MP4 é gerado sem elas.</p>
  <button type="button" class="button" data-render-action="enqueue" data-render-enqueue disabled>Gerar vídeo local</button>
  <div class="renders-grid"><section><h3>Trabalhos da produção</h3><div data-render-jobs></div></section><section data-render-detail aria-live="polite"><p>Escolha um trabalho para acompanhar.</p></section></div>
` });

export const createRendersController = ({ api, schedule = setTimeout, unschedule = clearTimeout }) => {
  let mounted = null; let cleanup = () => {};
  const mount = (root, context = {}) => {
    const panel = root?.querySelector?.('.renders-panel'); if (!panel || mounted === panel) return; cleanup(); mounted = panel;
    const find = (key) => panel.querySelector(`[data-render-${key}]`);
    const production = find('production'), candidate = find('candidate'), layout = find('layout'), preflight = find('preflight'), jobs = find('jobs'), detail = find('detail'), feedback = find('feedback'), health = find('health'), enqueue = find('enqueue');
    if (![production, candidate, layout, preflight, jobs, detail, feedback, health, enqueue].every(Boolean)) return;
    let alive = true, pending = false, capabilityAvailable = false, epoch = 0, jobsRequest = 0, checkRequest = 0, timer = null, video = null, selectedJob = null, detailKey = '', eligible = false, currentProduction = '', currentCandidate = '', rows = [];
    const current = () => alive && mounted === panel;
    let captionTrack = null;
    const captions = createClipCaptionsViewer({ api, onPreview: (jobId) => {
      if (!current() || selectedJob !== jobId || !video) return;
      if (!captionTrack) { const track = el('track'); captionTrack = track; track.kind = 'captions'; track.label = 'Transcrição do corte'; track.srclang = 'und'; track.src = api.clipCaptionsDownloadUrl(jobId, 'vtt'); track.default = true; track.addEventListener('load', () => { if (current() && captionTrack === track && track.track) track.track.mode = 'showing'; }); track.addEventListener('error', () => { if (current() && captionTrack === track && selectedJob === jobId) message('Não foi possível mostrar as legendas na prévia. Atualize o trabalho antes de tentar novamente.'); }); video.append(track); }
      else if (captionTrack.track) captionTrack.track.mode = 'showing';
    } });
    const message = (text = '') => { if (current()) { feedback.textContent = text; feedback.hidden = !text; } };
    const stopVideo = () => { captions.clear(); captionTrack = null; if (video) { video.pause?.(); video.removeAttribute('src'); video.load?.(); video = null; } };
    const busy = (value) => { pending = value; production.disabled = value; candidate.disabled = value; layout.disabled = value; enqueue.disabled = value || !eligible; panel.setAttribute('aria-busy', String(value)); };
    const showJob = (job) => {
      selectedJob = job.id;
      const key = JSON.stringify([job.id, job.status, job.progress, job.errorCode, job.previewUrl, job.outputMetadata]); if (key === detailKey) return; detailKey = key; stopVideo();
      const article = el('article'); article.append(el('h3', `${labels[job.status] ?? job.status} · tentativa ${job.attempt ?? 1}`));
      if (job.snapshot?.title) article.append(el('p', job.snapshot.title));
      article.append(el('p', job.layout === 'CENTER_CROP' ? 'Enquadramento: recorte central' : 'Enquadramento: imagem inteira'));
      if (active(job)) { const progress = Number(job.progress); article.append(el('p', Number.isFinite(progress) ? `Progresso: ${Math.min(100, Math.max(0, progress)).toFixed(0)}%` : 'Aguardando progresso…'), action('Cancelar trabalho', 'cancel', job.id)); }
      if (job.errorCode) { const explanation = { SOURCE_CHANGED: 'A fonte ou a seleção mudou. Revise o corte em Shorts e confira a mídia antes de tentar novamente.', OUTPUT_OUTDATED: 'O resultado ficou desatualizado ou indisponível. Revise a fonte e a seleção antes de gerar uma nova versão.', PROCESS_RESTARTED: 'O aplicativo foi reiniciado durante o trabalho. Você pode iniciar uma nova tentativa.', CANCELLED: 'O trabalho foi cancelado.', RENDER_UNAVAILABLE: 'A ferramenta de renderização não está disponível.', RENDER_TIMEOUT: 'A renderização ultrapassou o tempo permitido.' }[job.errorCode]; article.append(el('p', explanation ?? 'O trabalho não produziu um resultado válido. Confira o corte e a fonte antes de tentar novamente.', 'research-warning')); }
      if (['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) article.append(action('Tentar novamente', 'retry', job.id));
      if (job.status === 'SUCCEEDED' && job.previewUrl) {
        const data = job.outputMetadata; if (data) article.append(el('p', `${data.width} × ${data.height} · ${(data.durationMs / 1000).toFixed(2)} segundos · ${data.videoCodec}${data.hasAudio ? ' + áudio' : ' · sem áudio'}`));
        video = el('video'); video.controls = true; video.preload = 'metadata'; video.className = 'render-preview'; video.crossOrigin = 'anonymous'; video.src = api.renderPreviewUrl(job.id); video.setAttribute('aria-label', 'Prévia do corte renderizado');
        video.addEventListener('error', () => { if (current() && selectedJob === job.id) message('A prévia não está disponível. Atualize o trabalho para conferir se a fonte ou o corte mudou.'); }); article.append(video);
        const download = el('a', 'Abrir vídeo gerado'); download.href = api.renderPreviewUrl(job.id); download.target = '_blank'; download.rel = 'noopener'; article.append(download, el('p', 'Assista ao resultado antes de usar ou publicar.'));
        const captionPanel = el('div'); captionPanel.dataset.renderCaptions = job.id; article.append(action('Conferir legendas', 'captions', job.id), captionPanel);
      }
      detail.replaceChildren(article);
    };
    const showJobs = () => { jobs.replaceChildren(...rows.map((job) => action(`${job.snapshot?.title ?? 'Corte'} · ${labels[job.status] ?? job.status} · ${job.layout === 'CENTER_CROP' ? 'recorte central' : 'imagem inteira'} · tentativa ${job.attempt ?? 1}`, 'open', job.id))); if (!rows.length) jobs.append(el('p', 'Nenhum trabalho nesta produção.')); const selected = rows.find((job) => job.id === selectedJob); if (selected) showJob(selected); };
    const loadJobs = async () => {
      if (!currentProduction) return; const own = epoch, request = ++jobsRequest, id = currentProduction;
      const result = await api.listRenderJobs(id); if (!current() || epoch !== own || request !== jobsRequest || id !== currentProduction) return; rows = result; showJobs();
    };
    const poll = () => { if (timer) unschedule(timer); timer = schedule(async () => { if (!current()) return; try { if (!pending && rows.some(active)) await loadJobs(); } catch { message('Não foi possível atualizar o progresso. Use Atualizar para tentar novamente.'); } if (current()) poll(); }, 3000); };
    const check = async () => {
      const own = ++checkRequest, id = candidate.value; currentCandidate = id; eligible = false; enqueue.disabled = true; preflight.replaceChildren(el('p', id ? 'Conferindo fonte e revisão…' : 'Selecione um corte.')); if (!id) return;
      try { const result = await api.renderPreflight(id); if (!current() || own !== checkRequest || id !== currentCandidate) return;
        const box = el('article'); box.append(el('h3', result.clip?.title ?? 'Corte selecionado'));
        if (result.clip) box.append(el('p', `${(result.clip.startMs / 1000).toFixed(2)} → ${(result.clip.endMs / 1000).toFixed(2)} segundos`));
        eligible = result.eligible === true && capabilityAvailable; box.append(el('p', eligible ? 'Fonte disponível e seleção concluída. Pronto para gerar o vídeo.' : 'Ainda não é possível gerar este corte.', eligible ? '' : 'research-warning'));
        for (const reason of result.reasons ?? []) box.append(el('p', reason));
        const shorts = el('a', 'Revisar seleção em Shorts'); shorts.href = `#/shorts/${encodeURIComponent(result.productionId ?? currentProduction)}`; const media = el('a', 'Conferir vídeo de origem'); media.href = `#/media/${encodeURIComponent(result.productionId ?? currentProduction)}`; box.append(shorts, el('span', ' · '), media); preflight.replaceChildren(box); enqueue.disabled = pending || !eligible;
      } catch { if (current() && own === checkRequest) message('Não foi possível conferir o corte. Atualize a seleção em Shorts.'); }
    };
    const changeProduction = async (preferred = '') => {
      if (pending) { production.value = currentProduction; return; } const id = production.value, own = ++epoch; currentProduction = id; currentCandidate = ''; checkRequest++; eligible = false; enqueue.disabled = true; rows = []; selectedJob = null; detailKey = ''; stopVideo(); showJobs(); detail.replaceChildren(el('p', 'Escolha um trabalho para acompanhar.')); candidate.replaceChildren(el('option', 'Selecione um corte')); candidate.children[0].value = ''; candidate.value = ''; preflight.replaceChildren(el('p', 'Selecione um corte.')); message(); if (!id) return;
      try { const analyses = await api.listShortAnalyses(id); if (!current() || epoch !== own) return; const clips = analyses.find((row) => row.status === 'CURRENT')?.candidates.filter((row) => row.status === 'SELECTED') ?? []; for (const clip of clips) { const option = el('option', clip.title); option.value = clip.id; candidate.append(option); } candidate.value = clips.find((clip) => clip.id === preferred)?.id ?? clips[0]?.id ?? ''; if (!clips.length) message('Selecione um corte na análise atual de Shorts e conclua a revisão.'); await Promise.all([check(), loadJobs()]); }
      catch { if (current() && epoch === own) message('Não foi possível carregar os cortes desta produção.'); }
    };
    const click = async (event) => {
      const target = event.target.closest?.('[data-render-action]'); if (!target || pending) return; const name = target.dataset.renderAction, id = target.dataset.jobId;
      if (name === 'open') { const job = rows.find((row) => row.id === id); if (job) showJob(job); return; }
      if (name === 'captions') { if (selectedJob === id) await captions.load(id, detail.querySelector('[data-render-captions]')); return; }
      if (name === 'refresh') { const keep = selectedJob; await changeProduction(currentCandidate); if (current()) { const job = rows.find((row) => row.id === keep); if (job) showJob(job); } return; }
      if (!['enqueue', 'cancel', 'retry'].includes(name) || (name === 'enqueue' && (!eligible || !currentCandidate))) return;
      busy(true); message();
      try { let result; if (name === 'enqueue') result = await api.enqueueRender({ candidateId: currentCandidate, layout: layout.value || 'FIT' }); else if (name === 'cancel') result = await api.cancelRenderJob(id); else result = await api.retryRenderJob(id); if (!current()) return; const job = result.job ?? result; selectedJob = job.id; detailKey = ''; showJob(job); await loadJobs(); message(name === 'cancel' ? 'Cancelamento solicitado.' : 'Trabalho registrado. O progresso será atualizado nesta página.'); await check(); }
      catch { message('A operação não pôde ser concluída. Atualize o corte e confira a fonte antes de tentar novamente.'); }
      finally { if (current()) busy(false); }
    };
    const productionChange = () => changeProduction(); const candidateChange = () => { if (pending) candidate.value = currentCandidate; else return check(); };
    production.addEventListener('change', productionChange); candidate.addEventListener('change', candidateChange); panel.addEventListener('click', click);
    cleanup = () => { alive = false; epoch++; checkRequest++; if (timer) unschedule(timer); stopVideo(); production.removeEventListener('change', productionChange); candidate.removeEventListener('change', candidateChange); panel.removeEventListener('click', click); };
    poll();
    Promise.all([api.renderHealth(), api.listProductions({ format: 'LONG_FORM', limit: 200 })]).then(async ([capability, productions]) => {
      if (!current()) return; capabilityAvailable = capability.available === true; health.textContent = capabilityAvailable ? 'Renderização local disponível. Um vídeo por vez.' : 'A ferramenta de renderização local não está disponível.';
      for (const row of productions) { const option = el('option', row.title); option.value = row.id; production.append(option); }
      let preferred = ''; let productionId = productions[0]?.id ?? '';
      if (context.route?.subpath) { try { const clip = await api.getClipCandidate(decodeURIComponent(context.route.subpath)); if (!current()) return; preferred = clip.id; productionId = clip.analysis?.productionId ?? productionId; } catch { message('O corte solicitado não está disponível.'); } }
      if (!current()) return; production.value = productionId; await changeProduction(preferred);
    }).catch(() => message('Não foi possível carregar a renderização local.'));
  };
  return { mount, unmount: () => { cleanup(); cleanup = () => {}; mounted = null; } };
};
export const rendersModule = { id: 'renders', route: '/renders', allowSubroutes: true, label: 'Renderização', icon: 'production', fullscreen: true, pageTitle: 'Cortes renderizados', pageEyebrow: 'Shorts · Produção local', render, createController: createRendersController };
