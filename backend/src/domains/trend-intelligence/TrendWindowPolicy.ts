export interface ComparableWindow {
  label: string;
  start: Date;
  end: Date;
}

export interface ComparableWindowPair {
  current: ComparableWindow;
  previous: ComparableWindow;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Central comparison policy. Calendar windows are half-open and always have
 * identical duration. Episode windows always compare N recent items with the
 * immediately preceding N items.
 */
export class TrendWindowPolicy {
  calendar(days: 7 | 28, anchor: Date): ComparableWindowPair {
    const end = new Date(anchor);
    const currentStart = new Date(end.getTime() - days * DAY_MS);
    return {
      current: { label: `${days}d`, start: currentStart, end },
      previous: {
        label: `previous ${days}d`,
        start: new Date(currentStart.getTime() - days * DAY_MS),
        end: currentStart,
      },
    };
  }

  recentItems<T>(items: readonly T[], size: number): { current: T[]; previous: T[] } {
    if (!Number.isInteger(size) || size < 1) throw new Error('window size must be a positive integer');
    return {
      current: items.slice(0, size),
      previous: items.slice(size, size * 2),
    };
  }
}
