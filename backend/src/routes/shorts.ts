import { Router, type Response } from 'express';
import { ShortsService, ShortsValidationError, ShortsConflictError, ShortsNotFoundError } from '../services/shorts';
import { ProductionNotFoundError } from '../services/production';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const errorResponse = (res: Response, error: unknown) => {
  if (error instanceof ShortsValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ShortsNotFoundError || error instanceof ProductionNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ShortsConflictError) return res.status(409).json({ error: error.message, ...(/Timed transcript is required/.test(error.message) ? { code: 'NO_DATA' } : {}) });
  console.error(`Shorts request failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  return res.status(500).json({ error: 'Shorts request failed' });
};
export const createShortsRouter = (service = new ShortsService()) => {
  const router = Router();
  router.get('/productions/:id', async (req, res) => { try { return res.json(await service.list(req.params.id)); } catch (error) { return errorResponse(res, error); } });
  router.get('/productions/:id/selected', async (req, res) => { try { return res.json(await service.selected(req.params.id)); } catch (error) { return errorResponse(res, error); } });
  router.get('/productions/:id/render-contract', async (req, res) => { try { return res.json(await service.renderContract(req.params.id)); } catch (error) { return errorResponse(res, error); } });
  for (const action of ['analyze', 'regenerate']) router.post(`/productions/:id/${action}`, async (req, res) => {
    if (!object(req.body)) return res.status(400).json({ error: 'payload is invalid' });
    try { const result = await service.analyze(req.params.id, req.body, action === 'regenerate'); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return errorResponse(res, error); }
  });
  router.get('/analyses/:id', async (req, res) => { try { return res.json(await service.getAnalysis(req.params.id)); } catch (error) { return errorResponse(res, error); } });
  router.get('/candidates/:id', async (req, res) => { try { return res.json(await service.getCandidate(req.params.id)); } catch (error) { return errorResponse(res, error); } });
  router.get('/candidates/:id/evidence', async (req, res) => { try { return res.json(await service.evidence(req.params.id)); } catch (error) { return errorResponse(res, error); } });
  router.patch('/candidates/:id', async (req, res) => { if (!object(req.body)) return res.status(400).json({ error: 'payload is invalid' }); try { return res.json(await service.editCandidate(req.params.id, req.body)); } catch (error) { return errorResponse(res, error); } });
  router.post('/analyses/:id/candidates', async (req, res) => { if (!object(req.body)) return res.status(400).json({ error: 'payload is invalid' }); try { return res.status(201).json(await service.createManual(req.params.id, req.body)); } catch (error) { return errorResponse(res, error); } });
  for (const [action, status] of Object.entries({ shortlist: 'SHORTLISTED', select: 'SELECTED', reject: 'REJECTED', archive: 'ARCHIVED' })) router.post(`/candidates/:id/${action}`, async (req, res) => {
    if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.json(await service.setStatus(req.params.id, status)); } catch (error) { return errorResponse(res, error); }
  });
  for (const action of ['review', 'complete'] as const) router.post(`/analyses/:id/${action}`, async (req, res) => {
    if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.json(await service[action](req.params.id)); } catch (error) { return errorResponse(res, error); }
  });
  return router;
};
export default createShortsRouter();
