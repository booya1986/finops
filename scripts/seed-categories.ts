import { openDb } from '../src/db/index.js';
import { applyUserCategoryRules } from '../src/db/userRules.js';
import { log } from '../src/logging/logger.js';

/**
 * One-time bulk categorization of confidently-identifiable uncategorized
 * merchants. Each rule maps a substring/regex to a category; writes a
 * merchant_note (the user-truth layer) for every matching uncategorized
 * merchant so it also applies to future ingests. Ambiguous merchants are
 * left alone on purpose.
 */

const RULES: Array<{ category: string; test: (m: string) => boolean }> = [
  { category: 'סופרמרקט', test: (m) => /פרשמרקט|שופרסל|רמי לוי|ויקטורי|יוחננוף|אושר עד|מ\.ע\.ע\. שוקיס|בובה של (ירקנייה|סופר)|קצביי|חנויות בשר|משק הגולן|קצביית|כלבו קיבוץ|אונו מרקט|זול סנטר|סופרטל|שגב אקספרס|כרמלה|טל לחקלאי|ארץ שקד תבלינים|CARREFO/i.test(m) },
  { category: 'מסעדות וקפה', test: (m) => /קפה|מסעד|בורגר|פיצה|סושי|Wolt|מקדונלד|MC DONALD|ארומה|גרג|לנדוור|רולדין|פאפא גונס|סביח|שאטו שועל|שולחן מלכים|צאקולי|הדקה ה91|צייט פור ברוט|שומשום בר|דה פייסטרי|PATE|BONGUSTARE|SIREN COFFEE|AI TRE SCALINI|BUONGIORNO|PIANOSTRADA|VENCHI|MOLINO|GRANO|RISTOGEST|DON NINO|איטלקיה|ויין בר|מבשלת שפירא|בר בריא|GOZO|יאשקה|רובן ראשלצ|פארוק בשוק|פול אנד בר|נוף בחצר|קדור ראני|א\.י\.ש קייטרינג|א\.ש קייטרינג|שגב|בנא משקאות|EXPRESS$|DUTY FREE MARKET|SUPERMERCATO/i.test(m) },
  { category: 'קניות ואופנה', test: (m) => /זארה|ZARA|איקאה|לגו|LEGO|H&M|HM אונו|קסטרו|פולו ראלף|UNIQLO|בילבונג|פוקס הום|קניון|בוטיק|SETTE LIFESTYLE|DONNA SOFIA|HANS|XI STORE|תכשיטי יד זהב|ורדינון|אופיס דיפו|צומת ספרים|הייטקזון|טויס אר אס|בית התינוקות|לים אופנת ילדים|כרמית פארם|BOX$|פוט ל|מרסי|כרמלה$|BIALETTI/i.test(m) },
  { category: 'בריאות', test: (m) => /ד"ר|דר |פיזיוספורט|מדע היופי|וולנס|אסיא מדיקל|מכבי|כללית|מאוחדת|רופא|מרפא|בית מרקחת|סופר.?פארם|GERASSI BARBER|פארם/i.test(m) },
  { category: 'תחבורה', test: (m) => /דלק|פז |סונול|דור אלון|חניון|חניה|חניוני|פנגו|נאייקס|סלופארק|רב.?קו|מוניות|gett|יאנגו|YANGO|LIME |מ\. ?התחבורה|מ\.תחבורה|רכב|שטיפת רכב|AIRALO/i.test(m) },
  { category: 'כלי AI ותוכנה', test: (m) => /CLAUDE|Anthropic|OpenAI|HIGGSFIELD|ELEVENLABS|KREA|WISPR|MIRAGE|MIDJOURNEY|LOVABLE|SUPABASE|GOOGLE (CLOUD|One)|SITEGROUND|PADDLE|N8N|OBSIDIAN|LEMSQZY|FAL |FAL$|HANABI|HEADSTART|אינסטבלוק|DREAME|פרש דיגיטל|SCREENSTUDI|FEATURES LABELS|APPLE COM/i.test(m) },
  { category: 'נסיעות וחו"ל', test: (m) => /אל על|ג א ר היינמן|טרמינל|ORA ACANFORA|A S ROMA|AS ROMA|FCO1|ROMA/i.test(m) },
  { category: 'ילדים ופנאי', test: (m) => /גן |גיבס|PLAYSTATION|יס פלאנט|סינימה|צאצא|ל\.י ממתקים|חוות נעמי|חממה|נוף בחצר$/i.test(m) },
  { category: 'תרומות', test: (m) => /עיגול לטובה|להושיט יד|הקרן לפיתוח|עמותת|גדולים מהחיים|אשל ירושלים/i.test(m) },
  { category: 'בידור וסטרימינג', test: (m) => /Netflix|Disney|Spotify|YES |HOT |סלקום TV/i.test(m) },
  { category: 'מתנות', test: (m) => /שוברי מתנה|מתנה (באשראי )?לאירוע|EASY2GIVE|מתנה לאירו/i.test(m) },
  { category: 'דיור וחשבונות', test: (m) => /אמישראגז|עירית|עיריית|מילגם|הוראת.?קבע|בנהפ בקרה|ארנונה|חשמל|מים |ועד בית|בזק|פרטנר|סלקום|HOT|YES/i.test(m) },
];

function main(): void {
  const db = openDb();
  try {
    const uncategorized = db.prepare(`
      SELECT DISTINCT normalized_merchant AS m FROM transactions
      WHERE category IS NULL AND amount_ils < 0 AND is_transfer = 0
    `).all() as { m: string }[];

    const upsert = db.prepare(`
      INSERT INTO merchant_notes (merchant, note, category, updated_at)
      VALUES (@merchant, @note, @category, datetime('now'))
      ON CONFLICT(merchant) DO UPDATE SET category = excluded.category, note = excluded.note, updated_at = excluded.updated_at
    `);

    const byCategory: Record<string, number> = {};
    let matched = 0;
    for (const { m } of uncategorized) {
      const rule = RULES.find((r) => r.test(m));
      if (!rule) continue;
      upsert.run({ merchant: m, note: `סווג אוטומטית ל-${rule.category} (ניתן לשנות)`, category: rule.category });
      byCategory[rule.category] = (byCategory[rule.category] ?? 0) + 1;
      matched += 1;
    }

    const recategorized = applyUserCategoryRules(db);
    log.info(`[seed-categories] ${matched}/${uncategorized.length} בתי עסק סווגו · ${recategorized} תנועות עודכנו`);
    for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      log.info(`  ${cat}: ${n} בתי עסק`);
    }
    const left = db.prepare(`
      SELECT COUNT(DISTINCT normalized_merchant) AS n FROM transactions
      WHERE category IS NULL AND amount_ils < 0 AND is_transfer = 0
    `).get() as { n: number };
    log.info(`[seed-categories] נותרו ${left.n} בתי עסק לא מסווגים`);
  } finally {
    db.close();
  }
}

main();
