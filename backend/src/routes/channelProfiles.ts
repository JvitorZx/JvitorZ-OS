import { Router } from 'express';
import {
  ChannelProfileConflictError,
  ChannelProfileNotFoundError,
  ChannelProfileService,
  ChannelProfileValidationError,
} from '../services/ChannelProfileService';
import { ChannelDataService } from '../services/ChannelDataService';
import { ChannelProfileSession } from '../services/ChannelProfileSession';

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every((key) => fields.includes(key));

const sendError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof ChannelProfileValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ChannelProfileNotFoundError) return res.status(404).json({ error: 'Channel profile not found' });
  if (error instanceof ChannelProfileConflictError) return res.status(409).json({ error: 'The YouTube channel is already associated with another profile' });
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Channel profile request failed (${name})`);
  return res.status(500).json({ error: 'Channel profile request failed' });
};

export const createChannelProfilesRouter = (
  service: Pick<ChannelProfileService, 'list' | 'getActive' | 'create' | 'activate' | 'adoptLegacyWorkspaceData'> = new ChannelProfileService(undefined, undefined, new ChannelProfileSession()),
  channelData: Pick<ChannelDataService, 'connectActiveProfile'> = new ChannelDataService(),
): Router => {
  const router = Router();

  router.get('/', async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Invalid channel profile query' });
    try {
      const [profiles, active] = await Promise.all([service.list(), service.getActive()]);
      return res.status(200).json({ profiles, activeProfileId: active?.id ?? null });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/', async (req, res) => {
    if (!isObject(req.body) || !only(req.body, ['displayName', 'projectId']) || typeof req.body.displayName !== 'string'
      || (req.body.projectId !== undefined && req.body.projectId !== null && typeof req.body.projectId !== 'string')) {
      return res.status(400).json({ error: 'Invalid channel profile payload' });
    }
    try {
      return res.status(201).json(await service.create({
        displayName: req.body.displayName,
        ...(req.body.projectId !== undefined ? { projectId: req.body.projectId } : {}),
      }));
    }
    catch (error) { return sendError(res, error); }
  });

  router.post('/:id/activate', async (req, res) => {
    if (!req.params.id?.trim() || !isObject(req.body) || Object.keys(req.body).length) {
      return res.status(400).json({ error: 'Invalid channel profile activation request' });
    }
    try { return res.status(200).json(await service.activate(req.params.id)); }
    catch (error) { return sendError(res, error); }
  });

  router.post('/:id/connect', async (req, res) => {
    if (!req.params.id?.trim() || !isObject(req.body) || Object.keys(req.body).length) {
      return res.status(400).json({ error: 'Invalid channel profile connection request' });
    }
    try {
      const active = await service.getActive();
      if (!active || active.id !== req.params.id) throw new ChannelProfileConflictError('profile must be active before connecting');
      return res.status(200).json(await channelData.connectActiveProfile());
    } catch (error) { return sendError(res, error); }
  });

  router.post('/:id/adopt-legacy-data', async (req, res) => {
    if (!req.params.id?.trim() || !isObject(req.body) || Object.keys(req.body).length) {
      return res.status(400).json({ error: 'Invalid legacy data adoption request' });
    }
    try {
      const active = await service.getActive();
      if (!active || active.id !== req.params.id) throw new ChannelProfileConflictError('profile must be active before adopting legacy data');
      return res.status(200).json(await service.adoptLegacyWorkspaceData(req.params.id));
    } catch (error) { return sendError(res, error); }
  });

  return router;
};

export default createChannelProfilesRouter();
