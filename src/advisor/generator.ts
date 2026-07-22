import type Anthropic from '@anthropic-ai/sdk';
import type { FinancialBrief } from '../features/brief.js';
import { ADVISOR_MODEL, responseText } from './client.js';
import { GENERATOR_SCHEMA, type GeneratorOutput } from './schema.js';

/** PLAN.md §12, extended: an experienced advisor for someone who struggles with money. */
const PERSONA = `אתה יועץ פיננסי אישי ותיק ומנוסה שמלווה אדם שמתקשה להתנהל עם כסף. אתה מדבר בגובה העיניים, בעברית פשוטה, בלי מונחים מקצועיים ובלי טיפת שיפוטיות — כמו חבר חכם וסבלני שמסביר, לא מרצה. אתה מנתח אך ורק את ה-Financial Brief המצורף — לעולם לא ממציא מספרים, אחוזים או ריביות שאינם בו. אם אין ביסוס בנתונים — אמור שאין.

מה אתה בודק תמיד, בסדר הזה:
1. תזרים ומינוס — האם נגמר הכסף לפני סוף החודש, מתי נכנסת המשכורת מול מתי יורדים החיובים הגדולים (כולל חיוב כרטיסי האשראי), והאם יש דרך פשוטה לרווח.
2. חיובים כפולים (duplicate_charges) — לכל זוג: להגיד בפשטות "ייתכן שחויבת פעמיים, ככה בודקים וככה מבקשים זיכוי".
3. עסקאות גדולות או חריגות (large_transactions, קטגוריות עם z גבוה) — לא לשפוט, רק לוודא שהאדם מודע ושזה מכוון.
4. דברים שאפשר להוזיל — מנויים שלא בשימוש או שהתייקרו, עמלות, עסקאות מט"ח, עומס תשלומים (installments) שמכביד על החודשים הבאים.
הקשר ישראלי (ש"ח, חגים, בנקים וחברות אשראי). לכל המלצה: מה קרה, כמה זה עולה בפועל לחודש ולשנה, ומה עושים — צעדים קטנים ומעשיים שאפשר לבצע היום. קודם מה שדחוף ומה שקל.`;

export interface AdvisorMemory {
  dismissedTitles: string[];
  acceptedTitles: string[];
}

export async function generateRecommendations(
  client: Anthropic,
  brief: FinancialBrief,
  memory: AdvisorMemory,
): Promise<GeneratorOutput> {
  const memoryNotes = [
    memory.dismissedTitles.length > 0
      ? `המלצות שנדחו בעבר — אל תחזור עליהן או על וריאציות שלהן: ${memory.dismissedTitles.join(' | ')}`
      : '',
    memory.acceptedTitles.length > 0
      ? `המלצות שהתקבלו בעבר (סגנון שעובד): ${memory.acceptedTitles.join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model: ADVISOR_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: PERSONA,
    output_config: { format: { type: 'json_schema', schema: GENERATOR_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `להלן ה-Financial Brief של החודש (JSON, כל המספרים חושבו ב-SQL):

${JSON.stringify(brief, null, 1)}

${memoryNotes ? memoryNotes + '\n' : ''}
חשוב — user_context הוא אמת מוחלטת מהמשתמש עצמו: הערות על בתי עסק (merchant_notes) גוברות על כל מסקנה אוטומטית (למשל: חיוב שהוסבר אינו כפילות; מנוי שסומן לביטול — עקוב שבאמת נפסק). ענה על כל שאלה פתוחה ב-open_questions לפי הנתונים. אם יש goals, התייחס קודם ליעדים במצב at_risk/off_track והשתמש רק ב-corrective_action ובמספרים שחושבו שם.

החזר שלושה:
1. review — סקירה חודשית קצרה בגובה העיניים (מה מצב הכסף החודש, בלי להעמיס) + עד 3 פעולות דחופות להשבוע. השתמש רק במספרים שמופיעים ב-Brief.
2. recommendations — 3–7 המלצות מובנות. חשוב: המידע חייב להיות מפורק לשדות, לא גוש טקסט —
   - what_happened: משפט-שניים פשוטים בלבד.
   - breakdown: הפריטים המדויקים שמרכיבים את הסיפור (למשל: כל חיוב וסכומו) — העתק סכומים כלשונם מה-Brief.
   - change: המספר "לפני" (ממוצע/חודש קודם) מול "עכשיו", שניהם מה-Brief. null אם אין השוואה.
   - impact_monthly / impact_yearly: כמה זה עולה בפועל.
   - steps: 2–4 צעדים, כל אחד פעולה אחת פשוטה שאפשר לעשות היום.
   כסה את מה שיש בנתונים: כפילויות אם יש, מנויים, עמלות/מט"ח, תזרים, הוצאות חריגות. תעדף לפי דחיפות ואז חיסכון × קלות.
3. answers — תשובה לכל שאלה פתוחה (לפי question_id). אם אין שאלות — מערך ריק.`,
      },
    ],
  });

  return JSON.parse(responseText(response)) as GeneratorOutput;
}
