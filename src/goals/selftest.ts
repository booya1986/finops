import Database from 'better-sqlite3';
import { buildGoalTracking } from './tracking.js';

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`✗ ${message}`);
  console.log(`  ✓ ${message}`);
}

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, amount_ils REAL NOT NULL,
    category TEXT, is_transfer INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE goals (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
    target_amount REAL NOT NULL, category TEXT, deadline TEXT,
    progress REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active'
  );
  INSERT INTO transactions (date, amount_ils, category, is_transfer) VALUES
    ('2026-07-03', -250, 'מסעדות וקפה', 0),
    ('2026-07-10', -100, 'מסעדות וקפה', 0),
    ('2026-07-12', -150, 'תחבורה', 0),
    ('2026-07-15', -900, 'העברה', 1);
  INSERT INTO goals (title, type, target_amount, category, deadline, progress, status) VALUES
    ('תקרת הוצאות', 'cap_monthly', 1000, NULL, NULL, 0, 'active'),
    ('פחות מסעדות', 'cut_category', 400, 'מסעדות וקפה', NULL, 0, 'active'),
    ('קרן חירום', 'save_by_date', 12000, NULL, '2026-10-19', 3000, 'active'),
    ('ישן', 'cap_monthly', 500, NULL, NULL, 0, 'archived');
`);

console.log('[selftest] מעקב יעדים דטרמיניסטי:');
const goals = buildGoalTracking(db, '2026-07', new Date('2026-07-19T10:00:00Z'));
assert(goals.length === 3, 'יעד archived אינו מוצג');
const cap = goals.find((g) => g.type === 'cap_monthly')!;
assert(cap.current_value === 500, 'תקרת הוצאות מחושבת בלי העברות');
assert(cap.remaining === 500, 'נותרו ₪500 עד התקרה');
assert(cap.state === 'on_track', 'תקרת ההוצאות בתוך הקצב');
const cut = goals.find((g) => g.type === 'cut_category')!;
assert(cut.current_value === 350, 'יעד קטגוריה משתמש רק בקטגוריה שנבחרה');
assert(cut.state === 'at_risk', 'חריגה מהקצב מסומנת בסיכון לפני חריגה מהתקרה');
const saving = goals.find((g) => g.type === 'save_by_date')!;
assert(saving.current_value === 3000 && saving.remaining === 9000, 'יעד חיסכון עוקב אחרי ההתקדמות המאושרת');
assert((saving.required_monthly ?? 0) > 2900 && (saving.required_monthly ?? 0) < 3100, 'מחושב קצב חיסכון חודשי נדרש');
assert(saving.corrective_action.includes('בחודש'), 'מוצע צעד מתקן קונקרטי');
console.log('[selftest] הכל עבר ✓');
db.close();
