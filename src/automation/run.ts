import { closeSync, existsSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, FILE_MODE, loadEnvFallback } from '../config.js';
import { openDb } from '../db/index.js';
import { log } from '../logging/logger.js';
import { DEFAULT_SCHEDULE, dailyOutcome, dueJobs, type AutomationJob } from './schedule.js';

const LOCK_PATH = join(DATA_DIR, 'automation.lock');
const KILL_SWITCH_PATH = join(DATA_DIR, 'AUTOMATION_DISABLED');
let lockFd: number | null = null;
let running = false;

function israelDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function acquireLock(): void {
  lockFd = openSync(LOCK_PATH, 'wx', FILE_MODE);
  writeFileSync(lockFd, `${process.pid}\n`, 'utf8');
}

function releaseLock(): void {
  const owned = lockFd !== null;
  if (lockFd !== null) closeSync(lockFd);
  lockFd = null;
  if (owned) {
    try { unlinkSync(LOCK_PATH); } catch { /* already gone */ }
  }
}

function runNpm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: process.cwd(), env: process.env, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} הסתיים בקוד ${code}`)));
  });
}

function readAttempts(): Partial<Record<AutomationJob, string>> {
  const db = openDb();
  try {
    const rows = db.prepare(`SELECT key, value FROM agent_memory WHERE key LIKE 'automation.last_attempt.%'`).all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key.replace('automation.last_attempt.', ''), r.value]));
  } finally { db.close(); }
}

function remember(job: AutomationJob, key: 'last_attempt' | 'last_success', value: string): void {
  const db = openDb();
  try {
    db.prepare(`
      INSERT INTO agent_memory (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(`automation.${key}.${job}`, value);
  } finally { db.close(); }
}

async function execute(job: AutomationJob): Promise<void> {
  const today = israelDate();
  remember(job, 'last_attempt', today);
  if (job === 'daily') {
    // ingest exits 1 when ANY provider failed, even if the others succeeded.
    // Aborting here meant one dormant card (Cal) skipped the advisor entirely
    // for the day — and since last_attempt was already stamped, there was no
    // retry. Partial data is still worth advising on: the advisor reads
    // whatever landed in the DB, so run it either way and let the failure be
    // visible rather than silently costing a day of advice.
    let ingestFailed = false;
    try {
      await runNpm(['run', 'ingest', '--', '--months', '2']);
    } catch (err) {
      ingestFailed = true;
      log.error('[automation] ingest נכשל חלקית — ממשיך ל-advise על מה שכן נמשך:',
        err instanceof Error ? err.message : 'שגיאה לא ידועה');
    }
    const outcome = dailyOutcome(ingestFailed);
    if (outcome.runAdvise) await runNpm(['run', 'advise']);
    // Only a fully clean run counts as success, so a persistent provider
    // failure stays visible in the dashboard instead of looking healthy.
    if (!outcome.recordSuccess) {
      log.error(`[automation] ${job} הושלם חלקית — היועץ רץ, אך משיכה אחת נכשלה`);
      return;
    }
  } else {
    await runNpm(['run', 'report', '--', '--period', job]);
  }
  remember(job, 'last_success', new Date().toISOString());
  log.info(`[automation] ${job} הושלם`);
}

async function tick(): Promise<void> {
  if (running || existsSync(KILL_SWITCH_PATH)) return;
  const jobs = dueJobs(new Date(), readAttempts(), DEFAULT_SCHEDULE);
  if (jobs.length === 0) return;
  running = true;
  try {
    for (const job of jobs) {
      try { await execute(job); }
      catch (err) { log.error(`[automation] ${job} נכשל:`, err instanceof Error ? err.message : 'שגיאה לא ידועה'); }
    }
  } finally { running = false; }
}

function main(): void {
  loadEnvFallback();
  if (process.env['FINOPS_AUTOMATION_ENABLED'] !== '1') {
    throw new Error('האוטומציה כבויה כברירת מחדל. להפעלה מפורשת: FINOPS_AUTOMATION_ENABLED=1');
  }
  if (existsSync(KILL_SWITCH_PATH)) throw new Error(`kill switch פעיל: ${KILL_SWITCH_PATH}`);
  acquireLock();
  process.once('SIGINT', () => { releaseLock(); process.exit(0); });
  process.once('SIGTERM', () => { releaseLock(); process.exit(0); });
  process.once('exit', releaseLock);
  log.info('[automation] פעיל מקומית · בדיקה כל 60 שניות · אזור זמן Asia/Jerusalem');
  void tick();
  setInterval(() => { void tick(); }, 60_000);
}

try { main(); }
catch (err) {
  releaseLock();
  log.error('[automation] לא הופעל:', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
}
