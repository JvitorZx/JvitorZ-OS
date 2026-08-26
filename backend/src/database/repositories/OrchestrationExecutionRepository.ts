import type { OrchestrationExecution, Prisma, PrismaClient } from '@prisma/client';

export interface CreateOrchestrationExecutionData {
  projectId: string | null;
  conversationId: string | null;
  idempotencyKey: string | null;
  intent: string;
  objective: string;
  capabilities: Prisma.InputJsonValue;
  request: Prisma.InputJsonValue;
  plan: Prisma.InputJsonValue;
  failures: Prisma.InputJsonValue;
}

export class OrchestrationExecutionRepository {
  private readonly delegate: PrismaClient['orchestrationExecution'];

  constructor(client: PrismaClient) {
    this.delegate = client.orchestrationExecution;
  }

  async create(data: CreateOrchestrationExecutionData): Promise<OrchestrationExecution> {
    return this.delegate.create({ data });
  }

  async findById(id: string): Promise<OrchestrationExecution | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OrchestrationExecution | null> {
    return this.delegate.findUnique({ where: { idempotencyKey } });
  }

  async markRunning(id: string): Promise<OrchestrationExecution> {
    return this.delegate.update({ where: { id }, data: { status: 'running' } });
  }

  async tryMarkRunning(id: string): Promise<boolean> {
    const result = await this.delegate.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'running' },
    });
    return result.count === 1;
  }

  async complete(id: string, data: {
    status: 'completed' | 'partial' | 'failed';
    result: Prisma.InputJsonValue;
    evidence: Prisma.InputJsonValue;
    failures: Prisma.InputJsonValue;
    errorType?: string | null;
  }): Promise<OrchestrationExecution> {
    return this.delegate.update({
      where: { id },
      data: { ...data, completedAt: new Date() },
    });
  }

  async findRecent(filters: {
    projectId?: string | null;
    conversationId?: string | null;
    limit?: number;
  } = {}): Promise<OrchestrationExecution[]> {
    const where: Prisma.OrchestrationExecutionWhereInput = {};
    if ('projectId' in filters) where.projectId = filters.projectId;
    if ('conversationId' in filters) where.conversationId = filters.conversationId;
    return this.delegate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: filters.limit ?? 20,
    });
  }
}
