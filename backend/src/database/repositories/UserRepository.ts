import { PrismaClient, User } from '@prisma/client';
import { PrismaRepository } from './PrismaRepository';

export class UserRepository extends PrismaRepository<User> {
  constructor(client: PrismaClient) {
    super(client, client.user);
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    return this.delegate.create({ data });
  }
}
