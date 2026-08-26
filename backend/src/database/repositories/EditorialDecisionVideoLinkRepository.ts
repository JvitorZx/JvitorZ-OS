import type { EditorialDecisionVideoLink, Prisma, PrismaClient } from '@prisma/client';

export interface CreateEditorialDecisionVideoLinkData {
  decisionId: string;
  sourceSnapshotId: string;
  videoId: string;
  origin: string;
  notes: string | null;
}

export type EditorialDecisionVideoLinkWithDetails = Prisma.EditorialDecisionVideoLinkGetPayload<{
  include: {
    sourceSnapshot: true;
    outcomes: { orderBy: [{ evaluatedAt: 'desc' }, { id: 'asc' }] };
  };
}>;

const details = {
  sourceSnapshot: true,
  outcomes: { orderBy: [{ evaluatedAt: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.EditorialDecisionVideoLinkInclude;

export class EditorialDecisionVideoLinkRepository {
  private readonly delegate: PrismaClient['editorialDecisionVideoLink'];

  constructor(client: PrismaClient) {
    this.delegate = client.editorialDecisionVideoLink;
  }

  async create(data: CreateEditorialDecisionVideoLinkData): Promise<EditorialDecisionVideoLink> {
    return this.delegate.create({ data });
  }

  async findById(id: string): Promise<EditorialDecisionVideoLinkWithDetails | null> {
    return this.delegate.findUnique({ where: { id }, include: details });
  }

  async findByDecisionAndVideo(
    decisionId: string,
    videoId: string,
  ): Promise<EditorialDecisionVideoLinkWithDetails | null> {
    return this.delegate.findUnique({
      where: { decisionId_videoId: { decisionId, videoId } },
      include: details,
    });
  }

  async findByDecision(decisionId: string): Promise<EditorialDecisionVideoLinkWithDetails[]> {
    return this.delegate.findMany({
      where: { decisionId },
      include: details,
      orderBy: [{ linkedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async findByVideoId(videoId: string): Promise<EditorialDecisionVideoLinkWithDetails[]> {
    return this.delegate.findMany({
      where: { videoId },
      include: details,
      orderBy: [{ linkedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async delete(id: string): Promise<EditorialDecisionVideoLink> {
    return this.delegate.delete({ where: { id } });
  }
}
