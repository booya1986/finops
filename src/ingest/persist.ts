import type { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { ScraperScrapingResult } from 'israeli-bank-scrapers';
import { normalizeDescription, round2, toIsraelDate } from './normalize.js';
import { categorize, displayMerchant, isCardCompanyDebit, isFee, isInternalTransfer, normalizeMerchant } from './merchants.js';
import { maskAccount } from '../logging/logger.js';

export type ScrapedAccount = NonNullable<ScraperScrapingResult['accounts']>[number];
type ScrapedTxn = ScrapedAccount['txns'][number];

export interface PersistStats {
  accounts: number;
  fetched: number;
  inserted: number;
  skippedDuplicates: number;
  skippedPending: number;
}

/**
 * Dedup key (PLAN.md §5): sha256(date|amount|normalized_description|account_id),
 * extended with the bank reference (identifier/אסמכתא) when present so two
 * genuinely identical same-day charges don't collapse into one row. When the
 * bank provides no identifier this degrades exactly to the spec key.
 *
 * INVARIANT: the description fed here must be STABLE across releases —
 * whitespace-cleaned raw text only, never the rule-canonicalized merchant
 * name. Canonicalization rules evolve, and any change to a hash input would
 * make every future re-fetch of an existing transaction look new.
 */
export function dedupHash(
  date: string,
  amountIls: number,
  normalizedDescription: string,
  accountId: number,
  identifier: string | number | undefined,
): string {
  return createHash('sha256')
    .update(`${date}|${amountIls.toFixed(2)}|${normalizedDescription}|${accountId}|${identifier ?? ''}`)
    .digest('hex');
}

function ensureAccount(db: Database, type: 'checking' | 'card', provider: string, displayName: string): number {
  db.prepare(`INSERT OR IGNORE INTO accounts (type, provider, display_name) VALUES (?, ?, ?)`)
    .run(type, provider, displayName);
  const row = db
    .prepare(`SELECT id FROM accounts WHERE provider = ? AND display_name = ?`)
    .get(provider, displayName) as { id: number };
  return row.id;
}

/**
 * Idempotent persistence: INSERT OR IGNORE on dedup_hash UNIQUE — re-running
 * an overlapping fetch window inserts nothing twice. Pending transactions are
 * skipped entirely: their amount/date may still change, which would produce a
 * different hash later and create a duplicate.
 */
export function persistScrape(
  db: Database,
  provider: string,
  accountType: 'checking' | 'card',
  accounts: ScrapedAccount[],
): PersistStats {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions (
      account_id, date, charge_date, amount, currency, amount_ils,
      raw_description, normalized_merchant, category, dedup_hash, source,
      is_transfer, is_fee, is_fx, installment_current, installment_total, memo,
      ingested_at
    ) VALUES (
      @account_id, @date, @charge_date, @amount, @currency, @amount_ils,
      @raw_description, @normalized_merchant, @category, @dedup_hash, @source,
      @is_transfer, @is_fee, @is_fx, @installment_current, @installment_total, @memo,
      -- Set explicitly rather than relying on the column default: the v7
      -- migration adds this column via ALTER, which cannot carry one.
      datetime('now')
    )
  `);

  const stats: PersistStats = { accounts: 0, fetched: 0, inserted: 0, skippedDuplicates: 0, skippedPending: 0 };

  const run = db.transaction(() => {
    for (const account of accounts) {
      stats.accounts += 1;
      const prefix = accountType === 'checking' ? 'עו"ש' : 'כרטיס';
      const displayName = `${prefix} ${maskAccount(account.accountNumber)}`;
      const accountId = ensureAccount(db, accountType, provider, displayName);

      for (const txn of account.txns) {
        stats.fetched += 1;
        if ((txn.status as unknown as string) === 'pending') {
          stats.skippedPending += 1;
          continue;
        }
        const row = toRow(txn, accountId, provider, accountType);
        const result = insert.run(row);
        if (result.changes === 1) stats.inserted += 1;
        else stats.skippedDuplicates += 1;
      }

      if (typeof account.balance === 'number') {
        db.prepare(`
          INSERT INTO agent_memory (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(`balance.${provider}`, JSON.stringify({ balance: account.balance, asOf: new Date().toISOString() }));
      }
    }
  });
  run();
  return stats;
}

function toRow(
  txn: ScrapedTxn,
  accountId: number,
  provider: string,
  accountType: 'checking' | 'card',
): Record<string, unknown> {
  const date = toIsraelDate(txn.date);
  const amountIls = round2(txn.chargedAmount);
  const cleanDescription = normalizeDescription(txn.description);
  // Split-by-amount is display-only; classification (transfer/fee/category)
  // still runs on the base name so rules keep matching.
  const baseName = normalizeMerchant(txn.description);
  const normalized = displayMerchant(baseName, amountIls);
  // §5: the consolidated card-company debit in the CHECKING account is the
  // double-count side — flag it as a transfer so expense math excludes it.
  // The card account rows stay the source of truth for the actual spending.
  // Savings deposits/withdrawals are own-money movements — also transfers.
  const isTransfer =
    accountType === 'checking' && (isCardCompanyDebit(baseName) || isInternalTransfer(baseName));
  const feeFlag = isFee(baseName, amountIls);
  return {
    account_id: accountId,
    date,
    charge_date: txn.processedDate ? toIsraelDate(txn.processedDate) : null,
    amount: round2(txn.originalAmount),
    currency: txn.originalCurrency || 'ILS',
    amount_ils: amountIls,
    raw_description: txn.description,
    normalized_merchant: normalized,
    category: txn.category ?? categorize(baseName, amountIls, feeFlag),
    dedup_hash: dedupHash(date, amountIls, cleanDescription, accountId, txn.identifier),
    source: provider,
    is_transfer: isTransfer ? 1 : 0,
    is_fee: feeFlag ? 1 : 0,
    is_fx: txn.originalCurrency && txn.originalCurrency !== 'ILS' ? 1 : 0,
    installment_current: txn.installments?.number ?? null,
    installment_total: txn.installments?.total ?? null,
    memo: txn.memo ?? null,
  };
}
