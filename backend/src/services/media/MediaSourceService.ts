import { promises as fs } from 'fs';
import path from 'path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { DatabaseService } from '../../database/DatabaseService';
import { ProductionService } from '../production';
import { invalidateShortsSource } from '../../database/repositories/ShortsRepository';
import { MediaFiles, MediaError, hash, canonicalCase, statFingerprint, mediaMime } from './MediaFiles';
import { MediaProbe } from './MediaProbe';

const details = { libraryItem: { include: { productionAssets: true } } } satisfies Prisma.LocalMediaSourceInclude;
type Source = Prisma.LocalMediaSourceGetPayload<{ include: typeof details }>;
const text = (value: unknown, field: string, max = 160) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new MediaError('INVALID_INPUT', `${field} is invalid`); return value.trim(); };
export class MediaSourceService {
  constructor(private readonly client: PrismaClient = DatabaseService.client, private readonly files = new MediaFiles(), private readonly probe = new MediaProbe(), private readonly production: Pick<ProductionService, 'get' | 'linkAsset'> = new ProductionService()) {}
  health() { return this.probe.health(); }
  async roots() { return (await this.files.roots()).map(({ id, label }) => ({ id, label })); }
  private dto(source: Source) {
    const { libraryItem, identityKey: _identityKey, ...data } = source;
    return { ...data, title: libraryItem.title, previewUrl: `/api/media/sources/${source.id}/preview`, productions: libraryItem.productionAssets.map(({ productionId, role }) => ({ productionId, role })) };
  }
  private async find(idValue: unknown) { const row = await this.client.localMediaSource.findUnique({ where: { id: text(idValue, 'sourceId') }, include: details }); if (!row) throw new MediaError('NOT_FOUND', 'Media source not found', 404); return row; }
  private async invalidation(transaction: Prisma.TransactionClient, source: Source, reason: string) {
    for (const productionId of [...new Set(source.libraryItem.productionAssets.map(({ productionId }) => productionId))]) await invalidateShortsSource(transaction, productionId, reason);
  }
  private async check(source: Source, attempt = 0): Promise<Source> {
    let status = source.status; let errorCode = source.errorCode;
    try { const current = await this.files.resolve(source.rootId, source.relativePath); if (current.fingerprint !== source.fingerprint) { status = 'CHANGED'; errorCode = 'SOURCE_CHANGED'; } else if (['OFFLINE', 'CHANGED'].includes(status)) { status = 'CHANGED'; errorCode = 'REPROBE_REQUIRED'; } }
    catch (error) { status = 'OFFLINE'; errorCode = error instanceof MediaError ? error.code : 'OFFLINE'; }
    if (status !== source.status || errorCode !== source.errorCode) {
      const result = await this.client.$transaction(async (transaction) => {
        const changed = await transaction.localMediaSource.updateMany({ where: { id: source.id, fingerprint: source.fingerprint, updatedAt: source.updatedAt }, data: { status, errorCode, lastCheckedAt: new Date() } });
        if (!changed.count) return null;
        const updated = await transaction.localMediaSource.findUniqueOrThrow({ where: { id: source.id }, include: details });
        await this.invalidation(transaction, updated, 'Local media source is changed or unavailable'); return updated;
      });
      if (result) return result;
      if (attempt >= 3) throw new MediaError('SOURCE_CONFLICT', 'Source changed concurrently; refresh and retry', 409);
      return this.check(await this.find(source.id), attempt + 1);
    }
    return source;
  }
  async get(id: unknown) { return this.dto(await this.check(await this.find(id))); }
  async list() { const rows = await this.client.localMediaSource.findMany({ include: details, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 200 }); const result = []; for (const row of rows) result.push(this.dto(await this.check(row))); return result; }
  private async metadata(rootId: string, relativePath: string) {
    const before = await this.files.resolve(rootId, relativePath);
    let result: Awaited<ReturnType<MediaProbe['probe']>> | null = null; let status = 'READY'; let errorCode: string | null = null;
    try { result = await this.probe.probe(before.absolutePath); }
    catch (error) { status = error instanceof MediaError && error.code === 'PROBE_UNAVAILABLE' ? 'UNAVAILABLE' : 'ERROR'; errorCode = error instanceof MediaError ? error.code : 'PROBE_FAILED'; }
    const after = await this.files.resolve(rootId, relativePath);
    if (before.fingerprint !== after.fingerprint) throw new MediaError('SOURCE_CHANGED', 'File changed during probing; retry after the file is stable', 409);
    return { fingerprint: after.fingerprint, sizeBytes: after.sizeBytes, status, errorCode, durationMs: result?.durationMs ?? null, formatName: result?.formatName ?? null, videoCodec: result?.videoCodec ?? null, audioCodec: result?.audioCodec ?? null, width: result?.width ?? null, height: result?.height ?? null, hasAudio: result?.hasAudio ?? false, probeAt: new Date(), lastCheckedAt: new Date() };
  }
  async register(raw: Record<string, unknown>) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['rootId', 'relativePath', 'title', 'productionId', 'role'].includes(key))) throw new MediaError('INVALID_INPUT', 'Registration payload is invalid');
    const rootId = text(raw.rootId, 'rootId'); const resolved = await this.files.resolve(rootId, raw.relativePath);
    const title = raw.title === undefined ? path.basename(resolved.relativePath) : text(raw.title, 'title', 200);
    const productionId = raw.productionId === undefined ? null : text(raw.productionId, 'productionId');
    const role = raw.role === undefined ? 'RAW_VIDEO' : text(raw.role, 'role');
    if (!['RAW_VIDEO', 'EDITED_VIDEO'].includes(role) || (raw.role !== undefined && !productionId)) throw new MediaError('INVALID_INPUT', 'A Production video asset role requires productionId');
    if (productionId) await this.production.get(productionId);
    const identityKey = hash(`${rootId}:${canonicalCase(resolved.relativePath)}`);
    let source = await this.client.localMediaSource.findUnique({ where: { identityKey }, include: details }); let created = false;
    if (!source) {
      const metadata = await this.metadata(rootId, resolved.relativePath);
      try {
        source = await this.client.$transaction(async (transaction) => {
          const libraryItem = await transaction.libraryItem.create({ data: { title, type: 'video', content: null } });
          return transaction.localMediaSource.create({ data: { libraryItemId: libraryItem.id, rootId, relativePath: resolved.relativePath, identityKey, ...metadata }, include: details });
        });
        created = true;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
        source = await this.client.localMediaSource.findUniqueOrThrow({ where: { identityKey }, include: details });
      }
    }
    if (productionId) await this.production.linkAsset(productionId, source.libraryItemId, role);
    return { source: await this.get(source.id), created };
  }
  async reprobe(id: unknown) {
    const before = await this.find(id);
    let metadata: Awaited<ReturnType<MediaSourceService['metadata']>>;
    try { metadata = await this.metadata(before.rootId, before.relativePath); }
    catch (error) { await this.check(before); throw error; }
    const changed = before.fingerprint !== metadata.fingerprint;
    const source = await this.client.$transaction(async (transaction) => {
      const updated = await transaction.localMediaSource.updateMany({ where: { id: before.id, fingerprint: before.fingerprint, updatedAt: before.updatedAt }, data: metadata });
      if (!updated.count) throw new MediaError('SOURCE_CONFLICT', 'Source changed concurrently; refresh and retry', 409);
      const result = await transaction.localMediaSource.findUniqueOrThrow({ where: { id: before.id }, include: details });
      if (changed || metadata.status !== 'READY') await this.invalidation(transaction, result, 'Local media source was reprobed with changed or invalid content');
      return result;
    });
    return { source: this.dto(source), changed };
  }
  async openPreview(id: unknown) {
    const source = await this.check(await this.find(id));
    if (source.status !== 'READY') throw new MediaError('SOURCE_NOT_READY', 'Source must be online, unchanged and successfully probed before preview', 409);
    const authorized = await this.files.resolve(source.rootId, source.relativePath);
    const handle = await fs.open(authorized.absolutePath, 'r');
    try {
      const opened = await handle.stat({ bigint: true });
      const current = await this.files.resolve(source.rootId, source.relativePath);
      if (statFingerprint(opened) !== source.fingerprint || current.fingerprint !== source.fingerprint || canonicalCase(current.absolutePath) !== canonicalCase(authorized.absolutePath)) throw new MediaError('SOURCE_CHANGED', 'Source changed while opening preview; reprobe required', 409);
      return { handle, size: Number(opened.size), mime: mediaMime(source.relativePath), fingerprint: source.fingerprint };
    } catch (error) { await handle.close(); await this.check(source); throw error; }
  }
}
