import { randomBytes } from 'crypto';

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStateValidation = 'valid' | 'invalid' | 'expired';

export class OAuthStateStore {
  private readonly states = new Map<string, number>();

  // This in-memory store is suitable only for the current local, single-process deployment.
  // Replace it with shared session or cache storage before running multiple server instances.
  constructor(
    private readonly ttlMs = DEFAULT_STATE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('OAuth state TTL must be greater than zero');
    }
  }

  create(): string {
    this.removeExpired();

    let state: string;
    do {
      state = randomBytes(32).toString('base64url');
    } while (this.states.has(state));

    this.states.set(state, this.now() + this.ttlMs);
    return state;
  }

  consume(state: string): OAuthStateValidation {
    const expiresAt = this.states.get(state);

    if (expiresAt === undefined) {
      return 'invalid';
    }

    this.states.delete(state);

    if (expiresAt <= this.now()) {
      return 'expired';
    }

    return 'valid';
  }

  private removeExpired(): void {
    const currentTime = this.now();

    for (const [state, expiresAt] of this.states) {
      if (expiresAt <= currentTime) {
        this.states.delete(state);
      }
    }
  }
}
