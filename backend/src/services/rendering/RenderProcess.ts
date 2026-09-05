import { spawn } from 'child_process';
export class RenderError extends Error { constructor(readonly code: string, message: string, readonly httpStatus = 409) { super(message); this.name = 'RenderError'; } }
export interface RenderProcessInput { sourcePath: string; outputPath: string; startMs: number; endMs: number; layout: string; signal: AbortSignal; onProgress: (progress: number) => void }
export type RenderRunner = (input: RenderProcessInput) => Promise<void>;
export const renderArguments = (input: RenderProcessInput) => {
  const filter = input.layout === 'CENTER_CROP' ? 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1' : 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,setsar=1';
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-ss', (input.startMs / 1000).toFixed(3), '-i', input.sourcePath, '-t', ((input.endMs - input.startMs) / 1000).toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-threads', '2', '-progress', 'pipe:1', '-nostats', '-f', 'mp4', input.outputPath];
};
export const createRenderRunner = (executable = 'ffmpeg', timeoutMs = 10 * 60 * 1000, spawnProcess: typeof spawn = spawn): RenderRunner => (input) => new Promise((resolve, reject) => {
  if (input.signal.aborted) return reject(new RenderError('CANCELLED', 'Renderizacao cancelada.'));
  const child = spawnProcess(executable, renderArguments(input), { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let done = false; let stderrBytes = 0; let stdoutBytes = 0; let buffer = ''; let failure: RenderError | null = null;
  const stop = (error: RenderError) => { if (failure) return; failure = error; child.kill(); };
  const abort = () => stop(new RenderError('CANCELLED', 'Renderizacao cancelada.'));
  const timer = setTimeout(() => stop(new RenderError('RENDER_TIMEOUT', 'Renderizacao excedeu o tempo permitido.')), timeoutMs);
  input.signal.addEventListener('abort', abort, { once: true });
  child.stderr.on('data', (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > 128000) stop(new RenderError('RENDER_OUTPUT_LIMIT', 'Saida do processo excedeu o limite.')); });
  child.stdout.on('data', (data: Buffer) => { stdoutBytes += data.length; buffer += data.toString('utf8'); if (stdoutBytes > 512000 || buffer.length > 16000) return stop(new RenderError('RENDER_OUTPUT_LIMIT', 'Progresso do processo excedeu o limite.')); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines) { const match = /^out_time_us=(\d+)$/.exec(line.trim()); if (match) input.onProgress(Math.min(95, Math.max(0, Math.floor(Number(match[1]) / ((input.endMs - input.startMs) * 1000) * 95)))); } });
  const finish = (error?: RenderError) => { if (done) return; done = true; clearTimeout(timer); input.signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
  child.on('error', (error: NodeJS.ErrnoException) => finish(new RenderError(error.code === 'ENOENT' ? 'RENDER_UNAVAILABLE' : 'RENDER_FAILED', 'FFmpeg indisponivel ou falhou ao iniciar.')));
  child.on('close', (code) => finish(failure ?? (code === 0 ? undefined : new RenderError('RENDER_FAILED', 'FFmpeg nao concluiu o corte.'))));
});
