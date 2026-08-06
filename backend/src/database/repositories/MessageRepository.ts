import { PrismaClient, Message } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export class MessageRepository extends PrismaRepository<Message> {
  constructor(client: PrismaClient) {
    super(client, client.message);
  }

  async create(data: Omit<Message, 'id' | 'createdAt' | 'conversation'>): Promise<Message> {
    return this.delegate.create({ data });
  }

  async findByConversation(conversationId: string): Promise<Message[]> {
    return this.delegate.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}