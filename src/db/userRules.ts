import type { Database } from 'better-sqlite3';

/**
 * User-taught rules (merchant_notes) win over automatic classification.
 * Called after every ingest and after every note change, so both existing
 * and future transactions carry the user's category and transfer marking.
 */
export function applyUserCategoryRules(db: Database): number {
  const catChanges = db.prepare(`
    UPDATE transactions
    SET category = (SELECT n.category FROM merchant_notes n WHERE n.merchant = transactions.normalized_merchant)
    WHERE normalized_merchant IN (SELECT merchant FROM merchant_notes WHERE category IS NOT NULL)
      AND COALESCE(category, '') != (SELECT n.category FROM merchant_notes n WHERE n.merchant = transactions.normalized_merchant)
  `).run().changes;

  // Merchants flagged 'transfer' are internal money movements — exclude from
  // expense/income math (is_transfer=1). Existing + future rows both covered.
  const transferChanges = db.prepare(`
    UPDATE transactions SET is_transfer = 1
    WHERE is_transfer = 0
      AND normalized_merchant IN (SELECT merchant FROM merchant_notes WHERE flag = 'transfer')
  `).run().changes;

  return catChanges + transferChanges;
}
