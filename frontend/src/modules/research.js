import { createPanel, html } from '../design-system/index.js';

const text = (tag, value, className = '') => {
  const element = document.createElement(tag);
  element.textContent = String(value ?? '');
  if (className) element.className = className;
  return element;
};

const renderResearch = () => createPanel({
  eyebrow: 'Pesquisa',
  title: 'Pesquisa e oportunidades',
  className: 'research-panel',
  body: html`
    <div class="performance-feedback" data-research-feedback role="status" aria-live="polite" hidden></div>
    <nav class="research-tabs" data-research-tabs aria-label="Áreas de pesquisa">
      <button type="button" data-research-jump="research-sessions">Sessões</button><button type="button" data-research-jump="research-games">Jogos</button><button type="button" data-research-jump="research-content">Conteúdo</button><button type="button" data-research-jump="research-ideas">Ideias</button><button type="button" data-research-jump="research-shortlist">Shortlist</button>
    </nav>
    <section id="research-sessions" class="research-workspace" aria-labelledby="research-session-title">
      <div class="research-section-heading"><div><h3 id="research-session-title">Nova sessão de pesquisa</h3><p>Registre objetivo, restrições e fontes para preservar a decisão daquele momento.</p></div></div>
      <form class="manager-form research-session-form" data-research-session-form>
        <label for="researchSessionQuery">Pergunta de pesquisa</label>
        <textarea id="researchSessionQuery" data-research-session-query rows="3" maxlength="500" required></textarea>
        <div class="research-form-grid">
          <label>Objetivo<input data-research-session-objective maxlength="500" required></label>
          <label>Tipo<select data-research-session-type><option value="CHANNEL">Geral</option><option value="GAME">Jogo</option><option value="TOPIC">Conteúdo</option></select></label>
          <label>Formato<input data-research-session-format maxlength="80" placeholder="LONG_FORM, SHORT..."></label>
          <label>Jogo/candidato<input data-research-session-game maxlength="160"></label>
        </div>
        <button class="button" type="submit" data-research-session-submit>Criar e executar sessão</button>
      </form>
      <div class="research-card-grid" data-research-sessions><p class="performance-empty">Carregando sessões...</p></div>
    </section>
    <section id="research-games" class="research-workspace" aria-labelledby="research-games-title"><h3 id="research-games-title">Candidatos de jogos</h3><div class="research-card-grid" data-research-games><p class="performance-empty">Abra uma sessão de jogos para comparar candidatos.</p></div></section>
    <section id="research-content" class="research-workspace" aria-labelledby="research-content-title"><h3 id="research-content-title">Pesquisa de conteúdo</h3><div class="research-card-grid" data-research-content><p class="performance-empty">Abra uma sessão para visualizar padrões, lacunas e repetição.</p></div></section>
    <section id="research-ideas" class="research-workspace" aria-labelledby="research-ideas-title"><div class="research-section-heading"><div><h3 id="research-ideas-title">Ideias de vídeo</h3><p>Propostas concretas com origem, score relativo e limitações explícitas.</p></div></div><div class="research-card-grid" data-research-ideas><p class="performance-empty">Carregando ideias...</p></div></section>
    <section id="research-shortlist" class="research-workspace" aria-labelledby="research-shortlist-title"><h3 id="research-shortlist-title">Shortlist</h3><div class="research-card-grid" data-research-shortlist><p class="performance-empty">Nenhuma ideia na shortlist.</p></div></section>
    <details class="research-legacy"><summary>Pesquisa rápida legada</summary>
    <form class="manager-form" data-research-form>
      <label for="researchQuery">O que deseja investigar?</label>
      <textarea id="researchQuery" data-research-query rows="3" maxlength="500" required></textarea>
      <label for="researchMode">Tipo de pesquisa</label>
      <select id="researchMode" data-research-mode>
        <option value="general">Descoberta geral</option>
        <option value="games">Jogos</option>
        <option value="topics">Temas</option>
      </select>
      <button class="button" type="submit" data-research-submit>Pesquisar</button>
    </form>
    <section aria-labelledby="research-current-title">
      <h3 id="research-current-title">Resultado atual</h3>
      <div data-research-result><p class="performance-empty">Execute uma pesquisa para descobrir candidatos.</p></div>
    </section>
    <section aria-labelledby="research-opportunities-title">
      <h3 id="research-opportunities-title">Oportunidades persistidas</h3>
      <div data-research-opportunities><p class="performance-empty">Carregando oportunidades...</p></div>
    </section>
    <section aria-labelledby="research-detail-title">
      <h3 id="research-detail-title">Evidências da oportunidade</h3>
      <div data-research-detail><p class="performance-empty">Selecione uma oportunidade para abrir.</p></div>
    </section>
    <section aria-labelledby="research-history-title">
      <h3 id="research-history-title">Histórico</h3>
      <div data-research-history><p class="performance-empty">Carregando histórico...</p></div>
    </section>
    </details>
  `,
});

export const createResearchController = ({ api }) => {
  let mounted = null;
  let generation = 0;
  let detailRequest = 0;
  let busy = false;
  const busyActions = new Set();
  let activeSessionId = null;
  let sessionsState = [];
  let ideasState = [];
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.research-panel');
    if (!panel || panel === mounted) return;
    cleanup();
    mounted = panel;
    const token = ++generation;
    const current = () => mounted === panel && generation === token;
    const form = panel.querySelector('[data-research-form]');
    const query = panel.querySelector('[data-research-query]');
    const mode = panel.querySelector('[data-research-mode]');
    const submit = panel.querySelector('[data-research-submit]');
    const feedback = panel.querySelector('[data-research-feedback]');
    const result = panel.querySelector('[data-research-result]');
    const opportunities = panel.querySelector('[data-research-opportunities]');
    const detail = panel.querySelector('[data-research-detail]');
    const history = panel.querySelector('[data-research-history]');
    if (![form, query, mode, submit, feedback, result, opportunities, detail, history].every(Boolean)) return;

    const setFeedback = (message = '', variant = '') => {
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.className = `performance-feedback ${variant}`.trim();
    };
    const studio = {
      tabs: panel.querySelector('[data-research-tabs]'),
      form: panel.querySelector('[data-research-session-form]'), query: panel.querySelector('[data-research-session-query]'),
      objective: panel.querySelector('[data-research-session-objective]'), type: panel.querySelector('[data-research-session-type]'),
      format: panel.querySelector('[data-research-session-format]'), game: panel.querySelector('[data-research-session-game]'),
      submit: panel.querySelector('[data-research-session-submit]'), sessions: panel.querySelector('[data-research-sessions]'),
      games: panel.querySelector('[data-research-games]'), content: panel.querySelector('[data-research-content]'),
      ideas: panel.querySelector('[data-research-ideas]'), shortlist: panel.querySelector('[data-research-shortlist]'),
    };
    const actionButton = (label, action, id, className = 'button secondary') => {
      const node = document.createElement('button'); node.type = 'button'; node.className = className;
      node.dataset.researchAction = action; node.dataset.researchId = id; node.textContent = label; return node;
    };
    const safeList = (values, empty) => {
      const node = document.createElement('ul');
      for (const value of Array.isArray(values) ? values : []) node.append(text('li', typeof value === 'string' ? value : value?.summary ?? value?.description ?? 'Evidência registrada'));
      return node.children.length ? node : text('p', empty, 'performance-empty');
    };
    const scoreLabel = (idea) => Number.isFinite(Number(idea.opportunityScore)) ? `Score relativo ${Math.round(Number(idea.opportunityScore))}/100` : 'Score indisponível';
    const renderSessions = () => {
      if (!studio.sessions) return;
      if (!sessionsState.length) { studio.sessions.replaceChildren(text('p', 'Nenhuma sessão persistida.', 'performance-empty')); return; }
      studio.sessions.replaceChildren(...sessionsState.map((session) => {
        const card = document.createElement('article'); card.className = `research-card${session.id === activeSessionId ? ' active' : ''}`;
        card.append(text('span', session.status, 'research-badge'), text('h4', session.objective || session.query), text('p', session.query),
          text('small', `${session.freshness || 'UNKNOWN'} · ${new Date(session.researchedAt || session.createdAt).toLocaleString('pt-BR')}`));
        const actions = document.createElement('div'); actions.className = 'research-actions'; actions.append(actionButton('Abrir', 'open-session', session.id));
        if (session.status === 'DRAFT' || session.status === 'FAILED') actions.append(actionButton('Executar', 'run-session', session.id));
        if (session.status === 'COMPLETED') actions.append(actionButton('Reexecutar', 'rerun-session', session.id), actionButton('Gerar ideias', 'generate-ideas', session.id));
        if (session.status !== 'ARCHIVED') actions.append(actionButton('Arquivar', 'archive-session', session.id));
        card.append(actions); return card;
      }));
    };
    const renderGames = (items = []) => {
      if (!studio.games) return;
      if (!items.length) { studio.games.replaceChildren(text('p', 'Nenhum candidato de jogo sustentado pelas fontes atuais.', 'performance-empty')); return; }
      studio.games.replaceChildren(...items.map((item) => {
        const card = document.createElement('article'); card.className = 'research-card';
        const score = Number(item.scoreDetails?.relativeScore ?? Number(item.compatibility || 0) * 100);
        card.append(text('span', `#${item.rank} · ${item.state}`, 'research-badge'), text('h4', item.subject), text('p', item.summary),
          text('strong', `Score relativo ${Math.round(score)}/100`), safeList(item.evidence, 'Sem evidência estruturada.'), safeList(item.risks, 'Sem riscos adicionais registrados.'),
          text('small', item.scoreDetails?.disclaimer || 'Ranking relativo; não representa previsão de performance.'));
        return card;
      }));
    };
    const renderContent = (value) => {
      if (!studio.content) return;
      if (!value) { studio.content.replaceChildren(text('p', 'Pesquisa de conteúdo indisponível.', 'performance-empty')); return; }
      const groups = [['Padrões observados', value.patterns], ['Lacunas editoriais', value.gaps], ['Risco de repetição', value.repetition]];
      studio.content.replaceChildren(...groups.map(([title, items]) => { const card = document.createElement('article'); card.className = 'research-card'; card.append(text('h4', title), safeList(items, 'Nenhum item observado.')); return card; }), text('p', value.disclaimer || '', 'research-disclaimer'));
    };
    const renderIdeas = () => {
      const renderInto = (host, values, empty) => {
        if (!host) return; if (!values.length) { host.replaceChildren(text('p', empty, 'performance-empty')); return; }
        host.replaceChildren(...values.map((idea) => {
          const card = document.createElement('article'); card.className = 'research-card';
          card.append(text('span', idea.status, 'research-badge'), text('h4', idea.workingTitle || idea.premise), text('p', idea.premise), text('strong', scoreLabel(idea)), text('small', `${idea.format || 'Formato não informado'} · esforço ${idea.effortLevel || 'UNKNOWN'}`));
          if (idea.duplicateOfId) card.append(text('p', 'Possível repetição de uma ideia existente.', 'research-warning'));
          const actions = document.createElement('div'); actions.className = 'research-actions'; actions.append(actionButton('Abrir', 'open-idea', idea.id));
          if (idea.status === 'CANDIDATE') actions.append(actionButton('Shortlist', 'shortlist', idea.id));
          if (['CANDIDATE', 'SHORTLISTED'].includes(idea.status)) actions.append(actionButton('Selecionar', 'select', idea.id), actionButton('Rejeitar', 'reject', idea.id));
          if (!idea.isExperiment) actions.append(actionButton('Marcar teste', 'experiment', idea.id));
          if (['SELECTED', 'SHORTLISTED'].includes(idea.status)) actions.append(actionButton('Enviar ao Planner', 'planner', idea.id, 'button'));
          card.append(actions); return card;
        }));
      };
      renderInto(studio.ideas, ideasState, 'Nenhuma ideia persistida.');
      renderInto(studio.shortlist, ideasState.filter(({ status }) => ['SHORTLISTED', 'SELECTED', 'PLANNED'].includes(status)), 'Nenhuma ideia na shortlist.');
    };
    const refreshStudio = async () => {
      if (typeof api.listResearchSessions !== 'function' || typeof api.listResearchIdeas !== 'function') return;
      const request = ++detailRequest; const [sessionsResult, ideasResult] = await Promise.allSettled([api.listResearchSessions({ limit: 30 }), api.listResearchIdeas({ limit: 50 })]);
      if (!current() || request !== detailRequest) return;
      if (sessionsResult.status === 'fulfilled') sessionsState = sessionsResult.value;
      if (ideasResult.status === 'fulfilled') ideasState = ideasResult.value;
      renderSessions(); renderIdeas();
      if (sessionsResult.status === 'rejected' || ideasResult.status === 'rejected') setFeedback('Parte da workspace de Pesquisa está indisponível.', 'error');
    };
    const openSession = async (id) => {
      const request = ++detailRequest; const [session, games, contentValue] = await Promise.all([api.getResearchSession(id), api.getResearchGameCandidates(id), api.getContentResearch(id)]);
      if (!current() || request !== detailRequest) return;
      activeSessionId = session.id; renderSessions(); renderGames(games); renderContent(contentValue); setFeedback('Sessão aberta.', 'success');
    };
    const runAction = async (action, id) => {
      const key = `${action}:${id}`; if (busyActions.has(key)) return; busyActions.add(key);
      try {
        if (action === 'open-session') await openSession(id);
        else if (action === 'run-session') { await api.runResearchSession(id); await refreshStudio(); await openSession(id); }
        else if (action === 'rerun-session') { const next = await api.rerunResearchSession(id); await refreshStudio(); await openSession(next.id); }
        else if (action === 'archive-session') { await api.archiveResearchSession(id); await refreshStudio(); }
        else if (action === 'generate-ideas') { const session = await api.getResearchSession(id); await api.generateResearchIdeas(id, { objective: session.objective || session.query, format: session.format || 'LONG_FORM', effort: 'UNKNOWN', game: session.game || undefined, limit: 5 }); await refreshStudio(); }
        else if (action === 'open-idea') { const idea = await api.getResearchIdea(id); if (!current()) return; detail.replaceChildren(text('h4', idea.workingTitle || idea.premise), text('p', idea.premise), text('p', idea.viewerPromise || ''), text('strong', scoreLabel(idea)), safeList(idea.risks, 'Sem riscos registrados.'), safeList(idea.assumptions, 'Sem hipóteses adicionais.'), text('small', 'Score relativo e explicável; não é probabilidade nem previsão de views.')); }
        else if (action === 'shortlist') { await api.transitionResearchIdea(id, 'SHORTLISTED'); await refreshStudio(); }
        else if (action === 'select') { await api.transitionResearchIdea(id, 'SELECTED'); await refreshStudio(); }
        else if (action === 'reject') { await api.transitionResearchIdea(id, 'REJECTED', 'Rejeitada explicitamente pelo criador.'); await refreshStudio(); }
        else if (action === 'experiment') { await api.markResearchIdeaExperiment(id, true, 'Hipótese editorial a validar com resultado observado.'); await refreshStudio(); }
        else if (action === 'planner') { await api.sendResearchIdeaToPlanner(id); await refreshStudio(); }
        if (current() && action !== 'open-session' && action !== 'open-idea') setFeedback('Alteração persistida.', 'success');
      } catch { if (current()) setFeedback('Não foi possível concluir esta ação de Pesquisa.', 'error'); }
      finally { busyActions.delete(key); }
    };
    const submitSession = async (event) => {
      event.preventDefault(); if (!studio.query?.value.trim() || !studio.objective?.value.trim() || busyActions.has('create-session')) return;
      busyActions.add('create-session'); if (studio.submit) { studio.submit.disabled = true; studio.submit.setAttribute('aria-busy', 'true'); }
      try {
        const session = await api.createResearchSession({ query: studio.query.value.trim(), objective: studio.objective.value.trim(), subjectType: studio.type?.value || 'CHANNEL', format: studio.format?.value.trim() || undefined, game: studio.game?.value.trim() || undefined });
        await api.runResearchSession(session.id); if (!current()) return; await refreshStudio(); await openSession(session.id); setFeedback('Sessão executada e preservada.', 'success');
      } catch { if (current()) setFeedback('Não foi possível criar a sessão de Pesquisa.', 'error'); }
      finally { busyActions.delete('create-session'); if (current() && studio.submit) { studio.submit.disabled = false; studio.submit.setAttribute('aria-busy', 'false'); } }
    };
    const studioClick = async (event) => { const target = event.target.closest?.('[data-research-action]'); if (target?.dataset.researchAction && target?.dataset.researchId) await runAction(target.dataset.researchAction, target.dataset.researchId); };
    const jumpToSection = (event) => {
      const target = event.target.closest?.('[data-research-jump]');
      if (!target?.dataset.researchJump) return;
      panel.querySelector(`#${target.dataset.researchJump}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };
    const renderExecution = (execution) => {
      const article = document.createElement('article');
      article.className = 'manager-result-content';
      article.append(
        text('strong', execution.query?.text ?? 'Pesquisa'),
        text('span', `Qualidade ${execution.quality} · freshness ${execution.freshness} · cache ${execution.cache}`),
        text('small', `${execution.opportunities?.length ?? 0} oportunidade(s) encontradas.`),
      );
      const list = document.createElement('ul');
      for (const item of execution.opportunities ?? []) list.append(text('li', `${item.state}: ${item.subject} · confiança ${Math.round(Number(item.confidence ?? 0) * 100)}%`));
      article.append(list);
      result.replaceChildren(article);
    };
    const renderOpportunities = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        opportunities.replaceChildren(text('p', 'Nenhuma oportunidade persistida.', 'performance-empty'));
        return;
      }
      opportunities.replaceChildren(...items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'operator-card'; button.dataset.researchOpportunity = item.id;
        button.append(text('strong', item.subject), text('span', item.state),
          text('small', `Confiança ${Math.round(Number(item.confidence ?? 0) * 100)}% · ${item.freshness}`));
        return button;
      }));
    };
    const renderHistory = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        history.replaceChildren(text('p', 'Nenhuma pesquisa registrada.', 'performance-empty'));
        return;
      }
      history.replaceChildren(...items.map((item) => {
        const row = document.createElement('article'); row.className = 'manager-history-item';
        row.append(text('strong', item.query?.text), text('span', `${item.quality} · ${item.freshness}`),
          text('small', new Date(item.researchedAt).toLocaleString('pt-BR')));
        return row;
      }));
    };
    const renderDetail = (item) => {
      const article = document.createElement('article'); article.className = 'manager-result-content';
      article.append(text('strong', item.subject), text('p', item.summary),
        text('span', `${item.state} · compatibilidade ${Math.round(Number(item.compatibility ?? 0) * 100)}%`));
      for (const [title, items, value] of [
        ['Evidências', item.evidence, (entry) => `${entry.classification}: ${entry.summary}`],
        ['Riscos', item.risks, (entry) => entry], ['Lacunas', item.gaps, (entry) => entry],
      ]) {
        if (!Array.isArray(items) || items.length === 0) continue;
        article.append(text('h4', title));
        const list = document.createElement('ul'); list.append(...items.map((entry) => text('li', value(entry)))); article.append(list);
      }
      article.append(text('p', `Próxima investigação: ${item.nextInvestigation}`));
      detail.replaceChildren(article);
    };
    const load = async () => {
      const [opportunityResult, historyResult] = await Promise.allSettled([
        api.listResearchOpportunities({ limit: 30 }), api.listResearchHistory({ limit: 10 }),
      ]);
      if (!current()) return;
      if (opportunityResult.status === 'fulfilled') renderOpportunities(opportunityResult.value);
      else opportunities.replaceChildren(text('p', 'Não foi possível carregar oportunidades.', 'performance-empty'));
      if (historyResult.status === 'fulfilled') renderHistory(historyResult.value);
      else history.replaceChildren(text('p', 'Não foi possível carregar o histórico.', 'performance-empty'));
      if (opportunityResult.status === 'rejected' || historyResult.status === 'rejected') setFeedback('Parte da Pesquisa está indisponível. Tente novamente.', 'error');
    };
    const submitResearch = async (event) => {
      event.preventDefault();
      if (busy || !query.value.trim()) return;
      busy = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true'); setFeedback('Pesquisando evidências disponíveis...');
      try {
        const method = mode.value === 'games' ? 'researchGames' : mode.value === 'topics' ? 'researchTopics' : 'runResearch';
        const execution = await api[method]({ query: query.value.trim() });
        if (!current()) return;
        renderExecution(execution); setFeedback('Pesquisa concluída.', 'success'); await load();
      } catch {
        if (current()) setFeedback('Não foi possível concluir a pesquisa. Tente novamente.', 'error');
      } finally {
        busy = false;
        if (current()) { submit.disabled = false; submit.setAttribute('aria-busy', 'false'); }
      }
    };
    const openOpportunity = async (event) => {
      const button = event.target.closest?.('[data-research-opportunity]');
      if (!button) return;
      const request = ++detailRequest; detail.setAttribute('aria-busy', 'true');
      try {
        const item = await api.getResearchOpportunity(button.dataset.researchOpportunity);
        if (current() && request === detailRequest) { renderDetail(item); setFeedback(''); }
      } catch {
        if (current() && request === detailRequest) setFeedback('Não foi possível abrir esta oportunidade.', 'error');
      } finally { if (current() && request === detailRequest) detail.setAttribute('aria-busy', 'false'); }
    };
    form.addEventListener('submit', submitResearch);
    opportunities.addEventListener('click', openOpportunity);
    studio.form?.addEventListener('submit', submitSession);
    studio.tabs?.addEventListener('click', jumpToSection);
    for (const host of [studio.sessions, studio.ideas, studio.shortlist]) host?.addEventListener('click', studioClick);
    cleanup = () => { form.removeEventListener('submit', submitResearch); opportunities.removeEventListener('click', openOpportunity); studio.form?.removeEventListener('submit', submitSession); studio.tabs?.removeEventListener('click', jumpToSection); for (const host of [studio.sessions, studio.ideas, studio.shortlist]) host?.removeEventListener('click', studioClick); busyActions.clear(); };
    load();
    refreshStudio();
  };

  const unmount = () => { cleanup(); cleanup = () => {}; mounted = null; generation += 1; detailRequest += 1; };
  return { mount, unmount };
};

export const researchModule = {
  id: 'research', route: '/research', label: 'Pesquisa', icon: 'search', fullscreen: true,
  pageTitle: 'Pesquisa e Oportunidades', pageEyebrow: 'Discovery Engine',
  render: renderResearch,
  createController: createResearchController,
};
