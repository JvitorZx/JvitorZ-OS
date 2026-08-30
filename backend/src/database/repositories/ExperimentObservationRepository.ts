import type { Prisma, PrismaClient } from '@prisma/client';

export class ExperimentObservationRepository {
  constructor(private readonly client: PrismaClient) {}

  async findOutcome(id: string) {
    return this.client.planningOutcome.findUnique({ where: { id }, include: { snapshot: true, item: true, executionEvent: true } });
  }

  async findVariant(id: string) { return this.client.experimentVariant.findUnique({ where: { id } }); }

  async add(data: { experimentId: string; variantId: string; outcomeId: string; observedAt: Date; freshness: string; dataQuality: string; comparisonContext: unknown; metrics: unknown }) {
    const existing = await this.client.experimentObservation.findUnique({ where: { experimentId_outcomeId: { experimentId: data.experimentId, outcomeId: data.outcomeId } } });
    if (existing) return { observation: existing, created: false };
    const observation = await this.client.experimentObservation.create({ data: { ...data,
      comparisonContext: data.comparisonContext as Prisma.InputJsonValue, metrics: data.metrics as Prisma.InputJsonValue } });
    await this.client.experimentEvent.create({ data: { experimentId: data.experimentId, event: 'OBSERVATION_ADDED',
      reason: 'Outcome auditavel vinculado a uma variante.', data: { observationId: observation.id, outcomeId: data.outcomeId, variantId: data.variantId } } });
    return { observation, created: true };
  }

  async findByExperiment(experimentId: string) {
    return this.client.experimentObservation.findMany({ where: { experimentId }, include: { variant: true, outcome: true }, orderBy: [{ observedAt: 'asc' }, { id: 'asc' }] });
  }
}
