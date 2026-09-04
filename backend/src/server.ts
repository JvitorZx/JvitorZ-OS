import { loadEnv } from './core/config/loadEnv';
import app from './app';
import { automationRuntime, readAutomationRuntimeConfig } from './services/automation/AutomationRuntimeService';
import { DatabaseService } from './database/DatabaseService';
import { MonitoringControlService } from './services/strategic-monitoring';
import { ChannelContextBootstrap } from './services/channel-context';

loadEnv();

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST?.trim() || '127.0.0.1';

const server = app.listen(port, host, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;

  console.log(`JvitorZ OS backend running at http://${host}:${listeningPort}`);
  void new ChannelContextBootstrap().run()
    .then(({ created, existing }) => console.log(`Channel context bootstrap ready (${created} created, ${existing} existing)`))
    .catch((error) => console.error(`Channel context bootstrap failed (${error instanceof Error ? error.name : 'UnknownError'})`));
  const monitoringControl = new MonitoringControlService(
    undefined, undefined, undefined, undefined, () => automationRuntime.getHealth(),
  );
  void monitoringControl.reconcile()
    .then(async () => {
      if (readAutomationRuntimeConfig().enabled) await automationRuntime.start();
    })
    .catch((error) => {
      console.error(`Operational runtime startup failed (${error instanceof Error ? error.name : 'UnknownError'})`);
    });
});

let shuttingDown = false;
export const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  await automationRuntime.stop().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await DatabaseService.disconnect();
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void shutdown().finally(() => process.exit(0)); });
}

export default server;
