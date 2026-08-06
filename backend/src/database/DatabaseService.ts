import { PrismaClient } from '@prisma/client';

export class DatabaseService {
  private static instance: PrismaClient | null = null;

  public static get client(): PrismaClient {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new PrismaClient();
    }

    return DatabaseService.instance;
  }

  public static async connect(): Promise<PrismaClient> {
    const client = DatabaseService.client;
    await client.$connect();
    return client;
  }

  public static async disconnect(): Promise<void> {
    if (DatabaseService.instance) {
      await DatabaseService.instance.$disconnect();
      DatabaseService.instance = null;
    }
  }
}
