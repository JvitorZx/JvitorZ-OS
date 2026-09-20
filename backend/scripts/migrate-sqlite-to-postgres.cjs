const path = require('node:path');
const Database = require('better-sqlite3');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const sqlitePath = process.env.SQLITE_DATABASE_PATH
  ? path.resolve(process.env.SQLITE_DATABASE_PATH)
  : path.resolve(__dirname, '../prisma/dev.db');
const postgresUrl = process.env.POSTGRES_DATABASE_URL?.trim();

if (!postgresUrl) {
  throw new Error('POSTGRES_DATABASE_URL is required.');
}

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const convertValue = (value, dataType) => {
  if (value === null || value === undefined) return null;

  if (dataType === 'boolean') return Boolean(value);
  if (dataType.includes('timestamp') || dataType === 'date') {
    const parsed = typeof value === 'number' ? new Date(value) : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid persisted date value for PostgreSQL ${dataType}.`);
    }
    return parsed;
  }
  if (dataType === 'json' || dataType === 'jsonb') {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return JSON.stringify(parsed);
  }

  return value;
};

const loadPostgresColumns = async (client) => {
  const result = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY ordinal_position
  `);
  const columns = new Map();
  for (const row of result.rows) {
    const table = columns.get(row.table_name) ?? new Map();
    table.set(row.column_name, row.data_type);
    columns.set(row.table_name, table);
  }
  return columns;
};

const main = async () => {
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const postgres = new Client({ connectionString: postgresUrl });
  await postgres.connect();

  try {
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('SQLite integrity_check failed.');

    const tables = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
      ORDER BY name
    `).all().map(({ name }) => name);

    const postgresColumns = await loadPostgresColumns(postgres);
    const pending = [];
    let sourceRows = 0;

    for (const tableName of tables) {
      const targetColumns = postgresColumns.get(tableName);
      if (!targetColumns) throw new Error(`Target table is missing: ${tableName}`);

      const rows = sqlite.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all();
      sourceRows += rows.length;
      for (const row of rows) pending.push({ tableName, targetColumns, row });
    }

    await postgres.query('BEGIN');
    let insertedRows = 0;

    while (pending.length > 0) {
      let progress = 0;
      const deferred = [];

      for (const entry of pending) {
        const columnNames = Object.keys(entry.row).filter((name) => entry.targetColumns.has(name));
        const values = columnNames.map((name) => convertValue(entry.row[name], entry.targetColumns.get(name)));
        const placeholders = columnNames.map((_, index) => `$${index + 1}`).join(', ');
        const sql = `INSERT INTO ${quoteIdentifier(entry.tableName)} (${columnNames.map(quoteIdentifier).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        try {
          await postgres.query('SAVEPOINT migrate_row');
          const result = await postgres.query(sql, values);
          await postgres.query('RELEASE SAVEPOINT migrate_row');
          insertedRows += result.rowCount ?? 0;
          progress += 1;
        } catch (error) {
          await postgres.query('ROLLBACK TO SAVEPOINT migrate_row');
          await postgres.query('RELEASE SAVEPOINT migrate_row');
          if (error && error.code === '23503') {
            deferred.push(entry);
            continue;
          }
          const safeError = new Error(`Insert failed for ${entry.tableName} (${error?.code || 'Error'}).`);
          safeError.code = error?.code;
          throw safeError;
        }
      }

      if (deferred.length > 0 && progress === 0) {
        const blockedTables = [...new Set(deferred.map(({ tableName }) => tableName))].join(', ');
        throw new Error(`Unresolved foreign-key dependencies: ${blockedTables}`);
      }

      pending.length = 0;
      pending.push(...deferred);
    }

    let targetRows = 0;
    for (const tableName of tables) {
      const result = await postgres.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(tableName)}`);
      targetRows += result.rows[0].count;
    }

    if (targetRows !== sourceRows) {
      throw new Error(`Row verification failed: SQLite=${sourceRows}, PostgreSQL=${targetRows}.`);
    }

    await postgres.query('COMMIT');
    console.log(`Migration completed: ${tables.length} tables, ${sourceRows} rows verified, ${insertedRows} inserted.`);
  } catch (error) {
    await postgres.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    sqlite.close();
    await postgres.end();
  }
};

main().catch((error) => {
  console.error(`Migration failed (${error?.code || error?.name || 'Error'}): ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
});
