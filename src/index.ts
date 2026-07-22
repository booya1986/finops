import { existsSync, statSync } from 'node:fs';
import { DATA_DIR, DB_PATH, DIR_MODE, FILE_MODE, loadEnvFallback } from './config.js';
import { openDb } from './db/index.js';
import { log } from './logging/logger.js';

/**
 * Entry point: initialize the DB and run a sanity check (tables exist, file
 * permissions are strict). Fails closed — any error exits non-zero without
 * leaking sensitive details (PLAN.md §1.1).
 */

const EXPECTED_TABLES = [
  'accounts',
  'agent_memory',
  'alerts',
  'goals',
  'recommendations',
  'subscriptions',
  'transactions',
  'merchant_notes',
  'tx_questions',
];

function checkMode(path: string, expected: number, label: string): string {
  const mode = statSync(path).mode & 0o777;
  if (mode !== expected) {
    throw new Error(`${label}: הרשאות ${mode.toString(8)} במקום ${expected.toString(8)}`);
  }
  return `${label} ✓ (${expected.toString(8)})`;
}

function main(): void {
  loadEnvFallback();

  if (!existsSync(DB_PATH)) {
    throw new Error('ה-DB לא קיים — הרץ קודם: npm run db:migrate');
  }

  const db = openDb();
  try {
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all() as { name: string }[]
    ).map((t) => t.name);

    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      throw new Error(`חסרות טבלאות: ${missing.join(', ')} — הרץ: npm run db:migrate`);
    }

    log.info('[finops] בדיקת שפיות:');
    log.info(' ', checkMode(DATA_DIR, DIR_MODE, 'data/'));
    log.info(' ', checkMode(DB_PATH, FILE_MODE, 'finops.db'));
    log.info(`  סכמה ✓ (${EXPECTED_TABLES.length}/${EXPECTED_TABLES.length} טבלאות)`);
    log.info('[finops] תשתית Phases 0–7 תקינה: ingestion, Brief, advisor, goals, dashboard, reports ואוטומציה זמינים.');
    log.info('[finops] האוטומציה נשארת כבויה כברירת מחדל ודורשת opt-in מפורש.');
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  // Fail closed: message only, no stack/context that might carry data.
  log.error('[finops] כשל:', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
}
