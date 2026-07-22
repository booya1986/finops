import type { Database } from 'better-sqlite3';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, DIR_MODE, FILE_MODE } from '../config.js';
import { buildBrief } from '../features/brief.js';
import { openDb } from '../db/index.js';
import { log } from '../logging/logger.js';

export type ReportPeriod = 'weekly' | 'monthly';

function israelDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function currentMonthInIsrael(now: Date = new Date()): string {
  return israelDate(now).slice(0, 7);
}

function money(value: number): string {
  return `₪${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(value)}`;
}

function stateLabel(state: string): string {
  return ({ on_track: 'במסלול', at_risk: 'דורש תשומת לב', off_track: 'בחריגה', completed: 'הושלם', paused: 'מושהה' } as Record<string, string>)[state] ?? state;
}

/** Aggregated, deterministic Markdown. No raw transaction rows and no LLM. */
export function renderLocalReport(db: Database, month: string, period: ReportPeriod, now: Date = new Date()): string {
  const brief = buildBrief(db, month, now);
  const title = period === 'weekly' ? 'דוח שבועי' : 'דוח חודשי';
  const goals = brief.user_context.goals;
  const alerts: string[] = [];
  if (brief.cashflow.naive_eom_balance !== null && brief.cashflow.naive_eom_balance < 0) {
    alerts.push(`תחזית סוף החודש שלילית: ${money(brief.cashflow.naive_eom_balance)}.`);
  }
  for (const category of brief.categories.filter((c) => c.z_score !== null && c.z_score > 3).slice(0, 3)) {
    alerts.push(`${category.category}: ${money(category.current_total)} מול ממוצע ${money(category.avg_6m)}.`);
  }
  const categoryLines = brief.categories.slice(0, 6)
    .map((c) => `| ${c.category} | ${money(c.current_total)} | ${money(c.avg_6m)} |`)
    .join('\n');
  const goalLines = goals.length
    ? goals.map((g) => `- **${g.title}** · ${stateLabel(g.state)} · ${money(g.current_value)} מתוך ${money(g.target_amount)}. ${g.corrective_action}`).join('\n')
    : '- אין יעדים פעילים.';

  return `# ${title} · ${month}\n\n` +
    `נוצר מקומית ב־${israelDate(now)}. כל המספרים מחושבים דטרמיניסטית מה־DB.\n\n` +
    `## תמונת מצב\n\n` +
    `- הכנסות: **${money(brief.cashflow.income)}**\n` +
    `- הוצאות: **${money(brief.cashflow.expenses)}**\n` +
    `- נטו: **${money(brief.cashflow.net)}**\n` +
    `- יתרת התחייבויות בתשלומים: **${money(brief.cashflow.future_installment_obligations)}**\n\n` +
    `## מה דורש תשומת לב\n\n${alerts.length ? alerts.map((a) => `- ${a}`).join('\n') : '- לא זוהתה חריגה דטרמיניסטית חדשה.'}\n\n` +
    `## יעדים\n\n${goalLines}\n\n` +
    `## קטגוריות מובילות\n\n| קטגוריה | החודש | ממוצע קודם |\n|---|---:|---:|\n${categoryLines || '| אין נתונים | — | — |'}\n\n` +
    `## פרטיות\n\nהדוח נוצר ונשמר מקומית בלבד. הוא אינו כולל קרדנציאלס ואינו נשלח לשירות חיצוני.\n`;
}

export function writeLocalReport(
  db: Database,
  month: string,
  period: ReportPeriod,
  now: Date = new Date(),
  outputDir: string = join(DATA_DIR, 'reports'),
): string {
  mkdirSync(outputDir, { recursive: true, mode: DIR_MODE });
  chmodSync(outputDir, DIR_MODE);
  const suffix = period === 'weekly' ? israelDate(now) : month;
  const filename = `${period}-${suffix}.md`;
  const finalPath = join(outputDir, filename);
  const tempPath = join(outputDir, `.${filename}.tmp`);
  writeFileSync(tempPath, renderLocalReport(db, month, period, now), { encoding: 'utf8', mode: FILE_MODE });
  chmodSync(tempPath, FILE_MODE);
  renameSync(tempPath, finalPath);
  chmodSync(finalPath, FILE_MODE);
  db.prepare(`
    INSERT INTO agent_memory (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(`last_report.${period}`, JSON.stringify({ path: finalPath, month, generated_at: now.toISOString() }));
  return finalPath;
}

function parseArgs(): { period: ReportPeriod; month: string } {
  const args = process.argv.slice(2);
  const periodIndex = args.indexOf('--period');
  const periodRaw = periodIndex >= 0 ? args[periodIndex + 1] : 'weekly';
  if (periodRaw !== 'weekly' && periodRaw !== 'monthly') throw new Error('period חייב להיות weekly או monthly');
  const monthIndex = args.indexOf('--month');
  const month = monthIndex >= 0 ? args[monthIndex + 1] : currentMonthInIsrael();
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('חודש לא תקין');
  return { period: periodRaw, month };
}

if (process.argv[1]?.endsWith('generate.ts')) {
  try {
    const { period, month } = parseArgs();
    const db = openDb();
    try {
      const path = writeLocalReport(db, month, period);
      log.info(`[report] נוצר דוח מקומי: ${path}`);
    } finally { db.close(); }
  } catch (err) {
    log.error('[report] כשל:', err instanceof Error ? err.message : 'שגיאה לא ידועה');
    process.exit(1);
  }
}
