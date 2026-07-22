import { Entry } from '@napi-rs/keyring';
import { KEYCHAIN_SERVICE } from '../config.js';

/**
 * Thin wrapper over the OS keychain (PLAN.md §1.1). All secrets live under
 * one service name; values are fetched on demand and never logged. Callers
 * must not hold secrets longer than the operation that needs them.
 */

export function setSecret(account: string, value: string): void {
  new Entry(KEYCHAIN_SERVICE, account).setPassword(value);
}

/** Returns null when the secret does not exist. */
export function getSecret(account: string): string | null {
  try {
    return new Entry(KEYCHAIN_SERVICE, account).getPassword();
  } catch {
    return null;
  }
}

/** Returns true when a secret was actually deleted. */
export function deleteSecret(account: string): boolean {
  try {
    return new Entry(KEYCHAIN_SERVICE, account).deletePassword();
  } catch {
    return false;
  }
}
