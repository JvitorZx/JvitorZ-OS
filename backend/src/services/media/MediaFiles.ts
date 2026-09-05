import path from 'path';
import { promises as fs, type BigIntStats } from 'fs';
import { createHash } from 'crypto';

export class MediaError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus = 400) { super(message); this.name = 'MediaError'; }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const canonicalCase = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
export const statFingerprint = (value: BigIntStats) => hash([value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':'));
export const mediaMime = (relativePath: string) => ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t' }[path.extname(relativePath).toLowerCase()] ?? 'application/octet-stream');
export const safeRelativePath = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\x00-\x1f:%?#]/.test(value) || /^[\\/]/.test(value) || path.isAbsolute(value) || path.win32.isAbsolute(value)) throw new MediaError('INVALID_PATH', 'Use a relative media file path inside an allowed root');
  const parts = value.replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /[<>"|*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new MediaError('INVALID_PATH', 'Path traversal, device names or ambiguous path components are not allowed');
  const normalized = parts.join('/');
  if (!['.mp4', '.mov', '.mkv', '.webm', '.avi', '.ts'].includes(path.extname(normalized).toLowerCase())) throw new MediaError('UNSUPPORTED_MEDIA', 'Supported local video extensions: mp4, mov, mkv, webm, avi, ts');
  return normalized;
};

export interface MediaRoot { id: string; label: string; absolutePath: string }
export class MediaFiles {
  constructor(private readonly configuredRoots?: string[], private readonly defaultRoot = path.resolve(__dirname, '../../../media')) {}
  async roots(): Promise<MediaRoot[]> {
    let values = this.configuredRoots;
    if (!values && process.env.MEDIA_ALLOWED_ROOTS) {
      try { values = JSON.parse(process.env.MEDIA_ALLOWED_ROOTS); } catch { throw new MediaError('INVALID_ROOT_CONFIG', 'Media root configuration is invalid', 503); }
    }
    if (!values) { await fs.mkdir(this.defaultRoot, { recursive: true }); values = [this.defaultRoot]; }
    if (!Array.isArray(values) || !values.length || values.length > 20 || values.some((value) => typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value) || /[\x00-\x1f]/.test(value))) throw new MediaError('INVALID_ROOT_CONFIG', 'Media roots must be configured as local absolute directories', 503);
    return [...new Set(values.map((value) => path.resolve(value)))].map((absolutePath) => ({ id: hash(canonicalCase(absolutePath)).slice(0, 20), label: canonicalCase(absolutePath) === canonicalCase(this.defaultRoot) ? 'Midia do projeto (backend/media)' : path.basename(absolutePath) || 'Pasta de midia', absolutePath }));
  }
  async resolve(rootId: string, rawPath: unknown) {
    const relativePath = safeRelativePath(rawPath);
    const root = (await this.roots()).find(({ id }) => id === rootId);
    if (!root) throw new MediaError('ROOT_UNAVAILABLE', 'The registered media root is not configured', 409);
    try {
      const rootReal = await fs.realpath(root.absolutePath);
      if (/^[\\/]{2}/.test(rootReal)) throw new MediaError('ROOT_UNAVAILABLE', 'Network media roots are not allowed', 409);
      const rootStat = await fs.stat(rootReal);
      if (!rootStat.isDirectory()) throw new MediaError('ROOT_UNAVAILABLE', 'Media root is not a directory', 409);
      let current = rootReal;
      for (const component of relativePath.split('/')) {
        current = path.join(current, component);
        if ((await fs.lstat(current)).isSymbolicLink()) throw new MediaError('PATH_ESCAPE', 'Symbolic links are not accepted as local media sources', 400);
      }
      const absolutePath = await fs.realpath(current);
      const relative = path.relative(canonicalCase(rootReal), canonicalCase(absolutePath));
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new MediaError('PATH_ESCAPE', 'Media file is outside the allowed root');
      const stat = await fs.stat(absolutePath, { bigint: true });
      if (!stat.isFile()) throw new MediaError('NOT_FILE', 'A regular media file is required');
      if (stat.size <= 0 || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new MediaError('INVALID_FILE_SIZE', 'Media file size is invalid');
      return { absolutePath, relativePath, rootId, stat, fingerprint: statFingerprint(stat), sizeBytes: stat.size.toString() };
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError('OFFLINE', 'Media file is unavailable or cannot be read', 409);
    }
  }
}

export const parseByteRange = (value: string | undefined, size: number): { start: number; end: number; partial: boolean } => {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new MediaError('INVALID_RANGE', 'Invalid byte range', 416);
  let start: number; let end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new MediaError('INVALID_RANGE', 'Invalid byte range', 416); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new MediaError('INVALID_RANGE', 'Requested byte range is unavailable', 416);
  return { start, end, partial: true };
};
