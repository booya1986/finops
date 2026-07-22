import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb } from './index.js';
import { log } from '../logging/logger.js';

const SCHEMA_VERSION = 7;
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export function migrate(): void {
  const db = openDb();
  try {
    const current = db.pragma('user_version', { simple: true }) as number;
    // Schema uses IF NOT EXISTS throughout, so re-running is safe.
    db.exec(readFileSync(SCHEMA_PATH, 'utf-8'));

    // v2: recommendations.category (guarded — CREATE above already has it on fresh DBs).
    const recColumns = (db.pragma(`table_info(recommendations)`) as Array<{ name: string }>).map((c) => c.name);
    if (!recColumns.includes('category')) {
      db.exec(`ALTER TABLE recommendations ADD COLUMN category TEXT`);
      log.info('[migrate] v2: נוספה עמודת category ל-recommendations');
    }
    if (!recColumns.includes('details')) {
      db.exec(`ALTER TABLE recommendations ADD COLUMN details TEXT`);
      log.info('[migrate] v3: נוספה עמודת details ל-recommendations');
    }

    // v5: allow 'transfer' flag on merchant_notes. SQLite can't alter a CHECK
    // constraint in place; rebuild the table only when the old constraint is
    // still present (idempotent — fresh DBs already have the v5 schema above).
    const notesSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'merchant_notes'`).get() as { sql: string } | undefined)?.sql ?? '';
    if (notesSql && !notesSql.includes("'transfer'")) {
      db.exec(`
        CREATE TABLE merchant_notes_v5 (
          merchant TEXT PRIMARY KEY, note TEXT NOT NULL, category TEXT,
          flag TEXT CHECK (flag IN ('cancel', 'transfer')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO merchant_notes_v5 SELECT * FROM merchant_notes;
        DROP TABLE merchant_notes;
        ALTER TABLE merchant_notes_v5 RENAME TO merchant_notes;
      `);
      log.info("[migrate] v5: merchant_notes.flag תומך כעת ב-'transfer'");
    }

    // v6: transactions.manual_override (guarded — CREATE above already has it on fresh DBs).
    const txColumns = (db.pragma(`table_info(transactions)`) as Array<{ name: string }>).map((c) => c.name);
    if (!txColumns.includes('manual_override')) {
      db.exec(`ALTER TABLE transactions ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1))`);
      log.info('[migrate] v6: נוספה עמודת manual_override ל-transactions');
    }

    // v7: ingested_at — WHEN A ROW ENTERED THE DB, which is not its date.
    // A charge dated last week that arrives in today's scrape is new *to the
    // user*, and "what changed since you looked" has to key off arrival.
    // SQLite rejects a non-constant DEFAULT in ALTER TABLE, so the column is
    // added bare and backfilled; existing rows get the current time, which
    // only means they are all "already seen" from here on.
    if (!txColumns.includes('ingested_at')) {
      db.exec(`ALTER TABLE transactions ADD COLUMN ingested_at TEXT`);
      db.prepare(`UPDATE transactions SET ingested_at = datetime('now') WHERE ingested_at IS NULL`).run();
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_ingested_at ON transactions(ingested_at)`);
      // Every backfilled row carries the same timestamp, so without a marker
      // the first "what changed" would report the ENTIRE history as new. Seed
      // the marker past the backfill: pre-existing rows are already seen.
      db.prepare(`
        INSERT INTO agent_memory (key, value, updated_at)
        VALUES ('dashboard.last_seen', datetime('now'), datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run();
      log.info('[migrate] v7: נוספה עמודת ingested_at ל-transactions');
    }

    if (current < SCHEMA_VERSION) {
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[];
    log.info(`[migrate] schema v${SCHEMA_VERSION} — ${tables.length} טבלאות:`, tables.map((t) => t.name).join(', '));
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate();
}
