import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db/index.js';
import { log } from '../logging/logger.js';
import { applyUserCategoryRules } from '../db/userRules.js';
import { buildAccountsView, buildChargeSummaries, buildSummary, buildTransfersDetail, listTransactions } from './data.js';
import { writeLocalReport } from '../reports/generate.js';

/**
 * Live dashboard (PLAN.md §15) — an independent view layer over SQLite.
 * Zero external dependencies, bound to 127.0.0.1 only: the browser polls
 * /api/summary and the page re-renders; ingest runs update it live.
 */

const PORT = Number(process.env['FINOPS_DASH_PORT'] ?? 3737);
const PAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'index.html');
const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), 'web', 'dist');
const WEB_PAGE = join(WEB_DIST, 'index.html');
const USE_LEGACY = process.env['FINOPS_DASH_LEGACY'] === '1' || !existsSync(WEB_PAGE);
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GOAL_TYPES = new Set(['save_by_date', 'cut_category', 'cap_monthly']);
const GOAL_STATUSES = new Set(['active', 'paused', 'completed', 'archived']);

function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const db = openDb();

function currentMonthInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(new Date());
}

function sendJson(res: ServerResponse, code: number, payload: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function serveDashboardAsset(pathname: string, res: ServerResponse): boolean {
  if (USE_LEGACY) {
    if (pathname !== '/') return false;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(PAGE_PATH));
    return true;
  }

  let relative: string;
  try { relative = decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1)); }
  catch { return false; }
  const file = resolve(WEB_DIST, relative);
  if (file !== WEB_DIST && !file.startsWith(`${WEB_DIST}${sep}`)) return false;
  const resolvedFile = existsSync(file) && statSync(file).isFile() ? file : (!extname(relative) ? WEB_PAGE : '');
  if (!resolvedFile) return false;
  res.writeHead(200, {
    'content-type': STATIC_TYPES[extname(resolvedFile)] ?? 'application/octet-stream',
    'cache-control': resolvedFile === WEB_PAGE ? 'no-store' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  res.end(readFileSync(resolvedFile));
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 16 * 1024) {
        req.destroy();
        reject(new Error('body too large'));
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/') && serveDashboardAsset(url.pathname, res)) {
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/summary') {
      const monthParam = url.searchParams.get('month');
      const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonthInIsrael();
      sendJson(res, 200, buildSummary(db, month));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/accounts') {
      const monthParam = url.searchParams.get('month');
      const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonthInIsrael();
      sendJson(res, 200, buildAccountsView(db, month));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/transfers-detail') {
      const monthParam = url.searchParams.get('month');
      const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonthInIsrael();
      sendJson(res, 200, buildTransfersDetail(db, month));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/summaries') {
      const monthParam = url.searchParams.get('month');
      const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonthInIsrael();
      sendJson(res, 200, buildChargeSummaries(db, month));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/transactions') {
      const month = url.searchParams.get('month') ?? undefined;
      if (month && !MONTH_RE.test(month)) return sendJson(res, 400, { error: 'חודש לא תקין' });
      const accountRaw = url.searchParams.get('account');
      const limitRaw = Number(url.searchParams.get('limit') ?? 100);
      const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
      const result = listTransactions(db, {
        ...(month ? { month } : {}),
        ...(url.searchParams.get('category') ? { category: url.searchParams.get('category')! } : {}),
        ...(accountRaw && Number.isInteger(Number(accountRaw)) ? { accountId: Number(accountRaw) } : {}),
        ...(url.searchParams.get('q') ? { q: url.searchParams.get('q')! } : {}),
        limit: Math.min(Math.max(limitRaw || 100, 1), 500),
        offset: Math.max(offsetRaw || 0, 0),
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reports') {
      const body = JSON.parse((await readBody(req)) || '{}') as { period?: string; month?: string };
      if (body.period !== 'weekly' && body.period !== 'monthly') return sendJson(res, 400, { error: 'סוג דוח לא תקין' });
      const month = body.month && MONTH_RE.test(body.month) ? body.month : currentMonthInIsrael();
      const path = writeLocalReport(db, month, body.period);
      sendJson(res, 200, { generated: true, path });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/goals') {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        title?: string; type?: string; target_amount?: number; category?: string; deadline?: string; progress?: number;
      };
      const title = body.title?.trim().slice(0, 80) ?? '';
      const target = Number(body.target_amount);
      const progress = Number(body.progress ?? 0);
      if (!title) return sendJson(res, 400, { error: 'כותרת היעד חובה' });
      if (!body.type || !GOAL_TYPES.has(body.type)) return sendJson(res, 400, { error: 'סוג יעד לא תקין' });
      if (!Number.isFinite(target) || target <= 0 || target > 100_000_000) return sendJson(res, 400, { error: 'סכום היעד לא תקין' });
      if (!Number.isFinite(progress) || progress < 0 || progress > 100_000_000) return sendJson(res, 400, { error: 'התקדמות לא תקינה' });
      const category = body.category?.trim().slice(0, 60) || null;
      const deadline = body.deadline?.trim() || null;
      if (body.type === 'cut_category' && !category) return sendJson(res, 400, { error: 'קטגוריה חובה ליעד צמצום' });
      if (body.type === 'save_by_date' && (!deadline || !isValidIsoDate(deadline))) {
        return sendJson(res, 400, { error: 'תאריך יעד חובה לחיסכון' });
      }
      const result = db.prepare(`
        INSERT INTO goals (title, type, target_amount, category, deadline, progress, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(title, body.type, target, category, body.type === 'save_by_date' ? deadline : null, progress);
      sendJson(res, 200, { saved: true, id: Number(result.lastInsertRowid) });
      return;
    }

    const goalProgressMatch = url.pathname.match(/^\/api\/goals\/(\d+)\/progress$/);
    if (req.method === 'POST' && goalProgressMatch) {
      const body = JSON.parse((await readBody(req)) || '{}') as { progress?: number };
      const progress = Number(body.progress);
      if (!Number.isFinite(progress) || progress < 0 || progress > 100_000_000) {
        return sendJson(res, 400, { error: 'התקדמות לא תקינה' });
      }
      const changes = db.prepare(`UPDATE goals SET progress = ? WHERE id = ? AND status != 'archived'`)
        .run(progress, Number(goalProgressMatch[1])).changes;
      sendJson(res, changes === 1 ? 200 : 404, { updated: changes === 1 });
      return;
    }

    const goalStatusMatch = url.pathname.match(/^\/api\/goals\/(\d+)\/status$/);
    if (req.method === 'POST' && goalStatusMatch) {
      const body = JSON.parse((await readBody(req)) || '{}') as { status?: string };
      if (!body.status || !GOAL_STATUSES.has(body.status)) return sendJson(res, 400, { error: 'סטטוס יעד לא תקין' });
      const changes = db.prepare(`UPDATE goals SET status = ? WHERE id = ?`)
        .run(body.status, Number(goalStatusMatch[1])).changes;
      sendJson(res, changes === 1 ? 200 : 404, { updated: changes === 1 });
      return;
    }

    // Marks "you have seen everything up to now". Called explicitly by the
    // user dismissing the digest — NOT on page load, since the 5s poll would
    // then clear the digest before it could be read.
    if (req.method === 'POST' && url.pathname === '/api/seen') {
      db.prepare(`
        INSERT INTO agent_memory (key, value, updated_at)
        VALUES ('dashboard.last_seen', datetime('now'), datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run();
      sendJson(res, 200, { saved: true });
      return;
    }

    const recMatch = url.pathname.match(/^\/api\/recommendations\/(\d+)$/);
    if (req.method === 'POST' && recMatch) {
      const body = JSON.parse((await readBody(req)) || '{}') as { status?: string; realized_saving_ils?: number };
      if (body.status !== 'accepted' && body.status !== 'dismissed' && body.status !== 'done') {
        return sendJson(res, 400, { error: 'status חייב להיות accepted/dismissed/done' });
      }
      // Closing the loop (PLAN §17): the quality metric is realized saving over
      // time, so 'done' may carry what was ACTUALLY saved — which is often not
      // the estimate. Only accepted on 'done'; any other status leaves it null.
      const realized = body.status === 'done' && typeof body.realized_saving_ils === 'number'
        && Number.isFinite(body.realized_saving_ils) && body.realized_saving_ils >= 0
        ? Math.round(body.realized_saving_ils * 100) / 100
        : null;
      const changes = realized === null
        ? db.prepare(`UPDATE recommendations SET status = ? WHERE id = ?`)
            .run(body.status, Number(recMatch[1])).changes
        : db.prepare(`UPDATE recommendations SET status = ?, realized_saving_ils = ? WHERE id = ?`)
            .run(body.status, realized, Number(recMatch[1])).changes;
      sendJson(res, changes === 1 ? 200 : 404, { updated: changes === 1, realized_saving_ils: realized });
      return;
    }

    // Quick category assignment — no note required (the common case for
    // clearing "ללא קטגוריה"). Upserts category on the merchant, keeps any
    // existing note/flag, and re-applies rules to existing + future rows.
    if (req.method === 'POST' && url.pathname === '/api/categorize') {
      const body = JSON.parse((await readBody(req)) || '{}') as { merchant?: string; category?: string };
      if (!body.merchant || !body.category) return sendJson(res, 400, { error: 'merchant ו-category חובה' });
      const cat = body.category.trim().slice(0, 60);
      db.prepare(`
        INSERT INTO merchant_notes (merchant, note, category, updated_at)
        VALUES (@merchant, @note, @category, datetime('now'))
        ON CONFLICT(merchant) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at
      `).run({ merchant: body.merchant, note: `סווג ידנית ל-${cat}`, category: cat });
      const recategorized = applyUserCategoryRules(db);
      sendJson(res, 200, { saved: true, recategorized });
      return;
    }

    // Mark a merchant's charges as internal transfers — flips is_transfer=1
    // on existing + future rows so they drop out of expense/income math.
    if (req.method === 'POST' && url.pathname === '/api/transfer') {
      const body = JSON.parse((await readBody(req)) || '{}') as { merchant?: string };
      if (!body.merchant) return sendJson(res, 400, { error: 'merchant חובה' });
      db.prepare(`
        INSERT INTO merchant_notes (merchant, note, flag, updated_at)
        VALUES (@merchant, 'העברה פנימית — לא הוצאה', 'transfer', datetime('now'))
        ON CONFLICT(merchant) DO UPDATE SET flag = 'transfer', updated_at = datetime('now')
      `).run({ merchant: body.merchant });
      const changed = applyUserCategoryRules(db);
      sendJson(res, 200, { saved: true, changed });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/notes') {
      const body = JSON.parse((await readBody(req)) || '{}') as { merchant?: string; note?: string; category?: string; flag?: string };
      if (!body.merchant || !body.note) return sendJson(res, 400, { error: 'merchant ו-note חובה' });
      if (body.flag && body.flag !== 'cancel' && body.flag !== 'transfer') return sendJson(res, 400, { error: 'flag לא מוכר' });
      db.prepare(`
        INSERT INTO merchant_notes (merchant, note, category, flag, updated_at)
        VALUES (@merchant, @note, @category, @flag, datetime('now'))
        ON CONFLICT(merchant) DO UPDATE SET
          note = excluded.note, category = excluded.category, flag = excluded.flag, updated_at = excluded.updated_at
      `).run({ merchant: body.merchant, note: body.note, category: body.category || null, flag: body.flag || null });
      const recategorized = applyUserCategoryRules(db);
      if (body.flag === 'cancel') {
        db.prepare(`UPDATE subscriptions SET status = 'forgotten' WHERE merchant = ?`).run(body.merchant);
      }
      sendJson(res, 200, { saved: true, recategorized });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/notes/delete') {
      const body = JSON.parse((await readBody(req)) || '{}') as { merchant?: string };
      if (!body.merchant) return sendJson(res, 400, { error: 'merchant חובה' });
      const changes = db.prepare(`DELETE FROM merchant_notes WHERE merchant = ?`).run(body.merchant).changes;
      sendJson(res, 200, { deleted: changes === 1 });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/questions') {
      const body = JSON.parse((await readBody(req)) || '{}') as { tx_id?: number; question?: string };
      if (!body.tx_id || !Number.isInteger(body.tx_id)) return sendJson(res, 400, { error: 'tx_id חובה' });
      const exists = db.prepare(`SELECT 1 FROM transactions WHERE id = ?`).get(body.tx_id);
      if (!exists) return sendJson(res, 404, { error: 'תנועה לא קיימת' });
      db.prepare(`INSERT INTO tx_questions (tx_id, question) VALUES (?, ?)`)
        .run(body.tx_id, body.question?.trim() || 'מה החיוב הזה? אני לא מזהה אותו.');
      sendJson(res, 200, { saved: true });
      return;
    }

    const questionMatch = url.pathname.match(/^\/api\/questions\/(\d+)\/resolve$/);
    if (req.method === 'POST' && questionMatch) {
      const changes = db.prepare(`UPDATE tx_questions SET status = 'resolved' WHERE id = ?`)
        .run(Number(questionMatch[1])).changes;
      sendJson(res, changes === 1 ? 200 : 404, { updated: changes === 1 });
      return;
    }

    const alertMatch = url.pathname.match(/^\/api\/alerts\/(\d+)\/dismiss$/);
    if (req.method === 'POST' && alertMatch) {
      const changes = db.prepare(`UPDATE alerts SET dismissed = 1 WHERE id = ?`)
        .run(Number(alertMatch[1])).changes;
      sendJson(res, changes === 1 ? 200 : 404, { updated: changes === 1 });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    log.error('[dashboard] שגיאה:', err instanceof Error ? err.message : 'לא ידועה');
    sendJson(res, 500, { error: 'internal' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo;
  log.info(`[dashboard] רץ מקומית (${USE_LEGACY ? 'legacy fallback' : 'React + shadcn'}): http://127.0.0.1:${port}`);
});
