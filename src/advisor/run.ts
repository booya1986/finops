import { openDb } from '../db/index.js';
import { log } from '../logging/logger.js';
import { buildBrief } from '../features/brief.js';
import { createAnthropicClient } from './client.js';
import { generateRecommendations, type AdvisorMemory } from './generator.js';
import { evaluateRecommendations } from './evaluator.js';
import { checkGrounding, collectBriefNumbers } from './grounding.js';
import { generateAlerts, syncSubscriptions } from './alerts.js';

/**
 * The advisor pipeline (PLAN.md §6, §9):
 *   Brief (SQL) → deterministic alerts + subscriptions → Generator →
 *   code-level numeric grounding → Evaluator → store approved only.
 *
 *   npm run advise            current month
 *   npm run advise -- --month 2026-06
 */
function currentMonthInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(new Date());
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const monthIdx = argv.indexOf('--month');
  const month = monthIdx >= 0 ? argv[monthIdx + 1]! : currentMonthInIsrael();

  const db = openDb();
  try {
    log.info(`[advisor] בונה Brief לחודש ${month}…`);
    const brief = buildBrief(db, month);

    const alertCount = generateAlerts(db, brief);
    const subCount = syncSubscriptions(db, brief);
    log.info(`[advisor] התראות דטרמיניסטיות: ${alertCount} חדשות · מנויים מסונכרנים: ${subCount}`);

    // §11 memory: what was accepted/dismissed feeds the next generation.
    const history = db
      .prepare(`SELECT title, status FROM recommendations WHERE status IN ('accepted', 'dismissed', 'done')`)
      .all() as Array<{ title: string; status: string }>;
    const memory: AdvisorMemory = {
      dismissedTitles: history.filter((h) => h.status === 'dismissed').map((h) => h.title),
      acceptedTitles: history.filter((h) => h.status !== 'dismissed').map((h) => h.title),
    };

    const client = createAnthropicClient();
    log.info('[advisor] Generator מנסח סקירה והמלצות…');
    const generated = await generateRecommendations(client, brief, memory);
    log.info(`[advisor] נוסחו סקירה + ${generated.recommendations.length} המלצות — בדיקת עיגון מספרי…`);

    const briefNumbers = collectBriefNumbers(brief);
    const grounded = generated.recommendations.filter((rec) => {
      const check = checkGrounding(rec, briefNumbers, brief.cashflow.expenses);
      if (!check.ok) log.warn(`[advisor] נפסלה בעיגון: "${rec.title}" — ${check.reason}`);
      return check.ok;
    });

    if (grounded.length === 0) {
      log.warn('[advisor] אף המלצה לא עברה עיגון מספרי — לא נשמר דבר.');
      return;
    }

    log.info(`[advisor] ${grounded.length} עברו עיגון — Evaluator בוחן…`);
    const evaluation = await evaluateRecommendations(client, brief, generated.review, grounded);

    if (evaluation.review_ok) {
      db.prepare(`
        INSERT INTO agent_memory (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(`advisor_review.${month}`, JSON.stringify({ ...generated.review, generated_at: new Date().toISOString() }));
      log.info('[advisor] הסקירה החודשית אושרה ונשמרה:');
      log.info(`  ${generated.review.summary}`);
      generated.review.urgent_actions.forEach((a) => log.info(`  ⚡ ${a}`));
    } else {
      log.warn(`[advisor] הסקירה נדחתה ע"י ה-Evaluator: ${evaluation.review_reason} — לא נשמרה`);
    }

    // Answers to the user's open questions about specific charges.
    const answerStmt = db.prepare(`
      UPDATE tx_questions SET answer = ?, status = 'answered', answered_at = datetime('now')
      WHERE id = ? AND status = 'open'
    `);
    for (const qa of generated.answers) {
      if (answerStmt.run(qa.answer, qa.question_id).changes === 1) {
        log.info(`[advisor] ❓#${qa.question_id} נענתה: ${qa.answer}`);
      }
    }

    const approved = grounded.filter((_, i) => {
      const verdict = evaluation.verdicts.find((v) => v.index === i);
      if (!verdict?.approved) {
        log.warn(`[advisor] נדחתה ע"י ה-Evaluator: "${grounded[i]!.title}" — ${verdict?.reason ?? 'אין פסק דין'}`);
      }
      return verdict?.approved === true;
    });

    // A fresh run supersedes untouched suggestions from previous runs — the
    // feed shows current analysis only. User-acted rows (accepted/dismissed/
    // done) are the learning memory and are never removed.
    const superseded = db.prepare(`DELETE FROM recommendations WHERE status = 'new'`).run().changes;
    if (superseded > 0) log.info(`[advisor] ${superseded} המלצות ישנות שלא טופלו הוחלפו בניתוח העדכני`);

    const insert = db.prepare(`
      INSERT INTO recommendations (title, rationale, category, details, est_saving_ils, effort, confidence)
      SELECT @title, @rationale, @category, @details, @saving, @effort, @confidence
      WHERE NOT EXISTS (SELECT 1 FROM recommendations WHERE title = @title AND status IN ('new', 'accepted'))
    `);
    let stored = 0;
    for (const rec of approved) {
      stored += insert.run({
        title: rec.title,
        rationale: rec.what_happened,
        category: rec.category,
        details: JSON.stringify({
          what_happened: rec.what_happened,
          breakdown: rec.breakdown,
          change: rec.change,
          impact_monthly: rec.impact_monthly,
          impact_yearly: rec.impact_yearly,
          steps: rec.steps,
        }),
        saving: rec.est_saving_ils_monthly,
        effort: rec.effort,
        confidence: rec.confidence,
      }).changes;
    }

    log.info(`[advisor] אושרו ${approved.length}/${generated.recommendations.length} · נשמרו ${stored} חדשות`);
    for (const rec of approved) {
      log.info(`  ● ${rec.title} — חיסכון ~₪${rec.est_saving_ils_monthly}/חודש (${rec.category}, מאמץ: ${rec.effort})`);
      log.info(`    ${rec.what_happened}`);
      rec.breakdown.forEach((b) => log.info(`      · ${b.label}: ₪${b.amount}`));
      if (rec.change) log.info(`      ${rec.change.baseline_label}: ₪${rec.change.baseline} ← ${rec.change.current_label}: ₪${rec.change.current}`);
      log.info(`      עלות: ₪${rec.impact_monthly}/חודש · ₪${rec.impact_yearly}/שנה`);
      rec.steps.forEach((s, i) => log.info(`      ${i + 1}. ${s}`));
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  log.error('[advisor] כשל:', err instanceof Error ? err.message : 'שגיאה לא ידועה');
  process.exit(1);
});
