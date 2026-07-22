import type { Database } from 'better-sqlite3';
import { round2 } from '../ingest/normalize.js';

export type GoalType = 'save_by_date' | 'cut_category' | 'cap_monthly';
export type GoalState = 'on_track' | 'at_risk' | 'off_track' | 'completed' | 'paused';

interface GoalRow {
  id: number;
  title: string;
  type: GoalType;
  target_amount: number;
  category: string | null;
  deadline: string | null;
  progress: number;
  status: string;
}

export interface GoalTracking {
  id: number;
  title: string;
  type: GoalType;
  target_amount: number;
  category: string | null;
  deadline: string | null;
  manual_progress: number;
  status: string;
  state: GoalState;
  current_value: number;
  progress_pct: number;
  remaining: number;
  expected_by_now: number | null;
  days_left: number | null;
  required_monthly: number | null;
  corrective_action: string;
}

const MONTH = `strftime('%Y-%m', date)`;
const EXPENSE = `amount_ils < 0 AND is_transfer = 0`;

function israelDateParts(now: Date): { date: string; month: string; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return { date: `${year}-${month}-${day}`, month: `${year}-${month}`, day: Number(day) };
}

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.ceil((toMs - fromMs) / 86_400_000);
}

function shekels(n: number): string {
  return `₪${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.max(n, 0))}`;
}

/**
 * Deterministic Phase-5 goal tracking. Spending goals are measured directly
 * from SQL aggregates; a save-by-date goal uses the manually confirmed amount
 * already saved. The LLM may explain these values but never calculates them.
 */
export function buildGoalTracking(db: Database, month: string, now: Date = new Date()): GoalTracking[] {
  const goals = db.prepare(`
    SELECT id, title, type, target_amount, category, deadline, progress, status
    FROM goals WHERE status != 'archived' ORDER BY status = 'active' DESC, id DESC
  `).all() as GoalRow[];
  const today = israelDateParts(now);
  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year!, monthNum!, 0)).getUTCDate();
  const elapsed = month < today.month ? daysInMonth : month > today.month ? 0 : Math.min(today.day, daysInMonth);
  const monthDaysLeft = Math.max(daysInMonth - elapsed, 0);

  const spendStmt = db.prepare(`
    SELECT ROUND(COALESCE(-SUM(amount_ils), 0), 2) AS total
    FROM transactions
    WHERE ${EXPENSE} AND ${MONTH} = @month
      AND (@category IS NULL OR category = @category)
  `);

  return goals.map((goal) => {
    if (goal.type === 'save_by_date') {
      const current = round2(Math.max(goal.progress, 0));
      const remaining = round2(Math.max(goal.target_amount - current, 0));
      const daysLeft = goal.deadline ? daysBetween(today.date, goal.deadline) : null;
      const monthsLeft = daysLeft === null ? null : Math.max(daysLeft / 30.44, 1);
      const requiredMonthly = monthsLeft === null ? null : round2(remaining / monthsLeft);
      const completed = current >= goal.target_amount || goal.status === 'completed';
      const expired = daysLeft !== null && daysLeft < 0;
      const state: GoalState = goal.status === 'paused' ? 'paused' : completed ? 'completed' : expired ? 'off_track' : 'on_track';
      const action = state === 'paused'
        ? 'היעד מושהה. אפשר להפעיל אותו מחדש כשתרצה.'
        : state === 'completed'
          ? 'היעד הושג. אפשר לסמן אותו כהושלם.'
          : expired
            ? `מועד היעד עבר ועדיין חסרים ${shekels(remaining)}.`
            : `כדי להגיע ליעד בזמן צריך להוסיף בערך ${shekels(requiredMonthly ?? 0)} בחודש.`;
      return {
        ...goal, manual_progress: current, state, current_value: current,
        progress_pct: round2(Math.min((current / goal.target_amount) * 100, 100)), remaining,
        expected_by_now: null, days_left: daysLeft, required_monthly: requiredMonthly,
        corrective_action: action,
      };
    }

    const current = (spendStmt.get({ month, category: goal.category }) as { total: number }).total;
    const remaining = round2(goal.target_amount - current);
    const expected = round2(goal.target_amount * (elapsed / daysInMonth));
    const historical = month < today.month;
    const completed = historical && current <= goal.target_amount;
    const over = current > goal.target_amount;
    const aheadOfPace = !historical && current > expected * 1.05;
    const state: GoalState = goal.status === 'paused' ? 'paused' : completed ? 'completed' : over ? 'off_track' : aheadOfPace ? 'at_risk' : 'on_track';
    const dailyRoom = monthDaysLeft > 0 ? round2(Math.max(remaining, 0) / monthDaysLeft) : 0;
    const subject = goal.category ? `בקטגוריית ${goal.category}` : 'בכל ההוצאות';
    const action = state === 'paused'
      ? 'היעד מושהה. אפשר להפעיל אותו מחדש כשתרצה.'
      : state === 'completed'
        ? `החודש הסתיים בתוך התקרה, עם ${shekels(remaining)} שנותרו.`
        : state === 'off_track'
          ? `היעד חרג ב־${shekels(Math.abs(remaining))} ${subject}.`
          : state === 'at_risk'
            ? `הקצב גבוה מהתכנון. נותרו ${shekels(remaining)}, כלומר עד ${shekels(dailyRoom)} ליום.`
            : `אתה בתוך הקצב. נשארו ${shekels(remaining)} עד התקרה החודשית.`;
    return {
      ...goal, manual_progress: goal.progress, state, current_value: round2(current),
      progress_pct: round2(Math.min((current / goal.target_amount) * 100, 100)), remaining,
      expected_by_now: expected, days_left: monthDaysLeft, required_monthly: null,
      corrective_action: action,
    };
  });
}
