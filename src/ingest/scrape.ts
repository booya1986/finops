import { createScraper, type ScraperCredentials, type ScraperScrapingResult } from 'israeli-bank-scrapers';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecret } from '../secrets/keychain.js';
import { log } from '../logging/logger.js';
import { DATA_DIR } from '../config.js';
import { hostResolverRules, SCRAPE_MONTHS_BACK, type ProviderConfig } from './providers.js';
import type { ScrapedAccount } from './persist.js';

/**
 * Persistent per-provider Chromium profile: after the user approves the
 * device once (SMS OTP in a visible browser), the bank's device-trust cookie
 * survives across runs and headless scrapes stop triggering OTP. Holds bank
 * session state → lives under data/ (gitignored) at 0700.
 */
function browserProfileDir(providerKey: string): string {
  const parent = join(DATA_DIR, 'browser-profiles');
  const dir = join(parent, providerKey);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  chmodSync(dir, 0o700);
  return dir;
}

/**
 * On failure the library saves a screenshot of whatever the page showed —
 * local only (data/ is 0700 + gitignored), may contain personal data, so it
 * is for the USER's eyes when debugging, never sent anywhere.
 */
function debugDir(): string {
  const dir = join(DATA_DIR, 'debug');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

export interface FetchOptions {
  showBrowser?: boolean;
  monthsBack?: number;
}

/**
 * Fetch transactions for one provider under the §1.1 hardening:
 * credentials come from the Keychain only, live for the duration of the
 * scrape, and the browser can resolve DNS solely for allowlisted bank
 * domains. Fails closed on any error.
 */
export async function fetchProvider(
  providerKey: string,
  provider: ProviderConfig,
  options: FetchOptions = {},
): Promise<ScrapedAccount[]> {
  const credentials: Record<string, string> = {};
  for (const field of provider.credentialFields) {
    const value = getSecret(`${providerKey}.${field}`);
    if (value === null) {
      throw new Error(
        `חסר סוד "${providerKey}.${field}" ב-Keychain. הרץ: npm run secrets -- set ${providerKey}.${field}`,
      );
    }
    credentials[field] = value;
  }

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - (options.monthsBack ?? SCRAPE_MONTHS_BACK));

  const egressGuardOff = process.env['FINOPS_NO_EGRESS_GUARD'] === '1';
  if (egressGuardOff) {
    log.warn('[scrape] אזהרה: egress allowlist מנוטרל (FINOPS_NO_EGRESS_GUARD=1) — לדיבוג בלבד!');
  } else {
    log.info('[scrape] egress allowlist פעיל:', provider.egressAllowlist.join(', '));
  }

  const scraper = createScraper({
    companyId: provider.companyId,
    startDate,
    combineInstallments: false,
    showBrowser: options.showBrowser ?? false,
    verbose: false,
    // Interactive runs leave time for the user to type an SMS code.
    timeout: options.showBrowser ? 300_000 : 90_000,
    storeFailureScreenShotPath: join(debugDir(), `${providerKey}-failure.png`),
    args: [
      ...(egressGuardOff ? [] : [hostResolverRules(provider.egressAllowlist)]),
      `--user-data-dir=${browserProfileDir(providerKey)}`,
    ],
    // Debug aid for tuning the allowlist: hostnames only — full URLs may
    // carry query params with sensitive tokens, so they are never logged.
    preparePage: async (page) => {
      if (process.env['FINOPS_LOG_HOSTS'] === '1') {
        const seen = new Set<string>();
        page.on('request', (request) => {
          try {
            const host = new URL(request.url()).hostname;
            if (host && !seen.has(host)) {
              seen.add(host);
              log.info('[hosts]', host);
            }
          } catch {
            /* non-URL requests (data:, about:) — ignore */
          }
        });
      }
    },
  });

  let result: ScraperScrapingResult;
  try {
    result = await scraper.scrape(credentials as unknown as ScraperCredentials);
  } finally {
    // Best-effort cleanup: drop credential references as soon as the scrape ends.
    for (const field of provider.credentialFields) delete credentials[field];
  }

  if (!result.success) {
    // errorMessage may quote page content — keep it short, never log credentials.
    const detail = (result.errorMessage ?? '').slice(0, 200);
    throw new Error(`השליפה נכשלה (${result.errorType ?? 'UNKNOWN'})${detail ? `: ${detail}` : ''}`);
  }
  return result.accounts ?? [];
}
