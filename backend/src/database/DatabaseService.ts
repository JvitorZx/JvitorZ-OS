import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as PostgresPrismaClient } from '../../generated/postgres-client';

const DEFAULT_DATABASE_URL = `file:${path.resolve(__dirname, '../../prisma/dev.db')}`;

const isPostgresUrl = (url: string): boolean => /^postgres(?:ql)?:\/\//i.test(url);

export const resolveDatabaseUrl = (environment: NodeJS.ProcessEnv = process.env): string => {
  const configuredUrl = environment.DATABASE_URL?.trim();
  const postgresUrl = environment.POSTGRES_DATABASE_URL?.trim();
  return configuredUrl
    || (environment.DATABASE_MODE === 'postgres' ? postgresUrl : undefined)
    || DEFAULT_DATABASE_URL;
};

export class DatabaseService {
  private static instance: PrismaClient | null = null;

  public static get client(): PrismaClient {
    if (!DatabaseService.instance) {
      const databaseUrl = resolveDatabaseUrl();

      if (isPostgresUrl(databaseUrl)) {
        const adapter = new PrismaPg(databaseUrl);
        DatabaseService.instance = new PostgresPrismaClient({ adapter }) as unknown as PrismaClient;
      } else {
        const adapter = new PrismaBetterSqlite3(
          { url: databaseUrl },
          { timestampFormat: 'unixepoch-ms' },
        );

        DatabaseService.instance = new PrismaClient({ adapter });
      }
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
