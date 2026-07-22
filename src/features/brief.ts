import type { Database } from 'better-sqlite3';
import { round2 } from '../ingest/normalize.js';
import { buildGoalTracking, type GoalTracking } from '../goals/tracking.js';

/**
 * The Financial Brief (PLAN.md §7) — everything the advisor agent is allowed
 * to see. Every figure here is computed deterministically: SQL does the
 * grouping/summing, plain TS arithmetic derives mean/std/z from those sums.
 * No raw transactions leave this layer, only aggregates (PLAN.md §18).
 *
 * Conventions: expenses exclude is_transfer=1 rows (the §5 double-count) and
 * are reported as positive ₪ figures; months are 'YYYY-MM' strings.
 */

export interface CategoryStat {
  category: string;
  current_total: number;
  months_with_data: number;
  avg_6m: number;
  std_6m: number;
  z_score: number | null;
}

export interface RecurringMerchant {
  merchant: string;
  months_seen_6m: number;
  avg_monthly_amount: number;
  last_amount: number;
  last_date: string;
  deviation_pct: number | null;
  cadence: 'monthly';
  /** subscription = cancellable digital/service; recurring = fixed real-world payment. */
  kind: 'subscription' | 'recurring';
  /** active = charged within ~45 days; dormant = stopped/cancelled. */
  status: 'active' | 'dormant';
  days_since_last: number;
}

export interface DuplicateCharge {
  merchant: string;
  amount: number;
  dates: string[];
  account: string;
}

export interface LargeTransaction {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  merchant_avg_6m: number | null;
  merchant_seen_count: number;
}

export interface MacroView {
  /** (income − expenses) / income for the reference month, in %. Null when no income. */
  savings_rate_pct: number | null;
  net_by_month: Array<{ m: string; net: number }>;
  totals_6m: { income: number; expenses: number; net: number };
  avg_monthly_expenses_6m: number;
  /** Recurring charges + active installment payments — the "can't easily move" load. */
  fixed_monthly: number;
  fixed_pct_of_income: number | null;
  /** How many days the current balance covers at the 3-month average daily spend. */
  runway_days: number | null;
  top_merchants_6m: Array<{ merchant: string; total: number; pct_of_expenses: number }>;
  /** Average spend per week-of-month (1=1st–7th … 5=29th+), over the last 3 full months. */
  week_of_month_spend: Array<{ week: number; avg: number }>;
}

/** Day-by-day balance projection to the end of next month (PLAN §8). */
export interface CashflowForecast {
  /** Opening balance the projection starts from. Null when no balance is known. */
  starting_balance: number;
  /** First day the projected balance goes negative, if any. */
  first_negative_date: string | null;
  /** Balance on that day — the number that makes the warning concrete. */
  first_negative_amount: number | null;
  lowest_point: { date: string; balance: number };
  projected_end_balance: number;
  /** Dated obligations the projection is built from, so every number is traceable. */
  upcoming: Array<{ date: string; label: string; amount: number; kind: 'recurring' | 'installment' | 'income' }>;
}

/** The one number that changes day-to-day decisions. */
export interface DiscretionaryView {
  /** Income expected this month (actual so far, or last month's if none yet). */
  expected_income: number;
  /** Recurring + installments still due this month. */
  fixed_remaining: number;
  /** Non-fixed spending already made this month. */
  spent_so_far: number;
  /** expected_income − fixed (whole month) − discretionary already spent. */
  left_to_spend: number;
  /** left_to_spend spread over the days remaining. Null on the last day. */
  per_day_remaining: number | null;
}

/** Anchors this month's spend against a typical one. */
export interface TypicalMonthView {
  /** Median, not mean: one ₪77k month would drag an average and mislead. */
  median_expenses: number;
  current_expenses: number;
  delta: number;
  delta_pct: number | null;
  months_compared: number;
}

/**
 * A recurring charge that quietly got more expensive — the leak that is hard
 * to catch by eye. Two distinct causes, and the fix differs:
 *  - 'price': each charge costs more (₪40 → ₪55 subscription hike).
 *  - 'frequency': the charge is the same but happens more often (Claude went
 *    from 1 to 7 charges in a month — usage, not a price change).
 * Reporting them as one number would be wrong: the per-charge average for
 * Claude actually FELL while the monthly bill nearly quadrupled.
 */
export interface PriceIncrease {
  merchant: string;
  kind: 'price' | 'frequency';
  old_amount: number;
  new_amount: number;
  delta: number;
  delta_pct: number;
  since: string;
  yearly_impact: number;
  /** Charge counts, for the frequency case. */
  old_count?: number;
  new_count?: number;
}

export interface FinancialBrief {
  month: string;
  as_of: string;
  cashflow: {
    income: number;
    expenses: number;
    net: number;
    prev_month_expenses: number;
    burn_rate_daily: number;
    days_left_in_month: number;
    naive_eom_balance: number | null;
    balances: Array<{ provider: string; balance: number; as_of: string }>;
    future_installment_obligations: number;
  };
  categories: CategoryStat[];
  recurring: RecurringMerchant[];
  fees: { current_month: number; total_6m: number };
  fx: { current_month: number; count_current_month: number };
  top_movers: Array<{ category: string; current: number; previous: number; delta: number }>;
  installment_plans: Array<{ merchant: string; paid: number; total: number; monthly_amount: number; remaining_amount: number }>;
  duplicate_charges: DuplicateCharge[];
  large_transactions: LargeTransaction[];
  forecast: CashflowForecast | null;
  discretionary: DiscretionaryView;
  typical_month: TypicalMonthView;
  price_increases: PriceIncrease[];
  fee_detail: Array<{ date: string; merchant: string; amount: number }>;
  fx_detail: Array<{ date: string; merchant: string; amount_ils: number; amount: number; currency: string }>;
  income_events: Array<{ date: string; merchant: string; amount: number }>;
  card_debits_by_month: Array<{ m: string; total: number }>;
  macro: MacroView;
  /** What the user taught the agent — ground truth that overrides inference. */
  user_context: {
    merchant_notes: Array<{ merchant: string; note: string; category: string | null; flag: string | null }>;
    open_questions: Array<{ id: number; question: string; date: string; merchant: string; amount: number }>;
    goals: GoalTracking[];
  };
}

const EXPENSE = `amount_ils < 0 AND is_transfer = 0`;
const MONTH = `strftime('%Y-%m', date)`;

function monthAdd(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function stats(values: number[]): { avg: number; std: number } {
  if (values.length === 0) return { avg: 0, std: 0 };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  return { avg, std: Math.sqrt(variance) };
}

export function buildBrief(db: Database, month: string, now: Date = new Date()): FinancialBrief {
  const from6 = monthAdd(month, -6);
  const prevMonth = monthAdd(month, -1);

  // --- Cashflow ---------------------------------------------------------
  const flow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount_ils > 0 AND is_transfer = 0 THEN amount_ils END), 0) AS income,
      COALESCE(-SUM(CASE WHEN ${EXPENSE} THEN amount_ils END), 0) AS expenses
    FROM transactions WHERE ${MONTH} = ?
  `).get(month) as { income: number; expenses: number };

  const prevFlow = db.prepare(`
    SELECT COALESCE(-SUM(amount_ils), 0) AS expenses
    FROM transactions WHERE ${EXPENSE} AND ${MONTH} = ?
  `).get(prevMonth) as { expenses: number };

  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const isCurrentMonth = now.toISOString().slice(0, 7) === month;
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
  const daysLeft = daysInMonth - dayOfMonth;
  const burnRate = round2(flow.expenses / Math.max(dayOfMonth, 1));

  const balances = (
    db.prepare(`SELECT key, value FROM agent_memory WHERE key LIKE 'balance.%'`).all() as { key: string; value: string }[]
  ).map((r) => {
    const parsed = JSON.parse(r.value) as { balance: number; asOf: string };
    return { provider: r.key.replace('balance.', ''), balance: parsed.balance, as_of: parsed.asOf };
  });
  const totalBalance = balances.length > 0 ? balances.reduce((a, b) => a + b.balance, 0) : null;

  // --- Installment plans (§5: future obligations) -----------------------
  // One plan = one purchase, identified by merchant + total installment
  // count + the FIRST charge's date (distinguishes two separate purchases
  // from the same merchant with the same total, e.g. two 1/3 gift vouchers).
  // Per-payment amount can vary slightly (rounding on the last installment),
  // so it is read from the latest-seen row, never used as a grouping key —
  // grouping by amount was the bug that split one real plan into duplicate
  // rows whenever an installment's charge differed by a few agorot.
  const planRows = db.prepare(`
    SELECT normalized_merchant AS merchant, installment_total AS total, installment_current AS current,
           -amount_ils AS amount, date
    FROM transactions
    WHERE installment_total IS NOT NULL AND ${EXPENSE}
    ORDER BY date
  `).all() as Array<{ merchant: string; total: number; current: number; amount: number; date: string }>;

  const planGroups = new Map<string, typeof planRows>();
  for (const row of planRows) {
    // Group by merchant+total+starting installment number (current - occurrence
    // index), approximated by merchant+total+first-seen date bucket: since
    // rows are date-ordered, a new plan starts whenever `current` resets to
    // a value ≤ the previous row's `current` for the same merchant+total.
    const key = `${row.merchant}\u0000${row.total}`;
    const existing = planGroups.get(key);
    if (!existing) { planGroups.set(key, [row]); continue; }
    const prev = existing[existing.length - 1]!;
    if (row.current <= prev.current) {
      // New plan cycle for the same merchant+total combo — give it a unique key.
      planGroups.set(`${key}\u0000${row.date}`, [row]);
    } else {
      existing.push(row);
    }
  }

  const plans = [...planGroups.values()]
    .map((rows) => {
      const last = rows[rows.length - 1]!;
      return {
        merchant: last.merchant,
        paid: last.current,
        total: last.total,
        monthly_amount: round2(last.amount),
        remaining_amount: round2((last.total - last.current) * last.amount),
      };
    })
    .filter((p) => p.paid < p.total)
    .sort((a, b) => b.remaining_amount - a.remaining_amount);
  const futureObligations = round2(plans.reduce((a, p) => a + p.remaining_amount, 0));

  // --- Categories: 6-month history → avg/std/z for the reference month ---
  const catMonthly = db.prepare(`
    SELECT COALESCE(category, 'ללא קטגוריה') AS category, ${MONTH} AS m, -SUM(amount_ils) AS total
    FROM transactions
    WHERE ${EXPENSE} AND ${MONTH} >= ? AND ${MONTH} <= ?
    GROUP BY 1, 2
  `).all(from6, month) as Array<{ category: string; m: string; total: number }>;

  const byCategory = new Map<string, Map<string, number>>();
  for (const row of catMonthly) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, new Map());
    byCategory.get(row.category)!.set(row.m, row.total);
  }
  const categories: CategoryStat[] = [...byCategory.entries()]
    .map(([category, months]) => {
      const history = [...months.entries()].filter(([m]) => m !== month).map(([, t]) => t);
      const current = months.get(month) ?? 0;
      const { avg, std } = stats(history);
      return {
        category,
        current_total: round2(current),
        months_with_data: history.length,
        avg_6m: round2(avg),
        std_6m: round2(std),
        z_score: history.length >= 3 && std > 0 ? round2((current - avg) / std) : null,
      };
    })
    .sort((a, b) => b.current_total - a.current_total);

  // --- Recurring merchants (§7): stable monthly charges ------------------
  const merchantMonthly = db.prepare(`
    SELECT normalized_merchant AS merchant, ${MONTH} AS m, -SUM(amount_ils) AS total, MAX(date) AS last_date
    FROM transactions
    WHERE ${EXPENSE} AND ${MONTH} >= ? AND ${MONTH} <= ?
    GROUP BY 1, 2
  `).all(from6, month) as Array<{ merchant: string; m: string; total: number; last_date: string }>;

  const byMerchant = new Map<string, Array<{ m: string; total: number; last_date: string }>>();
  for (const row of merchantMonthly) {
    if (!byMerchant.has(row.merchant)) byMerchant.set(row.merchant, []);
    byMerchant.get(row.merchant)!.push(row);
  }
  // Subscription vs recurring classification: category "כלי AI ותוכנה" /
  // "בידור וסטרימינג" and cancel-flagged merchants are cancellable
  // subscriptions; fixed real-world payments (rent, loans, utilities,
  // insurance) are recurring charges. A user 'cancel' flag forces dormant.
  const SUBSCRIPTION_CATS = new Set(['כלי AI ותוכנה', 'בידור וסטרימינג', 'מנויים דיגיטליים']);
  const merchantMeta = new Map(
    (db.prepare(`
      SELECT normalized_merchant AS m, MAX(category) AS category FROM transactions
      WHERE ${EXPENSE} GROUP BY normalized_merchant
    `).all() as Array<{ m: string; category: string | null }>).map((r) => [r.m, r.category]),
  );
  const cancelledMerchants = new Set(
    (db.prepare(`SELECT merchant FROM merchant_notes WHERE flag = 'cancel'`).all() as { merchant: string }[]).map((r) => r.merchant),
  );
  const asOfMs = now.getTime();
  const DORMANT_DAYS = 45;

  const recurring: RecurringMerchant[] = [...byMerchant.entries()]
    .flatMap(([merchant, rows]) => {
      const history = rows.filter((r) => r.m !== month);
      if (history.length < 3) return [];
      const { avg, std } = stats(history.map((r) => r.total));
      if (avg <= 0 || std / avg > 0.15) return []; // amount not stable → not a subscription-like charge
      const currentRow = rows.find((r) => r.m === month);
      const last = currentRow ?? history[history.length - 1]!;
      const daysSince = Math.max(Math.round((asOfMs - new Date(last.last_date).getTime()) / 86_400_000), 0);
      const category = merchantMeta.get(merchant) ?? null;
      const kind: 'subscription' | 'recurring' =
        cancelledMerchants.has(merchant) || (category && SUBSCRIPTION_CATS.has(category)) ? 'subscription' : 'recurring';
      const status: 'active' | 'dormant' =
        cancelledMerchants.has(merchant) || daysSince > DORMANT_DAYS ? 'dormant' : 'active';
      return [{
        merchant,
        months_seen_6m: history.length,
        avg_monthly_amount: round2(avg),
        last_amount: round2(last.total),
        last_date: last.last_date,
        deviation_pct: avg > 0 ? round2(((last.total - avg) / avg) * 100) : null,
        cadence: 'monthly' as const,
        kind,
        status,
        days_since_last: daysSince,
      }];
    })
    .sort((a, b) => b.avg_monthly_amount - a.avg_monthly_amount);

  // --- Fees / FX ---------------------------------------------------------
  const fees = db.prepare(`
    SELECT
      COALESCE(-SUM(CASE WHEN ${MONTH} = ? THEN amount_ils END), 0) AS current_month,
      COALESCE(-SUM(amount_ils), 0) AS total_6m
    FROM transactions WHERE is_fee = 1 AND ${EXPENSE} AND ${MONTH} >= ?
  `).get(month, from6) as { current_month: number; total_6m: number };

  const fx = db.prepare(`
    SELECT COALESCE(-SUM(amount_ils), 0) AS current_month, COUNT(*) AS count_current_month
    FROM transactions WHERE is_fx = 1 AND ${EXPENSE} AND ${MONTH} = ?
  `).get(month) as { current_month: number; count_current_month: number };

  // --- Top movers: current vs previous month, by category ----------------
  const movers = (
    db.prepare(`
      SELECT COALESCE(category, 'ללא קטגוריה') AS category,
             COALESCE(-SUM(CASE WHEN ${MONTH} = ? THEN amount_ils END), 0) AS current,
             COALESCE(-SUM(CASE WHEN ${MONTH} = ? THEN amount_ils END), 0) AS previous
      FROM transactions WHERE ${EXPENSE} AND ${MONTH} IN (?, ?)
      GROUP BY 1
    `).all(month, prevMonth, month, prevMonth) as Array<{ category: string; current: number; previous: number }>
  )
    .map((r) => ({ ...r, current: round2(r.current), previous: round2(r.previous), delta: round2(r.current - r.previous) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  // --- §8 sensors: duplicates, unusual transactions, fees/FX detail --------
  // Same merchant + same amount + same account within 3 days = possible
  // double billing. Installment rows excluded (identical by design); tiny
  // amounts excluded to cut noise. Same-day pairs are included on purpose —
  // the advisor asks the user to verify rather than assume.
  const duplicates = (
    db.prepare(`
      SELECT t1.normalized_merchant AS merchant, -t1.amount_ils AS amount,
             t1.date AS d1, t2.date AS d2, a.display_name AS account
      FROM transactions t1
      JOIN transactions t2 ON t1.account_id = t2.account_id
        AND t1.normalized_merchant = t2.normalized_merchant
        AND t1.amount_ils = t2.amount_ils
        AND t1.id < t2.id
        AND julianday(t2.date) - julianday(t1.date) <= 3
      JOIN accounts a ON a.id = t1.account_id
      WHERE t1.amount_ils <= -20 AND t1.is_transfer = 0 AND t2.is_transfer = 0
        AND t1.installment_total IS NULL AND t2.installment_total IS NULL
        AND strftime('%Y-%m', t2.date) = ?
    `).all(month) as Array<{ merchant: string; amount: number; d1: string; d2: string; account: string }>
  ).map((r) => ({ merchant: r.merchant, amount: round2(r.amount), dates: [r.d1, r.d2], account: r.account }));

  const largeTx = (
    db.prepare(`
      SELECT t.date, t.normalized_merchant AS merchant, -t.amount_ils AS amount,
             COALESCE(t.category, 'ללא קטגוריה') AS category,
             (SELECT ROUND(AVG(-t2.amount_ils), 2) FROM transactions t2
              WHERE t2.normalized_merchant = t.normalized_merchant AND t2.id != t.id
                AND t2.amount_ils < 0 AND t2.is_transfer = 0) AS merchant_avg_6m,
             (SELECT COUNT(*) FROM transactions t3
              WHERE t3.normalized_merchant = t.normalized_merchant) AS merchant_seen_count
      FROM transactions t
      WHERE t.amount_ils < 0 AND t.is_transfer = 0 AND strftime('%Y-%m', t.date) = ?
      ORDER BY t.amount_ils ASC LIMIT 8
    `).all(month) as LargeTransaction[]
  ).map((r) => ({ ...r, amount: round2(r.amount) }));

  const feeDetail = (
    db.prepare(`
      SELECT date, normalized_merchant AS merchant, -amount_ils AS amount
      FROM transactions WHERE is_fee = 1 AND ${EXPENSE} AND ${MONTH} = ? ORDER BY date
    `).all(month) as Array<{ date: string; merchant: string; amount: number }>
  ).map((r) => ({ ...r, amount: round2(r.amount) }));

  const fxDetail = (
    db.prepare(`
      SELECT date, normalized_merchant AS merchant, -amount_ils AS amount_ils, -amount AS amount, currency
      FROM transactions WHERE is_fx = 1 AND ${EXPENSE} AND ${MONTH} = ? ORDER BY amount_ils LIMIT 12
    `).all(month) as Array<{ date: string; merchant: string; amount_ils: number; amount: number; currency: string }>
  ).map((r) => ({ ...r, amount_ils: round2(r.amount_ils), amount: round2(r.amount) }));

  const incomeEvents = (
    db.prepare(`
      SELECT date, normalized_merchant AS merchant, amount_ils AS amount
      FROM transactions
      WHERE amount_ils > 0 AND is_transfer = 0 AND ${MONTH} = ?
      ORDER BY amount_ils DESC LIMIT 6
    `).all(month) as Array<{ date: string; merchant: string; amount: number }>
  ).map((r) => ({ ...r, amount: round2(r.amount) }));

  // Monthly consolidated card-debit load (is_transfer card rows in checking):
  // shows how heavy the card bill lands each month — a key cashflow signal.
  const cardDebits = (
    db.prepare(`
      SELECT ${MONTH} AS m, ROUND(-SUM(amount_ils), 2) AS total
      FROM transactions
      WHERE is_transfer = 1 AND amount_ils < 0 AND ${MONTH} >= ? AND ${MONTH} <= ?
      GROUP BY m ORDER BY m
    `).all(monthAdd(month, -3), month) as Array<{ m: string; total: number }>
  );

  // --- Macro view: the "big picture" numbers a person needs to decide ------
  const netByMonth = (
    db.prepare(`
      SELECT ${MONTH} AS m,
        ROUND(COALESCE(SUM(CASE WHEN amount_ils > 0 AND is_transfer = 0 THEN amount_ils END), 0)
            + COALESCE(SUM(CASE WHEN ${EXPENSE} THEN amount_ils END), 0), 2) AS net
      FROM transactions WHERE ${MONTH} <= ? GROUP BY m ORDER BY m DESC LIMIT 12
    `).all(month) as Array<{ m: string; net: number }>
  ).reverse();

  const totals6 = db.prepare(`
    SELECT
      ROUND(COALESCE(SUM(CASE WHEN amount_ils > 0 AND is_transfer = 0 THEN amount_ils END), 0), 2) AS income,
      ROUND(COALESCE(-SUM(CASE WHEN ${EXPENSE} THEN amount_ils END), 0), 2) AS expenses
    FROM transactions WHERE ${MONTH} > ? AND ${MONTH} <= ?
  `).get(from6, month) as { income: number; expenses: number };

  const monthsWithData = Math.max(
    (db.prepare(`SELECT COUNT(DISTINCT ${MONTH}) AS n FROM transactions WHERE ${MONTH} > ? AND ${MONTH} <= ?`)
      .get(from6, month) as { n: number }).n,
    1,
  );

  const installmentMonthly = round2(plans.reduce((a, p) => a + p.monthly_amount, 0));
  const recurringMonthly = round2(recurring.reduce((a, r) => a + r.avg_monthly_amount, 0));
  const fixedMonthly = round2(recurringMonthly + installmentMonthly);

  const expensesAvgDaily3m = (() => {
    const t = db.prepare(`
      SELECT COALESCE(-SUM(amount_ils), 0) AS total FROM transactions
      WHERE ${EXPENSE} AND ${MONTH} > ? AND ${MONTH} <= ?
    `).get(monthAdd(month, -3), month) as { total: number };
    return t.total / 90;
  })();

  const topMerchants = (
    db.prepare(`
      SELECT normalized_merchant AS merchant, ROUND(-SUM(amount_ils), 2) AS total
      FROM transactions WHERE ${EXPENSE} AND ${MONTH} > ? AND ${MONTH} <= ?
      GROUP BY normalized_merchant ORDER BY total DESC LIMIT 5
    `).all(from6, month) as Array<{ merchant: string; total: number }>
  ).map((r) => ({
    ...r,
    pct_of_expenses: totals6.expenses > 0 ? round2((r.total / totals6.expenses) * 100) : 0,
  }));

  const weekSpend = (
    db.prepare(`
      SELECT MIN(CAST((CAST(strftime('%d', date) AS INTEGER) - 1) / 7 + 1 AS INTEGER), 5) AS week,
             ROUND(-SUM(amount_ils) / 3.0, 2) AS avg
      FROM transactions
      WHERE ${EXPENSE} AND ${MONTH} >= ? AND ${MONTH} < ?
      GROUP BY week ORDER BY week
    `).all(monthAdd(month, -3), month) as Array<{ week: number; avg: number }>
  );

  const macro: MacroView = {
    savings_rate_pct: flow.income > 0 ? round2(((flow.income - flow.expenses) / flow.income) * 100) : null,
    net_by_month: netByMonth,
    totals_6m: { income: totals6.income, expenses: totals6.expenses, net: round2(totals6.income - totals6.expenses) },
    avg_monthly_expenses_6m: round2(totals6.expenses / monthsWithData),
    fixed_monthly: fixedMonthly,
    fixed_pct_of_income: flow.income > 0 ? round2((fixedMonthly / flow.income) * 100) : null,
    runway_days: totalBalance !== null && expensesAvgDaily3m > 0
      ? Math.max(Math.round(totalBalance / expensesAvgDaily3m), 0)
      : null,
    top_merchants_6m: topMerchants,
    week_of_month_spend: weekSpend,
  };

  // --- 1. Forward cashflow forecast --------------------------------------
  // Walks day by day from today's balance to the end of next month, applying
  // dated obligations. Every figure comes from SQL-derived history, never a
  // model: recurring charges land on the day of month they historically land
  // on, installments on their usual day, salary on its usual day.
  const forecast: CashflowForecast | null = (() => {
    if (totalBalance === null) return null;
    const dayOf = (iso: string): number => Number(iso.slice(8, 10));
    const events: CashflowForecast['upcoming'] = [];

    // Recurring charges that are still active — dormant ones are not expected.
    for (const r of recurring) {
      if (r.status !== 'active') continue;
      events.push({ date: `DAY-${dayOf(r.last_date)}`, label: r.merchant, amount: -r.avg_monthly_amount, kind: 'recurring' });
    }
    // Installments still running: only the months that remain.
    for (const p of plans) {
      events.push({ date: `DAY-${15}`, label: `${p.merchant} (תשלום ${p.paid + 1}/${p.total})`, amount: -p.monthly_amount, kind: 'installment' });
    }
    // Salary: use the most recent income event's day and amount as the
    // expectation. Nothing to project from means no income leg at all.
    const lastSalary = incomeEvents[0];
    if (lastSalary) {
      events.push({ date: `DAY-${dayOf(lastSalary.date)}`, label: lastSalary.merchant, amount: lastSalary.amount, kind: 'income' });
    }

    const today = new Date(now);
    const horizon = new Date(now);
    horizon.setMonth(horizon.getMonth() + 2, 0); // end of next month
    let balance = totalBalance;
    let lowest = { date: today.toISOString().slice(0, 10), balance };
    let firstNegDate: string | null = balance < 0 ? today.toISOString().slice(0, 10) : null;
    let firstNegAmount: number | null = balance < 0 ? round2(balance) : null;
    const dated: CashflowForecast['upcoming'] = [];

    for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const dom = d.getDate();
      for (const e of events) {
        if (Number(e.date.replace('DAY-', '')) !== dom) continue;
        balance += e.amount;
        dated.push({ date: iso, label: e.label, amount: round2(e.amount), kind: e.kind });
      }
      if (balance < lowest.balance) lowest = { date: iso, balance: round2(balance) };
      if (balance < 0 && firstNegDate === null) {
        firstNegDate = iso;
        firstNegAmount = round2(balance);
      }
    }
    return {
      starting_balance: round2(totalBalance),
      first_negative_date: firstNegDate,
      first_negative_amount: firstNegAmount,
      lowest_point: { date: lowest.date, balance: round2(lowest.balance) },
      projected_end_balance: round2(balance),
      upcoming: dated.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40),
    };
  })();

  // --- 2. "What's left to spend this month" -------------------------------
  // Fixed load counts for the WHOLE month (it is owed whether or not it has
  // been charged yet); discretionary counts only what has actually gone out.
  const discretionary: DiscretionaryView = (() => {
    // Early in a month no salary has landed yet, so fall back to last month's
    // income rather than reporting that everything is available to spend.
    const prevIncome = (db.prepare(`
      SELECT COALESCE(SUM(amount_ils), 0) AS income FROM transactions
      WHERE amount_ils > 0 AND is_transfer = 0 AND ${MONTH} = ?
    `).get(monthAdd(month, -1)) as { income: number }).income;
    const expectedIncome = flow.income > 0 ? flow.income : round2(prevIncome);
    const fixedRow = db.prepare(`
      SELECT COALESCE(-SUM(amount_ils), 0) AS total FROM transactions
      WHERE ${EXPENSE} AND ${MONTH} = ?
        AND normalized_merchant IN (SELECT merchant FROM subscriptions)
    `).get(month) as { total: number };
    const spentTotal = flow.expenses;
    const discretionarySpent = round2(Math.max(spentTotal - fixedRow.total, 0));
    const left = round2(expectedIncome - fixedMonthly - discretionarySpent);
    return {
      expected_income: round2(expectedIncome),
      fixed_remaining: round2(Math.max(fixedMonthly - fixedRow.total, 0)),
      spent_so_far: discretionarySpent,
      left_to_spend: left,
      per_day_remaining: daysLeft > 0 ? round2(left / daysLeft) : null,
    };
  })();

  // --- 3. This month vs a typical one -------------------------------------
  // MEDIAN, not mean: a single ₪77k month (May) would drag an average and
  // make every other month look artificially frugal.
  const typicalMonth: TypicalMonthView = (() => {
    const rows = db.prepare(`
      SELECT ${MONTH} AS m, ROUND(COALESCE(-SUM(amount_ils), 0), 2) AS total
      FROM transactions WHERE ${EXPENSE} AND ${MONTH} < ? AND ${MONTH} >= ?
      GROUP BY m HAVING total > 0 ORDER BY total
    `).all(month, from6) as Array<{ m: string; total: number }>;
    if (rows.length === 0) {
      return { median_expenses: 0, current_expenses: round2(flow.expenses), delta: 0, delta_pct: null, months_compared: 0 };
    }
    const mid = Math.floor(rows.length / 2);
    const median = rows.length % 2 === 0
      ? (rows[mid - 1]!.total + rows[mid]!.total) / 2
      : rows[mid]!.total;
    const delta = round2(flow.expenses - median);
    return {
      median_expenses: round2(median),
      current_expenses: round2(flow.expenses),
      delta,
      delta_pct: median > 0 ? round2((delta / median) * 100) : null,
      months_compared: rows.length,
    };
  })();

  // --- 4. Silent price increases ------------------------------------------
  // A subscription creeping from ₪40 to ₪55 never trips the anomaly detector,
  // because the category total barely moves. Compare each recurring merchant's
  // latest charge against its earlier baseline instead.
  const priceIncreaseRows = db.prepare(`
    -- AVG per charge, not SUM per month: two ₪500 rent cheques clearing in
    -- one month is not a rise from ₪500 to ₪1,000. A price increase means
    -- each individual charge got bigger.
    WITH monthly AS (
      SELECT normalized_merchant AS merchant, ${MONTH} AS m,
             ROUND(-AVG(amount_ils), 2) AS total,
             COUNT(*) AS cnt,
             ROUND(-SUM(amount_ils), 2) AS spend
      FROM transactions WHERE ${EXPENSE} AND ${MONTH} >= ?
      GROUP BY 1, 2
    ), ranked AS (
      SELECT merchant, m, total, cnt, spend,
             ROW_NUMBER() OVER (PARTITION BY merchant ORDER BY m DESC) AS rn,
             COUNT(*) OVER (PARTITION BY merchant) AS months
      FROM monthly
    )
    SELECT r.merchant,
           r.total AS new_amount,
           ROUND(AVG(o.total), 2) AS old_amount,
           r.cnt AS new_count,
           ROUND(AVG(o.cnt), 2) AS old_count,
           r.spend AS new_spend,
           ROUND(AVG(o.spend), 2) AS old_spend,
           r.m AS since
    FROM ranked r JOIN ranked o ON o.merchant = r.merchant AND o.rn > 1
    WHERE r.rn = 1 AND r.months >= 3
    GROUP BY r.merchant
    -- Either the per-charge price rose, or the monthly bill rose because the
    -- charge repeats more often. Both are real leaks; they are labelled apart.
    HAVING (new_amount > old_amount * 1.15 AND new_amount - old_amount >= 5)
        OR (new_spend > old_spend * 1.3 AND new_spend - old_spend >= 50 AND new_count > old_count)
    -- No LIMIT here: ranking by shekels alone buried a real Netflix price
    -- hike below one-off supermarket swings, and the non-recurring rows are
    -- filtered out in TS afterwards — so a LIMIT would spend its slots on
    -- merchants that get discarded anyway.
    ORDER BY (new_spend - old_spend) DESC
  `).all(from6) as Array<{
    merchant: string; new_amount: number; old_amount: number;
    new_count: number; old_count: number; new_spend: number; old_spend: number; since: string;
  }>;
  const recurringNames = new Set(recurring.map((r) => r.merchant));
  const priceIncreasesFiltered: PriceIncrease[] = priceIncreaseRows
    // Only steady, recurring charges: a one-off big purchase is not a price hike.
    .filter((p) => recurringNames.has(p.merchant))
    .map((p) => {
      const priceRose = p.new_amount > p.old_amount * 1.15 && p.new_amount - p.old_amount >= 5;
      // Report the figure that actually explains the extra money: the charge
      // price when that rose, the monthly bill when the cause is repetition.
      const [oldV, newV] = priceRose ? [p.old_amount, p.new_amount] : [p.old_spend, p.new_spend];
      const delta = round2(newV - oldV);
      return {
        merchant: p.merchant,
        kind: (priceRose ? 'price' : 'frequency') as PriceIncrease['kind'],
        old_amount: oldV,
        new_amount: newV,
        delta,
        delta_pct: oldV > 0 ? round2((delta / oldV) * 100) : 0,
        since: p.since,
        yearly_impact: round2(delta * 12),
        ...(priceRose ? {} : { old_count: p.old_count, new_count: p.new_count }),
      };
    })
    // A price hike is a permanent leak; a busy month is not. Surface hikes
    // first even when their shekel delta is smaller, then cap the list.
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'price' ? -1 : 1;
      return b.delta - a.delta;
    })
    .slice(0, 8);

  return {
    month,
    as_of: now.toISOString(),
    cashflow: {
      income: round2(flow.income),
      expenses: round2(flow.expenses),
      net: round2(flow.income - flow.expenses),
      prev_month_expenses: round2(prevFlow.expenses),
      burn_rate_daily: burnRate,
      days_left_in_month: daysLeft,
      // Naive projection, clearly labeled: balance minus expected remaining burn.
      naive_eom_balance: totalBalance === null ? null : round2(totalBalance - burnRate * daysLeft),
      balances,
      future_installment_obligations: futureObligations,
    },
    categories,
    recurring,
    fees: { current_month: round2(fees.current_month), total_6m: round2(fees.total_6m) },
    fx: { current_month: round2(fx.current_month), count_current_month: fx.count_current_month },
    top_movers: movers,
    installment_plans: plans,
    duplicate_charges: duplicates,
    large_transactions: largeTx,
    forecast,
    discretionary,
    typical_month: typicalMonth,
    price_increases: priceIncreasesFiltered,
    fee_detail: feeDetail,
    fx_detail: fxDetail,
    income_events: incomeEvents,
    card_debits_by_month: cardDebits,
    macro,
    user_context: {
      merchant_notes: db.prepare(`SELECT merchant, note, category, flag FROM merchant_notes ORDER BY updated_at DESC`)
        .all() as FinancialBrief['user_context']['merchant_notes'],
      open_questions: db.prepare(`
        SELECT q.id, q.question, t.date, t.normalized_merchant AS merchant, t.amount_ils AS amount
        FROM tx_questions q JOIN transactions t ON t.id = q.tx_id
        WHERE q.status = 'open' ORDER BY q.created_at
      `).all() as FinancialBrief['user_context']['open_questions'],
      goals: buildGoalTracking(db, month, now),
    },
  };
}
