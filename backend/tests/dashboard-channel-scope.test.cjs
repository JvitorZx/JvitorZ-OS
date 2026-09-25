const assert = require('node:assert/strict');
const { test } = require('node:test');

const { DashboardService } = require('../dist/services/DashboardService');

const integrationMap = {
  youtubeData: { state: 'CONNECTED' },
  openai: { state: 'CONNECTED' },
};

const createDashboard = (profile, calls) => new DashboardService(
  { getChannelSummary: async () => ({ integration: { state: 'CONNECTED', stale: false, summary: 'ok' }, subscribers: '1', videoCount: '1', viewCount: '1' }) },
  { getDashboardAnalytics: async () => ({}) },
  { getOperatorsStatus: async (projectId) => { calls.operators.push(projectId); return { availableOperators: [], limitedOperators: [], activeOperators: [], items: [] }; } },
  { getSupervisorOverview: async (projectId) => { calls.supervisor.push(projectId); return { youtubeAnalytics: {}, dataQuality: [] }; } },
  { getSettings: async () => ({}) },
  { getOperationalSummary: async () => ({ active: 0 }) },
  { getAll: async () => integrationMap },
  { getActive: async () => profile },
);

test('Dashboard forwards the active channel workspace to operational modules', async () => {
  const calls = { operators: [], supervisor: [] };
  await createDashboard({ id: 'games', projectId: 'project-games', usesLegacyWorkspaceData: false }, calls).getDashboard();
  assert.deepEqual(calls, { operators: ['project-games'], supervisor: ['project-games'] });
});

test('Dashboard keeps adopted legacy data scoped to its selected profile', async () => {
  const calls = { operators: [], supervisor: [] };
  await createDashboard({ id: 'games', projectId: null, usesLegacyWorkspaceData: true }, calls).getDashboard();
  assert.deepEqual(calls, { operators: [null], supervisor: [null] });
});

test('Dashboard never falls back to global data for an unprepared channel profile', async () => {
  const calls = { operators: [], supervisor: [] };
  await createDashboard({ id: 'music', projectId: null, usesLegacyWorkspaceData: false }, calls).getDashboard();
  assert.deepEqual(calls, {
    operators: ['__no-active-channel-workspace__'],
    supervisor: ['__no-active-channel-workspace__'],
  });
});
