import type { Database } from 'better-sqlite3';
import { buildBrief, type FinancialBrief } from '../features/brief.js';

/**
 * Dashboard query layer — read-mostly SQL over the local DB. Everything here
 * stays on the machine (the dashboard binds to 127.0.0.1 only), so raw
 * transaction rows are fine to serve; the cloud still only ever sees the
 * aggregated Brief (PLAN.md §18).
 */

export interface DashboardSummary {
  generated_at: string;
  month: string;
  months_available: string[];
  brief: FinancialBrief;
  /** null on a first visit — with no marker everything would read as new. */
  since_last_visit: {
    since: string;
    new_transactions: number;
    new_spend: number;
    new_alerts: number;
    new_recommendations: number;
    top_new: Array<{ merchant: string; amount: number; date: string }>;
  } | null;
  /** partial = the checking account has no data for that month, so income is
   *  missing rather than genuinely zero. */
  history: Array<{ m: string; income: number; expenses: number; partial?: boolean }>;
  accounts: Array<{ id: number; type: string; provider: string; display_name: string; tx_count: number; last_date: string | null }>;
  alerts: Array<{ id: number; created_at: string; type: string; severity: string; message: string }>;
  recommendations: Array<{ id: number; created_at: string; title: string; rationale: string; category: string | null; details: unknown; est_saving_ils: number | null; effort: string | null; confidence: number | null }>;
  advisor_review: { summary: string; urgent_actions: string[]; generated_at: string } | null;
  recommendation_stats: { accepted: number; dismissed: number; done: number };
  subscriptions: Array<{ merchant: string; avg_amount: number; cadence: string; last_seen: string; status: string }>;
  last_ingest: Array<{ provider: string; updated_at: string }>;
  categories_all: string[];
  merchant_notes: Array<{ merchant: string; note: string; category: string | null; flag: string | null; updated_at: string; last_charge: string | null; last_amount: number | null; days_since: number | null }>;
  questions: Array<{ id: number; question: string; status: string; answer: string | null; created_at: string; date: string; merchant: string; amount: number }>;
  goals: FinancialBrief['user_context']['goals'];
  reports: Array<{ period: string; path: string; month: string; generated_at: string; updated_at: string }>;
  automation_runs: Array<{ job: string; value: string; updated_at: string }>;
  last_event_scan: { alerts: number; subscriptions: number; scanned_at: string; updated_at: string } | null;
}

const EXPENSE = `amount_ils < 0 AND is_transfer = 0`;
const MONTH = `strftime('%Y-%m', date)`;

export function buildSummary(db: Database, month: string): DashboardSummary {
  const brief = buildBrief(db, month);

  const history = db.prepare(`
    SELECT ${MONTH} AS m,
      ROUND(COALESCE(SUM(CASE WHEN amount_ils > 0 AND is_transfer = 0 THEN amount_ils END), 0), 2) AS income,
      ROUND(COALESCE(-SUM(CASE WHEN ${EXPENSE} THEN amount_ils END), 0), 2) AS expenses
    FROM transactions GROUP BY m ORDER BY m DESC LIMIT 12
  `).all() as DashboardSummary['history'];
  history.reverse();

  // Salary lands in the checking account, so months before that account's
  // history begins show ~zero income and read as "you earned nothing" — when
  // the truth is "we have no data". Hapoalim does not serve checking
  // transactions older than this, even with a 12-month scrape, so the gap is
  // permanent and the chart has to say so rather than imply a real zero.
  // Keyed off the first real INCOME row, not the first checking row: one
  // account holds nothing but a single day's loan pair (both is_transfer=1),
  // and using MIN(date) over all checking rows let that lone date mask five
  // months that genuinely have no salary data.
  const checkingStart = (db.prepare(`
    SELECT MIN(t.date) AS d FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.type = 'checking' AND t.amount_ils > 0 AND t.is_transfer = 0
  `).get() as { d: string | null }).d;
  const partialBefore = checkingStart ? checkingStart.slice(0, 7) : null;
  for (const row of history) {
    row.partial = partialBefore !== null && row.m < partialBefore;
  }

  const monthsAvailable = (
    db.prepare(`SELECT DISTINCT ${MONTH} AS m FROM transactions ORDER BY m DESC`).all() as { m: string }[]
  ).map((r) => r.m);

  const accounts = db.prepare(`
    SELECT a.id, a.type, a.provider, a.display_name,
           COUNT(t.id) AS tx_count, MAX(t.date) AS last_date
    FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id ORDER BY a.type, a.provider
  `).all() as DashboardSummary['accounts'];

  const alerts = db.prepare(`
    SELECT id, created_at, type, severity, message FROM alerts WHERE dismissed = 0 ORDER BY created_at DESC
  `).all() as DashboardSummary['alerts'];

  const recommendations = (
    db.prepare(`
      SELECT id, created_at, title, rationale, category, details, est_saving_ils, effort, confidence
      FROM recommendations WHERE status = 'new' ORDER BY est_saving_ils DESC
    `).all() as Array<DashboardSummary['recommendations'][number] & { details: string | null }>
  ).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));

  const reviewRow = db.prepare(`SELECT value FROM agent_memory WHERE key = ?`)
    .get(`advisor_review.${month}`) as { value: string } | undefined;
  const advisorReview = reviewRow ? (JSON.parse(reviewRow.value) as DashboardSummary['advisor_review']) : null;

  const recStats = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM recommendations
  `).get() as { accepted: number | null; dismissed: number | null; done: number | null };

  const subscriptions = db.prepare(`
    SELECT merchant, avg_amount, cadence, last_seen, status FROM subscriptions ORDER BY avg_amount DESC
  `).all() as DashboardSummary['subscriptions'];

  const lastIngest = (
    db.prepare(`SELECT key, updated_at FROM agent_memory WHERE key LIKE 'last_ingest.%'`).all() as { key: string; updated_at: string }[]
  ).map((r) => ({ provider: r.key.replace('last_ingest.', ''), updated_at: r.updated_at }));

  // Known categories = those seen in data + those the user created via notes,
  // minus the "uncategorized" bucket (never a target you assign TO).
  const categoriesAll = (
    db.prepare(`
      SELECT DISTINCT c FROM (
        SELECT category AS c FROM transactions WHERE category IS NOT NULL
        UNION SELECT category FROM merchant_notes WHERE category IS NOT NULL
      ) ORDER BY c
    `).all() as { c: string }[]
  ).map((r) => r.c);

  const reportRows = db.prepare(`SELECT key, value, updated_at FROM agent_memory WHERE key LIKE 'last_report.%' ORDER BY updated_at DESC`)
    .all() as Array<{ key: string; value: string; updated_at: string }>;
  const reports = reportRows.flatMap((row) => {
    try {
      const value = JSON.parse(row.value) as { path: string; month: string; generated_at: string };
      return [{ period: row.key.replace('last_report.', ''), ...value, updated_at: row.updated_at }];
    } catch { return []; }
  });
  const automationRuns = db.prepare(`SELECT key, value, updated_at FROM agent_memory WHERE key LIKE 'automation.last_success.%' ORDER BY updated_at DESC`)
    .all() as Array<{ key: string; value: string; updated_at: string }>;
  const eventRow = db.prepare(`SELECT value, updated_at FROM agent_memory WHERE key = 'last_event_scan'`)
    .get() as { value: string; updated_at: string } | undefined;
  let lastEventScan: DashboardSummary['last_event_scan'] = null;
  if (eventRow) {
    try { lastEventScan = { ...(JSON.parse(eventRow.value) as Omit<NonNullable<DashboardSummary['last_event_scan']>, 'updated_at'>), updated_at: eventRow.updated_at }; }
    catch { lastEventScan = null; }
  }

  // --- "What changed since you last looked" -------------------------------
  // Keyed off ingested_at, not `date`: a charge dated last week that arrived
  // in today's scrape is new TO THE USER. On a first visit there is no marker,
  // and everything would look new — so we report nothing rather than a
  // meaningless "1,185 new charges".
  const seenRow = db.prepare(`SELECT value FROM agent_memory WHERE key = 'dashboard.last_seen'`)
    .get() as { value: string } | undefined;
  const since = seenRow?.value ?? null;
  let sinceLastVisit: DashboardSummary['since_last_visit'] = null;
  if (since) {
    const newTx = db.prepare(`
      SELECT COUNT(*) AS count,
             ROUND(COALESCE(-SUM(CASE WHEN ${EXPENSE} THEN amount_ils END), 0), 2) AS spend
      FROM transactions WHERE ingested_at > ?
    `).get(since) as { count: number; spend: number };
    const newAlerts = db.prepare(
      `SELECT COUNT(*) AS n FROM alerts WHERE dismissed = 0 AND created_at > ?`
    ).get(since) as { n: number };
    const newRecs = db.prepare(
      `SELECT COUNT(*) AS n FROM recommendations WHERE status = 'new' AND created_at > ?`
    ).get(since) as { n: number };
    const topNew = db.prepare(`
      SELECT normalized_merchant AS merchant, ROUND(-amount_ils, 2) AS amount, date
      FROM transactions
      WHERE ingested_at > ? AND ${EXPENSE}
      ORDER BY amount_ils ASC LIMIT 3
    `).all(since) as Array<{ merchant: string; amount: number; date: string }>;
    sinceLastVisit = {
      since,
      new_transactions: newTx.count,
      new_spend: newTx.spend,
      new_alerts: newAlerts.n,
      new_recommendations: newRecs.n,
      top_new: topNew,
    };
  }

  return {
    generated_at: new Date().toISOString(),
    month,
    months_available: monthsAvailable,
    brief,
    since_last_visit: sinceLastVisit,
    history,
    accounts,
    alerts,
    recommendations,
    advisor_review: advisorReview,
    recommendation_stats: {
      accepted: recStats.accepted ?? 0,
      dismissed: recStats.dismissed ?? 0,
      done: recStats.done ?? 0,
    },
    subscriptions,
    last_ingest: lastIngest,
    categories_all: categoriesAll,
    goals: brief.user_context.goals,
    reports,
    automation_runs: automationRuns.map((row) => ({ job: row.key.replace('automation.last_success.', ''), value: row.value, updated_at: row.updated_at })),
    last_event_scan: lastEventScan,
    merchant_notes: db.prepare(`
      SELECT n.merchant, n.note, n.category, n.flag, n.updated_at,
             lc.last_charge, lc.last_amount,
             CASE WHEN lc.last_charge IS NULL THEN NULL
                  ELSE CAST(julianday('now') - julianday(lc.last_charge) AS INTEGER) END AS days_since
      FROM merchant_notes n
      LEFT JOIN (
        SELECT normalized_merchant AS m, MAX(date) AS last_charge,
               ROUND(-(SELECT amount_ils FROM transactions t2
                       WHERE t2.normalized_merchant = t.normalized_merchant
                       ORDER BY date DESC, id DESC LIMIT 1), 2) AS last_amount
        FROM transactions t WHERE amount_ils < 0 GROUP BY normalized_merchant
      ) lc ON lc.m = n.merchant
      -- Show only meaningful teachings: flags (cancel/transfer) or a
      -- hand-written note. Bulk auto-categorization rows are just quiet
      -- classification, not something the user "taught" — keep them out of
      -- this list so it stays focused.
      WHERE n.flag IS NOT NULL
         OR (n.note NOT LIKE 'סווג אוטומטית%' AND n.note NOT LIKE 'סווג ידנית%')
      ORDER BY n.updated_at DESC
    `).all() as DashboardSummary['merchant_notes'],
    questions: db.prepare(`
      SELECT q.id, q.question, q.status, q.answer, q.created_at,
             t.date, t.normalized_merchant AS merchant, t.amount_ils AS amount
      FROM tx_questions q JOIN transactions t ON t.id = q.tx_id
      ORDER BY q.status = 'open' DESC, q.created_at DESC LIMIT 30
    `).all() as DashboardSummary['questions'],
  };
}

export interface MerchantSummaryRow {
  merchant: string;
  category: string;
  month_total: number;
  month_count: number;
  total_6m: number;
  avg_monthly_6m: number;
  pct_of_6m: number;
  months_active: number;
  last_date: string;
}

export interface CategorySummaryRow {
  category: string;
  month_total: number;
  month_count: number;
  total_6m: number;
  avg_monthly_6m: number;
  pct_of_6m: number;
}

export interface ChargeSummaries {
  month: string;
  merchants: MerchantSummaryRow[];
  categories: CategorySummaryRow[];
  totals: { month_expenses: number; six_month_expenses: number };
}

/**
 * Aggregated charge summaries by merchant and by category — the "where does
 * the money actually go" tables. Expenses only, transfers excluded.
 */
export function buildChargeSummaries(db: Database, month: string): ChargeSummaries {
  const from = db.prepare(`SELECT strftime('%Y-%m', date(? || '-01', '-5 months')) AS m`).get(month) as { m: string };

  const totals = db.prepare(`
    SELECT
      ROUND(COALESCE(-SUM(CASE WHEN ${MONTH} = @month THEN amount_ils END), 0), 2) AS month_expenses,
      ROUND(COALESCE(-SUM(amount_ils), 0), 2) AS six_month_expenses
    FROM transactions
    WHERE amount_ils < 0 AND is_transfer = 0 AND ${MONTH} >= @from AND ${MONTH} <= @month
  `).get({ month, from: from.m }) as { month_expenses: number; six_month_expenses: number };

  const merchants = (
    db.prepare(`
      SELECT normalized_merchant AS merchant,
             COALESCE(MAX(category), 'ללא קטגוריה') AS category,
             ROUND(COALESCE(-SUM(CASE WHEN ${MONTH} = @month THEN amount_ils END), 0), 2) AS month_total,
             SUM(CASE WHEN ${MONTH} = @month THEN 1 ELSE 0 END) AS month_count,
             ROUND(-SUM(amount_ils), 2) AS total_6m,
             COUNT(DISTINCT ${MONTH}) AS months_active,
             MAX(date) AS last_date
      FROM transactions
      WHERE amount_ils < 0 AND is_transfer = 0 AND ${MONTH} >= @from AND ${MONTH} <= @month
      GROUP BY normalized_merchant
      ORDER BY total_6m DESC
      LIMIT 200
    `).all({ month, from: from.m }) as Array<Omit<MerchantSummaryRow, 'avg_monthly_6m' | 'pct_of_6m'>>
  ).map((r) => ({
    ...r,
    avg_monthly_6m: Math.round((r.total_6m / 6) * 100) / 100,
    pct_of_6m: totals.six_month_expenses > 0 ? Math.round((r.total_6m / totals.six_month_expenses) * 1000) / 10 : 0,
  }));

  const categories = (
    db.prepare(`
      SELECT COALESCE(category, 'ללא קטגוריה') AS category,
             ROUND(COALESCE(-SUM(CASE WHEN ${MONTH} = @month THEN amount_ils END), 0), 2) AS month_total,
             SUM(CASE WHEN ${MONTH} = @month THEN 1 ELSE 0 END) AS month_count,
             ROUND(-SUM(amount_ils), 2) AS total_6m
      FROM transactions
      WHERE amount_ils < 0 AND is_transfer = 0 AND ${MONTH} >= @from AND ${MONTH} <= @month
      GROUP BY 1
      ORDER BY total_6m DESC
    `).all({ month, from: from.m }) as Array<Omit<CategorySummaryRow, 'avg_monthly_6m' | 'pct_of_6m'>>
  ).map((r) => ({
    ...r,
    avg_monthly_6m: Math.round((r.total_6m / 6) * 100) / 100,
    pct_of_6m: totals.six_month_expenses > 0 ? Math.round((r.total_6m / totals.six_month_expenses) * 1000) / 10 : 0,
  }));

  return { month, merchants, categories, totals };
}

export interface AccountBreakdown {
  id: number;
  type: 'checking' | 'card';
  provider: string;
  display_name: string;
  month_expenses: number;
  month_income: number;
  month_transfers: number;
  month_fees: number;
  month_tx_count: number;
  avg_expenses_6m: number;
  top_categories: Array<{ category: string; total: number }>;
  top_merchants: Array<{ merchant: string; total: number }>;
  last_date: string | null;
}

export interface AccountsView {
  month: string;
  cards: AccountBreakdown[];
  checking: AccountBreakdown[];
  totals: {
    card_spend: number;      // real discretionary spend (source of truth)
    checking_spend: number;  // checking-only expenses, transfers excluded
    income: number;
    transfers: number;       // internal moves + consolidated card debits
  };
}

/**
 * Per-account / per-card breakdown — the advisor view that separates
 * checking (income, fixed obligations, internal moves) from cards (where the
 * real discretionary spending happens). Card accounts are the source of truth
 * for spend; the consolidated card debit in checking is a transfer (§5).
 */
export function buildAccountsView(db: Database, month: string): AccountsView {
  const from6 = db.prepare(`SELECT strftime('%Y-%m', date(? || '-01', '-5 months')) AS m`).get(month) as { m: string };

  const accounts = db.prepare(`SELECT id, type, provider, display_name FROM accounts ORDER BY type, id`)
    .all() as Array<{ id: number; type: 'checking' | 'card'; provider: string; display_name: string }>;

  const breakdown = (acc: typeof accounts[number]): AccountBreakdown => {
    const m = db.prepare(`
      SELECT
        ROUND(COALESCE(-SUM(CASE WHEN amount_ils < 0 AND is_transfer = 0 THEN amount_ils END), 0), 2) AS expenses,
        ROUND(COALESCE(SUM(CASE WHEN amount_ils > 0 AND is_transfer = 0 THEN amount_ils END), 0), 2) AS income,
        ROUND(COALESCE(SUM(CASE WHEN is_transfer = 1 THEN ABS(amount_ils) END), 0), 2) AS transfers,
        ROUND(COALESCE(-SUM(CASE WHEN is_fee = 1 THEN amount_ils END), 0), 2) AS fees,
        COUNT(*) AS n, MAX(date) AS last_date
      FROM transactions WHERE account_id = @id AND ${MONTH} = @month
    `).get({ id: acc.id, month }) as { expenses: number; income: number; transfers: number; fees: number; n: number; last_date: string | null };

    const avg = (db.prepare(`
      SELECT ROUND(COALESCE(-SUM(amount_ils), 0) / 6.0, 2) AS a
      FROM transactions WHERE account_id = @id AND amount_ils < 0 AND is_transfer = 0
        AND ${MONTH} >= @from AND ${MONTH} <= @month
    `).get({ id: acc.id, month, from: from6.m }) as { a: number }).a;

    const topCategories = db.prepare(`
      SELECT COALESCE(category, 'ללא קטגוריה') AS category, ROUND(-SUM(amount_ils), 2) AS total
      FROM transactions WHERE account_id = @id AND amount_ils < 0 AND is_transfer = 0 AND ${MONTH} = @month
      GROUP BY 1 ORDER BY total DESC LIMIT 5
    `).all({ id: acc.id, month }) as Array<{ category: string; total: number }>;

    const topMerchants = db.prepare(`
      SELECT normalized_merchant AS merchant, ROUND(-SUM(amount_ils), 2) AS total
      FROM transactions WHERE account_id = @id AND amount_ils < 0 AND is_transfer = 0 AND ${MONTH} = @month
      GROUP BY 1 ORDER BY total DESC LIMIT 5
    `).all({ id: acc.id, month }) as Array<{ merchant: string; total: number }>;

    return {
      id: acc.id, type: acc.type, provider: acc.provider, display_name: acc.display_name,
      month_expenses: m.expenses, month_income: m.income, month_transfers: m.transfers,
      month_fees: m.fees, month_tx_count: m.n, avg_expenses_6m: avg,
      top_categories: topCategories, top_merchants: topMerchants, last_date: m.last_date,
    };
  };

  const cards = accounts.filter((a) => a.type === 'card').map(breakdown);
  const checking = accounts.filter((a) => a.type === 'checking').map(breakdown);

  return {
    month, cards, checking,
    totals: {
      card_spend: Math.round(cards.reduce((s, a) => s + a.month_expenses, 0) * 100) / 100,
      checking_spend: Math.round(checking.reduce((s, a) => s + a.month_expenses, 0) * 100) / 100,
      income: Math.round(checking.reduce((s, a) => s + a.month_income, 0) * 100) / 100,
      transfers: Math.round(checking.reduce((s, a) => s + a.month_transfers, 0) * 100) / 100,
    },
  };
}

/**
 * Breakdown of the "העברות פנימיות" (internal transfers) KPI on the accounts
 * tab — answers "what is this?": the consolidated card-company debit in
 * checking (the §5 double-count guard) plus any other internal moves
 * (savings deposits/withdrawals). Never real spending — is_transfer=1 rows.
 */
export function buildTransfersDetail(db: Database, month: string): Array<{ merchant: string; total: number }> {
  return db.prepare(`
    SELECT normalized_merchant AS merchant, ROUND(-SUM(amount_ils), 2) AS total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.type = 'checking' AND is_transfer = 1 AND amount_ils < 0 AND ${MONTH} = ?
    GROUP BY normalized_merchant ORDER BY total DESC
  `).all(month) as Array<{ merchant: string; total: number }>;
}

export interface TransactionFilters {
  month?: string;
  category?: string;
  accountId?: number;
  q?: string;
  limit: number;
  offset: number;
}

export function listTransactions(db: Database, filters: TransactionFilters): { rows: unknown[]; total: number; total_filtered: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.month) {
    where.push(`${MONTH} = @month`);
    params['month'] = filters.month;
  }
  if (filters.category) {
    if (filters.category === 'ללא קטגוריה') where.push(`t.category IS NULL`);
    else {
      where.push(`t.category = @category`);
      params['category'] = filters.category;
    }
  }
  if (filters.accountId) {
    where.push(`t.account_id = @accountId`);
    params['accountId'] = filters.accountId;
  }
  if (filters.q) {
    where.push(`(t.normalized_merchant LIKE @q OR t.raw_description LIKE @q)`);
    params['q'] = `%${filters.q}%`;
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const agg = db.prepare(`
    SELECT COUNT(*) AS n, ROUND(COALESCE(-SUM(CASE WHEN amount_ils < 0 THEN amount_ils END), 0), 2) AS spent
    FROM transactions t ${whereSql}
  `).get(params) as { n: number; spent: number };
  const total = agg.n;

  const rows = db.prepare(`
    SELECT t.id, t.date, t.charge_date, t.amount_ils, t.currency, t.amount,
           t.normalized_merchant, COALESCE(t.category, 'ללא קטגוריה') AS category,
           t.is_transfer, t.is_fee, t.is_fx, t.installment_current, t.installment_total,
           a.display_name AS account
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    ${whereSql}
    ORDER BY t.date DESC, t.id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: filters.limit, offset: filters.offset });

  return { rows, total, total_filtered: agg.spent };
}
