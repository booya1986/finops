import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../logging/logger.js';
import { persistScrape, type ScrapedAccount } from './persist.js';

/**
 * Phases 1–2 acceptance checks, runnable without bank credentials:
 * scraper-shaped fixtures through the persistence layer twice against an
 * in-memory DB. Asserts the §5 invariants — idempotent re-runs, pending
 * skipped, card-company debits in checking flagged is_transfer (and ONLY in
 * checking), merchant normalization, fee flagging, expense totals that
 * exclude the double-counted card debit.
 */

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

const tx = (over: Record<string, unknown>): Record<string, unknown> => ({
  type: 'normal',
  originalCurrency: 'ILS',
  status: 'completed',
  ...over,
  date: `${over['date']}T12:00:00+03:00`,
  processedDate: `${over['date']}T12:00:00+03:00`,
});

const CHECKING = [
  {
    accountNumber: '12-345-678901',
    balance: 8421.55,
    txns: [
      tx({ identifier: 1001, date: '2026-07-01', originalAmount: -49.9, chargedAmount: -49.9, description: 'ספוטיפיי  בע"מ ' }),
      // Two genuinely identical same-day charges, distinct bank references.
      tx({ identifier: 1002, date: '2026-07-02', originalAmount: -18, chargedAmount: -18, description: 'קפה גרג' }),
      tx({ identifier: 1003, date: '2026-07-02', originalAmount: -18, chargedAmount: -18, description: 'קפה גרג' }),
      tx({ identifier: 1004, date: '2026-07-03', originalAmount: -12.99, originalCurrency: 'USD', chargedAmount: -47.81, description: 'CLAUDE.AI SUBSCRIPTION' }),
      tx({ identifier: 1005, date: '2026-07-18', originalAmount: -250, chargedAmount: -250, description: 'העברה בהמתנה', status: 'pending' }),
      // §5 double-count: consolidated card debits — must become is_transfer=1.
      tx({ identifier: 1006, date: '2026-07-10', originalAmount: -6543.21, chargedAmount: -6543.21, description: 'ישראכרט' }),
      tx({ identifier: 1007, date: '2026-07-10', originalAmount: -2100, chargedAmount: -2100, description: 'מקס איט פיננסים בע"מ' }),
      // "כאל" inside a name must NOT match (word-boundary trap).
      tx({ identifier: 1008, date: '2026-07-11', originalAmount: -500, chargedAmount: -500, description: 'העברה למיכאל כהן' }),
      tx({ identifier: 1009, date: '2026-07-12', originalAmount: -12.5, chargedAmount: -12.5, description: 'עמלת ערוץ ישיר' }),
      // Interest CREDIT — positive, must not be flagged as fee.
      tx({ identifier: 1010, date: '2026-07-13', originalAmount: 3.2, chargedAmount: 3.2, description: 'ריבית זכות' }),
      tx({ identifier: 1011, date: '2026-07-09', originalAmount: 15000, chargedAmount: 15000, description: 'משכורת' }),
      // Hapoalim reality: network-named card debit + savings both ways.
      tx({ identifier: 1012, date: '2026-07-14', originalAmount: -9800, chargedAmount: -9800, description: 'מסטרקרד' }),
      tx({ identifier: 1013, date: '2026-07-15', originalAmount: -5000, chargedAmount: -5000, description: 'הפקדה לפקדון' }),
      tx({ identifier: 1014, date: '2026-07-16', originalAmount: 5000, chargedAmount: 5000, description: 'משיכה מפקדון' }),
      tx({ identifier: 1015, date: '2026-07-17', originalAmount: -6.9, chargedAmount: -6.9, description: 'עמ.ערוץ ישיר' }),
      // Interest earned on the deposit — income, must NOT be a transfer.
      tx({ identifier: 1016, date: '2026-07-18', originalAmount: 52, chargedAmount: 52, description: 'ריבית מפקדון' }),
      // Loan principal: lands as a matched ±pair on one day. Borrowed money is
      // not income and the outgoing leg is not spending — both are transfers.
      tx({ identifier: 1017, date: '2026-07-19', originalAmount: 100000, chargedAmount: 100000, description: 'הלואה קרן/כללי' }),
      tx({ identifier: 1018, date: '2026-07-19', originalAmount: -100000, chargedAmount: -100000, description: 'הלואה קרן/כללי' }),
      // The monthly REPAYMENT is a real expense — guards against anyone
      // broadening the קרן-anchored pattern to a bare /הלוואה/.
      tx({ identifier: 1019, date: '2026-07-01', originalAmount: -1806.6, chargedAmount: -1806.6, description: 'הו"ק הלוואה' }),
    ],
  },
] as unknown as ScrapedAccount[];

const CARD = [
  {
    accountNumber: '4580-1234',
    txns: [
      tx({ identifier: 2001, date: '2026-07-05', originalAmount: -54.9, chargedAmount: -54.9, description: 'NETFLIX.COM' }),
      tx({ identifier: 2002, date: '2026-07-06', originalAmount: -432.1, chargedAmount: -432.1, description: 'רמי לוי שיווק השקמה 044' }),
      tx({ identifier: 2003, date: '2026-07-07', originalAmount: -1200, chargedAmount: -400, description: 'ריהוט הרצל', type: 'installments', installments: { number: 2, total: 3 } }),
      // Contains the word "מקס" but sits in a CARD account — not a transfer.
      tx({ identifier: 2004, date: '2026-07-08', originalAmount: -89, chargedAmount: -89, description: 'מקס מרקט' }),
    ],
  },
] as unknown as ScrapedAccount[];

function expect(condition: boolean, label: string): void {
  if (!condition) throw new Error(`selftest נכשל: ${label}`);
  log.info(`  ✓ ${label}`);
}

function main(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));

  log.info('[selftest] הרצה ראשונה (עו"ש + כרטיס):');
  const c1 = persistScrape(db, 'hapoalim', 'checking', CHECKING);
  const k1 = persistScrape(db, 'max', 'card', CARD);
  expect(c1.fetched + k1.fetched === 23, `נמשכו 23 תנועות (בפועל ${c1.fetched + k1.fetched})`);
  expect(c1.inserted + k1.inserted === 22, `נוספו 22 (בפועל ${c1.inserted + k1.inserted})`);
  expect(c1.skippedPending === 1, `ממתינה אחת דולגה (בפועל ${c1.skippedPending})`);

  log.info('[selftest] הרצה חוזרת (אידמפוטנטיות):');
  const c2 = persistScrape(db, 'hapoalim', 'checking', CHECKING);
  const k2 = persistScrape(db, 'max', 'card', CARD);
  expect(c2.inserted + k2.inserted === 0, `הרצה חוזרת לא מוסיפה כלום (בפועל ${c2.inserted + k2.inserted})`);
  expect(c2.skippedDuplicates + k2.skippedDuplicates === 22, `22 זוהו ככפולות (בפועל ${c2.skippedDuplicates + k2.skippedDuplicates})`);

  log.info('[selftest] כפל חיוב עו"ש/אשראי (§5):');
  const get = <T>(sql: string): T => db.prepare(sql).get() as T;
  const transfers = get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE is_transfer = 1`);
  expect(transfers.n === 7, `חיובי אשראי + פקדון + קרן הלוואה דו-כיווניים סומנו is_transfer (בפועל ${transfers.n})`);
  const deposit = get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE raw_description LIKE '%פקדון%' AND is_transfer = 1`);
  expect(deposit.n === 2, `הפקדה ומשיכה מפקדון שתיהן transfer (בפועל ${deposit.n})`);
  const interest = get<{ is_transfer: number }>(`SELECT is_transfer FROM transactions WHERE raw_description = 'ריבית מפקדון'`);
  expect(interest.is_transfer === 0, `"ריבית מפקדון" = הכנסה, לא transfer`);
  const principal = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE raw_description LIKE '%הלואה קרן%' AND is_transfer = 1`
  );
  expect(principal.n === 2, `קרן הלוואה: שני הכיוונים transfer — כסף מושאל אינו הכנסה (בפועל ${principal.n})`);
  const repayment = get<{ is_transfer: number }>(`SELECT is_transfer FROM transactions WHERE raw_description = 'הו"ק הלוואה'`);
  expect(repayment.is_transfer === 0, `החזר הלוואה נשאר הוצאה אמיתית (לא נמחק ע"י דפוס רחב מדי)`);
  const michael = get<{ is_transfer: number }>(`SELECT is_transfer FROM transactions WHERE raw_description LIKE '%מיכאל%'`);
  expect(michael.is_transfer === 0, `"מיכאל" לא נתפס בטעות כ"כאל" (מלכודת word-boundary)`);
  const maxMarket = get<{ is_transfer: number }>(`SELECT is_transfer FROM transactions WHERE raw_description = 'מקס מרקט'`);
  expect(maxMarket.is_transfer === 0, `"מקס" בחשבון כרטיס לא סומן transfer (רק בעו"ש)`);
  const expenses = get<{ total: number }>(
    `SELECT ROUND(SUM(amount_ils), 2) AS total FROM transactions WHERE amount_ils < 0 AND is_transfer = 0`,
  );
  // Manual tally: checking 49.9+18+18+47.81+500+12.5+6.9 = 653.11 (card
  // debits, savings, and BOTH loan-principal legs excluded; pending skipped),
  // plus the 1806.60 loan repayment — a real expense — = 2459.71;
  // card 54.9+432.1+400+89 = 976.00 → 3435.71 total.
  expect(expenses.total === -3435.71, `סך הוצאות בלי כפל חיוב והעברות: ‎-3435.71 (בפועל ${expenses.total})`);

  log.info('[selftest] נירמול, עמלות, תשלומים:');
  const names = new Set((db.prepare(`SELECT normalized_merchant AS m FROM transactions`).all() as { m: string }[]).map((r) => r.m));
  expect(names.has('Spotify') && names.has('Netflix') && names.has('Claude (Anthropic)') && names.has('רמי לוי'), `כללי נירמול בתי עסק הופעלו`);
  const fees = db.prepare(`SELECT raw_description AS d FROM transactions WHERE is_fee = 1 ORDER BY d`).all() as { d: string }[];
  expect(fees.length === 2 && fees.some((f) => f.d === 'עמ.ערוץ ישיר'), `עמלות סומנו כולל הקיצור "עמ." ; ריבית זכות (חיובית) לא (בפועל ${fees.length})`);
  const inst = get<{ c: number; t: number }>(`SELECT installment_current AS c, installment_total AS t FROM transactions WHERE raw_description = 'ריהוט הרצל'`);
  expect(inst.c === 2 && inst.t === 3, `תשלום 2/3 נשמר (installment_current/total)`);
  const fx = get<{ f: number; a: number }>(`SELECT is_fx AS f, amount_ils AS a FROM transactions WHERE currency = 'USD'`);
  expect(fx.f === 1 && fx.a === -47.81, `מט"ח: is_fx=1 ו-amount_ils תקין`);

  log.info('[selftest] חשבונות ומיסוך:');
  const accounts = db.prepare(`SELECT type, display_name FROM accounts ORDER BY type`).all() as { type: string; display_name: string }[];
  expect(accounts.length === 2, `שני חשבונות (בפועל ${accounts.length})`);
  expect(accounts.every((a) => !a.display_name.match(/\d{5,}|12-345|4580-1234/)), `מספרי חשבון ממוסכים בשמות התצוגה`);
  expect(accounts[0]!.display_name.startsWith('כרטיס') && accounts[1]!.display_name.startsWith('עו"ש'), `קידומות לפי סוג חשבון`);
  const balance = get<{ value: string }>(`SELECT value FROM agent_memory WHERE key = 'balance.hapoalim'`);
  expect(JSON.parse(balance.value).balance === 8421.55, `יתרה נשמרה ב-agent_memory`);

  db.close();
  log.info('[selftest] הכל עבר ✓');
}

try {
  main();
} catch (err) {
  log.error('[selftest]', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
}
