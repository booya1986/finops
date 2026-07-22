import { openDb } from '../db/index.js';
import { applyUserCategoryRules } from '../db/userRules.js';
import { log } from '../logging/logger.js';
import { getSecret } from '../secrets/keychain.js';
import { loadProviders } from './providers.js';
import { fetchProvider } from './scrape.js';
import { persistScrape } from './persist.js';
import { buildBrief } from '../features/brief.js';
import { generateAlerts, syncSubscriptions } from '../advisor/alerts.js';

/**
 * Ingestion entry point (Phase 1: checking account only).
 *
 *   npm run ingest              fetch + persist for all configured providers
 *   npm run ingest -- --show    visible browser (debugging)
 *   npm run ingest -- --months 3
 */
function currentMonthInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(new Date());
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const showBrowser = argv.includes('--show');
  const monthsIdx = argv.indexOf('--months');
  const monthsArg = monthsIdx >= 0 ? Number(argv[monthsIdx + 1]) : undefined;
  const monthsBack = monthsArg && Number.isFinite(monthsArg) && monthsArg > 0 ? monthsArg : undefined;
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  const providers = loadProviders();
  if (only && !(only in providers)) {
    log.error(`[ingest] ספק לא מוכר: "${only}" (זמינים: ${Object.keys(providers).join(', ')})`);
    process.exit(2);
  }

  const db = openDb();
  const failures: string[] = [];
  try {
    // One provider failing (CAPTCHA, temporary block) must not stop the rest.
    for (const [key, provider] of Object.entries(providers)) {
      if (only && key !== only) continue;
      // Explicit --only overrides the disable flag (deliberate manual run).
      if (provider.enabled === false && !only) {
        log.warn(`[ingest] ${key} מנוטרל (ראה providers.ts) — מדלג`);
        continue;
      }
      // No credentials stored → this provider simply isn't set up. Skip it
      // quietly instead of failing: a user who only uses some banks should
      // still get a clean exit. --only forces an attempt (surfaces the
      // "missing secret" error so setup problems are visible on demand).
      if (!only) {
        const hasAllSecrets = provider.credentialFields.every((f) => getSecret(`${key}.${f}`) !== null);
        if (!hasAllSecrets) {
          log.info(`[ingest] ${key}: לא הוזנו פרטי התחברות — מדלג (הרץ npm run setup להזנה)`);
          continue;
        }
      }
      log.info(`[ingest] מושך: ${provider.displayName} (עד ${monthsBack ?? 12} חודשים אחורה)…`);
      try {
        const fetchOptions = {
          showBrowser,
          ...(monthsBack !== undefined ? { monthsBack } : {}),
        };
        const accounts = await fetchProvider(key, provider, fetchOptions);
        const stats = persistScrape(db, key, provider.accountType, accounts);
        log.info(
          `[ingest] ${key}: ${stats.accounts} חשבונות, ${stats.fetched} תנועות נמשכו — ` +
            `${stats.inserted} נוספו, ${stats.skippedDuplicates} כפולות (דולגו), ${stats.skippedPending} ממתינות (דולגו)`,
        );
        db.prepare(`
          INSERT INTO agent_memory (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(`last_ingest.${key}`, JSON.stringify(stats));
      } catch (err) {
        failures.push(key);
        log.error(`[ingest] ${key} נכשל:`, err instanceof Error ? err.message : 'שגיאה לא ידועה');
      }
    }
    const recategorized = applyUserCategoryRules(db);
    if (recategorized > 0) log.info(`[ingest] ${recategorized} תנועות סווגו לפי הכללים שלימדת`);
    // Phase 7 event-driven delivery: immediately refresh deterministic alerts
    // and recurring-charge state after new data lands. No LLM or network call.
    const brief = buildBrief(db, currentMonthInIsrael());
    const alertCount = generateAlerts(db, brief);
    const subscriptionCount = syncSubscriptions(db, brief);
    db.prepare(`
      INSERT INTO agent_memory (key, value, updated_at) VALUES ('last_event_scan', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify({ alerts: alertCount, subscriptions: subscriptionCount, scanned_at: new Date().toISOString() }));
    log.info(`[ingest] סריקת אירועים: ${alertCount} התראות חדשות · ${subscriptionCount} חיובים חוזרים סונכרנו`);
  } finally {
    db.close();
  }
  if (failures.length > 0) {
    log.error(`[ingest] הסתיים עם כשלים ב: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  log.error('[ingest] כשל:', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
});
