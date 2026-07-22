/**
 * Phase 1 normalization: cleanup only. Full merchant mapping (regex + manual
 * table, PLAN.md §5) lands in Phase 2 and will write normalized_merchant on
 * top of this baseline.
 */

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Scraper dates are ISO datetimes; a UTC-midnight timestamp is still the
 * previous evening in Israel, so format in Asia/Jerusalem — never with the
 * machine-local getDate/getUTCDate.
 */
export function toIsraelDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`תאריך לא תקין מהסקרייפר: "${iso}"`);
  }
  return DATE_FMT.format(parsed);
}

export function normalizeDescription(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
