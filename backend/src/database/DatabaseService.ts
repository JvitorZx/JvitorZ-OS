import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DEFAULT_DATABASE_URL = `file:${path.resolve(__dirname, '../../prisma/dev.db')}`;

export class DatabaseService {
  private static instance: PrismaClient | null = null;

  public static get client(): PrismaClient {
    if (!DatabaseService.instance) {
      const adapter = new PrismaBetterSqlite3(
        { url: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL },
        { timestampFormat: 'unixepoch-ms' },
      );

      DatabaseService.instance = new PrismaClient({ adapter });
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
