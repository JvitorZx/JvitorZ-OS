import { PrismaClient } from '@prisma/client';
import { DatabaseService } from './DatabaseService';

export type PrismaClientInstance = PrismaClient;

export const createDatabaseConnection = async (): Promise<PrismaClient> => {
  return DatabaseService.connect();
};

export const closeDatabaseConnection = async (): Promise<void> => {
  await DatabaseService.disconnect();
};
