import { createDashboard } from './src/dashboard.js';
import { createApiClient } from './src/api/client.js';

const dashboardRoot = document.querySelector('#dashboardRoot');
const apiBaseUrl = 'http://localhost:3000';
const api = createApiClient(apiBaseUrl);

createDashboard({
  root: dashboardRoot,
  apiBaseUrl,
  api,
});
