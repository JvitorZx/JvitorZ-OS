import { analyticsModule } from './analytics.js';
import { channelModule } from './channel.js';
import { operatorsModule } from './operators.js';
import { plannerModule } from './planner.js';
import { settingsModule } from './settings.js';
import { supervisorModule } from './supervisor.js';
import { managerModule } from './manager.js';
import { automationsModule } from './automations.js';
import { homeModule } from './home.js';
import { libraryModule } from './library.js';
import { researchModule } from './research.js';
import { strategicPlanningModule } from './strategic-planning.js';
import { monitoringModule } from './monitoring.js';
import { channelContextModule } from './channel-context.js';
import { packagingModule } from './packaging.js';
import { productionModule } from './production.js';

export const dashboardModules = [
  homeModule,
  channelModule,
  analyticsModule,
  plannerModule,
  strategicPlanningModule,
  monitoringModule,
  channelContextModule,
  packagingModule,
  productionModule,
  libraryModule,
  researchModule,
  managerModule,
  supervisorModule,
  automationsModule,
  operatorsModule,
  settingsModule,
];
