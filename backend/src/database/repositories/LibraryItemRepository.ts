import { LibraryItem, PrismaClient } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type CreateLibraryItemData = Pick<LibraryItem, 'title'> &
  Partial<Pick<LibraryItem, 'projectId' | 'sourceMessageId' | 'type' | 'content'>>;

export class LibraryItemRepository extends PrismaRepository<LibraryItem> {
  constructor(client: PrismaClient) {
    super(client, client.libraryItem);
  }

  async create(data: CreateLibraryItemData): Promise<LibraryItem> {
    return this.delegate.create({ data });
  }

  async findAll(): Promise<LibraryItem[]> {
    return this.delegate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findById(id: string): Promise<LibraryItem | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  async findBySourceMessageId(sourceMessageId: string): Promise<LibraryItem | null> {
    return this.delegate.findUnique({ where: { sourceMessageId } });
  }
}
