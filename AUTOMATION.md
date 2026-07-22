# אוטומציה ודוחות מקומיים

Phase 7 מפעיל תזמון והגשת דוחות מקומית בלבד. אין שליחה למייל, Telegram, Notion או ענן; כל דוח נשמר תחת `data/reports` בהרשאות `600`.

## מה רץ ומתי

ה־scheduler בודק פעם בדקה לפי `Asia/Jerusalem`:

* כל יום מ־06:00: `ingest` לחודשיים האחרונים, ואז `advise`.
* יום ראשון מ־07:00: דוח שבועי.
* היום הראשון בחודש מ־08:00: דוח חודשי.

`agent_memory` שומר `last_attempt` לפני הרצה, ולכן כשל אינו יוצר retry storm באותו יום. `automation.lock` מונע שני schedulers במקביל.

## הפעלה מפורשת

האוטומציה כבויה כברירת מחדל ונכשלת סגור. להפעלה ידנית ב־terminal מקומי:

```bash
FINOPS_AUTOMATION_ENABLED=1 npm run automation
```

יש להשאיר את התהליך פעיל. קרדנציאלס ממשיכים להיטען מה־Keychain בתוך תהליך ה־ingest ואינם מועברים ב־argv.

## Kill switch

כדי למנוע הרצות חדשות מיד:

```bash
touch data/AUTOMATION_DISABLED
```

להפעלה מחדש בצורה הפיכה:

```bash
mv data/AUTOMATION_DISABLED data/AUTOMATION_DISABLED.off
```

אם תהליך נסגר באופן לא תקין ונשאר `data/automation.lock`, יש לבדוק שאין scheduler פעיל ורק אז להעביר את הקובץ לשם `automation.lock.stale`.

## דוחות ידניים

```bash
npm run report -- --period weekly
npm run report -- --period monthly
npm run report -- --period monthly --month 2026-06
```

אפשר ליצור אותם גם מתוך לשונית "ניהול" בדשבורד. הדוח כולל אגרגציות תזרים, חריגות, יעדים וקטגוריות מובילות, בלי raw transactions ובלי LLM.

## Event-driven

בסיום כל `npm run ingest`, המערכת בונה Brief חדש ומריצה מיד:

1. זיהוי התראות דטרמיניסטי.
2. סנכרון חיובים חוזרים.
3. שמירת `last_event_scan` להצגה בדשבורד.

הדשבורד, שמבצע polling כל חמש שניות, מציג את ההתראות החדשות ללא צורך ברענון ידני.

## בדיקות

```bash
npm run automation:selftest
npm run build
```

בדיקת חשבון אמיתי דורשת מהמשתמש לוודא ידנית: Keychain תקין, 2FA אם נדרש, ושהרצת scheduler אחת יוצרת ingest, advise ודוח ללא נעילת חשבון.
