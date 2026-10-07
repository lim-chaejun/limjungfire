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

// 날짜를 전혀 모를 때 검사 구간의 시작 — 이후의 모든 개정 경계를 본다 (소방 기준은 이보다 늦게 생겼다.
// JS Date.UTC 는 0~99년을 19xx 년으로 읽으므로 유효한 날짜인 1900년을 쓴다)
export const EARLIEST = '19000101';

// 기준일(refDate)과 개정 경계 검사 구간(window). status 'assumed' 인 기준일은 판정 근거(assumptions)에 표시된다.
//   허가 신청일 답변 → 신청일(정책 applicationDateSelectsRows)
//   허가일(확정) → [허가일 − 신청 구간, 허가일], 질문 '허가 신청일'
//   허가일 후보 여럿(신축·증축 등 인허가 여러 건) → [가장 이른 날 − 신청 구간, 가장 늦은 날], 질문 '허가일'(기준 허가 선택)
//   사용승인일만 → [승인일 − (추정 구간 + 신청 구간), 승인일], 질문 '허가일'
//   날짜 없음 → [가장 이른 개정 경계, 오늘] — 허가 시점을 전혀 모르므로 모든 개정 경계를 본다, 질문 '허가일'
export function resolveDateInfo(dates = {}, answers = {}, policy, today = todayYmd()) {
  const W = policy.applicationWindowDays;
  const application = normalizeYmd(answers.application_date);
  const permitAnswer = normalizeYmd(answers.permit_date);
  const permit = permitAnswer ? { value: permitAnswer, source: 'user', status: 'confirmed', candidates: [permitAnswer] } : dates.permit || null;
  const approval = dates.approval?.value ? dates.approval : null;
  const base = { permit: permit?.value ?? null, approval: approval?.value ?? null, today };
  if (application && (policy.applicationDateSelectsRows || !permit?.value)) {
    return { ...base, refDate: application, source: 'application', status: 'confirmed', window: null };
  }
  if (permit?.value) {
    const cands = permit.candidates?.length ? permit.candidates : [permit.value];
    const multiple = cands.length > 1;
    const span = application ? null : { from: addDays(cands[0], -W), to: cands[cands.length - 1], question: multiple ? 'permit_date' : 'application_date' };
    return {
      ...base,
      refDate: permit.value,
      source: 'permit',
      permitSource: permit.source,
      status: permit.status,
      permits: permit.permits,
      window: span && span.from < span.to ? span : null,
    };
  }
  if (approval) {
    const from = addDays(approval.value, -(policy.approvalOnlyLookbackDays + W));
    return { ...base, refDate: approval.value, source: 'approval', status: 'assumed', window: from < approval.value ? { from, to: approval.value, question: 'permit_date' } : null };
  }
  return { ...base, refDate: today, source: 'today', status: 'assumed', window: { from: EARLIEST, to: today, question: 'permit_date' } };
}
