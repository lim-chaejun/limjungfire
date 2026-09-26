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

// 한국시간 기준 오늘 'YYYYMMDD'
export function todayYmdKst(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

function ymdToUtc(ymd) {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

// b - a (일)
export function daysBetween(a, b) {
  return Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86400000);
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

// 기준일 직전 windowDays 이내에 시행된 실질 개정(일부·전부개정) 중 가장 최근 것.
// 부칙 적용례는 대개 '허가 신청일' 기준이므로, 허가일이 개정 시행 직후면 종전 기준이 적용될 수 있다.
export function findRecentAmendment(history, dateValue, windowDays = 180) {
  const date = toYmd(dateValue);
  if (!date || !Array.isArray(history)) return null;
  let found = null;
  for (const r of history) {
    const eff = toYmd(r.effective_date);
    if (!eff || eff > date) continue;
    if (!/일부개정|전부개정/.test(String(r.revision_type || ''))) continue;
    if (daysBetween(eff, date) > windowDays) continue;
    if (!found || eff > found.effective_date) found = r;
  }
  return found;
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
