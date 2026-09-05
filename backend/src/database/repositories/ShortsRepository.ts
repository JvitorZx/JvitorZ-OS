import { Prisma, type PrismaClient } from '@prisma/client';

export const invalidateShortsSource = async (transaction: Prisma.TransactionClient, productionId: string, reason: string) => {
  const invalidated = await transaction.shortAnalysis.updateMany({ where: { productionId, status: 'CURRENT' }, data: { status: 'STALE' } });
  if (!invalidated.count) return;
  const now = new Date();
  await transaction.productionStep.updateMany({ where: { productionId, key: { in: ['SHORTS', 'REVIEW'] }, state: { in: ['AVAILABLE', 'COMPLETED', 'IN_PROGRESS', 'WAITING_USER'] } }, data: { state: 'OUTDATED', completedAt: null, invalidatedAt: now, output: Prisma.DbNull } });
  await transaction.contentProduction.updateMany({ where: { id: productionId, status: { in: ['READY_TO_PUBLISH', 'IN_REVIEW'] } }, data: { status: 'IN_PRODUCTION', currentStage: 'SHORTS' } });
  await transaction.productionEvent.create({ data: { productionId, stepKey: 'SHORTS', event: 'SHORTS_INVALIDATED', actor: 'system', origin: 'production', reason } });
};

export const shortAnalysisDetails = { candidates: { orderBy: [{ score: 'desc' as const }, { startMs: 'asc' as const }, { id: 'asc' as const }] }, revisions: { orderBy: [{ createdAt: 'desc' as const }] } } satisfies Prisma.ShortAnalysisInclude;
export type ShortAnalysisDetails = Prisma.ShortAnalysisGetPayload<{ include: typeof shortAnalysisDetails }>;

export class ShortsRepository {
  constructor(readonly client: PrismaClient) {}

  // The first statement acquires SQLite's write lock before any version/source read.
  // Database constraints additionally allow only one CURRENT analysis per production.
  async transaction<T>(productionId: string, work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.$transaction(async (transaction) => {
          await transaction.$executeRaw`UPDATE ContentProduction SET version = version WHERE id = ${productionId}`;
          return work(transaction);
        }, { maxWait: 10000, timeout: 20000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (attempt >= 3 || !/SQLITE_BUSY|database is locked|P2034|write conflict/i.test(message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }
  findAnalysis(id: string) { return this.client.shortAnalysis.findUnique({ where: { id }, include: shortAnalysisDetails }); }
  findCandidate(id: string) { return this.client.clipCandidate.findUnique({ where: { id }, include: { analysis: true } }); }
}
