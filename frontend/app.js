import { createDashboard } from './src/dashboard.js';
import { createApiClient } from './src/api/client.js';
import { createPlannerController } from './src/modules/planner.js';

const dashboardRoot = document.querySelector('#dashboardRoot');
const apiBaseUrl = 'http://localhost:3000';
const api = createApiClient(apiBaseUrl);
const plannerController = createPlannerController({ api });

createDashboard({
  root: dashboardRoot,
  apiBaseUrl,
  api,
  onModulesRendered: plannerController.init,
});
