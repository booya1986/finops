import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { getSecret, setSecret } from './keychain.js';
import { secretGroups, allSecretFields } from './fields.js';

/**
 * One-shot local secrets-import form (PLAN.md §1.1 compliant):
 *
 * - Bound to 127.0.0.1 on a random port — unreachable from the network.
 * - One-time random token in the URL; GET and POST both reject without it.
 * - Values go browser → this process's memory → Keychain. Nothing touches
 *   disk, nothing is logged (field NAMES only), no external resources (CSP
 *   default-src 'none').
 * - Accepts a single successful submit, then the server exits. 15-minute
 *   idle timeout, fail closed.
 */

const TOKEN = randomBytes(16).toString('hex');
const MAX_BODY = 64 * 1024;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; background: #f4f5f7; color: #1a1d21;
         display: flex; justify-content: center; padding: 40px 16px; }
  main { width: 100%; max-width: 560px; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  p.sub { color: #5a6270; font-size: 0.9rem; margin-bottom: 24px; line-height: 1.5; }
  section { background: #fff; border: 1px solid #e2e5ea; border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
  h2 { font-size: 1rem; margin-bottom: 12px; }
  label { display: block; font-size: 0.85rem; color: #3b4048; margin: 10px 0 4px; }
  .set { color: #1a7f37; font-size: 0.78rem; margin-inline-start: 6px; }
  input[type=password] { width: 100%; direction: ltr; padding: 9px 10px; font-size: 0.95rem;
         border: 1px solid #c9cdd4; border-radius: 7px; background: #fafbfc; }
  input[type=password]:focus { outline: 2px solid #2563eb33; border-color: #2563eb; }
  button { width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; color: #fff;
           background: #1f6f43; border: 0; border-radius: 8px; cursor: pointer; margin-top: 8px; }
  button:hover { background: #185c37; }
  .ok { color: #1a7f37; font-size: 1.1rem; line-height: 1.7; }
  .note { color: #5a6270; font-size: 0.82rem; margin-top: 16px; line-height: 1.5; }
`;

function page(body: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FinOps — הזנת פרטים</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

function formPage(): string {
  const groups = secretGroups().map((group) => {
    const fields = group.fields.map((f) => {
      const exists = getSecret(f.key) !== null;
      const badge = exists ? '<span class="set">✓ כבר מוגדר — השאר ריק כדי לא להחליף</span>' : '';
      const opt = f.optional ? ' (אופציונלי)' : '';
      return `<label>${f.label}${opt}${badge}</label>
<input type="password" name="${f.key}" autocomplete="new-password" spellcheck="false" autocapitalize="off">`;
    }).join('\n');
    return `<section><h2>${group.title}</h2>${fields}</section>`;
  }).join('\n');

  return page(`
<h1>הזנת פרטי התחברות — FinOps</h1>
<p class="sub">העמוד רץ מקומית בלבד (127.0.0.1) ונסגר אחרי שליחה אחת. הערכים נכתבים ישירות
ל-Keychain של macOS — לא לקובץ, לא ללוג, ולא נשלחים לשום מקום. שדות ריקים מדולגים;
רווחים בקצוות מוסרים אוטומטית.</p>
<form method="post" action="/save">
<input type="hidden" name="_t" value="${TOKEN}">
${groups}
<button type="submit">שמירה ל-Keychain וסגירה</button>
</form>
<p class="note">טיפ: אחרי השמירה מומלץ לנקות את לוח ההעתקה (להעתיק טקסט אחר כלשהו).</p>`);
}

function successPage(stored: string[], skipped: number): string {
  const list = stored.map((k) => `✓ ${k}`).join('<br>');
  return page(`
<section><p class="ok">נשמרו ${stored.length} סודות ב-Keychain:<br>${list || '—'}</p>
${skipped > 0 ? `<p class="note">${skipped} שדות נשארו ריקים ודולגו.</p>` : ''}
<p class="note">השרת נסגר. אפשר לסגור את הטאב ולחזור ל-Claude Code.</p></section>`);
}

function tokenOk(candidate: string | null): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (code: number, html: string): void => {
    res.writeHead(code, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'referrer-policy': 'no-referrer',
    });
    res.end(html);
  };

  if (req.method === 'GET' && url.pathname === '/') {
    if (!tokenOk(url.searchParams.get('t'))) return send(403, page('<section><p>קישור לא תקף.</p></section>'));
    return send(200, formPage());
  }

  if (req.method === 'POST' && url.pathname === '/save') {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf-8'));
      if (!tokenOk(params.get('_t'))) return send(403, page('<section><p>קישור לא תקף.</p></section>'));
      const stored: string[] = [];
      let skipped = 0;
      for (const field of allSecretFields()) {
        const value = (params.get(field.key) ?? '').trim();
        if (value.length === 0) { skipped += 1; continue; }
        setSecret(field.key, value);
        stored.push(field.key);
      }
      send(200, successPage(stored, skipped));
      console.log(`[secrets-import] נשמרו ${stored.length} סודות: ${stored.join(', ') || '—'}`);
      // Let the response flush, then shut down — single-use by design.
      setTimeout(() => process.exit(0), 500);
    });
    return;
  }

  send(404, page('<section><p>לא נמצא.</p></section>'));
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/?t=${TOKEN}`;
  console.log(`[secrets-import] הטופס פתוח (חד-פעמי, 15 דקות): ${url}`);
  try {
    if (process.platform === 'darwin') execFile('open', [url]);
    else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
    else execFile('xdg-open', [url]);
  } catch { /* URL printed above for manual opening */ }
});

setTimeout(() => {
  console.error('[secrets-import] תם הזמן (15 דקות) בלי שליחה — נסגר, שום דבר לא נשמר.');
  process.exit(1);
}, IDLE_TIMEOUT_MS);
