import { createDashboard } from './src/dashboard.js';
import { initPlanner } from './src/modules/planner.js';

createDashboard({
  root: document.querySelector('#dashboardRoot'),
  apiBaseUrl: 'http://localhost:3000',
});

// Observe DOM to initialize planner interactive behavior when its panel is rendered
const observer = new MutationObserver(() => {
  const plannerPanel = document.querySelector('.planner-panel');
  if (plannerPanel) {
    initPlanner(document);
  }
});

observer.observe(document.body, { childList: true, subtree: true });
