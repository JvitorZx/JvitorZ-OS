import { createDetailList, createMetricCard, createPanel, createStatusPill, html } from '../design-system/index.js';
import { emptyValue, formatDate, formatNumber } from '../utils/formatters.js';
import { integrationFrom, operationalStatus } from '../utils/operational-status.js';

const channelErrorMessage = (error) => {
  if (error?.status === 401 || error?.code === 'AUTH_REQUIRED') return 'Reconecte sua conta Google para atualizar o canal.';
  if (error?.status === 503 || error?.code === 'PROVIDER_UNAVAILABLE') return 'O YouTube está temporariamente indisponível. O último dado válido foi preservado.';
  if (error?.code === 'CONFIG_MISSING') return 'A integração Google ainda não está configurada.';
  return 'Não foi possível sincronizar o canal. Tente novamente.';
};

export const channelSourceAction = (source = {}) => {
  if (source.state === 'NOT_CONFIGURED') return { label: 'Configuração necessária', available: false };
  if (source.state === 'AUTH_REQUIRED' || source.action === 'RECONNECT' || source.action === 'CONNECT') return { label: 'Reconectar', available: true };
  if (source.action === 'SYNC') return { label: 'Abrir sincronização', available: true };
  if (source.state === 'DEGRADED' || source.stale) return { label: 'Revisar dados', available: true };
  return { label: 'Abrir', available: true };
};

export const observedSnapshotDelta = (current, previous, field) => {
  const left = current?.[field]; const right = previous?.[field];
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
};

export const collectionAgeDays = (value, now = new Date()) => {
  const timestamp = new Date(value).getTime(); const current = new Date(now).getTime();
  return Number.isFinite(timestamp) && Number.isFinite(current) && current >= timestamp ? Math.floor((current - timestamp) / 86400000) : null;
};

export const createChannelController = ({ api, refreshDashboard }) => {
  let mountedRoot = null;
  let generation = 0;
  let detailRequest = 0;
  let syncing = false;
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.channel-panel');
    if (!panel || panel === mountedRoot) return;
    cleanup();
    mountedRoot = panel;
    const token = ++generation;
    const current = () => mountedRoot === panel && generation === token;
    const button = panel.querySelector('[data-channel-sync]');
    const feedback = panel.querySelector('[data-channel-feedback]');
    const videos = root.querySelector('[data-channel-videos]');
    const detail = root.querySelector('[data-channel-video-detail]');
    const summary = root.querySelector('[data-channel-video-summary]');
    const search = root.querySelector('[data-channel-video-search]');
    const format = root.querySelector('[data-channel-video-format]');
    const sort = root.querySelector('[data-channel-video-sort]');
    const evidence = root.querySelector('[data-channel-video-evidence]');
    const resultCount = root.querySelector('[data-channel-video-result-count]');
    const resetFilters = root.querySelector('[data-channel-video-reset]');
    const refreshContent = root.querySelector('[data-channel-video-refresh]');
    const comparison = root.querySelector('[data-channel-video-comparison]');
    let loadedVideos = [];
    let selectedVideoId = null;
    const comparedVideoIds = new Set();
    let contentLoading = false;
    const renderDetail = (result) => {
      if (!detail || !current()) return;
      const item = result?.current;
      detail.replaceChildren();
      if (!item) { detail.textContent = 'Detalhes indisponíveis.'; return; }
      const heading = document.createElement('h3'); heading.textContent = item.title ?? 'Vídeo sem título';
      const identity = document.createElement('p'); identity.textContent = `${item.format ?? 'Formato desconhecido'} · ${item.videoId}`;
      const youtube = document.createElement('a'); youtube.className = 'button secondary'; youtube.textContent = 'Abrir no YouTube'; youtube.href = `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`; youtube.target = '_blank'; youtube.rel = 'noopener noreferrer';
      const metrics = document.createElement('dl'); metrics.className = 'channel-video-metrics';
      for (const [label, value] of [['Views', item.views], ['Watch time (min)', item.watchTimeMinutes], ['Retenção média (%)', item.averageViewPercentage], ['Impressões', item.impressions], ['CTR', item.ctr], ['Likes', item.likes], ['Comentários', item.comments]]) {
        const term = document.createElement('dt'); term.textContent = label; const description = document.createElement('dd'); description.textContent = value === null || value === undefined ? '--' : String(value); metrics.append(term, description);
      }
      const history = document.createElement('small'); history.textContent = `${result.history?.length ?? 0} coleta(s) preservada(s). Última coleta: ${item.collectedAt ? new Date(item.collectedAt).toLocaleString('pt-BR') : '--'}`;
      const change = document.createElement('p'); change.className = 'channel-video-change';
      const previous = result.history?.[1]; const viewsDelta = observedSnapshotDelta(item, previous, 'views'); const retentionDelta = observedSnapshotDelta(item, previous, 'averageViewPercentage');
      change.textContent = previous ? `Variação desde a coleta anterior: views ${viewsDelta === null ? '--' : `${viewsDelta >= 0 ? '+' : ''}${viewsDelta}`}; retenção ${retentionDelta === null ? '--' : `${retentionDelta >= 0 ? '+' : ''}${retentionDelta} p.p.`}.` : 'Ainda não há uma coleta anterior comparável.';
      const timeline = document.createElement('ol'); timeline.className = 'channel-video-history';
      for (const snapshot of result.history ?? []) {
        const entry = document.createElement('li');
        entry.textContent = `${snapshot.collectedAt ? new Date(snapshot.collectedAt).toLocaleString('pt-BR') : 'Data ausente'} · ${snapshot.views ?? '--'} views · retenção ${snapshot.averageViewPercentage ?? '--'}% · CTR ${snapshot.ctr ?? '--'}%`;
        timeline.append(entry);
      }
      detail.append(heading, identity, youtube, metrics, history, change, timeline);
    };
    const openVideo = async (videoId) => {
      const request = ++detailRequest;
      if (detail) { detail.textContent = 'Carregando detalhes...'; detail.setAttribute('aria-busy', 'true'); }
      try { const result = await api.getYouTubeChannelVideo(videoId); if (current() && request === detailRequest) renderDetail(result); }
      catch (error) { if (detail && current() && request === detailRequest) detail.textContent = error?.status === 404 ? 'Este vídeo não está mais disponível.' : 'Não foi possível abrir os detalhes do vídeo.'; }
      finally { if (detail && current() && request === detailRequest) detail.setAttribute('aria-busy', 'false'); }
    };
    const renderVideos = (items) => {
      if (!videos || !current()) return;
      videos.replaceChildren();
      if (!Array.isArray(items) || items.length === 0) {
        const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = loadedVideos.length > 0 ? 'Nenhum vídeo corresponde aos filtros.' : 'Nenhum vídeo sincronizado ainda.'; videos.append(empty); return;
      }
      for (const item of items) {
        const row = document.createElement('article'); row.className = 'channel-video-row';
        const copy = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = item.title ?? 'Vídeo sem título';
        const meta = document.createElement('small'); meta.textContent = `${item.format ?? 'Formato desconhecido'} · ${item.videoId ?? 'ID indisponível'}`;
        const facts = document.createElement('span'); facts.textContent = `${Number(item.views ?? 0).toLocaleString('pt-BR')} views · coletado em ${item.collectedAt ? new Date(item.collectedAt).toLocaleDateString('pt-BR') : '--'}`;
        const actions = document.createElement('div'); actions.className = 'channel-video-row-actions';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'button secondary'; open.textContent = 'Detalhes'; open.setAttribute('aria-label', `Abrir detalhes de ${item.title ?? 'vídeo sem título'}`); open.setAttribute('aria-pressed', String(selectedVideoId === item.videoId)); open.addEventListener('click', () => { selectedVideoId = item.videoId; applyFilters(); openVideo(item.videoId); });
        const compare = document.createElement('button'); compare.type = 'button'; compare.className = 'button secondary'; compare.textContent = comparedVideoIds.has(item.videoId) ? 'Remover comparação' : 'Comparar'; compare.setAttribute('aria-pressed', String(comparedVideoIds.has(item.videoId))); compare.addEventListener('click', () => {
          if (comparedVideoIds.has(item.videoId)) comparedVideoIds.delete(item.videoId); else if (comparedVideoIds.size < 2) comparedVideoIds.add(item.videoId);
          renderComparison(); applyFilters();
        });
        actions.append(open, compare); copy.append(title, meta); row.append(copy, facts, actions); videos.append(row);
      }
    };
    const renderComparison = () => {
      if (!comparison || !current()) return;
      comparison.replaceChildren(); const selected = loadedVideos.filter((item) => comparedVideoIds.has(item.videoId));
      const status = document.createElement('p'); status.textContent = selected.length === 0 ? 'Selecione até dois vídeos para comparar.' : `${selected.length}/2 selecionado(s): ${selected.map((item) => item.title ?? item.videoId).join(' · ')}`; comparison.append(status);
      if (selected.length === 2) {
        if (selected[0].format !== selected[1].format) { const warning = document.createElement('p'); warning.className = 'performance-feedback'; warning.textContent = 'Comparação entre formatos diferentes: interprete métricas com cautela.'; comparison.append(warning); }
        const table = document.createElement('table'); table.className = 'channel-comparison-table';
        const head = document.createElement('tr'); for (const value of ['Métrica', selected[0].title ?? selected[0].videoId, selected[1].title ?? selected[1].videoId]) { const cell = document.createElement('th'); cell.textContent = value; head.append(cell); } table.append(head);
        for (const [label, field, suffix = ''] of [['Formato', 'format'], ['Views', 'views'], ['Retenção', 'averageViewPercentage', '%'], ['CTR', 'ctr', '%']]) {
          const row = document.createElement('tr'); const term = document.createElement('th'); term.textContent = label; row.append(term);
          for (const item of selected) { const cell = document.createElement('td'); const value = item[field]; cell.textContent = value === null || value === undefined ? '--' : `${value}${suffix}`; row.append(cell); } table.append(row);
        }
        comparison.append(table);
      }
    };
    const applyFilters = () => {
      const query = String(search?.value ?? '').trim().toLocaleLowerCase('pt-BR');
      const selectedFormat = String(format?.value ?? 'ALL');
      const selectedEvidence = String(evidence?.value ?? 'ALL');
      const filtered = loadedVideos.filter((item) => (
        (selectedFormat === 'ALL' || item.format === selectedFormat)
        && (!query || String(item.title ?? '').toLocaleLowerCase('pt-BR').includes(query))
        && (selectedEvidence === 'ALL' || (selectedEvidence === 'HAS_RETENTION' && item.averageViewPercentage !== null && item.averageViewPercentage !== undefined) || (selectedEvidence === 'MISSING_CTR' && (item.ctr === null || item.ctr === undefined)))
      ));
      const selectedSort = String(sort?.value ?? 'COLLECTED');
      const sorted = [...filtered].sort((left, right) => {
        if (selectedSort === 'TITLE') return String(left.title ?? '').localeCompare(String(right.title ?? ''), 'pt-BR');
        if (selectedSort === 'VIEWS') return Number(right.views ?? -1) - Number(left.views ?? -1);
        if (selectedSort === 'RETENTION') return Number(right.averageViewPercentage ?? -1) - Number(left.averageViewPercentage ?? -1);
        if (selectedSort === 'CTR') return Number(right.ctr ?? -1) - Number(left.ctr ?? -1);
        return new Date(right.collectedAt ?? 0).getTime() - new Date(left.collectedAt ?? 0).getTime();
      });
      if (resultCount) resultCount.textContent = `${sorted.length} vídeo(s) exibido(s)`;
      renderVideos(sorted);
    };
    const onFilter = () => applyFilters();
    const reset = () => { if (search) search.value = ''; if (format) format.value = 'ALL'; if (evidence) evidence.value = 'ALL'; if (sort) sort.value = 'COLLECTED'; applyFilters(); };
    const loadContent = async () => {
      if (contentLoading) return;
      contentLoading = true; if (refreshContent) { refreshContent.disabled = true; refreshContent.setAttribute('aria-busy', 'true'); }
      const hasList = typeof api.listYouTubeChannelVideos === 'function'; const hasSummary = typeof api.getYouTubeChannelVideoSummary === 'function';
      const [listResult, summaryResult] = await Promise.allSettled([hasList ? api.listYouTubeChannelVideos(50) : undefined, hasSummary ? api.getYouTubeChannelVideoSummary() : undefined]);
      if (!current()) { contentLoading = false; return; }
      if (hasList && listResult.status === 'fulfilled') { loadedVideos = Array.isArray(listResult.value) ? listResult.value : []; for (const id of comparedVideoIds) if (!loadedVideos.some((item) => item.videoId === id)) comparedVideoIds.delete(id); renderComparison(); applyFilters(); }
      else if (hasList && videos) { videos.replaceChildren(); const message = document.createElement('p'); message.className = 'empty-state'; message.textContent = 'Não foi possível carregar os vídeos sincronizados.'; videos.append(message); }
      if (hasSummary && summaryResult.status === 'fulfilled' && summary) renderSummary(summaryResult.value);
      else if (hasSummary && summary) summary.textContent = 'Cobertura indisponível.';
      contentLoading = false; if (refreshContent) { refreshContent.disabled = false; refreshContent.setAttribute('aria-busy', 'false'); }
    };
    const sync = async () => {
      if (syncing || !button) return;
      syncing = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      feedback.textContent = 'Sincronizando dados do canal...';
      feedback.hidden = false;
      feedback.className = 'performance-feedback';
      try {
        await api.syncYouTubeChannel();
        if (!current()) return;
        feedback.textContent = 'Canal sincronizado com sucesso.';
        feedback.className = 'performance-feedback success';
        await refreshDashboard?.();
      } catch (error) {
        if (!current()) return;
        feedback.textContent = channelErrorMessage(error);
        feedback.className = 'performance-feedback error';
      } finally {
        syncing = false;
        if (current()) {
          button.disabled = false;
          button.setAttribute('aria-busy', 'false');
        }
      }
    };
    button?.addEventListener('click', sync);
    search?.addEventListener('input', onFilter);
    format?.addEventListener('change', onFilter);
    sort?.addEventListener('change', onFilter);
    evidence?.addEventListener('change', onFilter);
    resetFilters?.addEventListener('click', reset);
    refreshContent?.addEventListener('click', loadContent);
    cleanup = () => { button?.removeEventListener('click', sync); search?.removeEventListener('input', onFilter); format?.removeEventListener('change', onFilter); sort?.removeEventListener('change', onFilter); evidence?.removeEventListener('change', onFilter); resetFilters?.removeEventListener('click', reset); refreshContent?.removeEventListener('click', loadContent); };
    const renderSummary = (value = {}) => {
      if (!summary || !current()) return;
      summary.replaceChildren();
      if (Number(value.videos ?? 0) === 0) { const empty = document.createElement('p'); empty.className = 'channel-video-summary-detail'; empty.textContent = 'Ainda não existem snapshots de vídeo persistidos.'; summary.append(empty); return; }
      for (const [label, amount] of [['Vídeos', value.videos], ['Coletas', value.observations], ['Com views', value.coverage?.views], ['Com retenção', value.coverage?.retention], ['Com CTR', value.coverage?.ctr]]) {
        const item = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = String(amount ?? 0); const small = document.createElement('small'); small.textContent = label; item.append(strong, small); summary.append(item);
      }
      const details = document.createElement('p'); details.className = 'channel-video-summary-detail';
      const formats = Object.entries(value.formats ?? {}).map(([name, count]) => `${name}: ${count}`).join(' · ') || 'formatos não informados';
      const age = value.latestCollectedAt ? collectionAgeDays(value.latestCollectedAt) : null;
      const collected = value.latestCollectedAt ? `${new Date(value.latestCollectedAt).toLocaleString('pt-BR')}${age === null ? '' : ` (há ${age} dia(s))`}` : 'sem coleta registrada';
      const windowStart = value.earliestCollectedAt ? new Date(value.earliestCollectedAt).toLocaleDateString('pt-BR') : '--';
      const missing = [['watch time', value.coverage?.watchTime], ['impressões', value.coverage?.impressions], ['inscritos', value.coverage?.subscribers], ['interações', value.coverage?.interactions]]
        .filter(([, count]) => Number(count ?? 0) < Number(value.videos ?? 0)).map(([label, count]) => `${label} ${count ?? 0}/${value.videos ?? 0}`);
      details.textContent = `Formatos: ${formats}. Janela local desde ${windowStart}. Última coleta: ${collected}. ${missing.length ? `Cobertura parcial: ${missing.join(', ')}.` : 'Cobertura completa para os grupos adicionais.'}`;
      summary.append(details);
      for (const [name, cohort] of Object.entries(value.formatCohorts ?? {})) {
        const row = document.createElement('p'); row.className = 'channel-video-summary-detail';
        row.textContent = `${name}: ${cohort.videos ?? 0} vídeo(s) · views ${cohort.coverage?.views ?? 0}/${cohort.videos ?? 0} · retenção ${cohort.coverage?.retention ?? 0}/${cohort.videos ?? 0} · CTR ${cohort.coverage?.ctr ?? 0}/${cohort.videos ?? 0}`;
        summary.append(row);
      }
    };
    loadContent();
  };

  const unmount = () => {
    cleanup(); cleanup = () => {};
    mountedRoot = null; generation += 1; detailRequest += 1; syncing = false;
  };

  return { mount, unmount };
};

export const channelModule = {
  id: 'channel',
  route: '/channel',
  pageTitle: 'Canal',
  pageEyebrow: 'Fonte de dados',
  refreshOnDashboardData: true,
  label: 'Canal',
  createController: createChannelController,
  render(data, context = {}) {
    const channel = data.channel ?? {};
    const metrics = data.metrics ?? {};
    const integration = integrationFrom(data, 'youtubeData') ?? channel.integration ?? {};
    const state = operationalStatus(integration.state);
    const needsReconnect = integration.state === 'AUTH_REQUIRED' || integration.state === 'NOT_CONFIGURED';
    const isDegraded = integration.state === 'DEGRADED' || integration.stale;
    const actions = html`<div class="channel-actions">
      ${createStatusPill(state.label, state.variant)}
      ${needsReconnect || isDegraded ? html`<a class="button secondary" href="${data.authUrl ?? `${context.apiBaseUrl ?? ''}/api/auth/google`}">Reconectar Google</a>` : ''}
      ${integration.state !== 'NOT_CONFIGURED' ? html`<button class="button secondary" type="button" data-channel-sync>Sincronizar canal</button>` : ''}
    </div>`;
    const sources = [
      ['googleOAuth', 'Google OAuth', 'Autorização usada pelas APIs do YouTube', `${context.apiBaseUrl ?? ''}/api/auth/google`],
      ['youtubeData', 'Dados do canal', 'Identidade e totais públicos do canal', '#/channel'],
      ['youtubeAnalytics', 'YouTube Analytics', 'Performance, audiência e retenção', '#/analytics'],
      ['youtubeReach', 'YouTube Reach', 'Impressões e CTR dos relatórios oficiais', '#/analytics/ctr'],
    ];
    const sourceRows = sources.map(([id, label, description, href]) => {
      const source = integrationFrom(data, id) ?? {};
      const sourceState = operationalStatus(source.state);
      const action = channelSourceAction(source);
      return html`<div class="channel-source-row">
        <div><strong>${label}</strong><small>${description}</small><small>${source.summary ?? sourceState.label}</small></div>
        ${createStatusPill(sourceState.label, sourceState.variant)}
        ${action.available ? html`<a class="button secondary" href="${href}">${action.label}</a>` : html`<span class="channel-source-unavailable" aria-disabled="true">${action.label}</span>`}
      </div>`;
    }).join('');

    return html`
      <section class="summary-grid" aria-label="Metricas principais">
        ${createMetricCard({
          label: 'Inscritos',
          value: formatNumber(metrics.subscribers),
          caption: integration.stale ? 'Último dado conhecido' : 'YouTube',
        })}
        ${createMetricCard({
          label: 'Videos',
          value: formatNumber(metrics.videos),
          caption: 'Canal',
        })}
        ${createMetricCard({
          label: 'Visualizacoes',
          value: formatNumber(metrics.views),
          caption: 'Total historico',
        })}
      </section>

      ${createPanel({
        eyebrow: 'Canal conectado',
        title: channel.title ?? emptyValue,
        className: 'channel-panel',
        action: actions,
        body: html`${createDetailList([
          { label: 'ID', value: channel.id ?? emptyValue },
          { label: 'Pais', value: channel.country ?? emptyValue },
          { label: 'Publicado em', value: formatDate(channel.publishedAt) },
          { label: 'Última atualização', value: formatDate(integration.lastSuccessAt) },
          { label: 'Estado', value: integration.summary ?? state.label },
        ])}<div class="performance-feedback" data-channel-feedback role="status" aria-live="polite" aria-atomic="true" hidden></div>`,
      })}
      ${createPanel({
        eyebrow: 'Conteúdo sincronizado',
        title: 'Vídeos recentes',
        className: 'channel-videos-panel',
        body: html`<div class="channel-video-summary" data-channel-video-summary aria-live="polite"><span>Calculando cobertura...</span></div><div class="channel-video-filters"><label>Buscar<input type="search" data-channel-video-search placeholder="Título do vídeo"></label><label>Formato<select data-channel-video-format><option value="ALL">Todos</option><option value="LONG_FORM">Long-form</option><option value="SHORTS">Shorts</option><option value="LIVE">Live</option></select></label><label>Evidência<select data-channel-video-evidence><option value="ALL">Todas</option><option value="HAS_RETENTION">Com retenção</option><option value="MISSING_CTR">Sem CTR</option></select></label><label>Ordenar<select data-channel-video-sort><option value="COLLECTED">Coleta recente</option><option value="VIEWS">Mais views</option><option value="RETENTION">Maior retenção</option><option value="CTR">Maior CTR</option><option value="TITLE">Título</option></select></label><button class="button secondary" type="button" data-channel-video-reset>Limpar filtros</button><button class="button secondary" type="button" data-channel-video-refresh>Atualizar lista local</button></div><p class="channel-video-result-count" data-channel-video-result-count aria-live="polite">Carregando resultados...</p><div class="channel-video-comparison" data-channel-video-comparison aria-live="polite">Selecione até dois vídeos para comparar.</div><div class="channel-video-layout"><div class="channel-video-list" data-channel-videos aria-live="polite"><p class="empty-state">Carregando vídeos...</p></div><aside class="channel-video-detail" data-channel-video-detail aria-live="polite">Selecione um vídeo para ver métricas e histórico.</aside></div>`,
      })}
      ${createPanel({
        eyebrow: 'Integrações oficiais',
        title: 'Fontes do YouTube',
        className: 'channel-sources-panel',
        body: html`<div class="channel-source-list">${sourceRows}</div>`,
      })}
    `;
  },
};
