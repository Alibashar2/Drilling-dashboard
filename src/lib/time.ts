// Time zones: the single source of truth.
//   - The database stores UTC instants (timestamptz; ISO strings ending in Z).
//   - Drilling reports are written in rig local time, which is TIME_ZONE. The import converts report clock times to UTC once
//     (src/import/reportTime.ts); everything shown on screen is converted back from UTC to TIME_ZONE here, and only here.
// Conversion always goes through the IANA zone rules (Intl), never a fixed number of hours.
export const TIME_ZONE = 'Asia/Baghdad';

export type Instant = number | string | Date | null | undefined;

const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const SHORT_OFFSET = /(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/;

/**
 * Epoch ms (UTC) of a stored timestamp. ISO 8601 with "Z" or an explicit offset ("+03:00", "+0300", PostgreSQL's "+00") is
 * honoured; a date-time without a zone is a database UTC value, never the browser's zone. Already-numeric values are instants.
 */
export function toMs(v: Instant): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  let s = String(v).trim();
  if (ISO_NO_ZONE.test(s)) s = s.replace(' ', 'T') + 'Z';
  s = s.replace(' ', 'T').replace(SHORT_OFFSET, '$1$2:00');
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

const DTF = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }
/** Calendar fields of an instant in TIME_ZONE. */
export function wallClock(ms: number): Wall {
  const p: Record<string, number> = {};
  for (const x of DTF.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
/** Offset of TIME_ZONE from UTC at an instant, in ms (from the zone rules; +03:00 for Baghdad today). */
export function offsetMs(ms: number): number {
  const w = wallClock(ms), whole = Math.floor(ms / 1000) * 1000;
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - whole;
}
/**
 * A TIME_ZONE wall-clock time, given as epoch ms whose UTC fields are that clock time (how the report reader holds a report's
 * own clock time), to the real UTC instant. Minutes, seconds and milliseconds are preserved.
 */
export function wallToUtc(wallMs: number): number {
  let t = wallMs - offsetMs(wallMs);
  const o = offsetMs(t);
  if (wallMs - o !== t) t = wallMs - o;   // the offset differs on the other side of a zone-rule change
  return t;
}
/** The inverse of wallToUtc: a UTC instant as TIME_ZONE wall-clock ms. */
export const utcToWall = (ms: number) => ms + offsetMs(ms);

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** "YYYY-MM-DD": the TIME_ZONE calendar date of an instant. */
export function localDay(v: Instant): string {
  const ms = toMs(v);
  if (ms == null) return '';
  const w = wallClock(ms);
  return `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`;
}
/** "HH:mm" in TIME_ZONE (":ss" added when the seconds are not zero). */
export function fmtTime(v: Instant): string {
  const ms = toMs(v);
  if (ms == null) return '—';
  const w = wallClock(ms);
  return `${pad(w.h)}:${pad(w.mi)}${w.s ? `:${pad(w.s)}` : ''}`;
}
/** "YYYY-MM-DD HH:mm" in TIME_ZONE. */
export function fmtDateTime(v: Instant): string {
  const ms = toMs(v);
  return ms == null ? '—' : `${localDay(ms)} ${fmtTime(ms)}`;
}
/** UTC instant of 00:00 TIME_ZONE on a calendar date ("YYYY-MM-DD"). */
export function dayStart(day: string): number {
  const [y, mo, d] = day.slice(0, 10).split('-').map(Number);
  return wallToUtc(Date.UTC(y, mo - 1, d));
}
/** [start, end) UTC instants of a TIME_ZONE calendar date: the boundaries used to filter stored UTC records by a local date. */
export function dayRange(day: string): [number, number] {
  const [y, mo, d] = day.slice(0, 10).split('-').map(Number);
  return [dayStart(day), wallToUtc(Date.UTC(y, mo - 1, d + 1))];
}
/** Value for an <input type="datetime-local"> (TIME_ZONE). */
export function toLocalInput(v: Instant): string {
  const ms = toMs(v);
  return ms == null ? '' : `${localDay(ms)}T${fmtTime(ms).slice(0, 5)}`;
}
/** A datetime-local input value (TIME_ZONE clock) to a UTC ISO string for storage. */
export function fromLocalInput(s: string): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? new Date(wallToUtc(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)))).toISOString() : null;
}
/** "UTC+03:00" for TIME_ZONE at an instant, from the zone rules. */
export function utcOffsetLabel(at: number = Date.now()): string {
  const o = offsetMs(at) / 60000, a = Math.abs(o);
  return `UTC${o < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
/** "Asia/Baghdad | UTC+03:00" */
export const zoneLabel = (at?: number) => `${TIME_ZONE} | ${utcOffsetLabel(at)}`;
