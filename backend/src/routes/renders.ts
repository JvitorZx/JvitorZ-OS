import { Router, type Response } from 'express';
import { ClipRenderService, RenderError } from '../services/rendering';
import { MediaError, parseByteRange } from '../services/media';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const failure = (res: Response, error: unknown) => { if (res.headersSent) return res.destroy(); if (error instanceof RenderError || error instanceof MediaError) return res.status(error.httpStatus).json({ error: error.message, code: error.code }); console.error(`Render request failed (${error instanceof Error ? error.name : 'UnknownError'})`); return res.status(500).json({ error: 'Renderizacao falhou.' }); };
export const createRenderRouter = (service = new ClipRenderService()) => {
  const router = Router();
  router.get('/health', async (_req, res) => { try { return res.json(await service.health()); } catch (error) { return failure(res, error); } });
  router.get('/candidates/:id/preflight', async (req, res) => { try { return res.json(await service.preflight(req.params.id)); } catch (error) { return failure(res, error); } });
  router.get('/jobs', async (req, res) => { if (Object.keys(req.query).some((key) => key !== 'productionId') || (req.query.productionId !== undefined && typeof req.query.productionId !== 'string')) return res.status(400).json({ error: 'Filtro invalido.' }); try { return res.json(await service.list(req.query.productionId)); } catch (error) { return failure(res, error); } });
  router.get('/jobs/:id', async (req, res) => { try { return res.json(await service.get(req.params.id)); } catch (error) { return failure(res, error); } });
  router.get('/jobs/:id/captions', async (req, res) => { if (Object.keys(req.query).length) return res.status(400).json({ error: 'Parametros de legenda invalidos.' }); try { return res.json(await service.captions(req.params.id)); } catch (error) { return failure(res, error); } });
  router.get('/jobs/:id/captions/:format', async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Parametros de legenda invalidos.' });
    try { const result = await service.captionFile(req.params.id, req.params.format); res.setHeader('Content-Type', result.contentType); res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store'); return res.send(result.text); } catch (error) { return failure(res, error); }
  });
  router.post('/jobs', async (req, res) => { if (!object(req.body)) return res.status(400).json({ error: 'Pedido invalido.' }); try { const result = await service.enqueue(req.body); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return failure(res, error); } });
  for (const action of ['cancel', 'retry'] as const) router.post(`/jobs/:id/${action}`, async (req, res) => { if (!object(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'Pedido invalido.' }); try { return res.json(await service[action](req.params.id)); } catch (error) { return failure(res, error); } });
  router.get('/jobs/:id/preview', async (req, res) => {
    let opened: Awaited<ReturnType<ClipRenderService['openPreview']>> | null = null;
    try { opened = await service.openPreview(req.params.id); let range; try { range = parseByteRange(req.headers.range, opened.size); } catch (error) { res.setHeader('Content-Range', `bytes */${opened.size}`); throw error; } res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', 'video/mp4'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Length', range.end - range.start + 1); if (range.partial) { res.status(206); res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${opened.size}`); } if (req.method === 'HEAD') { await opened.handle.close(); opened = null; return res.end(); } const stream = opened.handle.createReadStream({ start: range.start, end: range.end, autoClose: true }); opened = null; res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res); }
    catch (error) { if (opened) await opened.handle.close(); return failure(res, error); }
  });
  return router;
};
export default createRenderRouter();
