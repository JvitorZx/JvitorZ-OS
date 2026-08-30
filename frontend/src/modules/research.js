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
  `,
});

export const createResearchController = ({ api }) => {
  let mounted = null;
  let generation = 0;
  let detailRequest = 0;
  let busy = false;
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
    cleanup = () => { form.removeEventListener('submit', submitResearch); opportunities.removeEventListener('click', openOpportunity); };
    load();
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
