import type { AutomationGovernancePolicy, Prisma, PrismaClient } from '@prisma/client';

export class AutomationGovernanceRepository {
  constructor(private readonly client: PrismaClient) {}

  findByAutomationId(automationId: string): Promise<AutomationGovernancePolicy | null> {
    return this.client.automationGovernancePolicy.findUnique({ where: { automationId } });
  }

  upsert(automationId: string, data: Omit<Prisma.AutomationGovernancePolicyUncheckedCreateInput, 'automationId'>): Promise<AutomationGovernancePolicy> {
    return this.client.automationGovernancePolicy.upsert({ where: { automationId }, create: { automationId, ...data }, update: data });
  }
}
