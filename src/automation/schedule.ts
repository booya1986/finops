export type AutomationJob = 'daily' | 'weekly' | 'monthly';

export interface ScheduleConfig {
  dailyHour: number;
  weeklyDay: number;
  weeklyHour: number;
  monthlyDay: number;
  monthlyHour: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  dailyHour: 6,
  weeklyDay: 0,
  weeklyHour: 7,
  monthlyDay: 1,
  monthlyHour: 8,
};

function israelParts(now: Date): { date: string; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    day: weekdays[value('weekday')] ?? -1,
    hour: Number(value('hour')),
  };
}

/**
 * What the daily job should do after ingest returns. Extracted so the rule is
 * testable on its own — the bug it encodes cost a real day of advice.
 *
 * `ingest` exits non-zero when ANY provider fails, even when the rest
 * succeeded. Treating that as total failure meant one dormant card (Cal)
 * skipped `advise` entirely, and because last_attempt was already stamped for
 * the day, nothing retried. The advisor reads whatever landed in the DB, so
 * partial data is still worth advising on — but the run must not be recorded
 * as a success, or a provider failing every day would look healthy.
 */
export function dailyOutcome(ingestFailed: boolean): {
  runAdvise: boolean;
  recordSuccess: boolean;
} {
  return { runAdvise: true, recordSuccess: !ingestFailed };
}

/** Jobs are due at most once per Israel calendar date; lastAttempt prevents retry storms. */
export function dueJobs(now: Date, lastAttempt: Partial<Record<AutomationJob, string>>, config: ScheduleConfig = DEFAULT_SCHEDULE): AutomationJob[] {
  const current = israelParts(now);
  const dayOfMonth = Number(current.date.slice(8, 10));
  const jobs: AutomationJob[] = [];
  if (current.hour >= config.dailyHour && lastAttempt.daily !== current.date) jobs.push('daily');
  if (current.day === config.weeklyDay && current.hour >= config.weeklyHour && lastAttempt.weekly !== current.date) jobs.push('weekly');
  if (dayOfMonth === config.monthlyDay && current.hour >= config.monthlyHour && lastAttempt.monthly !== current.date) jobs.push('monthly');
  return jobs;
}
