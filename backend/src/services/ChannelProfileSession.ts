import fs from 'fs';
import path from 'path';
import type { Credentials } from 'google-auth-library';

const validProfileId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

const readJson = (filePath: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(temporaryPath, filePath);
};

/** Local-only selection and OAuth storage. Token values never leave this boundary. */
export class ChannelProfileSession {
  constructor(private readonly directory = path.resolve(__dirname, '../../.local/channel-profiles')) {}

  private get activeFilePath(): string { return path.join(this.directory, 'active.json'); }

  getActiveProfileId(): string | null {
    const active = readJson(this.activeFilePath)?.profileId;
    return validProfileId(active) ? active : null;
  }

  setActiveProfileId(profileId: string): void {
    if (!validProfileId(profileId)) throw new Error('Invalid channel profile session identifier');
    writeJson(this.activeFilePath, { profileId });
  }

  getTokenFilePath(profileId = this.getActiveProfileId()): string | null {
    return validProfileId(profileId) ? path.join(this.directory, 'tokens', `${profileId}.json`) : null;
  }

  hasProfileTokens(profileId = this.getActiveProfileId()): boolean {
    const tokenPath = this.getTokenFilePath(profileId);
    return Boolean(tokenPath && fs.existsSync(tokenPath));
  }

  promoteLegacyTokens(profileId: string, legacyTokenFilePath: string): void {
    const tokenPath = this.getTokenFilePath(profileId);
    if (!tokenPath || fs.existsSync(tokenPath)) return;
    const legacyTokens = readJson(legacyTokenFilePath);
    if (legacyTokens) writeJson(tokenPath, legacyTokens as Credentials);
  }
}
