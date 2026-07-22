#!/usr/bin/env node
/**
 * Guards the frontend/backend contract.
 *
 * Why this exists: the goal cards once declared current_amount /
 * target_progress_pct / on_track / guidance while the API sent
 * current_value / progress_pct / state / corrective_action. TypeScript could
 * not catch it — the interface was WRONG, not missing, so the compiler
 * happily checked the UI against a shape that never existed. The cards
 * rendered with undefined values and silently dropped the corrective step,
 * which is the most useful part of goal tracking.
 *
 * A type is a claim about runtime data. Nothing was checking that claim, so
 * this script does: it reads the real API response and asserts that every
 * field the UI types declare actually arrives, and flags fields the API
 * sends that the UI never declared (usually a feature wired only halfway).
 *
 * Run against a live local server: node scripts/contract-check.mjs
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.FINOPS_DASH_URL ?? 'http://127.0.0.1:3737';
const TYPES = 'src/dashboard/web/src/types.ts';

/**
 * Pulls the field names out of one interface/type block. Deliberately a
 * shallow parser rather than a TS compile: we only need top-level keys of
 * the objects the UI reads, and pulling in the compiler API to get them
 * would add a dependency for no extra safety.
 */
function fieldsOf(src, blockName) {
  const start = src.search(new RegExp(`(interface|type)\\s+${blockName}\\b`));
  if (start === -1) return null;
  let depth = 0, i = src.indexOf('{', start), out = [], buf = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    else if (depth === 1) buf += c;
  }
  for (const line of buf.split('\n')) {
    const m = line.match(/^\s*([a-z_][a-z0-9_]*)\??\s*:/i);
    if (m) out.push(m[1]);
  }
  return out;
}

const problems = [];
const note = (msg) => problems.push(msg);

const res = await fetch(`${BASE}/api/summary`).catch(() => null);
if (!res || !res.ok) {
  console.error(`[contract] לא ניתן לקרוא ל-${BASE}/api/summary — הפעל את השרת קודם`);
  process.exit(1);
}
const api = await res.json();
const src = readFileSync(TYPES, 'utf8');

// Each entry: the UI type block, and the live object it is meant to describe.
const CHECKS = [
  ['DashboardSummary', api],
  ['Goal', api.goals?.[0]],
];

for (const [block, sample] of CHECKS) {
  const declared = fieldsOf(src, block);
  if (!declared) { note(`טיפוס ${block} לא נמצא ב-${TYPES}`); continue; }
  if (!sample) { note(`אין דוגמה חיה ל-${block} — לא ניתן לאמת`); continue; }
  const actual = Object.keys(sample);
  // Declared-but-absent is the dangerous direction: the UI reads undefined.
  const missing = declared.filter((f) => !actual.includes(f));
  // Present-but-undeclared usually means a backend feature the UI never wired.
  const extra = actual.filter((f) => !declared.includes(f));
  for (const f of missing) note(`${block}.${f} — מוצהר ב-UI אך ה-API לא שולח אותו`);
  for (const f of extra) note(`${block}.${f} — ה-API שולח אך לא מוצהר ב-UI (פיצ'ר לא מחובר?)`);
}

// Nested brief blocks the overview reads directly. These are the ones whose
// absence shows up as a blank card rather than a crash.
for (const key of ['forecast', 'discretionary', 'typical_month', 'price_increases']) {
  if (!(key in (api.brief ?? {}))) note(`brief.${key} חסר לגמרי בתשובת ה-API`);
}

if (problems.length === 0) {
  console.log('[contract] ✓ ה-UI וה-API מסכימים על כל השדות');
  process.exit(0);
}
console.error('[contract] נמצאו אי-התאמות:');
for (const p of problems) console.error('  ✗ ' + p);
process.exit(1);
