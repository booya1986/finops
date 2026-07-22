import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT, DB_PATH } from '../config.js';
import { loadProviders } from '../ingest/providers.js';
import { runOnboarding } from './onboarding-server.js';

/**
 * First-run onboarding (`npm run setup`). A thin coordinator: it prepares the
 * environment, then hands off to the browser onboarding (onboarding-server),
 * which is where the user picks institutions and enters credentials. Secrets
 * are written only there — the wizard never touches the Keychain itself.
 *
 * Idempotent: never overwrites an existing DB; re-running just re-opens the
 * onboarding page.
 */

const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function step(n: number, total: number, title: string): void {
  console.log(`\n${BLUE}▸ שלב ${n}/${total}: ${title}${RESET}`);
}
function ok(msg: string): void { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function info(msg: string): void { console.log(`  ${DIM}${msg}${RESET}`); }
function fail(msg: string): never {
  console.error(`\n${RED}✗ ${msg}${RESET}\n`);
  process.exit(1);
}

function runScript(scriptArgs: string[]): number {
  const result = spawnSync('npm', scriptArgs, { cwd: PROJECT_ROOT, stdio: 'inherit', env: process.env });
  if (result.error) return -1;
  return result.status ?? -1;
}

async function main(): Promise<void> {
  const TOTAL = 3;
  console.log(`${GREEN}FinOps — בוא נתחיל${RESET}`);
  console.log(`${DIM}הכול רץ מקומית. שום נתון פיננסי לא עוזב את המחשב.${RESET}`);

  // ── Step 1: environment ───────────────────────────────────────────────
  step(1, TOTAL, 'בדיקת סביבה');
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 22) {
    fail(`נדרש Node 22.12 ומעלה (מותקן: ${process.versions.node}). התקן גרסה עדכנית ונסה שוב.`);
  }
  ok(`Node ${process.versions.node}`);
  if (!existsSync(join(PROJECT_ROOT, 'node_modules'))) {
    info('מתקין תלויות (npm install)…');
    if (runScript(['install']) !== 0) fail('npm install נכשל. בדוק חיבור אינטרנט ונסה שוב.');
    ok('התלויות הותקנו');
  } else {
    ok('התלויות מותקנות');
  }

  // ── Step 2: database ──────────────────────────────────────────────────
  step(2, TOTAL, 'מסד נתונים מקומי');
  if (existsSync(DB_PATH)) {
    ok('קיים כבר — לא נוגעים בו');
  } else {
    info('יוצר DB ריק (data/finops.db)…');
    if (runScript(['run', 'db:migrate']) !== 0 || !existsSync(DB_PATH)) {
      fail('יצירת ה-DB נכשלה. הרץ ידנית: npm run db:migrate');
    }
    ok('נוצר');
  }

  // ── Step 3: onboarding in the browser ─────────────────────────────────
  step(3, TOTAL, 'חיבור החשבונות');
  info('נפתח דף התחלה מעוצב בדפדפן — שם בוחרים בנקים/כרטיסים ומזינים פרטים.');
  await runOnboarding();

  // ── Summary ───────────────────────────────────────────────────────────
  const active = Object.values(loadProviders());
  if (active.length === 0) {
    console.log(`\n${DIM}לא נשמרו מוסדות. אפשר להריץ שוב בכל עת:${RESET}  ${BLUE}npm run setup${RESET}\n`);
    process.exit(0);
  }
  console.log(`\n${GREEN}הכול מוכן — ${active.length} מוסדות מחוברים.${RESET}`);
  console.log('  משיכה ראשונה מהבנק (דפדפן גלוי — אם יידרש קוד SMS, הקלד אותו שם):');
  console.log(`    ${BLUE}npm run ingest -- --show${RESET}`);
  console.log('  פתיחת הדשבורד:');
  console.log(`    ${BLUE}npm run dashboard${RESET}\n`);
}

main().catch((err) => {
  console.error(`${RED}שגיאה:${RESET}`, err instanceof Error ? err.message : err);
  process.exit(1);
});
