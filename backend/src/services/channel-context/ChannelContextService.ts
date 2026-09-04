import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ChannelContextRepository, type CreateChannelContextData } from '../../database/repositories/ChannelContextRepository';
import { CHANNEL_CONTEXT_STATUSES, CHANNEL_CONTEXT_TYPES, type ChannelContextFilters, type ChannelContextStatus, type ChannelContextType } from '../../domains/channel-context';

export class ChannelContextError extends Error { constructor(message: string) { super(message); this.name = 'ChannelContextError'; } }
export class ChannelContextValidationError extends ChannelContextError { constructor(message: string) { super(message); this.name = 'ChannelContextValidationError'; } }
export class ChannelContextNotFoundError extends ChannelContextError { constructor() { super('Channel context entry not found'); this.name = 'ChannelContextNotFoundError'; } }
export class ChannelContextConflictError extends ChannelContextError { constructor(message: string) { super(message); this.name = 'ChannelContextConflictError'; } }

const text = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ChannelContextValidationError(`${field} is invalid`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max = 300): string | null => value == null || value === '' ? null : text(value, field, max);
const date = (value: unknown, field: string): Date | null => {
  if (value == null || value === '') return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(text(value, field, 40));
  if (Number.isNaN(parsed.getTime())) throw new ChannelContextValidationError(`${field} is invalid`);
  return parsed;
};
const confidence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new ChannelContextValidationError('confidence is invalid');
  return value;
};
const metadata = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChannelContextValidationError('metadata is invalid');
  return value as Prisma.InputJsonValue;
};

export interface CreateChannelContextInput {
  projectId?: string | null; channelId?: string | null; type: string; status?: string;
  category: string; subject: string; statement: string; confidence: number; source: string;
  sourceReference?: string | null; occurredAt?: string | Date | null; periodStart?: string | Date | null;
  periodEnd?: string | Date | null; entityType?: string | null; entityId?: string | null;
  game?: string | null; series?: string | null; format?: string | null; metadata?: unknown;
}

const validateType = (value: unknown): ChannelContextType => {
  if (typeof value !== 'string' || !CHANNEL_CONTEXT_TYPES.includes(value as ChannelContextType)) throw new ChannelContextValidationError('type is invalid');
  return value as ChannelContextType;
};
const validateStatus = (value: unknown): ChannelContextStatus => {
  if (typeof value !== 'string' || !CHANNEL_CONTEXT_STATUSES.includes(value as ChannelContextStatus)) throw new ChannelContextValidationError('status is invalid');
  return value as ChannelContextStatus;
};

export class ChannelContextService {
  constructor(private readonly repository = new ChannelContextRepository(DatabaseService.client)) {}

  private data(input: CreateChannelContextInput, stableKey = `manual:${randomUUID()}`): CreateChannelContextData {
    const periodStart = date(input.periodStart, 'periodStart');
    const periodEnd = date(input.periodEnd, 'periodEnd');
    if (periodStart && periodEnd && periodStart > periodEnd) throw new ChannelContextValidationError('period is invalid');
    const entityType = optionalText(input.entityType, 'entityType', 80);
    const entityId = optionalText(input.entityId, 'entityId', 160);
    if (Boolean(entityType) !== Boolean(entityId)) throw new ChannelContextValidationError('entityType and entityId must be provided together');
    const status = validateStatus(input.status ?? 'ACTIVE');
    if (status === 'SUPERSEDED') throw new ChannelContextValidationError('SUPERSEDED status requires the supersession operation');
    return {
      stableKey, projectId: optionalText(input.projectId, 'projectId', 160), channelId: optionalText(input.channelId, 'channelId', 160),
      type: validateType(input.type), status, category: text(input.category, 'category', 80),
      subject: text(input.subject, 'subject', 160), statement: text(input.statement, 'statement', 4_000), confidence: confidence(input.confidence),
      source: text(input.source, 'source', 160), sourceReference: optionalText(input.sourceReference, 'sourceReference', 300),
      occurredAt: date(input.occurredAt, 'occurredAt'), periodStart, periodEnd, entityType, entityId,
      game: optionalText(input.game, 'game', 160), series: optionalText(input.series, 'series', 160), format: optionalText(input.format, 'format', 80),
      metadata: metadata(input.metadata),
    };
  }

  create(input: CreateChannelContextInput) { return this.repository.create(this.data(input)); }

  async list(filters: ChannelContextFilters = {}) {
    if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 200)) throw new ChannelContextValidationError('limit is invalid');
    return this.repository.findAll(filters);
  }

  async get(id: string) {
    const entry = await this.repository.findById(text(id, 'id', 160));
    if (!entry) throw new ChannelContextNotFoundError();
    return entry;
  }

  async update(id: string, input: Partial<Pick<CreateChannelContextInput, 'status' | 'statement' | 'confidence' | 'occurredAt' | 'periodStart' | 'periodEnd' | 'metadata'>>) {
    const existing = await this.get(id);
    if (existing.status === 'SUPERSEDED') throw new ChannelContextConflictError('Superseded context cannot be updated');
    const data: Prisma.ChannelContextEntryUncheckedUpdateInput = {};
    if (input.status !== undefined) {
      const nextStatus = validateStatus(input.status);
      if (nextStatus === 'SUPERSEDED') throw new ChannelContextValidationError('SUPERSEDED status requires the supersession operation');
      data.status = nextStatus;
    }
    if (input.statement !== undefined) data.statement = text(input.statement, 'statement', 4_000);
    if (input.confidence !== undefined) data.confidence = confidence(input.confidence);
    if (input.occurredAt !== undefined) data.occurredAt = date(input.occurredAt, 'occurredAt');
    if (input.periodStart !== undefined) data.periodStart = date(input.periodStart, 'periodStart');
    if (input.periodEnd !== undefined) data.periodEnd = date(input.periodEnd, 'periodEnd');
    const nextStart = data.periodStart instanceof Date ? data.periodStart : existing.periodStart;
    const nextEnd = data.periodEnd instanceof Date ? data.periodEnd : existing.periodEnd;
    if (nextStart && nextEnd && nextStart > nextEnd) throw new ChannelContextValidationError('period is invalid');
    if (input.metadata !== undefined) data.metadata = metadata(input.metadata) ?? Prisma.JsonNull;
    return this.repository.update(existing.id, data);
  }

  async supersede(id: string, input: CreateChannelContextInput) {
    const previous = await this.get(id);
    if (previous.status === 'SUPERSEDED' || previous.supersededBy) throw new ChannelContextConflictError('Context is already superseded');
    const replacement = this.data({ ...input, projectId: input.projectId ?? previous.projectId, channelId: input.channelId ?? previous.channelId }, `supersession:${previous.id}:${randomUUID()}`);
    const result = await this.repository.supersede(previous.id, replacement);
    if (!result) throw new ChannelContextNotFoundError();
    return result;
  }

  async relate(id: string, input: { relation: unknown; entityType: unknown; entityId: unknown }) {
    const entry = await this.get(id);
    await this.repository.relate(entry.id, text(input.relation, 'relation', 80), text(input.entityType, 'entityType', 80), text(input.entityId, 'entityId', 160));
    return this.get(entry.id);
  }

  createBootstrap(stableKey: string, input: CreateChannelContextInput) {
    return this.repository.createBootstrap(this.data(input, text(stableKey, 'stableKey', 240)));
  }
}
