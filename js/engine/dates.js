// 날짜 도구 — 모든 날짜는 'YYYYMMDD' 문자열. 순수 함수.
// 'YYYYMMDD' 는 사전순 비교가 곧 날짜 비교이므로 문자열 비교를 그대로 쓴다.

const YMD_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');

export function isValidYmd(s) {
  const m = typeof s === 'string' ? YMD_RE.exec(s) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// '2018-01-27' · '2018.01.27' · 20180127 → '20180127' (유효하지 않으면 null)
export function normalizeYmd(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/[-./\s]/g, '');
  return isValidYmd(s) ? s : null;
}

export function ymdToDay(s) {
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))) / DAY_MS;
}

export function dayToYmd(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

export function addDays(s, n) {
  return dayToYmd(ymdToDay(s) + n);
}

// 호출자가 today 를 넘기지 않았을 때만 쓰는 기본값 (현지 날짜)
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

export function formatYmd(s) {
  return isValidYmd(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : '-';
}

// 규정 행이 기준일에 유효한가 (start_date·end_date 가 null 이면 열린 구간, 양 끝 포함)
export function rowValidAt(row, ymd) {
  const start = row.start_date || '00000000';
  const end = row.end_date || '99999999';
  return start <= ymd && ymd <= end;
}
