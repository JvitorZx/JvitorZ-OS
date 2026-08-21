import { PrismaClient, Conversation, Prisma } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: { messages: true };
}>;

export class ConversationRepository extends PrismaRepository<Conversation> {
  constructor(client: PrismaClient) {
    super(client, client.conversation);
  }

  async create(data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt' | 'messages'>): Promise<Conversation> {
    return this.delegate.create({ data });
  }

  async findAll(): Promise<Conversation[]> {
    return this.delegate.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string): Promise<ConversationWithMessages | null> {
    return this.delegate.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
