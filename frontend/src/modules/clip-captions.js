const el = (tag, text = '') => { const node = document.createElement(tag); node.textContent = String(text ?? ''); return node; };

export const createClipCaptionsViewer = ({ api, onPreview }) => {
  let request = 0, pending = null, target = null;
  const clear = () => { request++; pending = null; target = null; };
  const load = async (jobId, container) => {
    if (!container || (pending === jobId && target === container)) return;
    clear(); target = container; pending = jobId; const own = request;
    container.replaceChildren(el('p', 'Conferindo as falas deste corte…'));
    try {
      const result = await api.getClipCaptions(jobId); if (own !== request || target !== container) return;
      const body = el('section'); body.setAttribute('aria-label', 'Legendas do corte'); body.append(el('h4', 'Legendas do corte'));
      if (!result.available || !result.cueCount) { body.append(el('p', 'Não há falas disponíveis para exportar neste corte.')); for (const reason of result.reasons ?? []) body.append(el('p', reason)); }
      else {
        body.append(el('p', `${result.cueCount} falas com tempos relativos ao início do corte.`));
        const downloads = el('p'); for (const format of ['srt', 'vtt']) if (result.formats?.includes(format)) { const link = el('a', `Baixar ${format.toUpperCase()}`); link.href = api.clipCaptionsDownloadUrl(jobId, format); link.download = `legendas.${format}`; downloads.append(link, el('span', ' ')); } body.append(downloads);
        if (onPreview && result.formats?.includes('vtt')) { const preview = el('button', 'Mostrar legendas na prévia'); preview.type = 'button'; preview.className = 'button secondary'; preview.addEventListener('click', () => { if (own === request && target === container) onPreview(jobId); }); body.append(preview); }
        body.append(el('p', 'As legendas usam a transcrição existente. Confira o texto e a sincronização antes de usar; o vídeo permanece sem legendas sobrepostas.'));
        for (const warning of result.warnings ?? []) { const node = el('p', warning); node.className = 'research-warning'; body.append(node); }
        const cues = el('ol'); cues.className = 'clip-caption-cues'; for (const cue of (result.cues ?? []).slice(0, 100)) { const line = el('li'); line.append(el('small', `${(cue.startMs / 1000).toFixed(2)} → ${(cue.endMs / 1000).toFixed(2)} s`), el('p', cue.text)); cues.append(line); } body.append(cues);
        if (result.cueCount > 100) body.append(el('p', 'A prévia mostra as primeiras 100 falas. Os arquivos incluem todas as falas do corte.'));
      }
      container.replaceChildren(body);
    } catch { if (own === request && target === container) container.replaceChildren(el('p', 'Não foi possível carregar as legendas. Atualize o trabalho e confira se a fonte ou o corte mudou.')); }
    finally { if (own === request) pending = null; }
  };
  return { load, clear };
};
