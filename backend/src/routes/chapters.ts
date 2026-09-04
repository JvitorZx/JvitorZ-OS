import { Router } from 'express';
import { ChaptersConflictError, ChaptersNotFoundError, ChaptersService, ChaptersValidationError } from '../services/chapters';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value: Record<string, unknown>, fields: readonly string[]): boolean => Object.keys(value).every((key) => fields.includes(key));
const IMPORT_FIELDS = ['productionId', 'format', 'content', 'segments', 'source', 'language', 'videoId', 'durationMs'] as const;

const safeError = (res: Parameters<Parameters<Router['get']>[1]>[1], error: unknown) => {
  if (error instanceof ChaptersValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof ChaptersNotFoundError) return res.status(404).json({ error: error.message });
  if (error instanceof ChaptersConflictError) return res.status(409).json({ error: error.message });
  console.error(`Chapters request failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  return res.status(500).json({ error: 'Chapters request failed' });
};

export const createChaptersRouter = (service: ChaptersService = new ChaptersService()): Router => {
  const router = Router();
  router.post('/transcripts', async (req, res) => {
    if (!object(req.body) || !only(req.body, IMPORT_FIELDS)) return res.status(400).json({ error: 'payload is invalid' });
    try { const result = await service.importTranscript(req.body); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return safeError(res, error); }
  });
  router.get('/transcripts/:id', async (req, res) => { try { return res.status(200).json(await service.getTranscript(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.get('/productions/:id/transcript', async (req, res) => { try { return res.status(200).json(await service.getProductionTranscript(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.get('/productions/:id', async (req, res) => { try { return res.status(200).json(await service.listVersions(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.post('/productions/:id/generate', async (req, res) => {
    if (!object(req.body) || !only(req.body, ['regenerate'])) return res.status(400).json({ error: 'payload is invalid' });
    try { const result = await service.generate(req.params.id, req.body); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return safeError(res, error); }
  });
  router.post('/productions/:id/regenerate', async (req, res) => {
    if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.generate(req.params.id, { regenerate: true })); } catch (error) { return safeError(res, error); }
  });
  router.get('/versions/:id', async (req, res) => { try { return res.status(200).json(await service.getVersion(req.params.id)); } catch (error) { return safeError(res, error); } });
  router.patch('/versions/:id', async (req, res) => {
    if (!object(req.body) || !only(req.body, ['entries', 'reason']) || !('entries' in req.body)) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.editVersion(req.params.id, req.body.entries, req.body.reason)); } catch (error) { return safeError(res, error); }
  });
  router.post('/versions/:id/entries', async (req, res) => {
    if (!object(req.body) || !only(req.body, ['startMs', 'title'])) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(201).json(await service.addChapter(req.params.id, req.body)); } catch (error) { return safeError(res, error); }
  });
  router.delete('/versions/:id/entries/:entryId', async (req, res) => { try { return res.status(200).json(await service.removeChapter(req.params.id, req.params.entryId)); } catch (error) { return safeError(res, error); } });
  router.post('/versions/:id/select', async (req, res) => {
    if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' });
    try { return res.status(200).json(await service.selectVersion(req.params.id)); } catch (error) { return safeError(res, error); }
  });
  router.get('/versions/:id/output', async (req, res) => { try { return res.status(200).json(await service.formatVersion(req.params.id)); } catch (error) { return safeError(res, error); } });
  return router;
};

export default createChaptersRouter();
