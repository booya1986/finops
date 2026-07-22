import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Project root is one level above this file's directory (src/ or dist/).
export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const DB_PATH = join(DATA_DIR, 'finops.db');

// Single Keychain service name for all secrets (PLAN.md §1.1).
export const KEYCHAIN_SERVICE = 'finops';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/**
 * Load the optional .env fallback (PLAN.md §1.1: Keychain first, .env only as
 * fallback). Refuses nothing, but warns loudly when the file is group/world
 * readable, since it may hold bank credentials.
 */
export function loadEnvFallback(): void {
  const envPath = join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;

  const mode = statSync(envPath).mode & 0o777;
  if (mode !== FILE_MODE) {
    console.warn(
      `[config] אזהרה: הרשאות .env הן ${mode.toString(8)} — נדרש 600. הרץ: chmod 600 .env`,
    );
  }
  dotenv.config({ path: envPath, quiet: true });
}
