import type { OrchestrationExecution } from '@prisma/client';
import type {
  ManagerQueryInput,
  ManagerQueryResult,
  OrchestrationRequest,
  OrchestrationResult,
} from '../../domains/orchestration';
import { buildOrchestrationContext, classifyManagerIntent } from './ManagerIntentInterpreter';
import {
  OrchestrationNotFoundError,
  OrchestrationValidationError,
  OrchestratorService,
} from './OrchestratorService';

const optionalId = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new OrchestrationValidationError(`${field} must be a non-empty string up to 120 characters`);
  }
  return value.trim();
};

const normalizeInput = (input: ManagerQueryInput): Required<Pick<ManagerQueryInput, 'message'>> & Omit<ManagerQueryInput, 'message'> => {
  if (!input || typeof input !== 'object' || typeof input.message !== 'string') {
    throw new OrchestrationValidationError('message is required');
  }
  const message = input.message.trim();
  if (!message || Array.from(message).length > 1_000) {
    throw new OrchestrationValidationError('message must contain from 1 to 1000 characters');
  }
  return {
    message,
    projectId: optionalId(input.projectId, 'projectId'),
    conversationId: optionalId(input.conversationId, 'conversationId'),
    requestId: optionalId(input.requestId, 'requestId') ?? undefined,
  };
};

const asManagerResult = (execution: OrchestrationExecution): ManagerQueryResult => {
  const result = execution.result as unknown as OrchestrationResult | null;
  const request = execution.request as unknown as OrchestrationRequest;
  if (!request.managerIntent || !result) throw new OrchestrationNotFoundError();
  return {
    correlationId: result.correlationId ?? execution.id,
    status: result.status,
    outcome: result.outcome ?? (result.status === 'completed' ? 'ANSWERED' : 'DEGRADED'),
    intent: request.managerIntent,
    answer: result.response,
    confidence: result.evidence.confidence,
    operatorsUsed: result.operatorInvocations ?? [],
    evidence: result.evidenceItems ?? [],
    conflicts: result.conflicts ?? [],
    missingData: result.evidence.missingData,
    decision: result.decision ?? null,
    createdAt: execution.createdAt,
  };
};

export class ManagerOrchestratorService {
  constructor(private readonly orchestrator = new OrchestratorService()) {}

  async query(input: ManagerQueryInput): Promise<ManagerQueryResult> {
    const normalized = normalizeInput(input);
    const managerIntent = classifyManagerIntent(normalized.message);
    const context = buildOrchestrationContext(normalized);
    const { execution } = await this.orchestrator.run({
      intent: normalized.message,
      managerIntent,
      projectId: normalized.projectId,
      conversationId: normalized.conversationId,
      idempotencyKey: normalized.requestId,
      context,
    });
    return asManagerResult(execution);
  }

  async listHistory(filters: { projectId?: string | null; conversationId?: string | null; limit?: number } = {}) {
    const limit = filters.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new OrchestrationValidationError('limit must be an integer from 1 to 50');
    }
    const rows = await this.orchestrator.listRecent({
      projectId: filters.projectId,
      conversationId: filters.conversationId,
      limit: 50,
    });
    return rows.filter((execution) => Boolean((execution.request as unknown as OrchestrationRequest).managerIntent))
      .slice(0, limit)
      .map(asManagerResult);
  }

  async getHistory(id: string): Promise<ManagerQueryResult> {
    return asManagerResult(await this.orchestrator.getExecution(id));
  }

  async getDiagnostics(id: string) {
    const execution = await this.orchestrator.getExecution(id);
    const result = asManagerResult(execution);
    return {
      correlationId: result.correlationId,
      intent: result.intent,
      status: result.status,
      outcome: result.outcome,
      confidence: result.confidence,
      operators: result.operatorsUsed,
      conflicts: result.conflicts,
      missingData: result.missingData,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    };
  }
}
