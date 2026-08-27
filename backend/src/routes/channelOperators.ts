import { Router } from 'express';
import { ChannelOperatorNotFoundError, ChannelOperatorService } from '../services/channel-operators';

const validProjectId = (value: unknown) => value === undefined || (typeof value === 'string' && value.trim().length > 0 && value.length <= 120);

export const createChannelOperatorsRouter = (service = new ChannelOperatorService()): Router => {
  const router = Router();

  router.get('/', async (req, res) => {
    if (!validProjectId(req.query.projectId) || Object.keys(req.query).some((key) => key !== 'projectId')) {
      return res.status(400).json({ error: 'invalid channel operator query' });
    }
    try { return res.status(200).json(await service.list(req.query.projectId as string | undefined)); }
    catch (error) { const name = error instanceof Error ? error.name : 'UnknownError'; console.error(`Channel operators failed (${name})`); return res.status(500).json({ error: 'Channel operators failed' }); }
  });

  router.get('/:id', async (req, res) => {
    if (!req.params.id?.trim() || !validProjectId(req.query.projectId) || Object.keys(req.query).some((key) => key !== 'projectId')) {
      return res.status(400).json({ error: 'invalid channel operator request' });
    }
    try { return res.status(200).json(await service.run(req.params.id.trim(), req.query.projectId as string | undefined)); }
    catch (error) {
      if (error instanceof ChannelOperatorNotFoundError) return res.status(404).json({ error: error.message });
      const name = error instanceof Error ? error.name : 'UnknownError'; console.error(`Channel operator failed (${name})`); return res.status(500).json({ error: 'Channel operator failed' });
    }
  });

  return router;
};

export default createChannelOperatorsRouter();
