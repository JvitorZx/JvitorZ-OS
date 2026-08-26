import { analyticsModule } from './analytics.js';
import { channelModule } from './channel.js';
import { operatorsModule } from './operators.js';
import { plannerModule } from './planner.js';
import { settingsModule } from './settings.js';
import { supervisorModule } from './supervisor.js';
import { managerModule } from './manager.js';

export const dashboardModules = [
  channelModule,
  analyticsModule,
  operatorsModule,
  plannerModule,
  managerModule,
  supervisorModule,
  settingsModule,
];
