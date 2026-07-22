/**
 * Structured-output schemas for the Generator→Evaluator loop (PLAN.md §9).
 * Strict JSON schemas (additionalProperties: false everywhere) so the API
 * guarantees the shape — no free-text parsing.
 */

export type RecommendationCategory =
  | 'duplicate_charge'
  | 'subscription'
  | 'fee_fx'
  | 'cashflow'
  | 'spending'
  | 'other';

export interface RecChange {
  baseline_label: string;
  baseline: number;
  current_label: string;
  current: number;
}

export interface CandidateRecommendation {
  title: string;
  category: RecommendationCategory;
  /** משפט-שניים פשוטים — מה קרה. */
  what_happened: string;
  /** ממה מורכב המספר — פריטים מדויקים מה-Brief. */
  breakdown: Array<{ label: string; amount: number }>;
  /** מה השתנה — ממוצע/תקופה קודמת מול עכשיו. null אם לא רלוונטי. */
  change: RecChange | null;
  impact_monthly: number;
  impact_yearly: number;
  /** צעדים קצרים, כל אחד ניתן לביצוע בפני עצמו. */
  steps: string[];
  est_saving_ils_monthly: number;
  effort: 'low' | 'med' | 'high';
  confidence: number;
  based_on_numbers: number[];
}

export interface MonthlyReview {
  summary: string;
  urgent_actions: string[];
}

export interface QuestionAnswer {
  question_id: number;
  answer: string;
}

export interface GeneratorOutput {
  review: MonthlyReview;
  recommendations: CandidateRecommendation[];
  answers: QuestionAnswer[];
}

export interface EvaluatorVerdict {
  index: number;
  approved: boolean;
  reason: string;
}

export interface EvaluatorOutput {
  verdicts: EvaluatorVerdict[];
  review_ok: boolean;
  review_reason: string;
}

export const GENERATOR_SCHEMA = {
  type: 'object',
  properties: {
    review: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'סקירה חודשית בגובה העיניים, 4–6 משפטים: מה מצב הכסף החודש, מה בולט, ומה חשוב להבין. עברית פשוטה, בלי מונחים.',
        },
        // Kept for backwards compatibility with reviews already stored in
        // agent_memory, but no longer rendered: these were plain strings with
        // no id or status, so a resolved item stayed on screen as "urgent"
        // forever. Anything the user should ACT on must be a recommendation,
        // which has accept/dismiss/done. Ask for observations instead.
        urgent_actions: {
          type: 'array',
          items: { type: 'string' },
          description: 'עד 3 תובנות קצרות שראוי לשים לב אליהן החודש. אלה הערות הקשר בלבד — כל דבר שדורש פעולה בפועל חייב להופיע כהמלצה, לא כאן.',
        },
      },
      required: ['summary', 'urgent_actions'],
      additionalProperties: false,
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'כותרת קצרה וקונקרטית בעברית' },
          category: {
            type: 'string',
            enum: ['duplicate_charge', 'subscription', 'fee_fx', 'cashflow', 'spending', 'other'],
          },
          what_happened: { type: 'string', description: 'משפט או שניים פשוטים — מה קרה. בלי מספרים מיותרים, בלי ז\'רגון.' },
          breakdown: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'שם הפריט (בית עסק / חיוב / רכיב)' },
                amount: { type: 'number', description: 'הסכום המדויק כפי שמופיע ב-Brief' },
              },
              required: ['label', 'amount'],
              additionalProperties: false,
            },
            description: 'ממה מורכב הסיפור — הפריטים המדויקים מה-Brief שמרכיבים את הסכום. ריק אם אין פירוק.',
          },
          change: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  baseline_label: { type: 'string', description: 'למשל: "ממוצע 6 חודשים" או "חודש שעבר"' },
                  baseline: { type: 'number' },
                  current_label: { type: 'string', description: 'למשל: "החודש"' },
                  current: { type: 'number' },
                },
                required: ['baseline_label', 'baseline', 'current_label', 'current'],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
            description: 'מה השתנה: מספר בסיס מול המספר הנוכחי, שניהם מה-Brief. null אם לא רלוונטי.',
          },
          impact_monthly: { type: 'number', description: 'כמה זה עולה בפועל בחודש, בש"ח' },
          impact_yearly: { type: 'number', description: 'כמה זה עולה בשנה אם ממשיכים ככה' },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '2–4 צעדים קצרים. כל צעד = פעולה אחת שאפשר לעשות היום, מנוסחת פשוט.',
          },
          est_saving_ils_monthly: { type: 'number', description: 'חיסכון חודשי משוער בש"ח' },
          effort: { type: 'string', enum: ['low', 'med', 'high'] },
          confidence: { type: 'number', description: '0 עד 1' },
          based_on_numbers: {
            type: 'array',
            items: { type: 'number' },
            description: 'המספרים מה-Brief שעליהם ההמלצה מבוססת, כלשונם',
          },
        },
        required: ['title', 'category', 'what_happened', 'breakdown', 'change', 'impact_monthly', 'impact_yearly', 'steps', 'est_saving_ils_monthly', 'effort', 'confidence', 'based_on_numbers'],
        additionalProperties: false,
      },
    },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_id: { type: 'integer', description: 'ה-id של השאלה מ-user_context.open_questions' },
          answer: {
            type: 'string',
            description: 'תשובה בגובה העיניים על סמך הנתונים בלבד. אם אי אפשר לדעת מהנתונים — אמור זאת והסבר איך לברר.',
          },
        },
        required: ['question_id', 'answer'],
        additionalProperties: false,
      },
      description: 'תשובה לכל שאלה פתוחה ב-user_context.open_questions. ריק אם אין שאלות.',
    },
  },
  required: ['review', 'recommendations', 'answers'],
  additionalProperties: false,
} as const;

export const EVALUATOR_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          approved: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['index', 'approved', 'reason'],
        additionalProperties: false,
      },
    },
    review_ok: { type: 'boolean', description: 'האם הסקירה נאמנה למספרי ה-Brief ולא ממציאה דבר' },
    review_reason: { type: 'string' },
  },
  required: ['verdicts', 'review_ok', 'review_reason'],
  additionalProperties: false,
} as const;
