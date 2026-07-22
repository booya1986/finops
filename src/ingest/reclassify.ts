import { openDb } from '../db/index.js';
import { applyUserCategoryRules } from '../db/userRules.js';
import { log } from '../logging/logger.js';
import { categorize, displayMerchant, isCardCompanyDebit, isFee, isInternalTransfer, normalizeMerchant } from './merchants.js';

/**
 * Re-apply the CURRENT classification rules to every stored transaction:
 * normalized_merchant (with display split), is_transfer, is_fee, and category.
 * dedup_hash is NEVER touched (identity, computed from stable inputs).
 * User-taught rules win — applyUserCategoryRules runs last so manual
 * categories and transfer flags override the automatic pass.
 *
 * Rows flagged manual_override are skipped entirely: that flag means a human
 * corrected THIS SPECIFIC transaction (e.g. one check among several sharing a
 * merchant name that's actually a one-off gift, not rent) — a merchant-level
 * rule can't express that distinction, so the automatic pass must never
 * touch it. (memo is NOT a signal for this — the bank scraper populates it
 * on nearly every row with payment-reference text, so it can't double as
 * "human-annotated".)
 *
 * Run after tuning rules in merchants.ts — no wipe/re-ingest needed.
 */
export function reclassify(): void {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT t.id, t.raw_description, t.amount_ils, t.normalized_merchant, t.category,
             t.is_transfer, t.is_fee, a.type AS account_type
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.manual_override = 0
    `).all() as Array<{
      id: number; raw_description: string; amount_ils: number; normalized_merchant: string;
      category: string | null; is_transfer: number; is_fee: number; account_type: 'checking' | 'card';
    }>;

    const update = db.prepare(`
      UPDATE transactions SET normalized_merchant = ?, category = ?, is_transfer = ?, is_fee = ? WHERE id = ?
    `);

    let changed = 0;
    db.transaction(() => {
      for (const row of rows) {
        const base = normalizeMerchant(row.raw_description);
        const display = displayMerchant(base, row.amount_ils);
        const feeFlag = isFee(base, row.amount_ils);
        const transfer =
          row.account_type === 'checking' && (isCardCompanyDebit(base) || isInternalTransfer(base));
        // Keep an existing category unless the automatic pass now produces one
        // (never clobber a category with null).
        const category = categorize(base, row.amount_ils, feeFlag) ?? row.category;
        if (
          display !== row.normalized_merchant ||
          category !== row.category ||
          (transfer ? 1 : 0) !== row.is_transfer ||
          (feeFlag ? 1 : 0) !== row.is_fee
        ) {
          update.run(display, category, transfer ? 1 : 0, feeFlag ? 1 : 0, row.id);
          changed += 1;
        }
      }
    })();

    const userRuleChanges = applyUserCategoryRules(db);
    log.info(`[reclassify] ${rows.length} שורות נבדקו, ${changed} עודכנו · ${userRuleChanges} לפי כללי המשתמש`);
  } finally {
    db.close();
  }
}

reclassify();
