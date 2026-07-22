import Database from 'better-sqlite3';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyOutcome, dueJobs } from './schedule.js';
import { renderLocalReport, writeLocalReport } from '../reports/generate.js';

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`✗ ${message}`);
  console.log(`  ✓ ${message}`);
}

console.log('[selftest] תזמון מקומי:');
const sunday = new Date('2026-07-19T05:30:00Z'); // 08:30 in Israel
const dueSunday = dueJobs(sunday, {});
assert(dueSunday.includes('daily') && dueSunday.includes('weekly') && !dueSunday.includes('monthly'), 'יום ראשון מפעיל daily + weekly');
assert(dueJobs(sunday, { daily: '2026-07-19', weekly: '2026-07-19' }).length === 0, 'last_attempt מונע הרצה כפולה באותו יום');
const monthStart = dueJobs(new Date('2026-08-01T06:00:00Z'), {});
assert(monthStart.includes('daily') && monthStart.includes('monthly'), 'היום הראשון בחודש מפעיל daily + monthly');

console.log('[selftest] כשל חלקי במשיכה:');
// A real failure: Cal (a card the user does not use) errored, ingest exited 1, and
// the whole daily job aborted — so the advisor never ran and, because
// last_attempt was already stamped, nothing retried. One dormant card cost a
// full day of advice.
const partial = dailyOutcome(true);
assert(partial.runAdvise, 'כשל בספק אחד לא מונע מהיועץ לרוץ על מה שכן נמשך');
assert(!partial.recordSuccess, 'ריצה חלקית אינה נרשמת כהצלחה — אחרת כשל קבוע ייראה תקין');
const clean = dailyOutcome(false);
assert(clean.runAdvise && clean.recordSuccess, 'ריצה נקייה מריצה את היועץ ונרשמת כהצלחה');

console.log('[selftest] דוח מקומי:');
const db = new Database(':memory:');
db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
db.prepare(`INSERT INTO accounts (type, provider, display_name) VALUES ('checking', 'fixture', 'חשבון בדיקה')`).run();
const accountId = Number(db.prepare(`SELECT id FROM accounts LIMIT 1`).pluck().get());
const insert = db.prepare(`
  INSERT INTO transactions (account_id, date, amount, amount_ils, raw_description, normalized_merchant, category, dedup_hash, source)
  VALUES (@account, @date, @amount, @amount, @merchant, @merchant, @category, @hash, 'fixture')
`);
insert.run({ account: accountId, date: '2026-07-01', amount: 15000, merchant: 'משכורת', category: 'הכנסות', hash: 'income' });
insert.run({ account: accountId, date: '2026-07-04', amount: -1200, merchant: 'סופר', category: 'סופרמרקט', hash: 'expense' });
db.prepare(`INSERT INTO goals (title, type, target_amount, progress, deadline) VALUES ('קרן חירום', 'save_by_date', 10000, 2500, '2026-12-31')`).run();
const report = renderLocalReport(db, '2026-07', 'weekly', new Date('2026-07-19T05:30:00Z'));
assert(report.includes('דוח שבועי') && report.includes('קרן חירום'), 'הדוח כולל תזרים ויעדים');
assert(!report.includes('raw_description'), 'הדוח אינו כולל שדות raw');
const reportDir = mkdtempSync(join(tmpdir(), 'finops-report-'));
try {
  chmodSync(reportDir, 0o700);
  const path = writeLocalReport(db, '2026-07', 'weekly', new Date('2026-07-19T05:30:00Z'), reportDir);
  assert((statSync(path).mode & 0o777) === 0o600, 'קובץ הדוח נשמר בהרשאות 600');
  assert(readFileSync(path, 'utf8').includes('נשמר מקומית בלבד'), 'קובץ הדוח נכתב במלואו');
} finally {
  db.close();
  rmSync(reportDir, { recursive: true, force: true });
}
console.log('[selftest] הכל עבר ✓');
