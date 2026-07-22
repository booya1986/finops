import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { setSecret } from '../secrets/keychain.js';
import { BASE_PROVIDERS, LOCAL_PROVIDERS_PATH } from '../ingest/providers.js';
import { DATA_DIR, DIR_MODE, FILE_MODE } from '../config.js';
import { onboardingPage } from './onboarding-page.js';

/**
 * Open a URL in the default browser, cross-platform. Best-effort: if it fails
 * (headless, missing command), the URL was already printed for manual opening.
 */
function openInBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'darwin') execFile('open', [url]);
    else if (platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
    else execFile('xdg-open', [url]); // linux / other
  } catch {
    /* URL already printed above — user can open it manually */
  }
}

/**
 * Single-screen onboarding server (PLAN.md §1.1 security model, same as the
 * old import-server it replaces):
 *
 * - Bound to 127.0.0.1 on a random port — unreachable from the network.
 * - One-time random token in the URL; GET and POST both reject without it.
 * - CSP default-src 'none': no external resources, nothing exfiltrates.
 * - On a single successful save it writes (a) each credential to the Keychain
 *   and (b) the chosen institution/account structure to providers.local.json
 *   (gitignored, 0600), then the server exits. 15-minute idle timeout, fail closed.
 *
 * It resolves the returned Promise so the wizard can await completion.
 */

const TOKEN = randomBytes(16).toString('hex');
const MAX_BODY = 256 * 1024;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface SavePayload {
  _t?: string;
  institutions?: Array<{
    base?: string;
    accounts?: Array<{ label?: string; values?: Record<string, unknown> }>;
  }>;
  /** The user's OWN Anthropic key for the advisor (optional). */
  anthropicApiKey?: string;
}

interface LocalInstance { base: string; displayName?: string }

function tokenOk(candidate: string | null): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Persist one successful submission. Derives extra-account ids (leumi2, …),
 * writes secrets to the Keychain, and writes the overlay file. Returns the
 * number of institutions saved.
 */
function persist(payload: SavePayload): number {
  const local: Record<string, LocalInstance> = {};
  let savedInstitutions = 0;

  for (const inst of payload.institutions ?? []) {
    const base = inst.base;
    if (!base || !BASE_PROVIDERS[base]) continue; // ignore anything not in the catalog
    const catalog = BASE_PROVIDERS[base];
    const accounts = inst.accounts ?? [];

    accounts.forEach((acct, index) => {
      // First account keeps the base id; extras get a numbered id.
      const id = index === 0 ? base : `${base}${index + 1}`;
      const values = acct.values ?? {};
      let wroteAny = false;

      for (const field of catalog.credentialFields) {
        const raw = values[field];
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value.length === 0) continue;
        setSecret(`${id}.${field}`, value);
        wroteAny = true;
      }

      // Only register instances that actually got at least one secret.
      if (wroteAny) {
        const label = (acct.label ?? '').trim();
        local[id] = { base, ...(label ? { displayName: label } : {}) };
        savedInstitutions += 1;
      }
    });
  }

  // The user's own Anthropic key for the advisor — their key, their account.
  const apiKey = (payload.anthropicApiKey ?? '').trim();
  if (apiKey.length > 0) setSecret('anthropic.apiKey', apiKey);

  mkdirSync(DATA_DIR, { recursive: true, mode: DIR_MODE });
  chmodSync(DATA_DIR, DIR_MODE);
  writeFileSync(LOCAL_PROVIDERS_PATH, JSON.stringify(local, null, 2), { mode: FILE_MODE });
  chmodSync(LOCAL_PROVIDERS_PATH, FILE_MODE);
  return savedInstitutions;
}

export function runOnboarding(): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const sendHtml = (code: number, html: string): void => {
        res.writeHead(code, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'",
          'referrer-policy': 'no-referrer',
        });
        res.end(html);
      };
      const sendJson = (code: number, obj: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(obj));
      };

      if (req.method === 'GET' && url.pathname === '/') {
        if (!tokenOk(url.searchParams.get('t'))) return sendHtml(403, '<p dir="rtl">קישור לא תקף.</p>');
        return sendHtml(200, onboardingPage(TOKEN));
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
          let payload: SavePayload;
          try { payload = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SavePayload; }
          catch { return sendJson(400, { ok: false, error: 'בקשה לא תקינה' }); }
          if (!tokenOk(payload._t ?? null)) return sendJson(403, { ok: false, error: 'קישור לא תקף' });

          let savedInstitutions: number;
          try { savedInstitutions = persist(payload); }
          catch (e) {
            const msg = e instanceof Error ? e.message : 'שמירה נכשלה';
            console.error('[onboarding] שמירה נכשלה:', msg);
            return sendJson(500, { ok: false, error: 'השמירה נכשלה. ודאי שיש הרשאה ל-Keychain ונסי שוב.' });
          }

          sendJson(200, { ok: true, savedInstitutions });
          console.log(`[onboarding] נשמרו ${savedInstitutions} מוסדות.`);
          setTimeout(() => { server.close(); resolve(); }, 400);
        });
        return;
      }

      sendJson(404, { ok: false, error: 'not found' });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const openUrl = `http://127.0.0.1:${port}/?t=${TOKEN}`;
      console.log(`\n  פותח את דף ההתחלה בדפדפן (מקומי, חד-פעמי):`);
      console.log(`  ${openUrl}\n`);
      openInBrowser(openUrl);
    });

    const idle = setTimeout(() => {
      console.error('[onboarding] תם הזמן (15 דקות) בלי שמירה — נסגר. שום דבר לא נשמר.');
      server.close();
      resolve();
    }, IDLE_TIMEOUT_MS);
    idle.unref?.();
  });
}
