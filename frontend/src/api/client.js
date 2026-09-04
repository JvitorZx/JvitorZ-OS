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

const listEditorialDecisionView = (baseUrl, path, filters, errorMessage) => {
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
  return requestJson(`${baseUrl}/api/operators/creator-intelligence/${path}${query ? `?${query}` : ''}`, undefined, errorMessage);
};

const transitionStrategicSignal = (baseUrl, signalId, action, reason) => {
  const id = requireIdentifier(signalId, 'signalId');
  const normalizedReason = reason === undefined || reason === null || reason === '' ? undefined : String(reason).trim();
  if (reason !== undefined && reason !== null && reason !== '' && !normalizedReason) throw new TypeError('reason must be a non-empty string');
  return requestJson(`${baseUrl}/api/monitoring/signals/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(normalizedReason ? { reason: normalizedReason } : {}),
  }, 'Erro ao atualizar sinal estrategico');
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

  async queryManager(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('manager query input must be an object');
    }
    return requestJson(`${baseUrl}/api/manager/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }, 'Erro ao consultar o Gerente');
  },

  async listManagerHistory({ projectId, conversationId, limit = 10 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('limit must be an integer from 1 to 50');
    const query = new URLSearchParams({ limit: String(limit) });
    if (projectId) query.set('projectId', requireIdentifier(projectId, 'projectId'));
    if (conversationId) query.set('conversationId', requireIdentifier(conversationId, 'conversationId'));
    return requestJson(`${baseUrl}/api/manager/history?${query}`, undefined, 'Erro ao carregar historico do Gerente');
  },

  async getManagerHistory(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(`${baseUrl}/api/manager/history/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir consulta do Gerente');
  },

  async getManagerDiagnostics(executionId) {
    const id = requireIdentifier(executionId, 'executionId');
    return requestJson(`${baseUrl}/api/manager/history/${encodeURIComponent(id)}/diagnostics`, undefined, 'Erro ao abrir diagnostico do Gerente');
  },

  async getCurrentContentPlan(filters = {}) {
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.horizon !== undefined) params.set('horizon', requireIdentifier(filters.horizon, 'horizon'));
    return requestJson(`${baseUrl}/api/planning/current${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar plano estrategico');
  },

  async getCurrentExecutionGuidance(filters = {}) {
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.horizon !== undefined) params.set('horizon', requireIdentifier(filters.horizon, 'horizon'));
    return requestJson(`${baseUrl}/api/planning/current/guidance${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar orientacao de execucao');
  },

  async generateContentPlan(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('planning input must be an object');
    return requestJson(`${baseUrl}/api/planning/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao gerar plano estrategico');
  },

  async createPlannedContentItem(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('planning item input must be an object');
    return requestJson(`${baseUrl}/api/planning/items`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao criar item planejado');
  },

  async updatePlannedContentItem(itemId, input) {
    const id = requireIdentifier(itemId, 'itemId');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('planning item update must be an object');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao atualizar item planejado');
  },

  async completePlannedContentItem(itemId, reason) {
    const id = requireIdentifier(itemId, 'itemId');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/complete`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reason ? { reason } : {}),
    }, 'Erro ao concluir item planejado');
  },

  async updatePlanningExecution(itemId, input) {
    const id = requireIdentifier(itemId, 'itemId');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('planning execution input must be an object');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/execution`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao atualizar execucao do planejamento');
  },

  async reorderContentPlan(planId, itemIds, reason) {
    const id = requireIdentifier(planId, 'planId');
    if (!Array.isArray(itemIds) || !itemIds.length) throw new TypeError('itemIds must be a non-empty array');
    const normalized = itemIds.map((itemId) => requireIdentifier(itemId, 'itemId'));
    const normalizedReason = String(reason ?? '').trim();
    if (!normalizedReason) throw new TypeError('reason must be a non-empty string');
    return requestJson(`${baseUrl}/api/planning/reorder`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: id, itemIds: normalized, reason: normalizedReason }),
    }, 'Erro ao reordenar plano estrategico');
  },

  async getContentPlan(planId) {
    const id = requireIdentifier(planId, 'planId');
    return requestJson(`${baseUrl}/api/planning/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir plano estrategico');
  },

  async listPlanningHistory(filters = {}) {
    const params = new URLSearchParams();
    if (filters.planId !== undefined) params.set('planId', requireIdentifier(filters.planId, 'planId'));
    if (filters.itemId !== undefined) params.set('itemId', requireIdentifier(filters.itemId, 'itemId'));
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200) throw new TypeError('limit must be an integer from 1 to 200');
      params.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/planning/history${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar historico do planejamento');
  },

  async listPlanningExecutionHistory(filters = {}) {
    const params = new URLSearchParams();
    if (filters.planId !== undefined) params.set('planId', requireIdentifier(filters.planId, 'planId'));
    if (filters.itemId !== undefined) params.set('itemId', requireIdentifier(filters.itemId, 'itemId'));
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200) throw new TypeError('limit must be an integer from 1 to 200');
      params.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/planning/execution-history${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar historico de execucao');
  },

  async listPlanningVideoCandidates(itemId) {
    const id = requireIdentifier(itemId, 'itemId');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/video-candidates`, undefined, 'Erro ao carregar videos candidatos');
  },

  async getPlanningItemOutcome(itemId) {
    const id = requireIdentifier(itemId, 'itemId');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/outcome`, undefined, 'Erro ao carregar resultado do planejamento');
  },

  async associatePlanningVideo(itemId, input) {
    const id = requireIdentifier(itemId, 'itemId');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('planning video link input must be an object');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/outcome/video`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao associar video ao planejamento');
  },

  async unlinkPlanningVideo(itemId, reason) {
    const id = requireIdentifier(itemId, 'itemId');
    const normalizedReason = String(reason ?? '').trim();
    if (!normalizedReason) throw new TypeError('reason must be a non-empty string');
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/outcome/video`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: normalizedReason }),
    }, 'Erro ao remover associacao do video');
  },

  async capturePlanningOutcome(itemId, snapshotId) {
    const id = requireIdentifier(itemId, 'itemId');
    const body = snapshotId === undefined ? {} : { snapshotId: requireIdentifier(snapshotId, 'snapshotId') };
    return requestJson(`${baseUrl}/api/planning/items/${encodeURIComponent(id)}/outcomes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, 'Erro ao avaliar resultado do planejamento');
  },

  async getPlanningOutcome(outcomeId) {
    const id = requireIdentifier(outcomeId, 'outcomeId');
    return requestJson(`${baseUrl}/api/planning/outcomes/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir resultado do planejamento');
  },

  async listStrategicLearnings(filters = {}) {
    const params = new URLSearchParams();
    for (const field of ['projectId', 'status', 'dimension']) {
      if (filters[field] !== undefined) params.set(field, requireIdentifier(filters[field], field));
    }
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200) throw new TypeError('limit must be an integer from 1 to 200');
      params.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/planning/learnings${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar aprendizados estrategicos');
  },

  async refreshStrategicLearnings(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('strategic learning input must be an object');
    return requestJson(`${baseUrl}/api/planning/learnings/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao atualizar aprendizados estrategicos');
  },

  async getStrategicLearning(learningId) {
    const id = requireIdentifier(learningId, 'learningId');
    return requestJson(`${baseUrl}/api/planning/learnings/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir aprendizado estrategico');
  },

  async getStrategicLearningEvidence(learningId) {
    const id = requireIdentifier(learningId, 'learningId');
    return requestJson(`${baseUrl}/api/planning/learnings/${encodeURIComponent(id)}/evidence`, undefined, 'Erro ao carregar evidencias do aprendizado');
  },

  async getStrategicLearningHistory(learningId) {
    const id = requireIdentifier(learningId, 'learningId');
    return requestJson(`${baseUrl}/api/planning/learnings/${encodeURIComponent(id)}/history`, undefined, 'Erro ao carregar historico do aprendizado');
  },

  async listStrategicLearningsFor(kind, referenceId) {
    const routes = { item: 'items', plan: 'plans', outcome: 'outcomes', video: 'videos' };
    if (!routes[kind]) throw new TypeError('strategic learning relation kind is invalid');
    const id = requireIdentifier(referenceId, `${kind}Id`);
    return requestJson(`${baseUrl}/api/planning/${routes[kind]}/${encodeURIComponent(id)}/learnings`, undefined, 'Erro ao carregar aprendizados relacionados');
  },

  async listStrategicExperiments(filters = {}) {
    const query = new URLSearchParams();
    if (filters.projectId) query.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.status) query.set('status', requireIdentifier(filters.status, 'status'));
    if (filters.limit) query.set('limit', String(filters.limit));
    return requestJson(`${baseUrl}/api/planning/experiments${query.size ? `?${query}` : ''}`, undefined, 'Erro ao carregar experimentos');
  },

  async createStrategicExperiment(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('experiment input must be an object');
    return requestJson(`${baseUrl}/api/planning/experiments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, 'Erro ao criar experimento');
  },

  async getStrategicExperiment(experimentId) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir experimento');
  },

  async startStrategicExperiment(experimentId) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 'Erro ao iniciar experimento');
  },

  async cancelStrategicExperiment(experimentId, reason) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reason ? { reason } : {}) }, 'Erro ao cancelar experimento');
  },

  async linkStrategicExperimentVariant(experimentId, variantId, input) {
    const id = requireIdentifier(experimentId, 'experimentId'); const variant = requireIdentifier(variantId, 'variantId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/variants/${encodeURIComponent(variant)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input ?? {}) }, 'Erro ao vincular variante');
  },

  async addStrategicExperimentObservation(experimentId, variantId, outcomeId) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/observations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId: requireIdentifier(variantId, 'variantId'), outcomeId: requireIdentifier(outcomeId, 'outcomeId') }) }, 'Erro ao adicionar observacao');
  },

  async analyzeStrategicExperiment(experimentId) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 'Erro ao analisar experimento');
  },

  async getStrategicExperimentEvidence(experimentId) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/evidence`, undefined, 'Erro ao carregar evidencias do experimento');
  },

  async getStrategicExperimentHistory(experimentId) {
    const id = requireIdentifier(experimentId, 'experimentId');
    return requestJson(`${baseUrl}/api/planning/experiments/${encodeURIComponent(id)}/history`, undefined, 'Erro ao carregar historico do experimento');
  },

  async listStrategicSignals(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new TypeError('monitoring filters must be an object');
    const query = new URLSearchParams();
    for (const field of ['projectId', 'state', 'severity', 'type']) {
      if (filters[field] !== undefined && filters[field] !== '') query.set(field, requireIdentifier(filters[field], field));
    }
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200) throw new TypeError('limit must be an integer from 1 to 200');
      query.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/monitoring/signals${query.size ? `?${query}` : ''}`, undefined, 'Erro ao carregar monitoramento estrategico');
  },

  async getStrategicSignal(signalId) {
    const id = requireIdentifier(signalId, 'signalId');
    return requestJson(`${baseUrl}/api/monitoring/signals/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir sinal estrategico');
  },

  async getMonitoringControl() {
    return requestJson(`${baseUrl}/api/monitoring/control`, undefined, 'Erro ao carregar controle do monitoramento');
  },

  async updateMonitoringCadence(intervalMs) {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new TypeError('intervalMs must be a positive integer');
    return requestJson(`${baseUrl}/api/monitoring/control`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intervalMs }),
    }, 'Erro ao atualizar cadencia do monitoramento');
  },

  async enableStrategicMonitoring() {
    return requestJson(`${baseUrl}/api/monitoring/control/enable`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao ativar monitoramento estrategico');
  },

  async disableStrategicMonitoring() {
    return requestJson(`${baseUrl}/api/monitoring/control/disable`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao desativar monitoramento estrategico');
  },

  async runStrategicMonitoringNow() {
    return requestJson(`${baseUrl}/api/monitoring/control/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao executar monitoramento estrategico');
  },

  async evaluateStrategicMonitoring(projectId) {
    const body = projectId === undefined || projectId === null || projectId === ''
      ? {}
      : { projectId: requireIdentifier(projectId, 'projectId') };
    return requestJson(`${baseUrl}/api/monitoring/evaluate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, 'Erro ao avaliar monitoramento estrategico');
  },

  async listChannelContext(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new TypeError('context filters must be an object');
    const query = new URLSearchParams();
    for (const field of ['projectId', 'type', 'status', 'category', 'entityType', 'entityId', 'periodFrom', 'periodTo']) {
      if (filters[field] !== undefined && filters[field] !== '') query.set(field, requireIdentifier(filters[field], field));
    }
    if (filters.currentOnly !== undefined) query.set('currentOnly', String(Boolean(filters.currentOnly)));
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200) throw new TypeError('limit must be an integer from 1 to 200');
      query.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/context${query.size ? `?${query}` : ''}`, undefined, 'Erro ao carregar contexto do canal');
  },

  async resolveChannelContext(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new TypeError('context resolver filters must be an object');
    const query = new URLSearchParams();
    for (const field of ['projectId', 'text', 'type', 'entityType', 'entityId', 'game', 'series', 'format', 'subject']) {
      if (filters[field] !== undefined && filters[field] !== '') query.set(field, requireIdentifier(filters[field], field));
    }
    if (filters.limit !== undefined) query.set('limit', String(filters.limit));
    return requestJson(`${baseUrl}/api/context/resolve${query.size ? `?${query}` : ''}`, undefined, 'Erro ao resolver contexto do canal');
  },

  async getChannelContext(contextId) {
    const id = requireIdentifier(contextId, 'contextId');
    return requestJson(`${baseUrl}/api/context/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir contexto do canal');
  },

  async createChannelContext(input) {
    return requestJson(`${baseUrl}/api/context`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, 'Erro ao criar contexto do canal');
  },

  async updateChannelContext(contextId, input) {
    const id = requireIdentifier(contextId, 'contextId');
    return requestJson(`${baseUrl}/api/context/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, 'Erro ao atualizar contexto do canal');
  },

  async supersedeChannelContext(contextId, input) {
    const id = requireIdentifier(contextId, 'contextId');
    return requestJson(`${baseUrl}/api/context/${encodeURIComponent(id)}/supersede`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, 'Erro ao substituir contexto do canal');
  },

  async relateChannelContext(contextId, input) {
    const id = requireIdentifier(contextId, 'contextId');
    return requestJson(`${baseUrl}/api/context/${encodeURIComponent(id)}/relations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, 'Erro ao relacionar contexto do canal');
  },

  async acknowledgeStrategicSignal(signalId, reason) {
    return transitionStrategicSignal(baseUrl, signalId, 'acknowledge', reason);
  },

  async dismissStrategicSignal(signalId, reason) {
    return transitionStrategicSignal(baseUrl, signalId, 'dismiss', reason);
  },

  async resolveStrategicSignal(signalId, reason) {
    return transitionStrategicSignal(baseUrl, signalId, 'resolve', reason);
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

  async getAudienceStatus() {
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/audience/status`, undefined, 'Erro ao consultar status de audiência');
  },

  async syncYouTubeAudience(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('audience sync input must be an object');
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/audience/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, 'Erro ao sincronizar audiência');
  },

  async getAudienceSummary(projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(requireIdentifier(projectId, 'projectId'))}` : '';
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/audience/summary${query}`, undefined, 'Erro ao carregar audiência');
  },

  async getTrafficSourceAnalysis(projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(requireIdentifier(projectId, 'projectId'))}` : '';
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/audience/traffic${query}`, undefined, 'Erro ao carregar fontes de tráfego');
  },

  async compareAudiencePeriods(input) {
    if (!input || typeof input !== 'object') throw new TypeError('audience comparison input must be an object');
    const query = new URLSearchParams();
    for (const field of ['currentStart', 'currentEnd', 'previousStart', 'previousEnd']) query.set(field, requireIdentifier(input[field], field));
    if (input.projectId) query.set('projectId', requireIdentifier(input.projectId, 'projectId'));
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/audience/comparison?${query}`, undefined, 'Erro ao comparar audiência');
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

  async compareEditorialCandidates(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('editorial candidate comparison input must be an object');
    }
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/compare`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      'Erro ao comparar oportunidades editoriais',
    );
  },

  async getCurrentEditorialDecision(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      throw new TypeError('current editorial decision filters must be an object');
    }
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.conversationId !== undefined) params.set('conversationId', requireIdentifier(filters.conversationId, 'conversationId'));
    const query = params.toString();
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/current${query ? `?${query}` : ''}`,
      undefined,
      'Erro ao carregar decisão editorial atual',
    );
  },

  async getEditorialDecisionEvidence(decisionId) {
    const id = requireIdentifier(decisionId, 'decisionId');
    return requestJson(
      `${baseUrl}/api/operators/creator-intelligence/editorial-decisions/${encodeURIComponent(id)}/evidence`,
      undefined,
      'Erro ao carregar evidências editoriais',
    );
  },

  async listEditorialOpportunities(filters = {}) {
    return listEditorialDecisionView(baseUrl, 'editorial-opportunities', filters, 'Erro ao carregar oportunidades editoriais');
  },

  async listEditorialRisks(filters = {}) {
    return listEditorialDecisionView(baseUrl, 'editorial-risks', filters, 'Erro ao carregar riscos editoriais');
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

  async listTrends(filters = {}) {
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.subjectType) params.set('subjectType', requireIdentifier(filters.subjectType, 'subjectType'));
    if (filters.classification) params.set('classification', requireIdentifier(filters.classification, 'classification'));
    if (filters.days !== undefined) {
      if (![7, 28].includes(filters.days)) throw new TypeError('days must be 7 or 28');
      params.set('days', String(filters.days));
    }
    if (filters.refresh === false) params.set('refresh', 'false');
    const query = params.toString();
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/trends${query ? `?${query}` : ''}`, undefined, 'Erro ao carregar tendências');
  },

  async getTrend(trendId) {
    const id = requireIdentifier(trendId, 'trendId');
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/trends/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir tendência');
  },

  async createSeries(input) {
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/series`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao criar série');
  },

  async listSeries(projectId) {
    const query = projectId === undefined ? '' : `?projectId=${encodeURIComponent(requireIdentifier(projectId, 'projectId'))}`;
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/series${query}`, undefined, 'Erro ao carregar séries');
  },

  async getSeries(seriesId) {
    const id = requireIdentifier(seriesId, 'seriesId');
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/series/${encodeURIComponent(id)}`, undefined, 'Erro ao abrir série');
  },

  async linkSeriesVideo(seriesId, snapshotId, mode = 'manual') {
    const id = requireIdentifier(seriesId, 'seriesId');
    const snapshot = requireIdentifier(snapshotId, 'snapshotId');
    if (!['manual', 'auto'].includes(mode)) throw new TypeError('mode must be manual or auto');
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/series/${encodeURIComponent(id)}/videos`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshotId: snapshot, mode }),
    }, 'Erro ao associar vídeo à série');
  },

  async unlinkSeriesVideo(seriesId, videoId) {
    const id = requireIdentifier(seriesId, 'seriesId');
    const video = requireIdentifier(videoId, 'videoId');
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/series/${encodeURIComponent(id)}/videos/${encodeURIComponent(video)}`, { method: 'DELETE' }, 'Erro ao remover vídeo da série');
  },

  async listContentPatterns(filters = {}) {
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.patternType) params.set('patternType', requireIdentifier(filters.patternType, 'patternType'));
    if (filters.refresh === false) params.set('refresh', 'false');
    const query = params.toString();
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/content-patterns${query ? `?${query}` : ''}`, undefined, 'Erro ao carregar padrões de conteúdo');
  },

  async getSubjectPerformance(type, projectId) {
    if (!['game', 'topic'].includes(type)) throw new TypeError('type must be game or topic');
    const params = new URLSearchParams({ type });
    if (projectId !== undefined) params.set('projectId', requireIdentifier(projectId, 'projectId'));
    return requestJson(`${baseUrl}/api/operators/creator-intelligence/subject-performance?${params}`, undefined, 'Erro ao carregar performance por assunto');
  },

  async runResearch(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('research input must be an object');
    return requestJson(`${baseUrl}/api/research`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao executar pesquisa');
  },

  async researchGames(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('game research input must be an object');
    return requestJson(`${baseUrl}/api/research/games`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao pesquisar jogos');
  },

  async researchTopics(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('topic research input must be an object');
    return requestJson(`${baseUrl}/api/research/topics`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 'Erro ao pesquisar temas');
  },

  async listResearchOpportunities(filters = {}) {
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.state !== undefined) params.set('state', requireIdentifier(filters.state, 'state'));
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) throw new TypeError('limit must be an integer from 1 to 100');
      params.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/research/opportunities${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar oportunidades de pesquisa');
  },

  async getResearchOpportunity(id) {
    const validId = requireIdentifier(id, 'opportunityId');
    return requestJson(`${baseUrl}/api/research/opportunities/${encodeURIComponent(validId)}`, undefined, 'Erro ao abrir oportunidade de pesquisa');
  },

  async listResearchHistory(filters = {}) {
    const params = new URLSearchParams();
    if (filters.projectId !== undefined) params.set('projectId', requireIdentifier(filters.projectId, 'projectId'));
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50) throw new TypeError('limit must be an integer from 1 to 50');
      params.set('limit', String(filters.limit));
    }
    return requestJson(`${baseUrl}/api/research/history${params.size ? `?${params}` : ''}`, undefined, 'Erro ao carregar histórico de pesquisa');
  },

  async getResearchHistory(id) {
    const validId = requireIdentifier(id, 'researchId');
    return requestJson(`${baseUrl}/api/research/history/${encodeURIComponent(validId)}`, undefined, 'Erro ao abrir pesquisa');
  },

  async refreshResearch(id) {
    const validId = requireIdentifier(id, 'researchId');
    return requestJson(`${baseUrl}/api/research/history/${encodeURIComponent(validId)}/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, 'Erro ao atualizar pesquisa');
  },
});
