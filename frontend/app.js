import { createDashboard } from './src/dashboard.js';
import { initPlanner } from './src/modules/planner.js';

const dashboardRoot = document.querySelector('#dashboardRoot');

createDashboard({
  root: dashboardRoot,
  apiBaseUrl: 'http://localhost:3000',
  onModulesRendered: initPlanner,
});
