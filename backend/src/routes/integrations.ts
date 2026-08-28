import { Router } from 'express';
import { IntegrationStatusService } from '../services/IntegrationStatusService';

export const createIntegrationsRouter = (
  service: Pick<IntegrationStatusService, 'getAll'> = new IntegrationStatusService(),
): Router => {
  const router = Router();
  router.get('/status', async (_req, res) => {
    try {
      return res.status(200).json(await service.getAll());
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to read integration status (${name})`);
      return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Failed to read integration status' });
    }
  });
  return router;
};

export default createIntegrationsRouter();
