import { createPanel, html } from '../design-system/index.js';

const el = (tag, text = '', className = '') => {
  const element = document.createElement(tag);
  element.textContent = String(text ?? '');
  element.className = className;
  return element;
};
const button = (text, action, id) => {
  const element = el('button', text, 'button secondary');
  element.type = 'button';
  element.dataset.shortsAction = action;
  if (id) element.dataset.clipId = id;
  return element;
};
const time = (ms) => `${(Number(ms) / 1000).toFixed(2)} s`;
const statusLabels = { CANDIDATE: 'Candidato', SHORTLISTED: 'Na shortlist', SELECTED: 'Selecionado', REJECTED: 'Rejeitado', ARCHIVED: 'Arquivado', CURRENT: 'Atual', STALE: 'Fonte alterada', SUPERSEDED: 'Versão anterior' };
const render = () => createPanel({
  eyebrow: 'Inteligência editorial', title: 'Candidatos a Shorts', className: 'shorts-panel',
  body: html`
    <p class="research-disclaimer">Encontre momentos na transcrição, compare os cortes e escolha o que vale editar. O score é relativo; não prevê visualizações. Esta etapa não renderiza vídeos.</p>
    <div data-shorts-feedback class="performance-feedback" role="status" aria-live="polite" hidden></div>
    <div class="monitoring-toolbar">
      <label>Produção <select data-shorts-production><option value="">Selecione uma produção</option></select></label>
      <label>Duração mínima (segundos) <input data-shorts-min type="number" min="0.001" step="0.001" placeholder="Padrão editorial"></label>
      <label>Duração máxima (segundos) <input data-shorts-max type="number" min="0.001" step="0.001" placeholder="Padrão editorial"></label>
      <button type="button" class="button" data-shorts-action="analyze">Analisar momentos</button>
      <button type="button" class="button secondary" data-shorts-action="regenerate">Gerar nova versão</button>
    </div>
    <p class="research-disclaimer">Uma nova versão preserva a anterior e suas edições. Se faltar transcrição, importe SBV, SRT ou VTT em <a href="#/chapters">Chapters</a>.</p>
    <p><a href="#/analytics/shorts">Consultar performance dos Shorts publicados</a></p>
    <div class="shorts-workspace">
      <section aria-label="Versões da análise"><h3>Análises</h3><div data-shorts-versions></div></section>
      <section data-shorts-detail aria-label="Candidatos e revisão" aria-live="polite"><p class="performance-empty">Selecione uma produção.</p></section>
    </div>
  `,
});

export const createShortsController = ({ api }) => {
  let mounted = null;
  let cleanup = () => {};
  const mount = (root, context = {}) => {
    const panel = root?.querySelector?.('.shorts-panel');
    if (!panel || mounted === panel) return;
    cleanup(); mounted = panel;
    let alive = true; let request = 0; let pending = false;
    let productionId = null; let analysis = null; let versions = [];
    const select = panel.querySelector('[data-shorts-production]');
    const minimum = panel.querySelector('[data-shorts-min]');
    const maximum = panel.querySelector('[data-shorts-max]');
    const list = panel.querySelector('[data-shorts-versions]');
    const detail = panel.querySelector('[data-shorts-detail]');
    const feedback = panel.querySelector('[data-shorts-feedback]');
    if (![select, minimum, maximum, list, detail, feedback].every(Boolean)) return;
    const current = () => alive && mounted === panel;
    const message = (text = '', kind = '') => {
      if (!current()) return;
      feedback.textContent = text; feedback.hidden = !text;
      feedback.className = `performance-feedback ${kind}`;
    };
    const busy = (value) => {
      pending = value; select.disabled = value;
      panel.setAttribute('aria-busy', String(value));
      for (const control of panel.querySelectorAll('[data-shorts-action]')) control.disabled = value || control.dataset.readOnly === 'true';
    };
    const renderVersions = () => {
      list.replaceChildren(...versions.map((row) => {
        const entry = button(`Versão ${row.version} · ${statusLabels[row.status] ?? row.status}`, 'open', row.id);
        entry.className = `operator-card${analysis?.id === row.id ? ' active' : ''}`;
        entry.setAttribute('aria-pressed', String(analysis?.id === row.id));
        return entry;
      }));
      if (!versions.length) list.append(el('p', 'Nenhuma análise salva.', 'performance-empty'));
    };
    const field = (container, label, key, value, type = 'text') => {
      const wrapper = el('label', label);
      const input = el('input'); input.type = type; input.value = String(value ?? ''); input.dataset.clipField = key;
      if (type === 'number') { input.min = '0'; input.step = '0.001'; }
      else input.maxLength = key === 'title' ? 160 : key === 'hook' ? 200 : 500;
      wrapper.append(input); container.append(wrapper); return input;
    };
    const editor = (candidate = null) => {
      const form = el('div', '', 'research-form-grid'); form.dataset.clipEditor = candidate?.id ?? 'manual';
      field(form, 'Início (segundos)', 'startMs', candidate ? candidate.startMs / 1000 : '', 'number');
      field(form, 'Fim (segundos)', 'endMs', candidate ? candidate.endMs / 1000 : '', 'number');
      field(form, 'Título interno', 'title', candidate?.title);
      field(form, 'Hook — promessa do corte', 'hook', candidate?.hook);
      form.append(el('small', 'Use os limites das falas exibidas em evidências. Os tempos são informados em segundos.'));
      if (!candidate) {
        const label = el('label', 'Variante de (opcional)'); const variants = el('select'); variants.dataset.clipField = 'variantOfId';
        const empty = el('option', 'Momento independente'); empty.value = ''; variants.append(empty);
        for (const row of analysis.candidates ?? []) { const option = el('option', row.title); option.value = row.id; variants.append(option); }
        label.append(variants); form.append(label); field(form, 'Motivo da variante', 'variantReason', '');
      }
      return form;
    };
    const renderAnalysis = (row) => {
      analysis = row; renderVersions();
      const body = el('article', '', 'planning-detail-content');
      body.append(el('h3', `Versão ${row.version} · ${statusLabels[row.status] ?? row.status}`));
      const productionLink = el('a', 'Abrir produção relacionada'); productionLink.href = `#/production/${encodeURIComponent(row.productionId)}`; body.append(productionLink);
      const readOnly = row.status !== 'CURRENT';
      if (readOnly) body.append(el('p', 'Esta análise foi preservada como histórico. Use a versão atual ou gere uma nova análise para revisar e selecionar cortes.', 'research-warning'));
      for (const limitation of row.limitations ?? []) body.append(el('p', limitation, 'research-disclaimer'));
      if (row.context?.entries?.length) {
        const context = el('details'); context.append(el('summary', 'Contexto editorial para esta revisão'));
        for (const entry of row.context.entries) context.append(el('p', `${entry.subject}: ${entry.statement}`));
        context.append(el('small', 'A seleção de um corte não registra um aprendizado automaticamente.')); body.append(context);
      }
      const controls = el('div', '', 'planning-item-actions');
      controls.append(button('Revisar com Supervisor', 'review'), button('Concluir seleção', 'complete'), button('Ver contrato para edição futura', 'contract'));
      if (readOnly) for (const control of controls.children) { control.dataset.readOnly = 'true'; control.disabled = true; }
      body.append(controls);
      if (row.review) {
        const outcome = { APPROVED: 'Aprovado', APPROVED_WITH_WARNINGS: 'Aprovado com observações', NEEDS_CHANGES: 'Precisa de ajustes', BLOCKED: 'Bloqueado' }[row.review.outcome] ?? 'Revisado';
        body.append(el('p', `Supervisor: ${outcome}`));
        const findings = el('ul');
        for (const finding of row.review.findings ?? []) findings.append(el('li', typeof finding === 'string' ? finding : finding.message));
        body.append(findings);
      }
      const grid = el('div', '', 'research-card-grid');
      for (const candidate of row.candidates ?? []) {
        const card = el('article', '', 'research-card'); card.dataset.clipCard = candidate.id;
        card.append(el('span', `${statusLabels[candidate.status] ?? candidate.status} · Score ${candidate.score ?? '—'}`, 'research-badge'), el('h4', candidate.title), el('p', candidate.hook), el('p', `${time(candidate.startMs)} → ${time(candidate.endMs)} · ${time(candidate.durationMs)}`), el('p', candidate.summary), el('p', candidate.rationale));
        if (candidate.variantOfId) { const parent = row.candidates.find((item) => item.id === candidate.variantOfId); card.append(el('p', `Variante de ${parent?.title ?? candidate.variantOfId}: ${candidate.variantReason ?? ''}`)); }
        if (candidate.chapterEntryId) card.append(el('small', 'Relacionado a um capítulo da fonte.'));
        for (const risk of candidate.risks ?? []) card.append(el('p', risk, 'research-warning'));
        const factors = el('details'); factors.append(el('summary', 'Como o score foi calculado'));
        const factorList = el('ul');
        for (const factor of Array.isArray(candidate.scoreFactors) ? candidate.scoreFactors : []) factorList.append(el('li', `${factor.factor}: ${factor.points} pontos. ${factor.reason}`));
        factors.append(factorList); card.append(factors);
        const evidence = el('div'); evidence.dataset.clipEvidence = candidate.id;
        card.append(button('Ver falas e timestamps', 'evidence', candidate.id), evidence);
        if (!readOnly && candidate.status !== 'ARCHIVED') {
          const edit = el('details'); edit.append(el('summary', 'Editar corte'), editor(candidate), button('Salvar edição', 'save', candidate.id)); card.append(edit);
          const actions = el('div', '', 'research-actions');
          for (const [action, label] of [['shortlist', 'Shortlist'], ['select', 'Selecionar'], ['reject', 'Rejeitar'], ['archive', 'Arquivar']]) actions.append(button(label, action, candidate.id));
          card.append(actions);
        }
        grid.append(card);
      }
      if (!(row.candidates ?? []).length) grid.append(el('p', 'Nenhum momento candidato encontrado. Você pode adicionar um corte com timestamps reais.', 'performance-empty'));
      body.append(grid);
      if (!readOnly) { const manual = el('details'); manual.append(el('summary', 'Adicionar candidato manual ou variante'), editor(), button('Salvar candidato manual', 'manual')); body.append(manual); }
      detail.replaceChildren(body);
      if (pending) busy(true);
    };
    const loadVersions = async (id, preferredId = null) => {
      const own = ++request;
      const rows = await api.listShortAnalyses(id);
      if (!current() || own !== request || productionId !== id) return false;
      versions = rows;
      const selected = rows.find((row) => row.id === preferredId) ?? rows[0];
      if (selected) renderAnalysis(selected);
      else { analysis = null; renderVersions(); detail.replaceChildren(el('p', 'Use Analisar momentos para examinar a transcrição desta produção.', 'performance-empty')); }
      return true;
    };
    const change = async () => {
      if (pending) { select.value = productionId ?? ''; return; }
      productionId = select.value || null; analysis = null; versions = []; request += 1; renderVersions();
      detail.replaceChildren(el('p', productionId ? 'Carregando análises…' : 'Selecione uma produção.', 'performance-empty')); message();
      const id = productionId;
      if (id) try { await loadVersions(id); } catch { if (current() && id === productionId) message('Não foi possível carregar as análises.', 'error'); }
    };
    const readEditor = (id) => {
      const form = [...detail.querySelectorAll('[data-clip-editor]')].find((item) => item.dataset.clipEditor === id);
      if (!form) throw new Error('EDITOR_MISSING');
      const result = {};
      for (const input of form.querySelectorAll('[data-clip-field]')) {
        const key = input.dataset.clipField;
        if (key.endsWith('Ms')) {
          if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error('INVALID_BOUNDARIES');
          result[key] = Math.round(Number(input.value) * 1000);
        } else if (input.value.trim() || !['variantOfId', 'variantReason'].includes(key)) result[key] = input.value.trim();
      }
      if (result.startMs < 0 || result.endMs <= result.startMs || !result.title || !result.hook) throw new Error('INVALID_BOUNDARIES');
      return result;
    };
    const click = async (event) => {
      const target = event.target.closest?.('[data-shorts-action]');
      if (!target || pending || target.disabled) return;
      const action = target.dataset.shortsAction; const candidateId = target.dataset.clipId;
      if (!productionId) return message('Selecione uma produção.', 'warning');
      const id = productionId; const analysisId = analysis?.id; const own = ++request;
      const valid = () => current() && productionId === id && own === request;
      busy(true); message();
      try {
        if (action === 'open') {
          const row = await api.getShortAnalysis(candidateId); if (valid()) renderAnalysis(row); return;
        }
        if (action === 'analyze' || action === 'regenerate') {
          const options = {};
          for (const [input, key] of [[minimum, 'minDurationMs'], [maximum, 'maxDurationMs']]) if (input.value.trim()) {
            const value = Number(input.value) * 1000;
            if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) throw new Error('INVALID_CONFIG');
            options[key] = value;
          }
          if (options.minDurationMs && options.maxDurationMs && options.minDurationMs > options.maxDurationMs) throw new Error('INVALID_CONFIG');
          const result = await api.analyzeShorts(id, options, action === 'regenerate');
          if (valid() && await loadVersions(id, result.analysis.id)) message(result.created ? 'Análise salva. Revise os momentos antes de selecionar.' : 'Análise existente retomada; suas edições foram preservadas.', 'success');
          return;
        }
        if (!analysisId) return message('Analise os momentos primeiro.', 'warning');
        if (action === 'evidence') {
          const data = await api.getClipEvidence(candidateId);
          if (valid()) { const container = [...detail.querySelectorAll('[data-clip-evidence]')].find((item) => item.dataset.clipEvidence === candidateId); container?.replaceChildren(...data.segments.map((segment) => el('p', `${time(segment.startMs)} → ${time(segment.endMs)}: ${segment.text}`))); }
          return;
        }
        if (action === 'contract') {
          const result = await api.getShortRenderContract(id);
          if (valid()) { const output = el('pre', JSON.stringify(result, null, 2), 'shorts-json'); detail.append(output); message('Contrato dos candidatos selecionados. Nenhum vídeo foi renderizado.'); }
          return;
        }
        if (action === 'save') await api.updateClipCandidate(candidateId, readEditor(candidateId));
        else if (action === 'manual') await api.createClipCandidate(analysisId, readEditor('manual'));
        else if (action === 'review') await api.reviewShortAnalysis(analysisId);
        else if (action === 'complete') await api.completeShortAnalysis(analysisId);
        else if (['shortlist', 'select', 'reject', 'archive'].includes(action)) await api.transitionClipCandidate(candidateId, action);
        else return;
        if (valid() && await loadVersions(id, analysisId)) message(action === 'complete' ? 'Seleção concluída no Production.' : 'Alteração salva. Histórico preservado.', 'success');
      } catch (error) {
        if (current() && productionId === id) message(
          error.message === 'INVALID_BOUNDARIES' ? 'Informe título, hook e um intervalo válido em segundos.' :
          error.message === 'INVALID_CONFIG' ? 'Informe durações positivas, com mínimo menor ou igual ao máximo.' :
          error.code === 'NO_DATA' ? 'Esta produção ainda não tem transcrição temporal. Importe SBV, SRT ou VTT em Chapters antes de analisar.' :
          error.status === 409 ? 'A ação depende de uma fonte temporal atual e de uma etapa disponível no Production. Confira a transcrição, a seleção e o Supervisor.' :
          error.status === 400 ? 'Revise os campos e os limites do corte; a solicitação foi recusada.' : 'Não foi possível concluir a ação. Nenhum resultado foi presumido.', 'error');
      } finally { if (current()) busy(false); }
    };
    select.addEventListener('change', change); panel.addEventListener('click', click);
    cleanup = () => { alive = false; request += 1; select.removeEventListener('change', change); panel.removeEventListener('click', click); };
    const own = ++request;
    api.listProductions({ format: 'LONG_FORM', limit: 200 }).then(async (rows) => {
      if (!current() || own !== request) return;
      for (const row of rows) { const option = el('option', row.title); option.value = row.id; select.append(option); }
      const requestedId = context.route?.subpath;
      const requested = rows.find((row) => encodeURIComponent(row.id) === requestedId);
      if (rows[0]) { select.value = (requested ?? rows[0]).id; await change(); }
      else message('Crie uma produção longa para começar.', 'warning');
    }).catch(() => { if (current() && own === request) message('Não foi possível carregar as produções.', 'error'); });
  };
  return { mount, unmount: () => { cleanup(); cleanup = () => {}; mounted = null; } };
};

export const shortsModule = { id: 'shorts', route: '/shorts', allowSubroutes: true, label: 'Shorts', icon: 'planning', fullscreen: true, pageTitle: 'Candidatos a Shorts', pageEyebrow: 'Momentos com evidência', render, createController: createShortsController };
