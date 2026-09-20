# Supabase PostgreSQL

The JvitorZ OS has a dedicated Supabase project in `sa-east-1`. It is isolated from the Publisher Agent database.

## Database modes

- SQLite remains the safe local and test default at `backend/prisma/dev.db`.
- The desktop launcher explicitly sets `DATABASE_MODE=postgres` and uses `POSTGRES_DATABASE_URL` from `backend/.env`.
- `backend/.env` is ignored by Git and must never be committed.
- `DATABASE_URL` can still override both modes for isolated tests or deployment environments.

## Prisma contracts

- `backend/prisma/schema.prisma`: SQLite contract used by local tests and as the data backup source.
- `backend/prisma/schema.postgresql.prisma`: PostgreSQL contract used by Supabase.
- `backend/prisma/migrations-postgresql`: canonical PostgreSQL migrations for Prisma.
- `backend/supabase/migrations`: synchronized SQL consumed by the Supabase GitHub integration.

Run `npm run supabase:sync-migrations` after adding a PostgreSQL migration. The synchronization script prevents a separate hand-maintained database contract.

## Safe deployment flow

1. Keep SQLite tests passing.
2. Validate both Prisma schemas.
3. Generate the PostgreSQL migration.
4. Synchronize Supabase migrations.
5. Apply migrations with `npm run prisma:deploy:postgres`.
6. Copy local data with `npm run data:migrate:postgres` only after taking a SQLite backup.
7. Verify row totals and run an application smoke test in PostgreSQL mode.

The migration utility runs inside one PostgreSQL transaction and verifies total row counts before commit. It never modifies the SQLite source.

## Security

The project uses server-side Prisma access. The Supabase Data API and automatic table exposure are disabled. Database passwords and connection strings stay only in environment configuration. The browser frontend must not receive a database URL or privileged key.
