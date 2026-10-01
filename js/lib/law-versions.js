// 기준일(허가일 등)에 적용되는 법령 버전 선택, 법률 명칭 변천, 대표 허가일 선택
// DOM에 의존하지 않으므로 브라우저와 node:test 양쪽에서 사용 가능.

// 소방시설 관련 법률의 명칭 변천 (시행일 기준)
// 근거: 국가법령정보센터 「소방시설 설치 및 관리에 관한 법률」 제정·개정문의 제명 변경
export const ACT_NAME_ERAS = [
  { from: '00000000', name: '소방법', basis: '소방시설설치유지및안전관리에관한법률 시행(2004. 5. 30.) 전' },
  { from: '20040530', name: '소방시설설치유지및안전관리에관한법률', basis: '법률 제6895호 제정' },
  { from: '20060805', name: '소방시설설치유지 및 안전관리에 관한 법률', basis: '법률 제7661호' },
  { from: '20120205', name: '소방시설 설치·유지 및 안전관리에 관한 법률', basis: '법률 제11037호' },
  { from: '20160121', name: '화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률', basis: '법률 제13062호' },
  { from: '20221201', name: '소방시설 설치 및 관리에 관한 법률', basis: '법률 제18522호 전부개정(화재예방법 분리)' }
];

// 소방시설법 최초 시행일 — 이전 허가 건축물은 구 소방법 적용
export const FIRE_ACT_START = '20040530';

// 'YYYYMMDD' 형식이면 그대로, 아니면 ''
export function toYmd(value) {
  const v = String(value ?? '').trim();
  return /^\d{8}$/.test(v) ? v : '';
}

// 사용자가 넣는 날짜의 하한 (판정 엔진 v2 dates.js 의 EARLIEST 와 같은 값)
export const EARLIEST_YMD = '19000101';

// 실제 달력에 있는 날짜인 'YYYYMMDD' 인가 (00000000·20171399 같은 값과 1900년 전은 거른다)
export function isValidYmd(value) {
  const v = toYmd(value);
  if (!v || v < EARLIEST_YMD) return false;
  const [y, m, d] = [Number(v.slice(0, 4)), Number(v.slice(4, 6)), Number(v.slice(6, 8))];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 사용자 입력('2018-01-20'·'20180120') → 'YYYYMMDD', 실제 날짜가 아니면 ''
export function parseYmdInput(value) {
  const v = String(value ?? '').trim().replace(/-/g, '');
  return isValidYmd(v) ? v : '';
}

// 한국시간 기준 오늘 'YYYYMMDD'
export function todayYmdKst(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

function ymdToUtc(ymd) {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

function numberOf(row) {
  const m = String(row.law_no || row.notice_no || '').match(/(\d+)(?:-(\d+))?\s*호/);
  if (!m) return 0;
  return m[2] ? Number(m[1]) * 100000 + Number(m[2]) : Number(m[1]);
}

// 연혁(시행일별 행 목록)에서 기준일에 적용되는 버전을 고른다.
// - 시행일 ≤ 기준일인 행 중 '가장 최근에 공포된' 버전 (단계 시행 행이 구버전 조문을 가리키는 문제 방지)
// - 기준일이 없으면 오늘(현행), 최초 시행 전이면 null
export function findApplicableVersion(history, dateValue, today = todayYmdKst()) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const date = toYmd(dateValue) || today;
  const eligible = history.filter((r) => toYmd(r.effective_date) && r.effective_date <= date);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) => {
    const pb = String(best.promulgation_date || '');
    const pr = String(r.promulgation_date || '');
    if (pr !== pb) return pr > pb ? r : best;
    if (r.effective_date !== best.effective_date) return r.effective_date > best.effective_date ? r : best;
    return numberOf(r) > numberOf(best) ? r : best;
  });
}

// 기준일의 소방시설 관련 법률 명칭
export function getActNameAt(dateValue, today = todayYmdKst()) {
  const date = toYmd(dateValue) || today;
  let era = ACT_NAME_ERAS[0];
  for (const e of ACT_NAME_ERAS) {
    if (e.from <= date) era = e;
  }
  return era;
}

// 허가 신청일을 따져 볼 기간(일). 부칙 적용례는 대개 '허가 신청일' 기준인데 대장에는 허가일만 있으므로,
// 허가일 직전 이 기간 안에 기준이 바뀌었으면 신청일에 따라 적용 기준이 달라질 수 있다.
// 판정 엔진 v2 정책 applicationWindowDays 와 같은 값이다 (CP1 Q7에서 바뀌면 함께 바꾼다).
export const APPLICATION_WINDOW_DAYS = 180;

// ymd 에 n일을 더한 'YYYYMMDD'
export function addDays(ymd, n) {
  return new Date(ymdToUtc(ymd) + n * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
}

// 허가일 직전 windowDays 안에 이 용도의 기준이 바뀐 날(경계)과, 그날 바뀐 시설별 기준.
// 경계 = 기준 행의 시작일, 또는 종료일 다음 날. 범위는 (허가일 − windowDays, 허가일].
// 반환: [{ date, facilities: [{ name, facilityId, before: [기준], after: [기준], notes: [비고] }] }] (날짜 오름차순)
//   before = 경계 전날까지 적용되다 끝난 기준, after = 경계 날부터 새로 적용된 기준.
//   허가 신청일이 경계보다 앞서면 before 쪽(종전 기준)이 적용될 수 있다.
//   기준 문구가 그대로인 행 나눔(비고만 바뀜)은 신청일에 따라 달라질 것이 없으므로 넣지 않는다.
export function findCriteriaBoundaries(fireData, permitDateValue, windowDays = APPLICATION_WINDOW_DAYS) {
  const permitDate = toYmd(permitDateValue);
  const facilities = Array.isArray(fireData && fireData.fire_facilities) ? fireData.fire_facilities : [];
  if (!permitDate || facilities.length === 0) return [];
  const from = addDays(permitDate, -windowDays);

  const points = new Set();
  for (const f of facilities) {
    for (const r of f.regulations || []) {
      const start = toYmd(r.start_date);
      const end = toYmd(r.end_date);
      if (start) points.add(start);
      if (end) points.add(addDays(end, 1));
    }
  }

  const result = [];
  for (const date of [...points].sort()) {
    if (date <= from || date > permitDate) continue;
    const dayBefore = addDays(date, -1);
    const changed = [];
    for (const f of facilities) {
      const regs = f.regulations || [];
      const after = regs.filter((r) => toYmd(r.start_date) === date);
      const before = regs.filter((r) => toYmd(r.end_date) === dayBefore);
      if (after.length === 0 && before.length === 0) continue;
      const beforeText = before.map((r) => r.criteria || '');
      const afterText = after.map((r) => r.criteria || '');
      if ([...beforeText].sort().join('\n') === [...afterText].sort().join('\n')) continue;
      changed.push({
        name: f.facility_name,
        facilityId: f.facility_id || null,
        before: beforeText,
        after: afterText,
        notes: after.map((r) => r.note).filter(Boolean)
      });
    }
    if (changed.length) result.push({ date, facilities: changed });
  }
  return result;
}

// 건축인허가 이력에서 소방기준 판단의 기준이 되는 허가를 고른다.
// 대수선·용도변경·증축 허가가 여러 건 섞여 있으므로 '신축' 중 가장 이른 허가일을 우선한다.
export function selectPrimaryPermit(items) {
  const list = Array.isArray(items) ? items : [];
  const valid = list.filter((i) => toYmd(i && i.archPmsDay));
  const counts = {};
  for (const i of valid) {
    const kind = String(i.archGbCdNm || '기타').trim() || '기타';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  if (valid.length === 0) return { item: null, total: 0, counts, reason: 'none' };
  const byDate = (a, b) => toYmd(a.archPmsDay).localeCompare(toYmd(b.archPmsDay));
  const isNew = (i) => i.archGbCd === '0100' || String(i.archGbCdNm || '').trim() === '신축';
  const newBuilds = valid.filter(isNew).sort(byDate);
  if (newBuilds.length > 0) {
    return { item: newBuilds[0], total: valid.length, counts, reason: 'new' };
  }
  return { item: valid.slice().sort(byDate)[0], total: valid.length, counts, reason: 'earliest' };
}
