import {
  ConversationLibraryItem,
  Prisma,
  PrismaClient,
} from '@prisma/client';

export type ConversationLibraryItemWithItem = Prisma.ConversationLibraryItemGetPayload<{
  include: { libraryItem: true };
}>;

export interface CreateConversationLibraryItemWithinLimitResult {
  link: ConversationLibraryItemWithItem;
  created: boolean;
}

export class ConversationLibraryItemRepository {
  private readonly client: PrismaClient;
  private readonly delegate: PrismaClient['conversationLibraryItem'];

  constructor(client: PrismaClient) {
    this.client = client;
    this.delegate = client.conversationLibraryItem;
  }

  async create(conversationId: string, libraryItemId: string): Promise<ConversationLibraryItem> {
    return this.delegate.create({
      data: { conversationId, libraryItemId },
    });
  }

  async findByConversationId(
    conversationId: string,
  ): Promise<ConversationLibraryItemWithItem[]> {
    return this.delegate.findMany({
      where: { conversationId },
      include: { libraryItem: true },
      orderBy: [{ createdAt: 'asc' }, { libraryItemId: 'asc' }],
    });
  }

  async findByConversationAndLibraryItem(
    conversationId: string,
    libraryItemId: string,
  ): Promise<ConversationLibraryItemWithItem | null> {
    return this.delegate.findUnique({
      where: {
        conversationId_libraryItemId: { conversationId, libraryItemId },
      },
      include: { libraryItem: true },
    });
  }

  async deleteLink(conversationId: string, libraryItemId: string): Promise<boolean> {
    const result = await this.delegate.deleteMany({
      where: { conversationId, libraryItemId },
    });
    return result.count > 0;
  }

  async countByConversationId(conversationId: string): Promise<number> {
    return this.delegate.count({ where: { conversationId } });
  }

  async createWithinLimit(
    conversationId: string,
    libraryItemId: string,
    limit: number,
  ): Promise<CreateConversationLibraryItemWithinLimitResult | null> {
    const createdAt = Date.now();
    // A single write statement makes the count and insertion atomic under SQLite's writer lock.
    const insertedRows = await this.client.$executeRaw`
      INSERT INTO "ConversationLibraryItem" ("conversationId", "libraryItemId", "createdAt")
      SELECT ${conversationId}, ${libraryItemId}, ${createdAt}
      WHERE (
        SELECT COUNT(*)
        FROM "ConversationLibraryItem"
        WHERE "conversationId" = ${conversationId}
      ) < ${limit}
      ON CONFLICT ("conversationId", "libraryItemId") DO NOTHING
    `;

    const link = await this.findByConversationAndLibraryItem(conversationId, libraryItemId);
    if (!link) return null;

    return { link, created: insertedRows === 1 };
  }
}
