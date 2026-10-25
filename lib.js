// Small shared helpers: errors, validation and date maths.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (m) => new HttpError(400, m);
export const conflict = (m) => new HttpError(409, m);
export const notFound = () => new HttpError(404, 'Not found');

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// Today's calendar date in the studio's time zone, as YYYY-MM-DD.
export const realToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

// Whole days from `today` to a YYYY-MM-DD string; null if it is not a real date.
export function daysBetween(today, s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((t - Date.UTC(ty, tm - 1, td)) / DAY);
}

export function intIn(v, lo, hi, name) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${name} must be a whole number from ${lo} to ${hi}`);
  return n;
}

export function text(v, name, { max, min = 0 }) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw bad(min === 1 ? `${name} is required` : `${name} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  return s;
}

// Optional map pin. Both missing -> [null, null]; otherwise both must be valid coordinates.
export function coords(lat, lng) {
  const empty = (v) => v === undefined || v === null || v === '';
  if (empty(lat) && empty(lng)) return [null, null];
  const la = Number(lat), lo = Number(lng);
  if (empty(lat) || empty(lng) || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
    throw bad('Map location is invalid');
  return [la, lo];
}
