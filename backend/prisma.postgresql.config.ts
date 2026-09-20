import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.postgresql.prisma',
  datasource: {
    url: env('POSTGRES_DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations-postgresql',
  },
});
