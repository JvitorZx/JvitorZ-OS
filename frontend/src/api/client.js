export class ApiRequestError extends Error {
  constructor(message, status) {
    super(`${message} (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

const requestJson = async (url, options, errorMessage) => {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new ApiRequestError(errorMessage, response.status);
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
});
