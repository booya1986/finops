import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../logging/logger.js';
import { persistScrape, type ScrapedAccount } from '../ingest/persist.js';
import { buildBrief } from './brief.js';

/**
 * Phase 3 acceptance: a deterministic 7-month fixture (Jan–Jul 2026) flows
 * through the real ingestion layer, then buildBrief('2026-07') is checked
 * against hand-computed figures — cashflow, z-score anomaly, recurring
 * detection with deviation, installment obligations, fees, top movers.
 */

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

let seq = 3000;
const tx = (date: string, amount: number, description: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'normal',
  identifier: seq++,
  originalAmount: amount,
  originalCurrency: 'ILS',
  chargedAmount: amount,
  description,
  status: 'completed',
  ...over,
  // Noon, not midnight: a hardcoded +03:00 at midnight lands on the previous
  // calendar day in Israel's winter (UTC+2). Real scraper data carries the
  // correct offset per date; the fixture must not be fooled by DST.
  date: `${date}T12:00:00+03:00`,
  processedDate: `${date}T12:00:00+03:00`,
});

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const GROCERIES: Record<string, number> = {
  '2026-01': -240, '2026-02': -260, '2026-03': -250, '2026-04': -255, '2026-05': -245, '2026-06': -250, '2026-07': -250,
};

function buildFixtures(): { checking: ScrapedAccount[]; card: ScrapedAccount[] } {
  const checkingTxns: Record<string, unknown>[] = [];
  const cardTxns: Record<string, unknown>[] = [];
  for (const m of MONTHS) {
    checkingTxns.push(
      tx(`${m}-09`, 15000, 'משכורת חודשית'),
      tx(`${m}-01`, -4500, 'שכר דירה'),
      tx(`${m}-05`, -49.9, 'ספוטיפיי'),
      tx(`${m}-12`, -12.5, 'עמלת ערוץ ישיר'),
      tx(`${m}-10`, -3000, 'ישראכרט'), // consolidated card debit — must stay out of expenses
      tx(`${m}-15`, GROCERIES[m]!, 'שופרסל דיל'),
    );
    cardTxns.push(tx(`${m}-03`, -54.9, 'NETFLIX.COM'));
  }
  // July anomaly: a second, unusually large grocery run.
  checkingTxns.push(tx('2026-07-16', -700, 'שופרסל דיל'));
  // Possible double billing: same merchant, same amount, 2 days apart.
  cardTxns.push(
    tx('2026-07-05', -250, 'חדר כושר פלוס'),
    tx('2026-07-07', -250, 'חדר כושר פלוס'),
  );
  // A large one-off — must surface in large_transactions.
  cardTxns.push(tx('2026-07-08', -3200, 'טיסות לחול בעמ'));
  // A/C bought on 6 installments of ₪600 — June (1/6) and July (2/6) billed.
  cardTxns.push(
    tx('2026-06-20', -600, 'אלקטרה מיזוג', { type: 'installments', originalAmount: -3600, installments: { number: 1, total: 6 } }),
    tx('2026-07-20', -600, 'אלקטרה מיזוג', { type: 'installments', originalAmount: -3600, installments: { number: 2, total: 6 } }),
  );
  return {
    checking: [{ accountNumber: '12-345-678901', balance: 8421.55, txns: checkingTxns }] as unknown as ScrapedAccount[],
    card: [{ accountNumber: '4580-1234', txns: cardTxns }] as unknown as ScrapedAccount[],
  };
}

/**
 * Leak-detection fixtures, deliberately in their OWN database. They exist to
 * pin down three mistakes found on real data, and every one of them changes
 * monthly totals — folding them into the main fixture would have forced a
 * rewrite of the hand-computed cashflow figures that the rest of this file
 * checks, weakening those assertions to strengthen these.
 */
function buildLeakFixtures(): { checking: ScrapedAccount[]; card: ScrapedAccount[] } {
  const checkingTxns: Record<string, unknown>[] = [];
  const cardTxns: Record<string, unknown>[] = [];
  for (const m of MONTHS) {
    checkingTxns.push(tx(`${m}-09`, 15000, 'משכורת חודשית'));
    // Rent: ONE cheque a month at a steady price…
    checkingTxns.push(tx(`${m}-01`, -4500, 'שכר דירה'));
    // Netflix: steady until July.
    cardTxns.push(tx(`${m}-03`, m === '2026-07' ? -79.9 : -54.9, 'NETFLIX.COM'));
    // An API-style charge billed once a month until July.
    cardTxns.push(tx(`${m}-11`, -100, 'ANTHROPIC'));
  }
  // …and in July a second cheque clears. The monthly TOTAL doubles while the
  // price per cheque never moved: comparing monthly SUMs reported this as a
  // "100% price increase", which is why the detector uses per-charge averages.
  checkingTxns.push(tx('2026-07-28', -4500, 'שכר דירה'));
  // Six extra API charges in July: the bill jumps 7x on unchanged unit price.
  // Reported as a price rise this would be wrong — the per-charge average
  // actually FALLS. It must be classified as 'frequency'.
  for (let d = 12; d <= 17; d++) cardTxns.push(tx(`2026-07-${d}`, -100, 'ANTHROPIC'));
  return {
    checking: [{ accountNumber: '12-345-678901', balance: 5000, txns: checkingTxns }] as unknown as ScrapedAccount[],
    card: [{ accountNumber: '4580-1234', txns: cardTxns }] as unknown as ScrapedAccount[],
  };
}

function expect(condition: boolean, label: string): void {
  if (!condition) throw new Error(`selftest נכשל: ${label}`);
  log.info(`  ✓ ${label}`);
}

/** Runs the leak-detection checks against their own isolated fixture. */
function checkLeakDetection(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));
  const { checking, card } = buildLeakFixtures();
  persistScrape(db, 'hapoalim', 'checking', checking);
  persistScrape(db, 'max', 'card', card);
  const brief = buildBrief(db, '2026-07', new Date('2026-07-19T12:00:00+03:00'));
  const leaks = brief.price_increases;

  log.info('[selftest] זיהוי דליפות:');
  const netflix = leaks.find((p) => p.merchant === 'Netflix');
  expect(
    netflix !== undefined && netflix.kind === 'price',
    `Netflix 54.9→79.9 מסווג כהתייקרות מחיר (בפועל ${netflix?.kind ?? 'לא זוהה'})`,
  );

  const api = leaks.find((p) => p.merchant.includes('Claude') || p.merchant.includes('ANTHROPIC'));
  expect(
    api !== undefined && api.kind === 'frequency',
    `7 חיובים במקום 1 מסווג כתדירות ולא כהתייקרות (בפועל ${api?.kind ?? 'לא זוהה'})`,
  );

  // The regression that matters most: two identical cheques in one month.
  const rent = leaks.find((p) => p.merchant.includes('שכר דירה'));
  expect(
    rent === undefined || rent.kind === 'frequency',
    `שני שיקי שכירות בחודש אינם "התייקרות מחיר" (בפועל ${rent?.kind ?? 'לא דווח כלל'})`,
  );

  // A price hike is a permanent leak; a busy month is not. Hikes rank first
  // even when their shekel delta is smaller — sorting by shekels alone once
  // buried a real Netflix increase below one-off supermarket noise.
  const firstPrice = leaks.findIndex((p) => p.kind === 'price');
  const firstFreq = leaks.findIndex((p) => p.kind === 'frequency');
  expect(
    firstPrice === -1 || firstFreq === -1 || firstPrice < firstFreq,
    `התייקרויות מחיר מדורגות לפני קפיצות תדירות`,
  );
  db.close();
}

function main(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));

  const { checking, card } = buildFixtures();
  persistScrape(db, 'hapoalim', 'checking', checking);
  persistScrape(db, 'max', 'card', card);

  const brief = buildBrief(db, '2026-07', new Date('2026-07-19T12:00:00+03:00'));

  log.info('[selftest] תזרים (חושב ידנית מראש):');
  // July expenses: 4500 + 49.9 + 12.5 + 950 + 54.9 + 600 + 250 + 250 + 3200
  // = 9867.3 (ישראכרט מוחרג)
  expect(brief.cashflow.income === 15000, `הכנסות 15000 (בפועל ${brief.cashflow.income})`);
  expect(brief.cashflow.expenses === 9867.3, `הוצאות 9867.3 בלי כפל החיוב (בפועל ${brief.cashflow.expenses})`);
  expect(brief.cashflow.net === 5132.7, `נטו 5132.7 (בפועל ${brief.cashflow.net})`);
  expect(brief.cashflow.prev_month_expenses === 5467.3, `הוצאות יוני 5467.3 (בפועל ${brief.cashflow.prev_month_expenses})`);
  expect(brief.cashflow.burn_rate_daily === 519.33, `קצב שריפה יומי 519.33 (בפועל ${brief.cashflow.burn_rate_daily})`);
  expect(brief.cashflow.days_left_in_month === 12, `נותרו 12 ימים (בפועל ${brief.cashflow.days_left_in_month})`);
  expect(brief.cashflow.naive_eom_balance === 2189.59, `תחזית יתרת סוף חודש 2189.59 (בפועל ${brief.cashflow.naive_eom_balance})`);
  expect(brief.cashflow.future_installment_obligations === 2400, `התחייבויות תשלומים 2400 (בפועל ${brief.cashflow.future_installment_obligations})`);

  log.info('[selftest] אנומליות וקטגוריות:');
  const grocery = brief.categories.find((c) => c.category === 'סופרמרקט')!;
  expect(grocery.current_total === 950 && grocery.avg_6m === 250, `סופרמרקט: 950 החודש מול ממוצע 250`);
  expect(grocery.z_score !== null && grocery.z_score > 3, `z-score גבוה לאנומליית הסופר (בפועל ${grocery.z_score})`);
  const rent = brief.categories.find((c) => c.category === 'שכירות')!;
  expect(rent.z_score === null && rent.std_6m === 0, `שכ"ד יציב לחלוטין — std=0, בלי z מלאכותי (קטגוריית שכירות נפרדת מדיור וחשבונות)`);

  log.info('[selftest] recurring:');
  const names = brief.recurring.map((r) => r.merchant);
  expect(names.includes('Spotify') && names.includes('Netflix') && names.includes('שכר דירה'), `Spotify/Netflix/שכ"ד זוהו כ-recurring`);
  const spotify = brief.recurring.find((r) => r.merchant === 'Spotify')!;
  expect(spotify.avg_monthly_amount === 49.9 && spotify.deviation_pct === 0, `Spotify: ממוצע 49.9, סטייה 0%`);
  const shufersal = brief.recurring.find((r) => r.merchant === 'שופרסל')!;
  expect(shufersal.deviation_pct === 280, `שופרסל: סטייה 280% החודש — הסיגנל לאנומליה (בפועל ${shufersal.deviation_pct}%)`);
  expect(!names.includes('אלקטרה מיזוג'), `חודשיים של תשלומי מזגן ≠ recurring`);

  log.info('[selftest] עמלות, top movers, תשלומים:');
  expect(brief.fees.current_month === 12.5 && brief.fees.total_6m === 87.5, `עמלות: 12.5 החודש, 87.5 בחצי שנה (בפועל ${brief.fees.current_month}/${brief.fees.total_6m})`);
  expect(brief.top_movers[0]!.category === 'ללא קטגוריה' && brief.top_movers[0]!.delta === 3700, `top mover: ללא קטגוריה ‎+3700 (בפועל ${brief.top_movers[0]!.category} ${brief.top_movers[0]!.delta})`);
  const plan = brief.installment_plans.find((p) => p.merchant === 'אלקטרה מיזוג')!;
  expect(plan.paid === 2 && plan.total === 6 && plan.remaining_amount === 2400, `תוכנית תשלומים: 2/6 שולמו, נותרו 2400`);
  expect(brief.fx.count_current_month === 0, `אין מט"ח בפיקסצ'ר`);

  log.info('[selftest] חיישני §8 — כפילויות, עסקאות גדולות, פירוט:');
  const dup = brief.duplicate_charges.find((d) => d.merchant === 'חדר כושר פלוס');
  expect(dup !== undefined && dup.amount === 250 && dup.dates.length === 2, `חיוב כפול זוהה: חדר כושר פלוס ×2 בהפרש יומיים`);
  expect(!brief.duplicate_charges.some((d) => d.merchant === 'אלקטרה מיזוג'), `תשלומים לא נספרים ככפילות`);
  expect(brief.large_transactions[0]!.merchant === 'שכר דירה' && brief.large_transactions[0]!.amount === 4500, `העסקה הגדולה ביותר: שכ"ד 4500 (בפועל ${brief.large_transactions[0]!.merchant})`);
  const flight = brief.large_transactions.find((t) => t.merchant === 'טיסות לחול בעמ');
  expect(flight !== undefined && flight.amount === 3200 && flight.merchant_seen_count === 1, `טיסות 3200 מזוהה כעסקה גדולה חד-פעמית`);
  expect(brief.fee_detail.length === 1 && brief.fee_detail[0]!.merchant === 'עמלת ערוץ ישיר', `פירוט עמלות: שורה אחת ביולי`);
  expect(brief.income_events[0]!.amount === 15000, `אירוע הכנסה: משכורת 15000`);
  expect(brief.card_debits_by_month.length === 4 && brief.card_debits_by_month.every((c) => c.total === 3000), `עומס חיובי אשראי: 3000 לחודש ×4`);

  log.info('[selftest] מאקרו:');
  const m = brief.macro;
  expect(m.savings_rate_pct === 34.22, `שיעור חיסכון 34.22% (בפועל ${m.savings_rate_pct})`);
  expect(m.top_merchants_6m[0]!.merchant === 'שכר דירה' && m.top_merchants_6m[0]!.total === 27000, `מוציא מוביל 6ח: שכ"ד 27,000 (בפועל ${m.top_merchants_6m[0]!.merchant} ${m.top_merchants_6m[0]!.total})`);
  expect(m.fixed_monthly === 5467.3, `הוצאות קבועות (recurring+תשלומים): 5467.3 (בפועל ${m.fixed_monthly})`);
  expect(m.runway_days === 38, `כרית נשימה: 38 ימים (בפועל ${m.runway_days})`);
  expect(m.net_by_month.length === 7 && m.net_by_month[6]!.net === 5132.7, `נטו חודשי: 7 חודשים, יולי 5132.7 (בפועל ${m.net_by_month[6]?.net})`);
  const w1 = m.week_of_month_spend.find((w) => w.week === 1);
  expect(w1 !== undefined && w1.avg === 4604.8, `שבוע 1 של החודש הכבד ביותר: 4604.8 (בפועל ${w1?.avg})`);

  db.close();
  checkLeakDetection();
  log.info('[selftest] הכל עבר ✓');
}

try {
  main();
} catch (err) {
  log.error('[selftest]', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
}
