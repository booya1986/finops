import type { Database } from 'better-sqlite3';
import type { FinancialBrief } from '../features/brief.js';

/**
 * Deterministic alerts + subscriptions upkeep — pure code over the Brief, no
 * LLM involved (PLAN.md §8, §13). Insert is deduped on (type, message)
 * against non-dismissed alerts so re-runs don't spam.
 */

export function generateAlerts(db: Database, brief: FinancialBrief): number {
  const candidates: Array<{ type: string; severity: 'info' | 'warning' | 'critical'; message: string }> = [];

  const eom = brief.cashflow.naive_eom_balance;
  if (eom !== null && eom < 0) {
    candidates.push({
      type: 'cashflow_warning',
      severity: 'critical',
      message: `תחזית יתרת סוף חודש שלילית: ₪${eom.toLocaleString('he-IL')} (קצב שריפה ₪${brief.cashflow.burn_rate_daily}/יום)`,
    });
  }

  for (const cat of brief.categories) {
    if (cat.z_score !== null && cat.z_score > 3) {
      candidates.push({
        type: 'category_anomaly',
        severity: 'warning',
        message: `חריגה בקטגוריית ${cat.category}: ₪${cat.current_total.toLocaleString('he-IL')} החודש מול ממוצע ₪${cat.avg_6m.toLocaleString('he-IL')} (z=${cat.z_score})`,
      });
    }
  }

  for (const rec of brief.recurring) {
    if (rec.deviation_pct !== null && rec.deviation_pct >= 20) {
      candidates.push({
        type: 'recurring_price_increase',
        severity: 'warning',
        message: `${rec.merchant}: החיוב האחרון ₪${rec.last_amount} — ${rec.deviation_pct}% מעל הממוצע (₪${rec.avg_monthly_amount})`,
      });
    }
  }

  // Duplicate suspicions are skipped for merchants the user already explained
  // (e.g., "two ₪200 BIT transfers = my personal trainer, not a mistake").
  const notedMerchants = new Set(
    (db.prepare(`SELECT merchant FROM merchant_notes`).all() as { merchant: string }[]).map((r) => r.merchant),
  );
  for (const dup of brief.duplicate_charges) {
    if (notedMerchants.has(dup.merchant)) continue;
    candidates.push({
      type: 'duplicate_charge',
      severity: 'warning',
      message: `חיוב כפול אפשרי: ${dup.merchant} — ₪${dup.amount} פעמיים (${dup.dates.join(', ')}) ב${dup.account}. שווה לבדוק מול בית העסק.`,
    });
  }

  // An alert the user dismissed stays gone — the guard ignores dismissed state
  // on purpose so identical alerts are never re-created.
  const insert = db.prepare(`
    INSERT INTO alerts (type, severity, message)
    SELECT ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE type = ? AND message = ?)
  `);
  let inserted = 0;
  for (const alert of candidates) {
    inserted += insert.run(alert.type, alert.severity, alert.message, alert.type, alert.message).changes;
  }
  return inserted;
}

export function syncSubscriptions(db: Database, brief: FinancialBrief): number {
  const upsert = db.prepare(`
    INSERT INTO subscriptions (merchant, avg_amount, cadence, first_seen, last_seen, status)
    VALUES (@merchant, @avg, @cadence, @last_date, @last_date, @status)
    ON CONFLICT(merchant) DO UPDATE SET
      avg_amount = excluded.avg_amount,
      last_seen = excluded.last_seen,
      status = excluded.status
  `);
  let count = 0;
  for (const rec of brief.recurring) {
    upsert.run({
      merchant: rec.merchant,
      avg: rec.avg_monthly_amount,
      cadence: rec.cadence,
      last_date: rec.last_date,
      status: rec.deviation_pct !== null && rec.deviation_pct >= 20 ? 'price_increased' : 'active',
    });
    count += 1;
  }
  // User verdict wins: merchants flagged 'cancel' stay marked as forgotten.
  db.prepare(`
    UPDATE subscriptions SET status = 'forgotten'
    WHERE merchant IN (SELECT merchant FROM merchant_notes WHERE flag = 'cancel')
  `).run();
  return count;
}
