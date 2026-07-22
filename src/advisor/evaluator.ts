import type Anthropic from '@anthropic-ai/sdk';
import type { FinancialBrief } from '../features/brief.js';
import { ADVISOR_MODEL, responseText } from './client.js';
import { EVALUATOR_SCHEMA, type CandidateRecommendation, type EvaluatorOutput, type MonthlyReview } from './schema.js';

/**
 * Second, independent pass (PLAN.md §9): a critical reviewer that sees the
 * same Brief and judges each candidate — grounded? actionable? safe? Only
 * approved recommendations are ever stored or shown.
 */
export async function evaluateRecommendations(
  client: Anthropic,
  brief: FinancialBrief,
  review: MonthlyReview,
  candidates: CandidateRecommendation[],
): Promise<EvaluatorOutput> {
  const response = await client.messages.create({
    model: ADVISOR_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system:
      'אתה מבקר קפדן של תוצרי יועץ פיננסי. אשר המלצה רק אם: (1) כל מספר בה מופיע ב-Brief או נגזר ממנו בחשבון פשוט ושקוף, (2) היא ישימה וקונקרטית ולא עצה כללית, (3) אין בה סיכון או ייעוץ השקעות. בדוק גם את הסקירה החודשית (review): כל מספר בה חייב להופיע ב-Brief, והטון פשוט ולא שיפוטי. דחה כל דבר גבולי — איכות לפני כמות.',
    output_config: { format: { type: 'json_schema', schema: EVALUATOR_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `ה-Financial Brief (מקור האמת):

${JSON.stringify(brief, null, 1)}

הסקירה החודשית לבדיקה:

${JSON.stringify(review, null, 1)}

ההמלצות לבדיקה (לפי אינדקס):

${JSON.stringify(candidates.map((c, i) => ({ index: i, ...c })), null, 1)}

החזר פסק דין לכל אינדקס + review_ok לסקירה.`,
      },
    ],
  });

  return JSON.parse(responseText(response)) as EvaluatorOutput;
}
