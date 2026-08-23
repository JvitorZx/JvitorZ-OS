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
      throw new Error(`Erro ${response.status} ao carregar dashboard`);
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
});
