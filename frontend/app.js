import { createDashboard } from './src/dashboard.js';

createDashboard({
  root: document.querySelector('#dashboardRoot'),
  apiBaseUrl: 'http://localhost:3000',
});
