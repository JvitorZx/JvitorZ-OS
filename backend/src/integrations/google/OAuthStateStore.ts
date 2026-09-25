import { randomBytes } from 'crypto';

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStateValidation = 'valid' | 'invalid' | 'expired';
export interface OAuthStateContext {
  profileId: string | null;
}

export class OAuthStateStore {
  private readonly states = new Map<string, { expiresAt: number; profileId: string | null }>();

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

  create(context: OAuthStateContext = { profileId: null }): string {
    this.removeExpired();

    let state: string;
    do {
      state = randomBytes(32).toString('base64url');
    } while (this.states.has(state));

    this.states.set(state, { expiresAt: this.now() + this.ttlMs, profileId: context.profileId });
    return state;
  }

  consume(state: string): OAuthStateValidation {
    return this.consumeWithContext(state).validation;
  }

  consumeWithContext(state: string): { validation: OAuthStateValidation; profileId: string | null } {
    const record = this.states.get(state);

    if (record === undefined) {
      return { validation: 'invalid', profileId: null };
    }

    this.states.delete(state);

    if (record.expiresAt <= this.now()) {
      return { validation: 'expired', profileId: null };
    }

    return { validation: 'valid', profileId: record.profileId };
  }

  private removeExpired(): void {
    const currentTime = this.now();

    for (const [state, record] of this.states) {
      if (record.expiresAt <= currentTime) {
        this.states.delete(state);
      }
    }
  }
}
