const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260910120000_monitoring_control_plane/migration.sql'), 'utf8');

test('monitoring control migration installs one disabled persistent control safely', () => {
  const db = new Database(':memory:');
  try {
    db.exec(migration);
    const control = db.prepare('SELECT * FROM MonitoringControl').get();
    assert.equal(control.id, 'strategic-monitoring');
    assert.equal(control.enabled, 0);
    assert.equal(control.intervalMs, 21600000);
    assert.equal(control.operationalState, 'DISABLED');
    assert.equal(control.nextRunAt, null);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM MonitoringControl').get().count, 1);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
