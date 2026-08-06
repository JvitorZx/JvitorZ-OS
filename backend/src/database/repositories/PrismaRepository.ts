import { PrismaClient } from '@prisma/client';
import { BaseRepository } from './BaseRepository';

export abstract class PrismaRepository<T, K = string> implements BaseRepository<T, K> {
  protected client: PrismaClient;
  protected delegate: any;

  constructor(client: PrismaClient, delegate: any) {
    this.client = client;
    this.delegate = delegate;
  }

  async findById(id: K): Promise<T | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  async findAll(): Promise<T[]> {
    return this.delegate.findMany();
  }

  async create(item: T): Promise<T> {
    return this.delegate.create({ data: item });
  }

  async update(id: K, item: Partial<T>): Promise<T> {
    return this.delegate.update({ where: { id }, data: item });
  }

  async delete(id: K): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }
}
