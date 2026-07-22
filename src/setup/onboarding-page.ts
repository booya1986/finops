import { BASE_PROVIDERS, type ProviderCatalogEntry } from '../ingest/providers.js';

/**
 * The onboarding page — a single self-contained HTML document. No external
 * resources (CSP default-src 'none'): fonts fall back to the system stack, all
 * CSS and JS are inline. The catalog is injected as JSON so the client can
 * render institution cards and their fields without another request.
 *
 * Design: a calm "private ledger" — warm paper, near-black ink, hairline rules,
 * and a single pine-green seal used only for "secure/selected". The persistent
 * "🔒 מקומי" seal is the signature: trust made visible the whole way through.
 */

interface CatalogField { name: string; label: string; hint?: string }
interface CatalogEntry {
  id: string;
  category: 'bank' | 'card';
  displayName: string;
  advanced: boolean;
  fields: CatalogField[];
}

function toCatalog(): CatalogEntry[] {
  return Object.entries(BASE_PROVIDERS).map(([id, p]: [string, ProviderCatalogEntry]) => ({
    id,
    category: p.category,
    displayName: p.displayName,
    advanced: p.advanced === true,
    fields: p.fields.map((f) => ({ name: f.name, label: f.label, ...(f.hint ? { hint: f.hint } : {}) })),
  }));
}

const CSS = `
:root {
  --paper: #FBFAF7; --card: #FFFFFF; --ink: #1A1D24; --muted: #6B7280;
  --edge: #E7E4DC; --edge-strong: #D8D4C9;
  --seal: #1F6F5C; --seal-ink: #17513f; --seal-tint: #EAF2EF;
  --danger: #B23A3A;
  --r: 14px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: "Heebo", system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--paper); color: var(--ink);
  line-height: 1.55; direction: rtl;
  padding: 48px 20px 96px;
  display: flex; justify-content: center;
}
main { width: 100%; max-width: 620px; }

/* Persistent security seal — the signature element. */
.seal {
  position: fixed; inset-block-start: 20px; inset-inline-start: 20px;
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 500; color: var(--seal-ink);
  background: var(--seal-tint); border: 1px solid #CDE3DB;
  padding: 6px 12px; border-radius: 999px;
}
.seal-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--seal); }

.stepline { font-size: 13px; color: var(--muted); letter-spacing: .01em; margin-block-end: 10px; }
h1 { font-size: 30px; font-weight: 300; letter-spacing: -.01em; line-height: 1.2; }
.lede { color: var(--muted); font-size: 15.5px; margin-block-start: 10px; max-width: 52ch; }

.rule { height: 1px; background: var(--edge); margin: 28px 0; border: 0; }

.group-label {
  font-size: 12px; font-weight: 600; letter-spacing: .06em;
  text-transform: none; color: var(--muted); margin-block-end: 12px;
}

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 460px) { .grid { grid-template-columns: 1fr; } }

.pick {
  text-align: start; background: var(--card); border: 1px solid var(--edge);
  border-radius: var(--r); padding: 13px 15px; cursor: pointer;
  font: inherit; color: var(--ink); transition: border-color .12s, background .12s, box-shadow .12s;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.pick:hover { border-color: var(--edge-strong); }
.pick[aria-pressed="true"] {
  border-color: var(--seal); background: var(--seal-tint);
  box-shadow: inset 0 0 0 1px var(--seal);
}
.pick .name { font-weight: 500; font-size: 15px; }
.pick .tag {
  font-size: 10.5px; color: var(--muted); border: 1px solid var(--edge-strong);
  border-radius: 6px; padding: 1px 6px; white-space: nowrap;
}
.pick .check {
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  border: 1.5px solid var(--edge-strong); display: grid; place-items: center;
  color: #fff; font-size: 12px; transition: background .12s, border-color .12s;
}
.pick[aria-pressed="true"] .check { background: var(--seal); border-color: var(--seal); }

/* Selected-institution credential blocks */
#forms { margin-block-start: 6px; }
.inst {
  border: 1px solid var(--edge); border-radius: var(--r);
  background: var(--card); padding: 18px; margin-block-end: 14px;
}
.inst-head { display: flex; align-items: baseline; justify-content: space-between; margin-block-end: 4px; }
.inst-title { font-size: 16px; font-weight: 600; }
.inst-note { font-size: 12.5px; color: var(--muted); margin-block-end: 14px; }

.acct { border-block-start: 1px dashed var(--edge); padding-block-start: 14px; margin-block-start: 14px; }
.acct:first-of-type { border-block-start: 0; padding-block-start: 0; margin-block-start: 0; }
.acct-label { font-size: 12.5px; font-weight: 600; color: var(--muted); margin-block-end: 10px; }

label.field { display: block; margin-block-end: 12px; }
.field .lbl { font-size: 13px; font-weight: 500; margin-block-end: 5px; display: block; }
.field .hint { font-size: 11.5px; color: var(--muted); margin-block-start: 4px; }
input[type="password"], input[type="text"] {
  width: 100%; direction: ltr; text-align: start;
  padding: 10px 12px; font: inherit; font-size: 14.5px;
  border: 1px solid var(--edge-strong); border-radius: 9px; background: #FCFCFB; color: var(--ink);
}
input:focus { outline: 2px solid rgba(31,111,92,.25); outline-offset: 1px; border-color: var(--seal); }
input.name-input { direction: rtl; }

.add {
  margin-block-start: 4px; background: none; border: 1px dashed var(--edge-strong);
  color: var(--seal-ink); border-radius: 9px; padding: 8px 12px; cursor: pointer;
  font: inherit; font-size: 13px; width: 100%;
}
.add:hover { border-color: var(--seal); background: var(--seal-tint); }

.reassure {
  display: flex; gap: 10px; align-items: flex-start;
  background: var(--seal-tint); border: 1px solid #CDE3DB; border-radius: var(--r);
  padding: 13px 15px; font-size: 13px; color: var(--seal-ink); margin: 22px 0;
}

/* Intro slides */
.slide { text-align: center; padding-block-start: 40px; max-width: 480px; margin-inline: auto; }
.slide-icon {
  width: 64px; height: 64px; border-radius: 18px; margin: 0 auto 22px;
  display: grid; place-items: center; font-size: 30px;
  background: var(--seal-tint); border: 1px solid #CDE3DB;
}
.slide h1 { font-size: 27px; margin-block-end: 12px; }
.slide .lede { font-size: 16px; line-height: 1.65; }
.slide-note {
  display: inline-flex; gap: 8px; align-items: flex-start; text-align: start;
  margin-block-start: 22px; font-size: 12.5px; color: var(--seal-ink);
  background: var(--seal-tint); border: 1px solid #CDE3DB; border-radius: 10px;
  padding: 10px 13px; max-width: 420px;
}
.dots { display: flex; gap: 7px; justify-content: center; margin-block-start: 30px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--edge-strong); transition: background .15s, width .15s; }
.dot.on { background: var(--seal); width: 20px; border-radius: 4px; }
button.ghost {
  background: none; border: 0; color: var(--muted); font: inherit; font-size: 15px;
  padding: 13px 18px; cursor: pointer;
}
button.ghost:hover { color: var(--ink); }

.actions { margin-block-start: 26px; display: flex; align-items: center; gap: 14px; }
button.primary {
  background: var(--seal); color: #fff; border: 0; border-radius: 10px;
  padding: 13px 26px; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
}
button.primary:hover { background: var(--seal-ink); }
button.primary:disabled { opacity: .45; cursor: default; }
.actions .muted { font-size: 13px; color: var(--muted); }

.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }

/* Done screen */
.done { text-align: center; padding-block-start: 24px; }
.done .mark {
  width: 56px; height: 56px; border-radius: 50%; background: var(--seal-tint);
  border: 1px solid #CDE3DB; color: var(--seal); display: grid; place-items: center;
  font-size: 26px; margin: 0 auto 18px;
}
.done h1 { margin-block-end: 8px; }
.done code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13.5px;
  background: #1A1D24; color: #FBFAF7; padding: 3px 8px; border-radius: 6px; direction: ltr; display: inline-block;
}
.done .steps { margin-block-start: 22px; text-align: start; display: inline-block; }
.done .steps li { margin-block-end: 12px; list-style: none; }
.done .steps .n { color: var(--muted); font-size: 12px; }
.err { color: var(--danger); font-size: 13px; margin-block-start: 10px; }
`;

export function onboardingPage(token: string): string {
  const catalogJson = JSON.stringify(toCatalog());
  return `<!doctype html><html lang="he" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FinOps — התחלה</title><style>${CSS}</style></head>
<body>
<div class="seal"><span class="seal-dot"></span>מקומי · הכול נשאר במחשב שלך</div>
<main id="app"></main>
<script>
const TOKEN = ${JSON.stringify(token)};
const CATALOG = ${catalogJson};
const app = document.getElementById('app');
const selected = new Map(); // id -> { entry, accounts: [{label, values:{}}] }
const aiKey = { value: '' };  // the user's own Anthropic key (optional)

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs||{})) {
    if (attrs[k] == null) continue;
    if (k === 'class') n.className = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
}

const SLIDES = [
  {
    icon: '📊',
    title: 'הכסף שלך, במקום אחד',
    body: 'FinOps מושך את התנועות מכל חשבונות הבנק וכרטיסי האשראי שלך, מסדר אותן לפי קטגוריות, ומראה לך תמונה אחת ברורה — לאן הכסף הולך, מה התייקר, ואיפה אפשר לחסוך.',
    note: 'הכלי קורא בלבד. הוא לעולם לא מזיז כסף ולא מבצע פעולות.',
  },
  {
    icon: '🔒',
    title: 'הכול נשאר אצלך',
    body: 'הנתונים, הסיסמאות והדוחות נשמרים על המחשב שלך בלבד. שום מידע פיננסי לא עולה לענן. הסיסמאות נשמרות ב-Keychain המוצפן של המערכת — לא בקובץ, לא בקוד, ולעולם לא נשלחות לאף אחד.',
    note: 'בזמן משיכה, הדפדפן מורשה לגשת רק לאתרי הבנקים — כלום אחר.',
  },
  {
    icon: '✅',
    title: 'מה כדאי להכין',
    body: 'פרטי ההתחברות לאתרי הבנקים וכרטיסי האשראי שלך — אותם פרטים שאת מזינה כשאת נכנסת לאתר של כל אחד מהם. בשלב הבא פשוט בוחרים את המוסדות הרלוונטיים ומזינים אותם.',
    note: 'אפשר להתחיל עם מוסד אחד ולהוסיף עוד בכל עת.',
  },
];

function renderIntro(i = 0) {
  const s = SLIDES[i];
  app.innerHTML = '';
  const dots = el('div', { class: 'dots' });
  SLIDES.forEach((_, j) => dots.append(el('span', { class: 'dot' + (j === i ? ' on' : '') })));
  app.append(
    el('div', { class: 'slide' },
      el('div', { class: 'slide-icon' }, s.icon),
      el('h1', {}, s.title),
      el('p', { class: 'lede', style: 'margin-inline:auto' }, s.body),
      el('div', { class: 'slide-note' }, el('span', {}, '🔒'), el('span', {}, s.note))
    ),
    dots,
    el('div', { class: 'actions', style: 'justify-content:center' },
      i > 0
        ? el('button', { class: 'ghost', type: 'button', onclick: () => renderIntro(i - 1) }, 'הקודם')
        : null,
      el('button', { class: 'primary', type: 'button',
        onclick: () => (i < SLIDES.length - 1 ? renderIntro(i + 1) : renderPicker()) },
        i < SLIDES.length - 1 ? 'המשך' : 'בוא נתחיל')
    )
  );
}

function renderPicker() {
  app.innerHTML = '';
  app.append(
    el('div', { class: 'stepline' }, 'שלב 1 מתוך 2'),
    el('h1', {}, 'אילו חשבונות לחבר?'),
    el('p', { class: 'lede' }, 'בחרי את הבנקים וכרטיסי האשראי שיש לך. אפשר להוסיף כמה שצריך — וגם כמה חשבונות מאותו סוג.')
  );
  for (const [cat, title] of [['bank','בנקים'], ['card','כרטיסי אשראי']]) {
    app.append(el('hr', { class: 'rule' }), el('div', { class: 'group-label' }, title));
    const grid = el('div', { class: 'grid' });
    for (const e of CATALOG.filter(c => c.category === cat)) {
      const on = selected.has(e.id);
      const btn = el('button', {
        class: 'pick', type: 'button', 'aria-pressed': String(on),
        onclick: () => toggle(e)
      },
        el('span', { class: 'name' }, e.displayName),
        e.advanced ? el('span', { class: 'tag' }, 'הגדרה מתקדמת') : null,
        el('span', { class: 'check' }, '✓')
      );
      grid.append(btn);
    }
    app.append(grid);
  }
  app.append(
    el('div', { class: 'reassure' },
      el('span', {}, '🔒'),
      el('span', {}, 'הפרטים שתזיני נשמרים ישירות ל-Keychain של המחשב — לא לקובץ, לא לרשת, ולעולם לא נשלחים לשום מקום. הכלי קורא בלבד ואף פעם לא מזיז כסף.')
    ),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', id: 'next', onclick: renderForms }, 'המשך'),
      el('span', { class: 'muted', id: 'count' }, '')
    )
  );
  updateCount();
}

function toggle(e) {
  if (selected.has(e.id)) selected.delete(e.id);
  else selected.set(e.id, { entry: e, accounts: [{ label: '', values: {} }] });
  renderPicker();
}
function updateCount() {
  const n = selected.size;
  document.getElementById('next').disabled = n === 0;
  document.getElementById('count').textContent = n === 0 ? 'בחרי לפחות אחד' : (n === 1 ? 'מוסד אחד נבחר' : n + ' מוסדות נבחרו');
}

function renderForms() {
  app.innerHTML = '';
  app.append(
    el('div', { class: 'stepline' }, 'שלב 2 מתוך 2'),
    el('h1', {}, 'פרטי ההתחברות'),
    el('p', { class: 'lede' }, 'אותם פרטים שאת מזינה באתר הבנק. אם יש לך יותר מחשבון אחד מאותו סוג — הוסיפי אותו כאן.')
  );
  const forms = el('div', { id: 'forms' });
  for (const [id, sel] of selected) forms.append(renderInst(id, sel));
  app.append(el('hr', { class: 'rule' }), forms);
  app.append(renderAiCard());
  app.append(
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: submit }, 'שמירה והתחלה'),
      el('button', { class: 'primary', type: 'button', onclick: renderPicker,
        style: 'background:transparent;color:var(--muted);padding-inline:6px' }, 'חזרה')
    ),
    el('div', { class: 'err', id: 'err' }, '')
  );
}

// Optional: the user's OWN AI key, so the advisor runs on their account.
// Never a shared key — each person supplies their own.
function renderAiCard() {
  const wrap = el('div', { class: 'inst' });
  wrap.append(
    el('div', { class: 'inst-head' }, el('span', { class: 'inst-title' }, '🧠 עוזר AI (רשות)')),
    el('div', { class: 'inst-note' },
      'רוצה שהכלי גם ינתח וימליץ? הדביקי מפתח Anthropic משלך. המפתח שלך בלבד — ' +
      'הוא נשמר ב-Keychain אצלך ומחויב לחשבון שלך. אפשר גם לדלג ולהוסיף בהמשך.')
  );
  const block = el('div', { class: 'acct' });
  const input = el('input', {
    type: 'password', autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'off',
    value: aiKey.value || '',
    oninput: (ev) => { aiKey.value = ev.target.value; },
  });
  const lab = el('label', { class: 'field' },
    el('span', { class: 'lbl' }, 'Anthropic API Key'), input);
  lab.append(el('span', { class: 'hint' }, 'מתחיל ב-sk-ant-… · להשגה: console.anthropic.com'));
  block.append(lab);
  wrap.append(block);
  return wrap;
}

function renderInst(id, sel) {
  const wrap = el('div', { class: 'inst' });
  wrap.append(
    el('div', { class: 'inst-head' }, el('span', { class: 'inst-title' }, sel.entry.displayName)),
    el('div', { class: 'inst-note' }, sel.entry.advanced
      ? 'דורש אימות דו-שלבי — ראי את התיעוד להשגת הטוקן הקבוע.'
      : 'הפרטים נשמרים מוצפנים ב-Keychain.')
  );
  sel.accounts.forEach((acct, i) => {
    const block = el('div', { class: 'acct' });
    if (sel.accounts.length > 1) {
      block.append(el('div', { class: 'acct-label' }, 'חשבון ' + (i + 1)));
      block.append(fieldEl('__label', 'שם לחשבון (איך לזהות אותו)', 'למשל: הכרטיס שלי, החשבון המשותף', acct, true));
    }
    for (const f of sel.entry.fields) block.append(fieldEl(f.name, f.label, f.hint, acct, false));
    wrap.append(block);
  });
  wrap.append(el('button', { class: 'add', type: 'button',
    onclick: () => { sel.accounts.push({ label: '', values: {} }); renderForms(); } },
    '＋ עוד חשבון מ' + sel.entry.displayName));
  return wrap;
}

function fieldEl(name, label, hint, acct, isLabel) {
  const input = el('input', {
    type: isLabel ? 'text' : 'password',
    class: isLabel ? 'name-input' : '',
    autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'off',
    value: isLabel ? (acct.label || '') : (acct.values[name] || ''),
    oninput: (ev) => { if (isLabel) acct.label = ev.target.value; else acct.values[name] = ev.target.value; }
  });
  const lab = el('label', { class: 'field' }, el('span', { class: 'lbl' }, label), input);
  if (hint) lab.append(el('span', { class: 'hint' }, hint));
  return lab;
}

async function submit() {
  const payload = { _t: TOKEN, institutions: [], anthropicApiKey: aiKey.value.trim() };
  for (const [id, sel] of selected) {
    payload.institutions.push({
      base: id,
      accounts: sel.accounts.map(a => ({ label: a.label.trim(), values: a.values }))
    });
  }
  const btn = document.querySelector('.actions .primary');
  btn.disabled = true; btn.textContent = 'שומר…';
  try {
    const res = await fetch('/save', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'שמירה נכשלה');
    renderDone(data.savedInstitutions || selected.size);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'שמירה והתחלה';
    document.getElementById('err').textContent = e.message || 'שמירה נכשלה — נסי שוב.';
  }
}

function renderDone(n) {
  app.innerHTML = '';
  app.append(el('div', { class: 'done' },
    el('div', { class: 'mark' }, '✓'),
    el('h1', {}, 'הכול מוכן'),
    el('p', { class: 'lede', style: 'margin-inline:auto' },
      (n === 1 ? 'חובר מוסד אחד' : 'חוברו ' + n + ' מוסדות') + '. אפשר לסגור את הטאב ולחזור לטרמינל.'),
    el('ul', { class: 'steps' },
      el('li', {}, el('div', { class: 'n' }, 'משיכה ראשונה — ייפתח דפדפן, ואם יידרש קוד SMS תקלידי אותו שם'),
        el('div', {}, elCode('npm run ingest -- --show'))),
      el('li', {}, el('div', { class: 'n' }, 'פתיחת הדשבורד'),
        el('div', {}, elCode('npm run dashboard')))
    )
  ));
}
function elCode(t) { return el('code', {}, t); }

renderIntro();
</script>
</body></html>`;
}
