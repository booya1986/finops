import { normalizeDescription } from './normalize.js';

/**
 * Merchant normalization + classification (PLAN.md §5). Rule tables are the
 * extension point: add a regex → canonical-name pair when a messy merchant
 * shows up. Classification runs on the NORMALIZED name only.
 */

/** Canonical-name rules, applied after generic cleanup. First match wins. */
const MERCHANT_RULES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /netflix/i, name: 'Netflix' },
  { pattern: /\bhbo\b|max\.com|warner ?media/i, name: 'HBO Max' },
  { pattern: /disney\+?/i, name: 'Disney+' },
  { pattern: /spotify|ספוטיפיי/i, name: 'Spotify' },
  // Bank truncates to fixed width — "CLAUDE AI SUBSCRIPTI[ON]" never
  // contains "anthropic" or "claude.ai", so match on the "claude ai" stem too.
  { pattern: /claude\.ai|claude ai|anthropic/i, name: 'Claude (Anthropic)' },
  { pattern: /openai|chatgpt|\bgpt\b/i, name: 'OpenAI' },
  { pattern: /higgsfield/i, name: 'Higgsfield' },
  { pattern: /google \*?(one|storage)/i, name: 'Google One' },
  { pattern: /icloud|apple\.com\/bill/i, name: 'Apple' },
  { pattern: /wolt/i, name: 'Wolt' },
  { pattern: /^שופרסל/, name: 'שופרסל' },
  { pattern: /^רמי לוי/, name: 'רמי לוי' },
];

/**
 * Consolidated monthly card-company debits in the CHECKING account
 * (PLAN.md §5: the critical double-count). Word-anchored on purpose —
 * "כאל" must not match inside names like "מיכאל".
 */
const CARD_COMPANY_DEBIT_PATTERNS: RegExp[] = [
  /ישראכרט/,
  /מקס איט|לאומי קארד/,
  /(^|\s)מקס(\s|$)/,
  /כרטיסי אשראי לישראל|ויזה כאל|(^|\s)כאל(\s|$)/,
  /אמריקן אקספרס|אמקס|(^|\s)amex(\s|$)/i,
  /דיינרס/,
  // Hapoalim names the consolidated debit after the card NETWORK, not the
  // issuer — confirmed against real data ("מסטרקרד", 8 debits/₪79k).
  /מסטרקרד|מאסטרקרד/,
  /(^|\s)ויזה(\s|$)/,
];

/**
 * Own-money movements in the checking account (savings deposits and
 * withdrawals) — not income, not expense. Both directions get is_transfer=1.
 */
const INTERNAL_TRANSFER_PATTERNS: RegExp[] = [
  /פי?קדון/,
  /חי?סכון/,
  // Loan PRINCIPAL ("הלואה קרן/כללי") lands as a matched ±pair on one day: the
  // money arrives and immediately leaves. It's borrowed money, not income, and
  // the outgoing leg isn't spending — counting either blows up the month (2025-09
  // read as ₪100k income / ₪112k expenses on a ₪12k month). Anchored on קרן so
  // the monthly repayment ("הו"ק הלוואה") stays a REAL expense: servicing a loan
  // is genuine outflow.
  /הלוו?אה\s*קרן/,
];

/** Bank fees / interest (is_fee). Only ever applied to charges (amount < 0). */
const FEE_PATTERNS: RegExp[] = [
  /עמל[הת]/,
  /^עמ['".]/, // Hapoalim abbreviates: "עמ.ערוץ ישיר"
  /דמי (ניהול|כרטיס|חשבון)/,
  /ר[יִ]?בית/, // "ריבית" and Hapoalim's "רבית" (overdraft interest — a charge)
];

export function normalizeMerchant(rawDescription: string): string {
  let name = normalizeDescription(rawDescription)
    .replace(/[״]/g, '"')
    .replace(/[׳]/g, "'")
    .replace(/^(paypal \*|pp\*)/i, '')
    .trim();
  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(name)) return rule.name;
  }
  return name;
}

/**
 * Some merchants collapse to one bucket that hides distinct recurring payments
 * — most notably "שיק", where fixed amounts are really rent, parking, etc.
 * Split those by amount so each becomes its own merchant the user categorizes
 * once. Applied to the DISPLAY name only (never the dedup hash), so it's safe
 * to change and re-run without duplicating rows.
 */
const SPLIT_BY_AMOUNT = new Set(['שיק']);

// The recurring ₪4,500 rent check is a known, named commitment — show it as
// "שכירות" rather than the generic "שיק ₪4,500" bucket every other check
// amount gets split into.
const RENT_CHECK_AMOUNT = 4500;

export function displayMerchant(normalizedMerchant: string, amountIls: number): string {
  if (!SPLIT_BY_AMOUNT.has(normalizedMerchant)) return normalizedMerchant;
  const abs = Math.round(Math.abs(amountIls));
  if (abs === RENT_CHECK_AMOUNT) return 'שכירות';
  return `${normalizedMerchant} ₪${abs.toLocaleString('en-US')}`;
}

export function isCardCompanyDebit(normalizedMerchant: string): boolean {
  return CARD_COMPANY_DEBIT_PATTERNS.some((p) => p.test(normalizedMerchant));
}

export function isInternalTransfer(normalizedMerchant: string): boolean {
  // Interest ON a deposit ("ריבית מפקדון") is real income, not own-money movement.
  if (/ריבית/.test(normalizedMerchant)) return false;
  return INTERNAL_TRANSFER_PATTERNS.some((p) => p.test(normalizedMerchant));
}

export function isFee(normalizedMerchant: string, amountIls: number): boolean {
  return amountIls < 0 && FEE_PATTERNS.some((p) => p.test(normalizedMerchant));
}

/**
 * Rule-based categorization, used only when the scraper didn't supply a
 * category. Coarse buckets on purpose — the Brief aggregates on these.
 * Unmatched merchants stay NULL and surface as "ללא קטגוריה".
 */
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^(Netflix|HBO Max|Disney\+)$/i, category: 'בידור וסטרימינג' },
  { pattern: /^(Spotify|Claude \(Anthropic\)|OpenAI|Higgsfield|Google One|Apple)$|יוטיוב|youtube/i, category: 'כלי AI ותוכנה' },
  { pattern: /שופרסל|רמי לוי|ויקטורי|יוחננוף|טיב טעם|מגה |יינות ביתן|אושר עד|סופר /, category: 'סופרמרקט' },
  { pattern: /קפה|מסעד|בורגר|פיצה|סושי|Wolt|מקדונלד|ארומה|גרג|לנדוור|רולדין/i, category: 'מסעדות וקפה' },
  { pattern: /דלק|פז |סונול|דור אלון|טן |חניון|חניה|פנגו|סלופארק|רב קו|רב-קו|מוניות|gett|יאנגו/i, category: 'תחבורה' },
  { pattern: /שכר דירה|^שכירות$|בעל.?הבית|בעה"ב/i, category: 'שכירות' },
  { pattern: /ארנונה|חשמל|מים |גז |ועד בית|בזק|הוט |hot|פרטנר|סלקום|yes/i, category: 'דיור וחשבונות' },
  { pattern: /סופר-פארם|סופר פארם|בית מרקחת|מכבי|כללית|מאוחדת|רופא|מרפא/, category: 'בריאות' },
  { pattern: /ביטוח|הפניקס|הראל |מגדל |מנורה|כלל ביטוח/, category: 'ביטוח' },
  { pattern: /הלווא|הלואה|הו"ק הלווא/, category: 'הלוואות' },
  { pattern: /משכורת|שכר |salary/i, category: 'הכנסה' },
];

/**
 * BIT (Israel's dominant P2P payment app) carries wildly different purposes
 * under one merchant name — a fixed personal-trainer fee is meaningfully
 * different from ad-hoc splitting-the-bill transfers. Amount-based split so
 * the trainer's recurring ₪200 doesn't drown in "miscellaneous transfers",
 * and vice versa. The exact amount is a heuristic, not identity — a real
 * user override (merchant_notes) always wins over this guess.
 */
const BIT_TRAINER_AMOUNT = 200;
function categorizeBit(amountIls: number): string {
  return Math.abs(amountIls) === BIT_TRAINER_AMOUNT ? 'פיתוח אישי וכושר' : 'העברות אישיות (ביט)';
}

export function categorize(normalizedMerchant: string, amountIls: number, isFeeFlag: boolean): string | null {
  if (isFeeFlag) return 'עמלות בנק';
  if (amountIls > 0 && /משכורת|שכר |salary/i.test(normalizedMerchant)) return 'הכנסה';
  if (/העברה ב.?BIT/i.test(normalizedMerchant)) return categorizeBit(amountIls);
  if (/משיכ[הת] מבנקט|כספומט|ATM/i.test(normalizedMerchant)) return 'מזומן ומשיכות';
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(normalizedMerchant)) return rule.category;
  }
  return null;
}
