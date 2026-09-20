const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const prismaRoot = path.join(backendRoot, 'prisma', 'migrations-postgresql');
const supabaseRoot = path.join(backendRoot, 'supabase', 'migrations');

fs.mkdirSync(supabaseRoot, { recursive: true });

const expected = new Set();
for (const entry of fs.readdirSync(prismaRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = path.join(prismaRoot, entry.name, 'migration.sql');
  if (!fs.existsSync(source)) continue;

  const targetName = `${entry.name}.sql`;
  expected.add(targetName);
  fs.copyFileSync(source, path.join(supabaseRoot, targetName));
}

for (const entry of fs.readdirSync(supabaseRoot, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.sql') && !expected.has(entry.name)) {
    fs.unlinkSync(path.join(supabaseRoot, entry.name));
  }
}

console.log(`Supabase migrations synchronized: ${expected.size}.`);
