/**
 * Masked logging (PLAN.md §1.1): no credentials, OTPs, or full account
 * numbers may ever reach a log line. Everything logged through here is
 * redacted first; account-like values keep their last 4 characters only.
 */

const SENSITIVE_KEY = /pass|secret|token|otp|credential|pwd|card|cvv|pin|api[_-]?key/i;

/** Keep only the last 4 characters: "12345678" → "••••5678". */
export function maskAccount(value: string): string {
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}

/** Replace values of sensitive-looking keys, recursively. */
export function redact<T>(input: T): T {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map((v) => redact(v)) as T;
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(value);
    }
    return out as T;
  }
  return input;
}

function format(parts: unknown[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(redact(p))))
    .join(' ');
}

export const log = {
  info: (...parts: unknown[]): void => console.log(format(parts)),
  warn: (...parts: unknown[]): void => console.warn(format(parts)),
  error: (...parts: unknown[]): void => console.error(format(parts)),
};
