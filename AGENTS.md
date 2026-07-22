# FinOps — כללים קריטיים (תמצית מ-PLAN.md)

סוכן יועץ פיננסי אישי אוטונומי + לייב דשבורד. מקומי בלבד. המסמך המלא: `PLAN.md`. בנייה בשלבים (Phase 0–7).

**מדיניות מעבר שלבים:** בסוף כל שלב מריצים את כל בדיקות קריטריון הקבלה. דברים שרק המשתמש יכול לבדוק (קרדנציאלס, אימות מול חשבון אמיתי, 2FA) — מפרטים למשתמש מה ואיך. אם כל הבדיקות עוברות — ממשיכים לשלב הבא אוטומטית, בלי לחכות לאישור.

## שלוש החלטות הליבה

1. **ניתוח על Features בלבד** — הסוכן לא רואה תנועות גולמיות אלא "Financial Brief" ש-SQL מחשב. כל מספר מגיע מ-SQL דטרמיניסטי; ה-LLM רק מתעדף ומנסח.
2. **Generator → Evaluator** — כל המלצה עוברת סוכן מבקר (ביסוס בנתונים, ישימות, בטיחות) לפני שהיא מוצגת.
3. **יעדים + זיכרון** — הסוכן מלווה: עוקב אחרי יעדים, מציע צעד מתקן, וזוכר מה התקבל/נדחה.

## עקרונות אבטחה (סעיף 1 — לא לפשר)

* הכל מקומי: DB, קבצים, לוגים. אין העלאת נתונים פיננסיים לענן.
* קרדנציאלס ב-Keychain של ה-OS (`@napi-rs/keyring`, service ‏`finops`) או `.env` שב-`.gitignore`. אף פעם לא בקוד ולא ב-git.
* ה-LLM מקבל כברירת מחדל רק אגרגציות. raw data לענן — רק מאחורי flag מפורש.
* קריאה בלבד. אין פעולות תשלום/העברה בשום מקום במערכת.

## אבטחת השליפה (סעיף 1.1 — מחמיר)

* **קרדנציאלס:** keychain בלבד; `.env` fallback עם `chmod 600`. לעולם לא כארגומנטים ל-CLI (נראים ב-`ps`), לעולם לא בלוגים. לטעון לזיכרון רק למשך השליפה.
* **שרשרת אספקה (החשוב ביותר):** גרסאות מוצמדות (`save-exact`), lockfile מחויב, `npm audit`, אין עדכון תלויות אוטומטי — כל bump עובר review.
* **בידוד ורשת:** סקרייפר בקונטקסט מבודד; egress allowlist לדומייני הבנק בלבד.
* **נתונים ולוגים:** SQLite ב-`chmod 600` על דיסק מוצפן; לוגים ממוסכים — 4 ספרות אחרונות בלבד, בלי OTP/סיסמאות.
* **תפעול:** fail closed · ריווח בין הרצות · kill switch · אין גיבוי לא-מוצפן ולא לענן.

## דדופ ומלכודות ישראליות (סעיף 5)

* מפתח דדופ: `sha256(date | amount | normalized_description | account_id)` + `INSERT OR IGNORE`.
* **כפל חיוב אשראי/עו"ש (קריטי):** מקור האמת להוצאות כרטיס = סקרייפר הכרטיס; החיוב המרוכז בעו"ש מסומן `is_transfer=1` ומוחרג — אחרת ספירה כפולה.
* תשלומים: `installment_current/total` + חיזוי תשלומים עתידיים בתזרים.
* נירמול שמות בתי עסק בעברית לפני קטגוריזציה; להבחין `date` (עסקה) מ-`charge_date` (חיוב); מט"ח: מטבע מקורי + `amount_ils`.

## Guardrails (סעיף 17)

* לעולם לא מזיז כסף. קריאה בלבד. כל צעד עם השלכה — Human-in-the-loop.
* אנטי-הזיה: מספרים מ-SQL בלבד; Evaluator חוסם המלצות לא-מבוססות.
* מדד איכות: יחס המלצות שהתקבלו + חיסכון ממומש לאורך זמן.

## פקודות

* `npm start` — אתחול + בדיקת שפיות
* `npm run db:migrate` — יצירת/עדכון סכמת ה-DB (`data/finops.db`)
* `npm run secrets -- set|get|delete <name>` — ניהול סודות ב-Keychain (קלט מוסתר, לא argv)
* `npm run ingest` — משיכת תנועות מכל הספקים (`--show` לדפדפן גלוי, `--months N`)
* `npm run ingest:selftest` — בדיקת דדופ/נירמול/כפל-חיוב על פיקסצ'רים, בלי בנק
* `npm run brief` — Financial Brief לחודש הנוכחי (`--month YYYY-MM` לחודש אחר)
* `npm run brief:selftest` — אימות ה-Brief מול חישובים ידניים
* `npm run goals:selftest` — אימות מעקב יעדים, קצב וצעד מתקן על fixtures מקומיים
* `npm run advise` — הרצת היועץ: התראות דטרמיניסטיות + Generator→Evaluator (דורש anthropic.apiKey ב-Keychain)
* `npm run report -- --period weekly|monthly` — יצירת דוח Markdown מקומי תחת `data/reports`
* `npm run automation` — scheduler מקומי (דורש `FINOPS_AUTOMATION_ENABLED=1`; פרטים ב-`AUTOMATION.md`)
* `npm run automation:selftest` — בדיקת תזמון, מניעת כפילות והרשאות דוחות בלי בנק
* `npm run dashboard` — build + לייב דשבורד React/shadcn על http://127.0.0.1:3737 (מקומי בלבד)
* `npm run dashboard:build` — typecheck + build של ממשק React; `npm run dashboard:legacy` מפעיל fallback שמור
* `npm run reclassify` — החלה מחדש של כללי סיווג על תנועות קיימות (אחרי שינוי ב-merchants.ts)
* `npm run setup` — וויזרד התקנה ראשוני: בדיקת סביבה, יצירת DB, והזנת פרטי התחברות מאובטחת
* `npm run build` — typecheck של שכבת Node/TypeScript (ההרצה דרך tsx)
