export type TabId =
  "overview" | "accounts" | "spending" | "commitments" | "manage"

export interface CategoryStat {
  category: string
  current_total: number
  avg_6m: number
  z_score: number | null
}

export interface Goal {
  id: number
  title: string
  type: "save_by_date" | "cut_category" | "cap_monthly"
  target_amount: number
  category: string | null
  deadline: string | null
  progress: number
  status: string
  // These must match what src/goals/tracking.ts actually returns. An earlier
  // version of this interface invented current_amount/target_progress_pct/
  // on_track/guidance, which the API never sent — so the goal cards rendered
  // with undefined values and showed no corrective step at all.
  current_value: number
  progress_pct: number
  state: "on_track" | "at_risk" | "off_track" | "completed" | "paused"
  corrective_action: string
  remaining: number
  expected_by_now: number | null
  days_left: number | null
  required_monthly: number | null
  manual_progress: number
}

export interface DashboardSummary {
  generated_at: string
  month: string
  months_available: string[]
  /** null on a first visit — no marker means everything would read as new. */
  since_last_visit: {
    since: string
    new_transactions: number
    new_spend: number
    new_alerts: number
    new_recommendations: number
    top_new: Array<{ merchant: string; amount: number; date: string }>
  } | null
  brief: {
    cashflow: {
      income: number
      expenses: number
      net: number
      prev_month_expenses: number
      burn_rate_daily: number
      days_left_in_month: number
      naive_eom_balance: number | null
      balances: Array<{ provider: string; balance: number; as_of: string }>
      future_installment_obligations: number
    }
    categories: CategoryStat[]
    recurring: Array<{
      merchant: string
      avg_monthly_amount: number
      last_amount: number
      last_date: string
      deviation_pct: number | null
      kind: "subscription" | "recurring"
      status: "active" | "dormant"
      days_since_last: number
    }>
    fees: { current_month: number; total_6m: number }
    fx: { current_month: number; count_current_month: number }
    top_movers: Array<{
      category: string
      current: number
      previous: number
      delta: number
    }>
    installment_plans: Array<{
      merchant: string
      paid: number
      total: number
      monthly_amount: number
      remaining_amount: number
    }>
    duplicate_charges: Array<{
      merchant: string
      amount: number
      dates: string[]
      account: string
    }>
    large_transactions: Array<{
      date: string
      merchant: string
      amount: number
      category: string
    }>
    forecast: {
      starting_balance: number
      first_negative_date: string | null
      first_negative_amount: number | null
      lowest_point: { date: string; balance: number }
      projected_end_balance: number
      upcoming: Array<{
        date: string
        label: string
        amount: number
        kind: "recurring" | "installment" | "income"
      }>
    } | null
    discretionary: {
      expected_income: number
      fixed_remaining: number
      spent_so_far: number
      left_to_spend: number
      per_day_remaining: number | null
    }
    typical_month: {
      median_expenses: number
      current_expenses: number
      delta: number
      delta_pct: number | null
      months_compared: number
    }
    price_increases: Array<{
      merchant: string
      kind: "price" | "frequency"
      old_amount: number
      new_amount: number
      delta: number
      delta_pct: number
      since: string
      yearly_impact: number
      old_count?: number
      new_count?: number
    }>
    macro: {
      savings_rate_pct: number | null
      net_by_month: Array<{ m: string; net: number }>
      totals_6m: { income: number; expenses: number; net: number }
      avg_monthly_expenses_6m: number
      fixed_monthly: number
      fixed_pct_of_income: number | null
      runway_days: number | null
      top_merchants_6m: Array<{
        merchant: string
        total: number
        pct_of_expenses: number
      }>
      week_of_month_spend: Array<{ week: number; avg: number }>
    }
  }
  /** partial = no checking data that month, so income is missing not zero. */
  history: Array<{ m: string; income: number; expenses: number; partial?: boolean }>
  accounts: Array<{
    id: number
    type: string
    provider: string
    display_name: string
    tx_count: number
    last_date: string | null
  }>
  alerts: Array<{
    id: number
    created_at: string
    type: string
    severity: string
    message: string
  }>
  recommendations: Array<{
    id: number
    created_at: string
    title: string
    rationale: string
    category: string | null
    details: {
      what_happened?: string
      breakdown?: Array<{ label: string; amount: number }>
      change?: {
        baseline_label: string
        baseline: number
        current_label: string
        current: number
      }
      impact_monthly?: number
      impact_yearly?: number
      steps?: string[]
    } | null
    est_saving_ils: number | null
    effort: string | null
    confidence: number | null
  }>
  advisor_review: {
    summary: string
    urgent_actions: string[]
    generated_at: string
  } | null
  recommendation_stats: { accepted: number; dismissed: number; done: number }
  subscriptions: Array<{
    merchant: string
    avg_amount: number
    cadence: string
    last_seen: string
    status: string
  }>
  categories_all: string[]
  merchant_notes: Array<{
    merchant: string
    note: string
    category: string | null
    flag: string | null
    updated_at: string
    last_charge: string | null
    last_amount: number | null
    days_since: number | null
  }>
  questions: Array<{
    id: number
    question: string
    status: string
    answer: string | null
    created_at: string
    date: string
    merchant: string
    amount: number
  }>
  goals: Goal[]
  reports: Array<{
    period: string
    path: string
    month: string
    generated_at: string
    updated_at: string
  }>
  automation_runs: Array<{ job: string; value: string; updated_at: string }>
  last_event_scan: {
    alerts: number
    subscriptions: number
    scanned_at: string
    updated_at: string
  } | null
  last_ingest: Array<{ provider: string; updated_at: string }>
}

export interface AccountBreakdown {
  id: number
  type: "checking" | "card"
  provider: string
  display_name: string
  month_expenses: number
  month_income: number
  month_transfers: number
  month_fees: number
  month_tx_count: number
  avg_expenses_6m: number
  top_categories: Array<{ category: string; total: number }>
  top_merchants: Array<{ merchant: string; total: number }>
  last_date: string | null
}

export interface AccountsView {
  month: string
  cards: AccountBreakdown[]
  checking: AccountBreakdown[]
  totals: {
    card_spend: number
    checking_spend: number
    income: number
    transfers: number
  }
}

export interface TransferDetail {
  merchant: string
  total: number
}

export interface ChargeSummaries {
  month: string
  merchants: Array<{
    merchant: string
    category: string
    month_total: number
    month_count: number
    total_6m: number
    avg_monthly_6m: number
    pct_of_6m: number
    months_active: number
    last_date: string
  }>
  categories: Array<{
    category: string
    month_total: number
    month_count: number
    total_6m: number
    avg_monthly_6m: number
    pct_of_6m: number
  }>
  totals: { month_expenses: number; six_month_expenses: number }
}

export interface Transaction {
  id: number
  date: string
  charge_date: string | null
  amount_ils: number
  currency: string
  amount: number
  normalized_merchant: string
  category: string
  is_transfer: number
  is_fee: number
  is_fx: number
  installment_current: number | null
  installment_total: number | null
  account: string
}

export interface TransactionsResult {
  rows: Transaction[]
  total: number
  total_filtered: number
}
