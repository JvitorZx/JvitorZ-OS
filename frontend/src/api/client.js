export class ApiRequestError extends Error {
  constructor(message, status, code = null) {
    super(`${message} (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

const SAFE_ERROR_CODES = new Set([
  'AUTH_REQUIRED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'CONFIG_MISSING',
  'INVALID_REQUEST', 'NO_DATA', 'INTERNAL_ERROR',
]);

const requestJson = async (url, options, errorMessage) => {
  const response = await fetch(url, options);

  if (!response.ok) {
    let code = null;
    if (typeof response.json === 'function') {
      try {
        const payload = await response.json();
        if (SAFE_ERROR_CODES.has(payload?.code)) code = payload.code;
      } catch {
        // Error bodies are optional; status remains the safe public contract.
      }
    }
    throw new ApiRequestError(errorMessage, response.status, code);
  }

  if (response.status === 204) return undefined;

  return response.json();
};

const requireIdentifier = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return value.trim();
};

export const createApiClient = (baseUrl) => ({
  async getIntegrationStatus() {
    return requestJson(`${baseUrl}/api/integrations/status`, undefined, 'Erro ao consultar integracoes');
  },

  async listChannelOperators(projectId) {
    const query = projectId === undefined
      ? ''
      : `?projectId=${encodeURIComponent(requireIdentifier(projectId, 'projectId'))}`;
    return requestJson(`${baseUrl}/api/operators/channel${query}`, undefined, 'Erro ao carregar operadores do canal');
  },

  async getChannelOperator(operatorId, projectId) {
    const id = requireIdentifier(operatorId, 'operatorId');
    const query = projectId === undefined
      ? ''
      : `?projectId=${encodeURIComponent(requireIdentifier(projectId, 'projectId'))}`;
    return requestJson(`${baseUrl}/api/operators/channel/${encodeURIComponent(id)}${query}`, undefined, 'Erro ao executar operador do canal');
  },

  async getAutomationRuntimeStatus() {
    return requestJson(`${baseUrl}/api/automations/runtime/status`, undefined, 'Erro ao consultar runtime de automacoes');
  },

  async listAutomationRuntimeEvents(limit = 20) {
    return requestJson(`${baseUrl}/api/automations/runtime/events?limit=${encodeURIComponent(String(limit))}`,
      undefined, 'Erro ao carregar eventos do runtime');
  },

  async controlAutomationRuntime(action) {
    if (!['start', 'stop', 'tick'].includes(action)) throw new TypeError('invalid runtime action');
    return requestJson(`${baseUrl}/api/automations/runtime/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao controlar runtime de automacoes');
  },

  async listAutomationDiagnostics() {
    return requestJson(`${baseUrl}/api/automations/diagnostics`, undefined, 'Erro ao carregar diagnosticos de automacoes');
  },

  async getAutomationDiagnostics(automationId) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/diagnostics`, undefined, 'Erro ao diagnosticar automacao');
  },

  async getAutomationGovernance(automationId) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/governance`, undefined, 'Erro ao carregar governanca');
  },

  async updateAutomationGovernance(automationId, input) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/governance`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao atualizar governanca');
  },

  async controlAutomationGovernance(automationId, action, input = {}) {
    const id = requireIdentifier(automationId, 'automationId');
    if (!['clear-block', 'skip', 'override'].includes(action)) throw new TypeError('invalid governance action');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao controlar governanca');
  },

  async controlAutomationRun(runId, action) {
    const id = requireIdentifier(runId, 'runId'); if (!['retry', 'recover'].includes(action)) throw new TypeError('invalid run recovery action');
    return requestJson(`${baseUrl}/api/automations/runs/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao recuperar execucao');
  },

  async createAutomation(input) {
    return requestJson(`${baseUrl}/api/automations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao criar automacao');
  },

  async listAutomations() {
    return requestJson(`${baseUrl}/api/automations`, undefined, 'Erro ao carregar automacoes');
  },

  async getAutomation(automationId) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir automacao');
  },

  async updateAutomation(automationId, input) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao atualizar automacao');
  },

  async setAutomationState(automationId, action) {
    const id = requireIdentifier(automationId, 'automationId');
    if (!['enable', 'disable', 'pause', 'resume'].includes(action)) throw new TypeError('invalid automation action');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao alterar estado da automacao');
  },

  async runAutomationNow(automationId) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao executar automacao');
  },

  async listAutomationRuns(automationId, limit = 20) {
    const id = requireIdentifier(automationId, 'automationId');
    return requestJson(`${baseUrl}/api/automations/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(String(limit))}`,
      undefined, 'Erro ao carregar execucoes da automacao');
  },

  async getAutomationRun(runId) {
    const id = requireIdentifier(runId, 'runId');
    return requestJson(`${baseUrl}/api/automations/runs/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir execucao da automacao');
  },

  async executeApprovedAutomationRun(runId) {
    const id = requireIdentifier(runId, 'runId');
    return requestJson(`${baseUrl}/api/automations/runs/${encodeURIComponent(id)}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao executar plano aprovado da automacao');
  },

  async listDueAutomations(now) {
    const query = now ? `?now=${encodeURIComponent(new Date(now).toISOString())}` : '';
    return requestJson(`${baseUrl}/api/automations/due${query}`, undefined, 'Erro ao carregar automacoes vencidas');
  },

  async listOrchestrationCapabilities() {
    return requestJson(
      `${baseUrl}/api/orchestrator/capabilities`,
      undefined,
      'Erro ao carregar capabilities do Gerente',
    );
  },

  async planOrchestration(input) {
    return requestJson(
      `${baseUrl}/api/orchestrator/plan`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Erro ao montar plano do Gerente',
    );
  },

  async previewOrchestration(input) {
    return requestJson(
      `${baseUrl}/api/orchestrator/preview`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Erro ao criar preview do plano',
    );
  },

  async runOrchestration(input) {
    return requestJson(
      `${baseUrl}/api/orchestrator/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Erro ao executar solicitacao do Gerente',
    );
  },

  async listOrchestrationExecutions({ projectId, conversationId, limit = 10 } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (projectId) query.set('projectId', projectId);
    if (conversationId) query.set('conversationId', conversationId);
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/recent?${query}`,
      undefined,
      'Erro ao carregar historico do Gerente',
    );
  },

  async getOrchestrationExecution(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}`,
      undefined,
      'Erro ao abrir execucao do Gerente',
    );
  },

  async getOrchestrationPlan(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}/plan`,
      undefined,
      'Erro ao abrir plano do Gerente',
    );
  },

  async getPlanReview(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}/review`,
      undefined,
      'Erro ao carregar revisao do plano',
    );
  },

  async approveOrchestrationPlan(executionId, { reviewer, reason, expectedVersion }) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewer, ...(reason ? { reason } : {}), expectedVersion }),
      },
      'Erro ao aprovar plano',
    );
  },

  async rejectOrchestrationPlan(executionId, { reviewer, reason, expectedVersion }) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewer, reason, expectedVersion }),
      },
      'Erro ao rejeitar plano',
    );
  },

  async executeOrchestrationPlan(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}/execute`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
      'Erro ao executar plano aprovado',
    );
  },

  async getOrchestrationAuditTrail(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(
      `${baseUrl}/api/orchestrator/executions/${encodeURIComponent(id)}/audit`,
      undefined,
      'Erro ao carregar auditoria do plano',
    );
  },

  async getDashboard() {
    const response = await fetch(`${baseUrl}/api/dashboard`);

    if (response.status === 401) {
      return {
        unauthorized: true,
        authUrl: `${baseUrl}/api/auth/google`,
      };
    }

    if (!response.ok) {
      throw new ApiRequestError('Nao foi possivel carregar o dashboard', response.status);
    }

    return response.json();
  },

  async createConversation({ title } = {}) {
    return requestJson(
      `${baseUrl}/api/operators/planner/conversations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(title === undefined ? {} : { title }),
      },
      'Erro ao criar conversa do Planner',
    );
  },

  async listConversations() {
    return requestJson(
      `${baseUrl}/api/operators/planner/conversations`,
      undefined,
      'Erro ao carregar historico do Planner',
    );
  },

  async getConversation(conversationId) {
    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(conversationId)}`,
      undefined,
      'Erro ao carregar conversa do Planner',
    );
  },

  async updateConversationContext(conversationId, context) {
    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(conversationId)}/context`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context }),
      },
      'Erro ao salvar contexto do Planner',
    );
  },

  async createMessage(conversationId, { sender, text }) {
    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender, text }),
      },
      'Erro ao salvar mensagem do Planner',
    );
  },

  async generatePlannerReply(conversationId) {
    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(conversationId)}/reply`,
      { method: 'POST' },
      'Erro ao gerar resposta do Planner',
    );
  },

  async saveMessageToLibrary(conversationId, messageId) {
    const validConversationId = requireIdentifier(conversationId, 'conversationId');
    const validMessageId = requireIdentifier(messageId, 'messageId');

    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(validConversationId)}/messages/${encodeURIComponent(validMessageId)}/library`,
      { method: 'POST' },
      'Erro ao salvar resposta na Biblioteca',
    );
  },

  async listLibraryItems() {
    return requestJson(
      `${baseUrl}/api/operators/planner/library`,
      undefined,
      'Erro ao carregar Biblioteca',
    );
  },

  async getLibraryItem(libraryItemId) {
    const validLibraryItemId = requireIdentifier(libraryItemId, 'libraryItemId');

    return requestJson(
      `${baseUrl}/api/operators/planner/library/${encodeURIComponent(validLibraryItemId)}`,
      undefined,
      'Erro ao abrir item da Biblioteca',
    );
  },

  async linkLibraryItemToConversation(conversationId, libraryItemId) {
    const validConversationId = requireIdentifier(conversationId, 'conversationId');
    const validLibraryItemId = requireIdentifier(libraryItemId, 'libraryItemId');

    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(validConversationId)}/library/${encodeURIComponent(validLibraryItemId)}`,
      { method: 'POST' },
      'Erro ao vincular item a conversa do Planner',
    );
  },

  async listConversationLibraryItems(conversationId) {
    const validConversationId = requireIdentifier(conversationId, 'conversationId');

    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(validConversationId)}/library`,
      undefined,
      'Erro ao carregar memoria ativa do Planner',
    );
  },

  async unlinkLibraryItemFromConversation(conversationId, libraryItemId) {
    const validConversationId = requireIdentifier(conversationId, 'conversationId');
    const validLibraryItemId = requireIdentifier(libraryItemId, 'libraryItemId');

    return requestJson(
      `${baseUrl}/api/operators/planner/conversations/${encodeURIComponent(validConversationId)}/library/${encodeURIComponent(validLibraryItemId)}`,
      { method: 'DELETE' },
      'Erro ao desvincular item da conversa do Planner',
    );
  },

  async getYouTubePerformanceStatus() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/performance/youtube/status`,
      undefined,
      'Erro ao consultar status do YouTube Analytics',
    );
  },

  async getYouTubeReachStatus() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/reach/youtube/status`,
      undefined,
      'Erro ao consultar status de alcance',
    );
  },

  async syncYouTubeReach(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('reach sync input must be an object');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/reach/youtube/sync`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
      'Erro ao sincronizar alcance do YouTube',
    );
  },

  async listYouTubeReachData(filters = {}) {
    const query = new URLSearchParams();
    if (filters.projectId) query.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.videoId) query.set('videoId', requireIdentifier(filters.videoId, 'videoId'));
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/reach/data${query.size ? `?${query}` : ''}`, undefined, 'Erro ao carregar alcance');
  },

  async getDataQuality(projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(requireIdentifier(projectId, 'projectId'))}` : '';
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/reach/quality${query}`, undefined, 'Erro ao carregar qualidade dos dados');
  },

  async syncYouTubePerformance(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('sync input must be an object');
    }
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/performance/youtube/sync`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Erro ao sincronizar YouTube Analytics',
    );
  },

  async getYouTubeLastSync() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/performance/youtube/last-sync`,
      undefined,
      'Erro ao consultar ultima sincronizacao',
    );
  },

  async listPerformanceRecords() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/performance/records`,
      undefined,
      'Erro ao carregar dados de performance',
    );
  },

  async getPerformanceBaseline() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/performance/baseline`,
      undefined,
      'Erro ao carregar baseline de performance',
    );
  },

  async listPerformanceSignals() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/performance/signals`,
      undefined,
      'Erro ao carregar sinais de performance',
    );
  },

  async listChannelLearnings() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/learnings`,
      undefined,
      'Erro ao carregar aprendizados do canal',
    );
  },

  async getCreatorIntelligenceContext() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/context`,
      undefined,
      'Erro ao carregar contexto de decisoes',
    );
  },

  async getDecisionEvidence(decisionId) {
    const validDecisionId = requireIdentifier(decisionId, 'decisionId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decisions/${encodeURIComponent(validDecisionId)}/evidence`,
      undefined,
      'Erro ao carregar evidencias da decisao',
    );
  },

  async generateEditorialDecision(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('editorial decision input must be an object');
    }
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Erro ao gerar decisao editorial',
    );
  },

  async listEditorialDecisions(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      throw new TypeError('editorial decision filters must be an object');
    }
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.conversationId !== undefined) params.set('conversationId', requireIdentifier(filters.conversationId, 'conversationId'));
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50) {
        throw new TypeError('limit must be an integer from 1 to 50');
      }
      params.set('limit', String(filters.limit));
    }
    const query = params.toString();
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions${query ? `?${query}` : ''}`,
      undefined,
      'Erro ao carregar decisoes editoriais',
    );
  },

  async getEditorialDecision(decisionId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}`,
      undefined,
      'Erro ao abrir decisao editorial',
    );
  },

  async registerEditorialDecisionOutcome(decisionId, snapshotId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    const validSnapshotId = requireIdentifier(snapshotId, 'snapshotId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/outcome`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId: validSnapshotId }),
      },
      'Erro ao registrar resultado editorial',
    );
  },

  async linkEditorialDecisionVideo(decisionId, input) {
    const id = requireIdentifier(decisionId, 'decisionId');
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('decision video link input must be an object');
    }
    const snapshotId = requireIdentifier(input.snapshotId, 'snapshotId');
    const body = { snapshotId };
    if (input.origin !== undefined) body.origin = requireIdentifier(input.origin, 'origin');
    if (input.notes !== undefined) {
      if (typeof input.notes !== 'string') throw new TypeError('notes must be text');
      body.notes = input.notes;
    }
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/videos`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Erro ao associar video a decisao editorial',
    );
  },

  async listEditorialDecisionVideos(decisionId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/videos`,
      undefined,
      'Erro ao carregar videos da decisao editorial',
    );
  },

  async unlinkEditorialDecisionVideo(decisionId, linkId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    const validLinkId = requireIdentifier(linkId, 'linkId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/videos/${encodeURIComponent(validLinkId)}`,
      { method: 'DELETE' },
      'Erro ao remover video da decisao editorial',
    );
  },

  async evaluateEditorialDecisionOutcome(decisionId, linkId, snapshotId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    const validLinkId = requireIdentifier(linkId, 'linkId');
    const body = snapshotId === undefined
      ? {}
      : { snapshotId: requireIdentifier(snapshotId, 'snapshotId') };
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/videos/${encodeURIComponent(validLinkId)}/outcomes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Erro ao avaliar resultado editorial',
    );
  },

  async listEditorialDecisionOutcomes(decisionId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/outcomes`,
      undefined,
      'Erro ao carregar resultados da decisao editorial',
    );
  },

  async listDecisionOutcomes(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      throw new TypeError('decision outcome filters must be an object');
    }
    const params = new URLSearchParams();
    for (const field of ['projectId', 'conversationId', 'decisionId', 'videoId']) {
      if (filters[field] !== undefined) params.set(field, requireIdentifier(filters[field], field));
    }
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50) {
        throw new TypeError('limit must be an integer from 1 to 50');
      }
      params.set('limit', String(filters.limit));
    }
    const query = params.toString();
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes${query ? `?${query}` : ''}`,
      undefined,
      'Erro ao carregar resultados editoriais',
    );
  },

  async getDecisionOutcome(outcomeId) {
    const id = requireIdentifier(outcomeId, 'outcomeId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/${encodeURIComponent(id)}`,
      undefined,
      'Erro ao abrir resultado editorial',
    );
  },

  async listOutcomeReviewStates() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/review-states`,
      undefined,
      'Erro ao carregar estados de revisão dos outcomes',
    );
  },

  async getOutcomeReviewState(outcomeId) {
    const id = requireIdentifier(outcomeId, 'outcomeId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/${encodeURIComponent(id)}/review-state`,
      undefined,
      'Erro ao carregar estado de revisão do outcome',
    );
  },

  async reviewDecisionOutcome(outcomeId) {
    const id = requireIdentifier(outcomeId, 'outcomeId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/${encodeURIComponent(id)}/review`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      'Erro ao revisar outcome',
    );
  },

  async reviewAvailableOutcomes() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/review`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      'Erro ao revisar outcomes disponíveis',
    );
  },

  async listOutcomeReviews(outcomeId) {
    const id = requireIdentifier(outcomeId, 'outcomeId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/${encodeURIComponent(id)}/reviews`,
      undefined,
      'Erro ao carregar histórico de revisões',
    );
  },

  async getOutcomeReviewStatus() {
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/decision-outcomes/review-status`,
      undefined,
      'Erro ao carregar resumo de revisão dos outcomes',
    );
  },
});
