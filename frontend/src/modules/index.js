import { analyticsModule } from './analytics.js';
import { channelModule } from './channel.js';
import { operatorsModule } from './operators.js';
import { settingsModule } from './settings.js';
import { supervisorModule } from './supervisor.js';

export const dashboardModules = [
  channelModule,
  analyticsModule,
  operatorsModule,
  supervisorModule,
  settingsModule,
];
