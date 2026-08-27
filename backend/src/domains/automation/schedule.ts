import type { AutomationSchedule, AutomationTriggerType } from './types';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class AutomationScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationScheduleValidationError';
  }
}

export const getZonedDateParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
};

export const zonedLocalToUtc = (local: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string) => {
  const nominal = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
  let candidate = nominal;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedDateParts(new Date(candidate), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = nominal - represented;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return new Date(candidate);
};

export const assertTimeZone = (timezone: string): string => {
  if (typeof timezone !== 'string' || !timezone.trim() || timezone.length > 80) {
    throw new AutomationScheduleValidationError('timezone must be a valid IANA timezone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new AutomationScheduleValidationError('timezone must be a valid IANA timezone');
  }
  return timezone.trim();
};

export const normalizeAutomationSchedule = (
  triggerType: AutomationTriggerType,
  schedule: AutomationSchedule | undefined,
): AutomationSchedule => {
  if (triggerType === 'MANUAL_ONLY') {
    if (schedule !== undefined && schedule !== null && Object.keys(schedule).length > 0) {
      throw new AutomationScheduleValidationError('manual automations cannot define a schedule');
    }
    return null;
  }
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule) || !TIME_PATTERN.test(schedule.time)) {
    throw new AutomationScheduleValidationError('schedule.time must use HH:mm');
  }
  if (triggerType === 'DAILY') {
    if (Object.keys(schedule).some((key) => !['time'].includes(key))) {
      throw new AutomationScheduleValidationError('daily schedule contains unsupported fields');
    }
    return { time: schedule.time };
  }
  const weekday = (schedule as { weekday?: unknown }).weekday;
  if (!Number.isInteger(weekday) || Number(weekday) < 0 || Number(weekday) > 6
    || Object.keys(schedule).some((key) => !['time', 'weekday'].includes(key))) {
    throw new AutomationScheduleValidationError('weekly schedule.weekday must be an integer from 0 to 6');
  }
  return { time: schedule.time, weekday: Number(weekday) };
};

export const calculateNextRunAt = (
  triggerType: AutomationTriggerType,
  schedule: AutomationSchedule,
  timezone: string,
  after: Date,
): Date | null => {
  if (triggerType === 'MANUAL_ONLY') return null;
  const normalizedZone = assertTimeZone(timezone);
  const normalizedSchedule = normalizeAutomationSchedule(triggerType, schedule);
  if (!normalizedSchedule) return null;
  const [hour, minute] = normalizedSchedule.time.split(':').map(Number);
  const localAfter = getZonedDateParts(after, normalizedZone);
  const base = new Date(Date.UTC(localAfter.year, localAfter.month - 1, localAfter.day));
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + offset);
    if (triggerType === 'WEEKLY' && date.getUTCDay() !== (normalizedSchedule as { weekday: number }).weekday) continue;
    const candidate = zonedLocalToUtc({
      year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute,
    }, normalizedZone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new AutomationScheduleValidationError('could not calculate the next schedule occurrence');
};

export const calculateLatestEligibleRunAt = (
  triggerType: AutomationTriggerType,
  schedule: AutomationSchedule,
  timezone: string,
  now: Date,
): Date | null => {
  if (triggerType === 'MANUAL_ONLY') return null;
  const lookback = triggerType === 'DAILY' ? 3 : 15;
  let cursor = new Date(now.getTime() - lookback * 24 * 60 * 60 * 1_000);
  let latest: Date | null = null;
  for (let count = 0; count < lookback + 3; count += 1) {
    const candidate = calculateNextRunAt(triggerType, schedule, timezone, cursor);
    if (!candidate || candidate.getTime() > now.getTime()) break;
    latest = candidate;
    cursor = candidate;
  }
  return latest;
};
