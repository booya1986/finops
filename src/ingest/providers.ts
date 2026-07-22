import { CompanyTypes } from 'israeli-bank-scrapers';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.js';

/**
 * Per-provider ingestion config. Keychain account names follow
 * "<provider>.<field>" (e.g. hapoalim.userCode). The egress allowlist is
 * enforced at the Chromium DNS layer (PLAN.md §1.1): every hostname that is
 * not excluded below resolves to NOTFOUND, so a compromised dependency
 * cannot exfiltrate from the browser even if it tries.
 *
 * BASE_PROVIDERS below is the full set of Israeli institutions that
 * israeli-bank-scrapers supports as financial accounts. It is the read-only
 * catalog shown in the onboarding wizard. A user's actual selections — and
 * any extra accounts of the same type (leumi2, isracard2, …) — live in
 * data/providers.local.json (gitignored) and are merged in by loadProviders().
 *
 * A provider with no stored credentials is skipped automatically at ingest
 * time, so enabling many here costs nothing until secrets are entered.
 */

export interface CredentialField {
  /** Field name, stored in the Keychain as "<provider>.<name>". */
  name: string;
  /** Label shown in the onboarding form. */
  label: string;
  /** Plain-language hint under the field (no jargon). */
  hint?: string;
}

export interface ProviderConfig {
  companyId: CompanyTypes;
  accountType: 'checking' | 'card';
  displayName: string;
  /** Keychain field names, stored as "<provider>.<field>". */
  credentialFields: string[];
  /** Hostname patterns allowed out (Chromium host-resolver-rules EXCLUDE). */
  egressAllowlist: string[];
  /** When false, every automated run skips this provider (§1.1: avoid lockouts). */
  enabled?: boolean;
}

/** Catalog entry: a ProviderConfig plus the metadata the wizard needs. */
export interface ProviderCatalogEntry extends ProviderConfig {
  category: 'bank' | 'card';
  /** Rich field descriptors for the onboarding form. */
  fields: CredentialField[];
  /** Needs a non-trivial (2FA-token) setup — flagged in the wizard. */
  advanced?: boolean;
}

/** Build a ProviderConfig-compatible catalog entry from field descriptors. */
function entry(
  companyId: CompanyTypes,
  category: 'bank' | 'card',
  displayName: string,
  domain: string,
  fields: CredentialField[],
  advanced = false,
): ProviderCatalogEntry {
  return {
    companyId,
    category,
    accountType: category === 'bank' ? 'checking' : 'card',
    displayName,
    fields,
    credentialFields: fields.map((f) => f.name),
    egressAllowlist: [domain, `*.${domain}`],
    ...(advanced ? { advanced: true } : {}),
  };
}

// Common field descriptors, reused across institutions.
const USER = { name: 'username', label: 'שם משתמש' };
const PASS = { name: 'password', label: 'סיסמה' };
const NATIONAL_ID = { name: 'id', label: 'תעודת זהות', hint: '9 ספרות' };

/**
 * The 16 institutions israeli-bank-scrapers 6.8.0 supports as accounts.
 * Credential fields and login domains were taken from the library's own
 * scrapers (not from memory). Benefit programs (behatsdaa, beyahadBishvilha)
 * are intentionally excluded — they are points/perks, not financial accounts.
 */
export const BASE_PROVIDERS: Record<string, ProviderCatalogEntry> = {
  // ── Banks ──────────────────────────────────────────────────────────────
  hapoalim: entry(CompanyTypes.hapoalim, 'bank', 'בנק הפועלים', 'bankhapoalim.co.il', [
    { name: 'userCode', label: 'קוד משתמש' },
    PASS,
  ]),
  leumi: entry(CompanyTypes.leumi, 'bank', 'בנק לאומי', 'bankleumi.co.il', [USER, PASS]),
  discount: entry(CompanyTypes.discount, 'bank', 'בנק דיסקונט', 'telebank.co.il', [
    NATIONAL_ID,
    { name: 'num', label: 'מספר מזהה', hint: 'המספר שקבעת בהרשמה לאתר' },
    PASS,
  ]),
  mercantile: entry(CompanyTypes.mercantile, 'bank', 'בנק מרכנתיל', 'telebank.co.il', [
    NATIONAL_ID,
    { name: 'num', label: 'מספר מזהה', hint: 'המספר שקבעת בהרשמה לאתר' },
    PASS,
  ]),
  mizrahi: entry(CompanyTypes.mizrahi, 'bank', 'בנק מזרחי טפחות', 'mizrahi-tefahot.co.il', [USER, PASS]),
  beinleumi: entry(CompanyTypes.beinleumi, 'bank', 'הבנק הבינלאומי', 'fibi.co.il', [USER, PASS]),
  union: entry(CompanyTypes.union, 'bank', 'בנק איגוד', 'unionbank.co.il', [USER, PASS]),
  otsarHahayal: entry(CompanyTypes.otsarHahayal, 'bank', 'בנק אוצר החייל', 'bankotsar.co.il', [USER, PASS]),
  massad: entry(CompanyTypes.massad, 'bank', 'בנק מסד', 'bankmassad.co.il', [USER, PASS]),
  yahav: entry(CompanyTypes.yahav, 'bank', 'בנק יהב', 'yahav.co.il', [
    { name: 'nationalID', label: 'תעודת זהות', hint: '9 ספרות' },
    USER,
    PASS,
  ]),
  pagi: entry(CompanyTypes.pagi, 'bank', 'בנק פאגי', 'pagi.co.il', [USER, PASS]),
  oneZero: entry(
    CompanyTypes.oneZero,
    'bank',
    'בנק oneZero',
    'tfd-bank.com',
    [
      { name: 'email', label: 'אימייל' },
      { name: 'password', label: 'סיסמה' },
      { name: 'phoneNumber', label: 'מספר טלפון', hint: 'לאימות דו-שלבי' },
      { name: 'otpLongTermToken', label: 'טוקן קבוע (OTP)', hint: 'מתקבל בהתחברות הראשונה — ראה תיעוד' },
    ],
    true,
  ),

  // ── Credit cards ───────────────────────────────────────────────────────
  isracard: entry(CompanyTypes.isracard, 'card', 'ישראכרט', 'isracard.co.il', [
    NATIONAL_ID,
    { name: 'card6Digits', label: '6 ספרות אחרונות של הכרטיס', hint: 'מופיעות על גב הכרטיס' },
    PASS,
  ]),
  visaCal: entry(CompanyTypes.visaCal, 'card', 'כאל (Visa Cal)', 'cal-online.co.il', [USER, PASS]),
  max: entry(CompanyTypes.max, 'card', 'מקס (Max)', 'max.co.il', [USER, PASS]),
  amex: entry(CompanyTypes.amex, 'card', 'אמריקן אקספרס', 'americanexpress.co.il', [
    NATIONAL_ID,
    { name: 'card6Digits', label: '6 ספרות אחרונות של הכרטיס', hint: 'מופיעות על גב הכרטיס' },
    PASS,
  ]),
};

/**
 * A user's local overlay. Each key is a provider instance id — either a base
 * id ("leumi") the user selected, or a derived one for an extra account of the
 * same type ("leumi2"). `base` points back to the catalog entry whose scraper
 * and fields to reuse; `displayName` is the user's own label for it.
 */
interface LocalProviderInstance {
  base: string;
  displayName?: string;
  enabled?: boolean;
}
type LocalProviders = Record<string, LocalProviderInstance>;

export const LOCAL_PROVIDERS_PATH = join(DATA_DIR, 'providers.local.json');

function readLocalProviders(): LocalProviders {
  if (!existsSync(LOCAL_PROVIDERS_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(LOCAL_PROVIDERS_PATH, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as LocalProviders) : {};
  } catch {
    return {};
  }
}

/**
 * The providers to actually ingest. When the user has an overlay, only the
 * institutions they selected (and their extra accounts) are active — each
 * built from its base catalog entry, with the user's display label. With no
 * overlay yet (fresh install before setup), fall back to the full catalog so
 * `--only` and manual runs still work.
 */
export function loadProviders(): Record<string, ProviderConfig> {
  const local = readLocalProviders();
  const ids = Object.keys(local);
  if (ids.length === 0) {
    return Object.fromEntries(Object.entries(BASE_PROVIDERS).map(([k, v]) => [k, toConfig(v)]));
  }
  const result: Record<string, ProviderConfig> = {};
  for (const [id, inst] of Object.entries(local)) {
    const base = BASE_PROVIDERS[inst.base];
    if (!base) continue; // unknown base → ignore rather than crash
    result[id] = {
      ...toConfig(base),
      ...(inst.displayName ? { displayName: inst.displayName } : {}),
      ...(inst.enabled === false ? { enabled: false } : {}),
    };
  }
  return result;
}

/** Strip catalog-only metadata down to the runtime ProviderConfig shape. */
function toConfig(e: ProviderCatalogEntry): ProviderConfig {
  const { category, fields, advanced, ...config } = e;
  void category; void fields; void advanced;
  return config;
}

/**
 * Back-compat export: the active providers as a static object. Prefer
 * loadProviders() where the value may change at runtime (e.g. after setup).
 */
export const PROVIDERS: Record<string, ProviderConfig> = loadProviders();

export const SCRAPE_MONTHS_BACK = 12;

/** Chromium flag blocking DNS for everything outside the allowlist. */
export function hostResolverRules(allowlist: string[]): string {
  const excludes = allowlist.map((h) => `EXCLUDE ${h}`).join(', ');
  return `--host-resolver-rules=MAP * ~NOTFOUND, ${excludes}`;
}
