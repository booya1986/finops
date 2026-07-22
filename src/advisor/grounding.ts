import type { FinancialBrief } from '../features/brief.js';
import type { CandidateRecommendation } from './schema.js';

/**
 * Deterministic anti-hallucination gate (PLAN.md §17): every number a
 * recommendation claims to rely on must literally exist in the Brief, and the
 * estimated saving must be sane. Runs BEFORE the LLM evaluator — code first,
 * judgment second.
 */

/** Collect every numeric value in the brief, rounded to 2dp, as a lookup set. */
export function collectBriefNumbers(brief: FinancialBrief): Set<number> {
  const numbers = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      numbers.add(Math.round(value * 100) / 100);
      numbers.add(Math.round(Math.abs(value) * 100) / 100);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(brief);
  return numbers;
}

export interface GroundingResult {
  ok: boolean;
  reason?: string;
}

export function checkGrounding(
  rec: CandidateRecommendation,
  briefNumbers: Set<number>,
  monthlyExpenses: number,
): GroundingResult {
  if (!(rec.est_saving_ils_monthly > 0)) {
    return { ok: false, reason: 'חיסכון משוער לא חיובי' };
  }
  if (rec.est_saving_ils_monthly > monthlyExpenses) {
    return { ok: false, reason: `חיסכון משוער (₪${rec.est_saving_ils_monthly}) גדול מסך ההוצאות החודשי` };
  }
  if (rec.based_on_numbers.length === 0) {
    return { ok: false, reason: 'לא צוינו מספרים מה-Brief' };
  }
  const mustExist: Array<[number, string]> = [
    ...rec.based_on_numbers.map((n): [number, string] => [n, 'based_on_numbers']),
    ...rec.breakdown.map((b): [number, string] => [b.amount, `פירוק "${b.label}"`]),
    ...(rec.change ? ([[rec.change.baseline, 'change.baseline'], [rec.change.current, 'change.current']] as Array<[number, string]>) : []),
  ];
  for (const [n, where] of mustExist) {
    const rounded = Math.round(Math.abs(n) * 100) / 100;
    if (!briefNumbers.has(rounded)) {
      return { ok: false, reason: `המספר ${n} (${where}) לא קיים ב-Brief — חשד להזיה` };
    }
  }
  if (rec.steps.length === 0) {
    return { ok: false, reason: 'אין צעדים לביצוע' };
  }
  if (rec.confidence < 0 || rec.confidence > 1) {
    return { ok: false, reason: 'confidence מחוץ לטווח 0–1' };
  }
  return { ok: true };
}
