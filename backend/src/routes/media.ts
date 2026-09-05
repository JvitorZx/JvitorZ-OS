import { Router, type Response } from 'express';
import { MediaSourceService, MediaError, parseByteRange } from '../services/media';
import { ProductionNotFoundError } from '../services/production';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const failure = (res: Response, error: unknown) => {
  if (res.headersSent) { res.destroy(); return; }
  if (error instanceof MediaError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
  if (error instanceof ProductionNotFoundError) return res.status(404).json({ error: 'Production not found' });
  console.error(`Media request failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  return res.status(500).json({ error: 'Media request failed' });
};
export const createMediaRouter = (service = new MediaSourceService()) => {
  const router = Router();
  router.get('/health', async (_req, res) => { try { return res.json(await service.health()); } catch (error) { return failure(res, error); } });
  router.get('/roots', async (_req, res) => { try { return res.json(await service.roots()); } catch (error) { return failure(res, error); } });
  router.get('/sources', async (_req, res) => { try { return res.json(await service.list()); } catch (error) { return failure(res, error); } });
  router.post('/sources', async (req, res) => { if (!object(req.body)) return res.status(400).json({ error: 'payload is invalid' }); try { const result = await service.register(req.body); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return failure(res, error); } });
  router.get('/sources/:id', async (req, res) => { try { return res.json(await service.get(req.params.id)); } catch (error) { return failure(res, error); } });
  router.post('/sources/:id/reprobe', async (req, res) => { if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'payload is invalid' }); try { return res.json(await service.reprobe(req.params.id)); } catch (error) { return failure(res, error); } });
  router.get('/sources/:id/preview', async (req, res) => {
    let opened: Awaited<ReturnType<MediaSourceService['openPreview']>> | null = null;
    try {
      opened = await service.openPreview(req.params.id);
      let range;
      try { range = parseByteRange(req.headers.range, opened.size); } catch (error) { res.setHeader('Content-Range', `bytes */${opened.size}`); throw error; }
      res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', opened.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Length', range.end - range.start + 1);
      if (range.partial) { res.status(206); res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${opened.size}`); }
      if (req.method === 'HEAD') { await opened.handle.close(); opened = null; return res.end(); }
      const stream = opened.handle.createReadStream({ start: range.start, end: range.end, autoClose: true }); opened = null;
      res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch (error) { if (opened) await opened.handle.close(); return failure(res, error); }
  });
  return router;
};
export default createMediaRouter();
