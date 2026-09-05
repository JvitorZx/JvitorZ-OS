import { spawn } from 'child_process';
import { MediaError } from './MediaFiles';

export type ProbeRunner = (args: string[], options: { timeoutMs: number; maxOutputBytes: number }) => Promise<string>;
export const createProbeRunner = (executable = 'ffprobe'): ProbeRunner => (args, options) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let finished = false; let output = ''; let bytes = 0;
  const done = (error?: MediaError) => { if (finished) return; finished = true; clearTimeout(timer); if (error) { child.kill(); reject(error); } else resolve(output); };
  const timer = setTimeout(() => done(new MediaError('PROBE_TIMEOUT', 'Media probe exceeded its time limit', 503)), options.timeoutMs);
  child.stdout.on('data', (data: Buffer) => { bytes += data.length; if (bytes > options.maxOutputBytes) return done(new MediaError('PROBE_OUTPUT_LIMIT', 'Media probe output exceeded its safe limit', 503)); output += data.toString('utf8'); });
  child.stderr.on('data', (data: Buffer) => { bytes += data.length; if (bytes > options.maxOutputBytes) done(new MediaError('PROBE_OUTPUT_LIMIT', 'Media probe output exceeded its safe limit', 503)); });
  child.on('error', (error: NodeJS.ErrnoException) => done(new MediaError(error.code === 'ENOENT' ? 'PROBE_UNAVAILABLE' : 'PROBE_FAILED', error.code === 'ENOENT' ? 'ffprobe is not available' : 'Media probe could not start', 503)));
  child.on('close', (code) => done(code === 0 ? undefined : new MediaError('PROBE_FAILED', 'Media probe rejected the file or its format', 422)));
});

export class MediaProbe {
  constructor(private readonly runner: ProbeRunner = createProbeRunner(), private readonly timeoutMs = 15000) {}
  async health() {
    try { const output = await this.runner(['-version'], { timeoutMs: 3000, maxOutputBytes: 64000 }); if (!/^ffprobe version /m.test(output)) throw new Error(); return { available: true, capability: 'AVAILABLE', reason: null }; }
    catch { return { available: false, capability: 'UNAVAILABLE', reason: 'ffprobe is unavailable or did not respond' }; }
  }
  async probe(absolutePath: string) {
    const output = await this.runner(['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height', '-of', 'json', '-i', absolutePath], { timeoutMs: this.timeoutMs, maxOutputBytes: 128000 });
    let raw: { format?: { format_name?: unknown; duration?: unknown }; streams?: Array<{ codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown }> };
    try { raw = JSON.parse(output); } catch { throw new MediaError('PROBE_INVALID_OUTPUT', 'Media probe returned invalid metadata', 422); }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.streams) || raw.streams.length > 100 || raw.streams.some((stream) => !stream || typeof stream !== 'object' || Array.isArray(stream))) throw new MediaError('PROBE_INVALID_OUTPUT', 'Media probe returned invalid metadata', 422);
    const video = raw.streams.find(({ codec_type }) => codec_type === 'video'); const audio = raw.streams.find(({ codec_type }) => codec_type === 'audio');
    const duration = Number(raw.format?.duration); const durationMs = Math.round(duration * 1000);
    const codec = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.,-]{1,100}$/.test(value) ? value : null;
    const dimension = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 32768 ? value : null;
    const formatName = codec(raw.format?.format_name);
    if (!video || !codec(video.codec_name) || !dimension(video.width) || !dimension(video.height) || !Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 2147483647 || !formatName || !formatName.split(',').some((value) => ['mov', 'matroska', 'webm', 'avi', 'mpegts'].includes(value))) throw new MediaError('UNSUPPORTED_MEDIA', 'A supported video with usable duration and dimensions is required', 422);
    return { durationMs, formatName, videoCodec: codec(video.codec_name), audioCodec: audio ? codec(audio.codec_name) : null, width: dimension(video.width), height: dimension(video.height), hasAudio: Boolean(audio) };
  }
}
