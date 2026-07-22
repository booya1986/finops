import { openDb } from '../db/index.js';
import { log } from '../logging/logger.js';
import { buildBrief } from './brief.js';

/**
 *   npm run brief                    Brief for the current month
 *   npm run brief -- --month 2026-06 Brief for a chosen month
 *
 * Output is aggregates only (PLAN.md §18) — safe to hand to the advisor.
 */
function currentMonthInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(new Date());
}

function main(): void {
  const argv = process.argv.slice(2);
  const monthIdx = argv.indexOf('--month');
  const month = monthIdx >= 0 ? argv[monthIdx + 1] : currentMonthInIsrael();
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`חודש לא תקין — צפוי YYYY-MM (התקבל: "${month}")`);
  }

  const db = openDb();
  try {
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n;
    if (count === 0) {
      throw new Error('אין תנועות ב-DB — הרץ קודם: npm run ingest');
    }
    console.log(JSON.stringify(buildBrief(db, month), null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  log.error('[brief] כשל:', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
}
