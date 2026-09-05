import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient, ClipRenderJob } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { MediaFiles, MediaProbe, createProbeRunner, hash, statFingerprint, canonicalCase } from '../media';
import { createShortsSourceFingerprint } from '../shorts/ShortsService';
import { createRenderRunner, RenderError, type RenderRunner } from './RenderProcess';
import { buildClipCaptions, serializeCaptions } from '../../domains/captions';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const id = (value: unknown) => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new RenderError('INVALID_INPUT', 'Identificador invalido.', 400); return value; };
const profiles = [{ layout: 'FIT', width: 720, height: 1280 }, { layout: 'CENTER_CROP', width: 720, height: 1280 }];
export class ClipRenderService {
  private initialized: Promise<void> | null = null;
  private worker: Promise<void> | null = null;
  private workerError: string | null = null;
  private controllers = new Map<string, AbortController>();
  private enqueueLock: Promise<unknown> = Promise.resolve();
  private closing = false;
  private shutdownPromise: Promise<void> | null = null;
  constructor(private readonly client: PrismaClient = DatabaseService.client, private readonly files = new MediaFiles(), private readonly probe = new MediaProbe(), private readonly runner: RenderRunner = createRenderRunner(), private readonly outputRoot = path.resolve(__dirname, '../../../rendered')) {}
  async initialize() {
    if (this.closing) throw new RenderError('APPLICATION_STOPPED', 'Aplicativo em encerramento; novos trabalhos estao bloqueados.');
    if (!this.initialized) this.initialized = (async () => {
      await fs.mkdir(this.outputRoot, { recursive: true });
      if ((await fs.lstat(this.outputRoot)).isSymbolicLink()) throw new RenderError('OUTPUT_ROOT_INVALID', 'Pasta de saida nao pode ser um link.');
      await this.client.clipRenderJob.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'INTERRUPTED', errorCode: 'PROCESS_RESTARTED', errorMessage: 'Execucao interrompida; tente novamente explicitamente.', completedAt: new Date() } });
    })();
    return this.initialized;
  }
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    this.shutdownPromise = (async () => {
      if (!this.initialized) return;
      await this.initialized;
      await this.enqueueLock.catch(() => undefined);
      try { await this.client.clipRenderJob.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'INTERRUPTED', errorCode: 'APPLICATION_STOPPED', errorMessage: 'Aplicativo encerrado; tente novamente explicitamente.', completedAt: new Date() } }); }
      finally { for (const controller of this.controllers.values()) controller.abort(); await this.waitForIdle(); }
    })();
    return this.shutdownPromise;
  }
  async health() {
    await this.initialize();
    if (this.workerError) return { available: false, capability: 'UNAVAILABLE', reason: 'Worker interrompido; reinicie o backend para retomar explicitamente.', worker: 'SERIAL_LOCAL' };
    try { const version = await createProbeRunner('ffmpeg')(['-version'], { timeoutMs: 3000, maxOutputBytes: 64000 }); const probe = await this.probe.health(); if (!/^ffmpeg version /m.test(version) || !probe.available) throw new Error(); return { available: true, capability: 'AVAILABLE', reason: null, worker: 'SERIAL_LOCAL' }; }
    catch { return { available: false, capability: 'UNAVAILABLE', reason: 'FFmpeg ou ffprobe indisponivel.', worker: 'SERIAL_LOCAL' }; }
  }
  private async inspect(candidateId: string, layout = 'FIT') {
    const candidate = await this.client.clipCandidate.findUnique({ where: { id: candidateId }, include: { analysis: true } });
    if (!candidate) throw new RenderError('NOT_FOUND', 'Candidato nao encontrado.', 404);
    const production = await this.client.contentProduction.findUnique({ where: { id: candidate.analysis.productionId }, include: { steps: true, assets: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] } } });
    if (!production) throw new RenderError('NOT_FOUND', 'Producao nao encontrada.', 404);
    const reasons: string[] = [];
    if (candidate.status !== 'SELECTED') reasons.push('Selecione o candidato em Shorts.');
    if (candidate.analysis.status !== 'CURRENT') reasons.push('A analise esta desatualizada.');
    if (['CANCELLED'].includes(production.status)) reasons.push('A producao foi cancelada.');
    const shortsStep = production.steps.find(({ key }) => key === 'SHORTS'); const editing = production.steps.find(({ key }) => key === 'EDITING'); const chapters = production.steps.find(({ key }) => key === 'CHAPTERS');
    if (shortsStep?.state !== 'COMPLETED') reasons.push('Conclua a revisao e selecao da etapa Shorts.');
    if (editing?.state !== 'COMPLETED' || !chapters || !['COMPLETED', 'SKIPPED'].includes(chapters.state)) reasons.push('A edicao e os capitulos precisam estar resolvidos.');
    const transcript = await this.client.timedTranscript.findFirst({ where: { productionId: production.id }, orderBy: [{ version: 'desc' }] });
    const asset = production.assets.find(({ role }) => role === 'EDITED_VIDEO') ?? production.assets.find(({ role }) => role === 'RAW_VIDEO');
    const actualFingerprint = createShortsSourceFingerprint(transcript, editing, asset);
    if (candidate.analysis.sourceFingerprint !== actualFingerprint || candidate.analysis.transcriptId !== transcript?.id) reasons.push('O conteudo temporal mudou; regenere e revise os candidatos.');
    const source = asset ? await this.client.localMediaSource.findUnique({ where: { libraryItemId: asset.libraryItemId } }) : null;
    if (!source) reasons.push('Registre o mesmo asset de video da producao no workspace Midia.');
    else if (source.status !== 'READY') reasons.push('A fonte local precisa estar pronta e inspecionada.');
    let resolved: Awaited<ReturnType<MediaFiles['resolve']>> | null = null;
    if (source) {
      try { resolved = await this.files.resolve(source.rootId, source.relativePath); if (resolved.fingerprint !== source.fingerprint) reasons.push('O arquivo fonte mudou; execute nova inspecao em Midia.'); }
      catch { reasons.push('Arquivo fonte indisponivel ou fora da raiz permitida.'); }
      if (!source.durationMs || candidate.endMs > source.durationMs + 50 || candidate.startMs < 0 || candidate.endMs <= candidate.startMs) reasons.push('O intervalo do candidato excede a duracao real da fonte.');
    }
    const snapshot = { candidateId, analysisId: candidate.analysisId, productionId: production.id, candidateUpdatedAt: candidate.updatedAt.toISOString(), title: candidate.title, hook: candidate.hook, startMs: candidate.startMs, endMs: candidate.endMs, analysisFingerprint: candidate.analysis.sourceFingerprint, sourceId: source?.id ?? null, sourceFingerprint: source?.fingerprint ?? null, sourceLibraryItemId: source?.libraryItemId ?? null, layout, profile: { width: 720, height: 1280, videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac' } };
    return { candidate, source, resolved, snapshot, snapshotKey: hash(JSON.stringify(snapshot)), view: { eligible: reasons.length === 0, reasons, candidateId, productionId: production.id, analysisId: candidate.analysisId, source: source ? { id: source.id, libraryItemId: source.libraryItemId, fingerprint: source.fingerprint, durationMs: source.durationMs, width: source.width, height: source.height, hasAudio: source.hasAudio } : null, clip: { startMs: candidate.startMs, endMs: candidate.endMs, durationMs: candidate.endMs - candidate.startMs, title: candidate.title }, profiles, defaultLayout: 'FIT' } };
  }
  async preflight(candidateId: unknown) { return (await this.inspect(id(candidateId))).view; }
  private dto(job: ClipRenderJob) { const { outputFingerprint: _fingerprint, snapshotKey: _key, ...value } = job; return { ...value, previewUrl: job.status === 'SUCCEEDED' ? `/api/renders/jobs/${job.id}/preview` : null }; }
  private async find(jobId: unknown) { const job = await this.client.clipRenderJob.findUnique({ where: { id: id(jobId) } }); if (!job) throw new RenderError('NOT_FOUND', 'Renderizacao nao encontrada.', 404); return job; }
  private async validateSucceeded(job: ClipRenderJob) {
    if (job.status !== 'SUCCEEDED') return job;
    try { const actual = await this.inspect(job.candidateId, job.layout); if (!actual.view.eligible || actual.snapshotKey !== job.snapshotKey) throw new Error(); const output = await this.outputFile(job.id); if (statFingerprint(await fs.stat(output, { bigint: true })) !== job.outputFingerprint) throw new Error(); return job; }
    catch { await this.client.clipRenderJob.updateMany({ where: { id: job.id, status: 'SUCCEEDED' }, data: { status: 'FAILED', errorCode: 'OUTPUT_OUTDATED', errorMessage: 'Resultado desatualizado ou indisponivel; revise a fonte e solicite nova renderizacao.' } }); return this.find(job.id); }
  }
  async get(jobId: unknown) { await this.initialize(); return this.dto(await this.validateSucceeded(await this.find(jobId))); }
  async list(productionId?: unknown) { await this.initialize(); const rows = await this.client.clipRenderJob.findMany({ where: productionId === undefined ? {} : { productionId: id(productionId) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 }); const result = []; for (const row of rows) result.push(this.dto(await this.validateSucceeded(row))); return result; }
  async enqueue(raw: Record<string, unknown>, retryOf?: ClipRenderJob) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['candidateId', 'layout'].includes(key))) throw new RenderError('INVALID_INPUT', 'Pedido de renderizacao invalido.', 400);
    const candidateId = id(raw.candidateId); const layout = raw.layout ?? 'FIT';
    if (layout !== 'FIT' && layout !== 'CENTER_CROP') throw new RenderError('INVALID_INPUT', 'Layout deve ser FIT ou CENTER_CROP.', 400);
    await this.initialize();
    if (this.closing) throw new RenderError('APPLICATION_STOPPED', 'Aplicativo em encerramento; novos trabalhos estao bloqueados.');
    if (this.workerError) throw new RenderError('WORKER_STOPPED', 'Worker interrompido por falha interna; reinicie o backend antes de tentar novamente.', 503);
    const work = this.enqueueLock.then(async () => {
      if (this.closing) throw new RenderError('APPLICATION_STOPPED', 'Aplicativo em encerramento; novos trabalhos estao bloqueados.');
      const current = await this.inspect(candidateId, layout);
      if (!current.view.eligible || !current.source) throw new RenderError('NOT_ELIGIBLE', current.view.reasons.join(' '));
      const previous = await this.client.clipRenderJob.findFirst({ where: { snapshotKey: current.snapshotKey }, orderBy: [{ attempt: 'desc' }] });
      if (previous && (!retryOf || ['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(previous.status))) return { job: this.dto(await this.validateSucceeded(previous)), created: false };
      if (this.closing) throw new RenderError('APPLICATION_STOPPED', 'Aplicativo em encerramento; novos trabalhos estao bloqueados.');
      const job = await this.client.clipRenderJob.create({ data: { id: randomUUID(), candidateId, productionId: current.snapshot.productionId, analysisId: current.snapshot.analysisId, sourceId: current.source.id, snapshotKey: current.snapshotKey, snapshot: json(current.snapshot), layout, attempt: (previous?.attempt ?? 0) + 1 } });
      return { job: this.dto(job), created: true };
    });
    this.enqueueLock = work.catch(() => undefined);
    const result = await work; this.kick(); return result;
  }
  async retry(jobId: unknown) { await this.initialize(); const prior = await this.find(jobId); if (!['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(prior.status)) throw new RenderError('RETRY_CONFLICT', 'Somente trabalhos falhos ou interrompidos podem ser tentados novamente.'); return this.enqueue({ candidateId: prior.candidateId, layout: prior.layout }, prior); }
  async cancel(jobId: unknown) { await this.initialize(); const job = await this.find(jobId); if (job.status === 'CANCELLED') return this.dto(job); if (!['QUEUED', 'RUNNING'].includes(job.status)) throw new RenderError('CANCEL_CONFLICT', 'Este trabalho ja terminou.'); await this.client.clipRenderJob.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Renderizacao cancelada.', completedAt: new Date() } }); this.controllers.get(job.id)?.abort(); return this.dto(await this.find(job.id)); }
  private kick() {
    if (this.worker || this.workerError || this.closing) return;
    this.worker = this.runQueue().catch(async () => {
      this.workerError = 'WORKER_STOPPED';
      try { await this.client.clipRenderJob.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'INTERRUPTED', errorCode: 'WORKER_STOPPED', errorMessage: 'Worker interrompido por falha interna; reinicie e tente novamente.', completedAt: new Date() } }); } catch { /* Storage unavailable: initialization will mark jobs interrupted after restart. */ }
    }).finally(async () => { this.worker = null; if (!this.workerError && !this.closing) { try { if (await this.client.clipRenderJob.count({ where: { status: 'QUEUED' } })) this.kick(); } catch { this.workerError = 'WORKER_STOPPED'; } } });
  }
  async waitForIdle() { while (this.worker) await this.worker; }
  private async outputFile(jobId: string, creating = false) {
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new RenderError('OUTPUT_INVALID', 'Identificador de saida invalido.');
    const root = await fs.realpath(this.outputRoot);
    if (/^[\\/]{2}/.test(root) || (await fs.lstat(this.outputRoot)).isSymbolicLink()) throw new RenderError('OUTPUT_INVALID', 'Pasta de saida invalida.');
    const output = path.join(root, `${jobId}.mp4`);
    if (creating) { try { await fs.lstat(output); throw new RenderError('OUTPUT_EXISTS', 'A saida ja existe; nenhum arquivo sera sobrescrito.'); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; } return output; }
    if ((await fs.lstat(output)).isSymbolicLink()) throw new RenderError('OUTPUT_INVALID', 'Saida nao pode ser um link.');
    const real = await fs.realpath(output); if (path.dirname(canonicalCase(real)) !== canonicalCase(root)) throw new RenderError('OUTPUT_INVALID', 'Saida fora da pasta permitida.'); return real;
  }
  private async runQueue() {
    for (;;) {
      if (this.closing) return;
      const job = await this.client.clipRenderJob.findFirst({ where: { status: 'QUEUED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }); if (!job) return;
      const claimed = await this.client.clipRenderJob.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), progress: 1 } }); if (!claimed.count) continue;
      const controller = new AbortController(); this.controllers.set(job.id, controller);
      try {
        const before = await this.inspect(job.candidateId, job.layout);
        if (!before.view.eligible || before.snapshotKey !== job.snapshotKey || !before.resolved) throw new RenderError('SOURCE_CHANGED', 'Fonte ou selecao mudou antes da renderizacao.');
        const outputPath = await this.outputFile(job.id, true);
        const beforeStart = await this.find(job.id);
        if (beforeStart.status !== 'RUNNING' || controller.signal.aborted) throw new RenderError('CANCELLED', 'Renderizacao cancelada antes de iniciar o processo.');
        await this.runner({ sourcePath: before.resolved.absolutePath, outputPath, startMs: before.candidate.startMs, endMs: before.candidate.endMs, layout: job.layout, signal: controller.signal, onProgress: (progress) => { void this.client.clipRenderJob.updateMany({ where: { id: job.id, status: 'RUNNING' }, data: { progress: Math.min(95, Math.max(1, Math.round(progress))) } }).catch(() => undefined); } });
        if (controller.signal.aborted) throw new RenderError('CANCELLED', 'Renderizacao cancelada.');
        const after = await this.inspect(job.candidateId, job.layout);
        if (!after.view.eligible || after.snapshotKey !== job.snapshotKey) throw new RenderError('SOURCE_CHANGED', 'Fonte ou selecao mudou durante a renderizacao.');
        const output = await this.outputFile(job.id);
        const statBefore = await fs.stat(output, { bigint: true }); const metadata = await this.probe.probe(output); const statAfter = await fs.stat(output, { bigint: true });
        const expectedDuration = before.candidate.endMs - before.candidate.startMs;
        if (statFingerprint(statBefore) !== statFingerprint(statAfter) || metadata.width !== 720 || metadata.height !== 1280 || metadata.videoCodec !== 'h264' || Math.abs(metadata.durationMs - expectedDuration) > 350 || metadata.hasAudio !== before.source?.hasAudio || (metadata.hasAudio && metadata.audioCodec !== 'aac')) throw new RenderError('OUTPUT_INVALID', 'A verificacao do MP4 nao corresponde ao perfil solicitado.');
        const final = await this.inspect(job.candidateId, job.layout);
        if (!final.view.eligible || final.snapshotKey !== job.snapshotKey) throw new RenderError('SOURCE_CHANGED', 'Fonte ou selecao mudou durante a verificacao.');
        await this.client.$transaction(async (transaction) => {
          const active = await transaction.clipRenderJob.findUniqueOrThrow({ where: { id: job.id } });
          if (active.status !== 'RUNNING') throw new RenderError('CANCELLED', 'Renderizacao cancelada.');
          const candidate = await transaction.clipCandidate.findUniqueOrThrow({ where: { id: job.candidateId }, include: { analysis: true } }); const source = await transaction.localMediaSource.findUniqueOrThrow({ where: { id: job.sourceId } });
          if (candidate.status !== 'SELECTED' || candidate.updatedAt.toISOString() !== final.snapshot.candidateUpdatedAt || candidate.analysis.status !== 'CURRENT' || candidate.analysis.sourceFingerprint !== final.snapshot.analysisFingerprint || source.status !== 'READY' || source.fingerprint !== final.snapshot.sourceFingerprint) throw new RenderError('SOURCE_CHANGED', 'Fonte ou selecao mudou antes de salvar o resultado.');
          const library = await transaction.libraryItem.create({ data: { title: `${candidate.title} - ${job.layout}`, type: 'video', content: null } });
          await transaction.clipRenderJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', progress: 100, completedAt: new Date(), outputLibraryItemId: library.id, outputMetadata: json({ ...metadata, sizeBytes: statAfter.size.toString() }), outputFingerprint: statFingerprint(statAfter) } });
        });
      } catch (error) {
        const failure = error instanceof RenderError ? error : new RenderError('RENDER_FAILED', 'Nao foi possivel concluir ou verificar a renderizacao.');
        await this.client.clipRenderJob.updateMany({ where: { id: job.id, status: 'RUNNING' }, data: { status: failure.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED', errorCode: failure.code, errorMessage: failure.message, completedAt: new Date() } });
      } finally { this.controllers.delete(job.id); }
    }
  }
  async openPreview(jobId: unknown) {
    await this.initialize(); const job = await this.validateSucceeded(await this.find(jobId)); if (job.status !== 'SUCCEEDED') throw new RenderError('OUTPUT_NOT_READY', 'Saida indisponivel, desatualizada ou nao concluida.');
    const output = await this.outputFile(job.id); const handle = await fs.open(output, 'r');
    try { const stat = await handle.stat({ bigint: true }); const current = await this.outputFile(job.id); if (statFingerprint(stat) !== job.outputFingerprint || statFingerprint(await fs.stat(current, { bigint: true })) !== job.outputFingerprint) throw new RenderError('OUTPUT_CHANGED', 'Saida mudou ao abrir o preview.'); return { handle, size: Number(stat.size), mime: 'video/mp4' }; } catch (error) { await handle.close(); throw error; }
  }
  async captions(jobId: unknown) {
    await this.initialize();
    const job = await this.validateSucceeded(await this.find(jobId));
    if (job.status !== 'SUCCEEDED') throw new RenderError('OUTPUT_NOT_READY', 'Legendas exigem uma renderizacao concluida e atual.');
    const snapshot = job.snapshot as { startMs: number; endMs: number };
    const analysis = await this.client.shortAnalysis.findUnique({ where: { id: job.analysisId }, select: { transcriptId: true } });
    if (!analysis) throw new RenderError('CAPTIONS_UNAVAILABLE', 'Transcript da renderizacao indisponivel.');
    const segments = await this.client.timedTranscriptSegment.findMany({ where: { transcriptId: analysis.transcriptId, startMs: { lt: snapshot.endMs }, endMs: { gt: snapshot.startMs } }, orderBy: [{ startMs: 'asc' }, { position: 'asc' }, { id: 'asc' }] });
    const result = buildClipCaptions(segments, snapshot.startMs, snapshot.endMs);
    const verified = await this.validateSucceeded(await this.find(job.id));
    if (verified.status !== 'SUCCEEDED' || verified.snapshotKey !== job.snapshotKey) throw new RenderError('OUTPUT_OUTDATED', 'Fonte ou selecao mudou durante a leitura das legendas.');
    return { jobId: job.id, available: result.cues.length > 0, reasons: result.cues.length ? [] : ['Nenhum segmento temporal com texto esta disponivel para este corte.'], cueCount: result.cues.length, durationMs: result.durationMs, cues: result.cues, formats: ['srt', 'vtt'], warnings: result.warnings };
  }
  async captionFile(jobId: unknown, formatValue: unknown) {
    if (formatValue !== 'srt' && formatValue !== 'vtt') throw new RenderError('INVALID_FORMAT', 'Formato de legenda deve ser srt ou vtt.', 400);
    const result = await this.captions(jobId);
    if (!result.available) throw new RenderError('CAPTIONS_UNAVAILABLE', result.reasons.join(' '));
    return { filename: `${result.jobId}.${formatValue}`, contentType: formatValue === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8', text: serializeCaptions(result.cues, formatValue) };
  }
}
