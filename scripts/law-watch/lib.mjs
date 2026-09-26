// 법령 개정 감시(law-watch) — 순수 함수 모음
// 네트워크·파일 I/O 는 check.mjs 가 맡고, 여기에는 입력이 같으면 출력도 같은 함수만 둔다.
// (정규화, 파서, 키, diff, 발췌, 제안 행, 영향 추정, 보고서 렌더링, 지문)

import { createHash } from 'node:crypto';

// ───────────────────────── 상수 ─────────────────────────

export const LAW_GO_KR = 'https://www.law.go.kr';
export const USER_AGENT = 'limjungfire-law-watch/1.0 (+https://github.com/lim-chaejun/limjungfire)';

// 요청 예절 기본값 — 레지스트리의 http 로 덮어쓸 수 있다
export const DEFAULT_HTTP = Object.freeze({
  delayMs: 2000,
  jitterMs: 500,
  timeoutMs: 30000,
  retries: 3,
  backoffMs: [5000, 15000, 45000],
  retryAfterMaxMs: 120000,
  maxRequests: 250,
  deadlineMs: 15 * 60 * 1000, // 실행 전체 기한 — 넘으면 남은 소스는 요청 없이 DEADLINE_EXCEEDED
  userAgent: USER_AGENT,
});

export const ENRICH_CAP = 30; // 실행당 개정문 조회 상한
export const REPORT_MAX_CHARS = 60000; // GitHub 이슈 본문 한도(65,536자) 여유분
export const EXCERPT_CAPS = Object.freeze({ amendment: 700, addenda: 500, reason: 300 });

export const MARKER_LAW = '<!-- law-watch:law-update -->';
export const MARKER_BROKEN = '<!-- law-watch:broken -->';
export const STATE_RE = /<!-- law-watch:state (\{.*?\}) -->/;

export const IMPACT_LABEL = Object.freeze({
  none: '영향 없음(추정)',
  wording: '자구 수정(추정)',
  criteria: '기준 변경 가능(추정)',
  unknown: '확인 필요(추정)',
});

// ───────────────────────── 정규식 ─────────────────────────
// 모두 law.go.kr 실제 응답(2026-09-26 기록, test/fixtures)으로 검증했다.

// 이름 조회 래퍼 페이지의 iframe (src 안의 &amp; 는 호출 측에서 풀어 쓴다)
export const RE_IFRAME = /<iframe[^>]*\bid="lawService"[^>]*\bsrc="([^"]+)"/;
// 법령 연혁 목록 한 행: lsiSeq, 공포일, 공포번호(0 채움), 시행일, 현행(Y|N), 개정구분
export const RE_LAW_ROW = /lsViewLsHst2\('(\d+)',\s*'(\d{8})',\s*'(\d+)',\s*'(\d{8})',\s*'([YN])',\s*'\d+'\s*,\s*'([^']+)'\)/;
// 시행예정 표시(법령: "앞으로 시행될 법령" 아이콘). 행정규칙도 잡도록 "법령"은 뺐다.
export const RE_FUTURE = /앞으로\s*시행될/;
// 행정규칙(고시) 연혁 한 행: admRulSeq, 이름, 시행일 문자열, [발령 정보]
export const RE_ADM_ROW = /admRulViewHst\('[YN]',\s*'(\d+)'\)[^>]*>\s*\d+\.\s*(?:<img[^>]*>\s*)?([^<]+?)\s*<br\s*\/?>\s*<div class="subtit1_1">\s*\[시행 ([^\]]+)\]\s*\[([^\]]+)\]/;
export const RE_HDR = /\[시행 ([^\]]*)\]\s*\[([^\]]*)\]/;
export const RE_DATE = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./; // "2026. 5. 4." → 20260504
// "소방청고시 제2026-15호, 2026. 5. 4., 일부개정" → 발령기관, 번호, 공포일(년·월·일), 개정구분
export const RE_PROM = /^(.*?)\s*제\s*(\d+(?:-\d+)?)\s*호\s*,\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*,\s*(.+)$/;
export const RE_ADDENDA = /부\s*칙\s*([\s\S]*?)(?=【|$)/;
export const RE_TRANSIT = /제\d+조(?:의\d+)?\(([^)]*(?:적용례|경과조치|특례|유효기간)[^)]*)\)/g;
const RE_SEC_REASON = /【\s*제정\s*[·ㆍ・]?\s*개정\s*이유\s*】/;
const RE_SEC_DOC = /【\s*제정\s*[·ㆍ・]?\s*개정\s*문\s*】/;
const RE_CRITERIA = /별표\s*[2456](?!\d)|설치|면적|층수|수용인원|면제/;
const RE_BOILERPLATE = /(?:일부|전부)를\s*다음과\s*같이\s*개정한다\./g;
const TRANSIT_KINDS = ['적용례', '경과조치', '특례', '유효기간'];

// ───────────────────────── 문자열 도구 ─────────────────────────

const DOT_CLASS = '[·‧•・･ㆍᆞ]';
const RE_DOTS = /[·‧•・･ㆍᆞ]/g;

// 이름 비교용 정규화: 공백 제거, 가운뎃점 통일, 전각 괄호, 끝의 말줄임 제거 (NFKC 는 쓰지 않는다)
export function normName(s) {
  return String(s ?? '')
    .replace(/[\s 　]+/g, '')
    .replace(RE_DOTS, 'ㆍ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/(\.\.\.|…)$/, '');
}

// 목록 화면은 긴 이름·기관명을 "..." 로 자른다 → 그런 값은 쓰지 않는다
export const isTruncated = (s) => /\.\.\.|…/.test(String(s ?? ''));

export const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 띄어쓰기·가운뎃점 차이를 허용하는 이름 정규식 조각
export function namePattern(name) {
  return [...normName(name)].map((c) => (c === 'ㆍ' ? DOT_CLASS : escRe(c))).join('\\s*');
}

// 일괄(타법)개정문에서 「해당 법령」의 개정 조만 잘라낸다
const RE_OWN_END =
  '(?=제\\d+조(?:의\\d+)?\\(\\s*「|제\\d+조(?:의\\d+)?(?:부터\\s*제\\d+조(?:의\\d+)?까지|\\s*및\\s*제\\d+조(?:의\\d+)?)?\\s*생략|부\\s*칙|$)';
export const reOwn = (name) =>
  new RegExp(`제\\d+조(?:의\\d+)?\\(\\s*「\\s*${namePattern(name)}\\s*」\\s*의\\s*개정\\s*\\)([\\s\\S]*?)${RE_OWN_END}`);

// 부칙 "다른 법령의 개정" 형식: "② ○○ 일부를 다음과 같이 개정한다. …" 부터 다음 항·부칙 조까지
export const reOtherLaw = (name) =>
  new RegExp(
    `(?:[①-⑳]\\s*)?${namePattern(name)}\\s*(?:일부를|전부를)\\s*다음과\\s*같이\\s*개정한다\\.([\\s\\S]*?)` +
      '(?=[①-⑳]|제\\d+조(?:의\\d+)?\\([^)]*(?:개정|경과조치|적용례|시행일|특례|유효기간)[^)]*\\)|$)',
  );

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

// 태그·스크립트·주석 제거 → 엔티티 복원 → 공백 압축
export function htmlToText(html) {
  const noTags = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

export function snippet(html, n = 300) {
  const t = htmlToText(html);
  return (t || String(html ?? '')).slice(0, n);
}

export function cap(s, n) {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

// 사이트가 이름을 HTML 에 그대로 넣으므로 꺾쇠·따옴표는 제거한다
export const cleanName = (s) =>
  String(s ?? '')
    .replace(/[<>"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// ───────────────────────── 날짜 ─────────────────────────

export function isValidYmd(s) {
  if (!/^\d{8}$/.test(String(s))) return false;
  const y = +s.slice(0, 4);
  const m = +s.slice(4, 6);
  const d = +s.slice(6, 8);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseKoDate(text) {
  const m = RE_DATE.exec(String(text ?? ''));
  return m ? `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}` : null;
}

// 한국 표준시(UTC+9, 서머타임 없음) 기준 오늘
export function todayKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
}

export const fmtYmd = (s) => (/^\d{8}$/.test(String(s ?? '')) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(s ?? ''));

// ───────────────────────── 요청 ─────────────────────────

export function lawListRequest(lsId) {
  return { method: 'POST', url: `${LAW_GO_KR}/LSW/lsHstListR.do`, body: `lsId=${lsId}&chrClsCd=010202&ancYnChk=0` };
}
export function admChainRequest(admRulSeq) {
  return { method: 'POST', url: `${LAW_GO_KR}/LSW/admRulHstListR.do`, body: `admRulSeq=${admRulSeq}` };
}
export function lawDocRequest(lsiSeq, efYd) {
  return {
    method: 'POST',
    url: `${LAW_GO_KR}/LSW/lsRvsDocInfoR.do`,
    body: `lsiSeq=${lsiSeq}&chrClsCd=010202&efYd=${efYd}&ancYnChk=0`,
  };
}
export function admDocRequest(admRulSeq) {
  return {
    method: 'POST',
    url: `${LAW_GO_KR}/LSW/admRulRvsInfoR.do`,
    body: `admRulSeq=${admRulSeq}&joTpYn=Y&languageType=Ko&chrClsCd=010201`,
  };
}
// 이름으로 현행 버전을 여는 래퍼. 한글 경로까지 전부 퍼센트 인코딩해야 한다(안 하면 메인 페이지).
export function wrapperRequest(kind, name) {
  const seg = kind === 'law' ? '법령' : '행정규칙';
  return { method: 'GET', url: `${LAW_GO_KR}/${encodeURIComponent(seg)}/${encodeURIComponent(normName(name))}`, body: '' };
}
export const lawLink = (seq) => `${LAW_GO_KR}/LSW/lsInfoP.do?lsiSeq=${seq}`;
export const admLink = (seq) => `${LAW_GO_KR}/LSW/admRulInfoP.do?admRulSeq=${seq}`;

// 기록/재생 파일 키
export function requestKey({ method, url, body = '' }) {
  return createHash('sha1').update(`${method}\n${url}\n${body ?? ''}`).digest('hex');
}

// ───────────────────────── 파서 ─────────────────────────

const normNo = (s) => String(s).replace(/^0+(?=\d)/, '');
const LAW_ROW_CALL = 'lsViewLsHst2(';
const ADM_ROW_CALL = 'admRulViewHst(';
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, ' ');

// 반복 호출 지점(onclick) 기준으로 조각을 나눈다 — 행 안의 마크업이 바뀌어도 행 단위가 유지된다
function chunksAt(html, needle) {
  const starts = [];
  let i = html.indexOf(needle);
  while (i >= 0) {
    starts.push(i);
    i = html.indexOf(needle, i + needle.length);
  }
  return starts.map((s, k) => html.slice(s, k + 1 < starts.length ? starts[k + 1] : html.length));
}

// 목록 항목(<li>) 수 = 호출 지점 수(해석 성공 + 실패) 여야 한다. 호출 함수 이름이 바뀐 행은 조각에서
// 통째로 빠지므로, 어긋나면 해석 실패로 올린다(조용히 빠뜨리지 않음). 39개 기록 목록 모두 일치한다.
function checkItemCount(scope, needle, parsed) {
  const items = scope.split(/<li[\s>]/i).slice(1);
  const calls = parsed.rows.length + parsed.unparsed.length;
  if (items.length !== calls) {
    const stray = items.find((li) => !li.includes(needle));
    parsed.unparsed.push(
      `목록 항목(<li>) ${items.length}개 ≠ 행(${needle}) ${calls}개${stray ? ` — 호출이 없는 항목: ${snippet(`<li ${stray}`, 150)}` : ''}`,
    );
  }
  return parsed;
}

// 법령 연혁 목록(lsHstListR.do). 한글 연혁 탭(lsHstDivKO)만 본다(영문 연혁 탭 제외). 주석은 지우고 본다.
export function parseLawList(html) {
  const s = stripComments(String(html ?? ''));
  const ko = s.indexOf('id="lsHstDivKO"');
  const en = s.indexOf('id="lsHstDivENG"');
  const scope = ko >= 0 ? s.slice(ko, en > ko ? en : s.length) : s;
  const rows = [];
  const unparsed = [];
  for (const chunk of chunksAt(scope, LAW_ROW_CALL)) {
    const m = RE_LAW_ROW.exec(chunk);
    if (!m) {
      unparsed.push(snippet(chunk, 200));
      continue;
    }
    const [, seq, ancYd, ancNo, efYd, cur, type] = m;
    if (!isValidYmd(efYd) || !isValidYmd(ancYd)) {
      unparsed.push(snippet(chunk, 200));
      continue;
    }
    const hdr = RE_HDR.exec(chunk);
    const prom = hdr ? RE_PROM.exec(hdr[2].trim()) : null;
    rows.push({
      seq,
      ancYd,
      ancNo: normNo(ancNo),
      efYd,
      current: cur === 'Y',
      revisionType: type.trim(),
      issuer: prom ? prom[1].trim() : '',
      name: '',
      future: RE_FUTURE.test(chunk),
      key: `${efYd}:${seq}`,
      altKey: null,
    });
  }
  return checkItemCount(scope, LAW_ROW_CALL, { rows, unparsed });
}

// 행정규칙(고시) 연혁 체인(admRulHstListR.do). 체인 안의 아무 seq 로 조회해도 전체가 온다.
export function parseAdmChain(html) {
  const s = stripComments(String(html ?? ''));
  const rows = [];
  const unparsed = [];
  for (const chunk of chunksAt(s, ADM_ROW_CALL)) {
    const m = RE_ADM_ROW.exec(chunk);
    const efYd = m ? parseKoDate(m[3]) : null;
    const prom = m ? RE_PROM.exec(m[4].trim()) : null;
    const ancYd = prom ? `${prom[3]}${prom[4].padStart(2, '0')}${prom[5].padStart(2, '0')}` : null;
    if (!m || !efYd || !prom || !isValidYmd(efYd) || !isValidYmd(ancYd)) {
      unparsed.push(snippet(chunk, 200));
      continue;
    }
    rows.push({
      seq: m[1],
      name: cleanName(decodeEntities(m[2])),
      efYd,
      ancYd,
      issuer: prom[1].trim(),
      noticeNo: prom[2],
      revisionType: prom[6].trim(),
      current: false,
      future: RE_FUTURE.test(chunk),
      key: m[1],
      altKey: `${efYd}#${prom[2]}`, // seq 없는 옛 연혁 행과 맞추기 위한 대체 키
    });
  }
  return checkItemCount(s, ADM_ROW_CALL, { rows, unparsed });
}

// 이름 조회 래퍼 → 현행 버전 식별자
export function parseWrapper(html) {
  const m = RE_IFRAME.exec(String(html ?? ''));
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, '&');
  const q = new URLSearchParams(src.includes('?') ? src.slice(src.indexOf('?') + 1) : '');
  return { src, lsiSeq: q.get('lsiSeq'), efYd: q.get('efYd'), admRulSeq: q.get('admRulSeq') };
}

function hiddenValue(html, id) {
  const m = new RegExp(`<input[^>]*\\bid="${escRe(id)}"[^>]*\\bvalue="([^"]*)"`).exec(html);
  return m ? cleanName(decodeEntities(m[1])) : '';
}

function section(text, re) {
  const m = re.exec(text);
  if (!m) return '';
  const start = m.index + m[0].length;
  const next = text.indexOf('【', start);
  return text.slice(start, next < 0 ? text.length : next).trim();
}

// 부칙 머리: "부칙" 뒤에 <제N호…> 가 있을 수 있고, 이어서 "이 영은…" 또는 "제1조(" 가 온다
function findAddenda(docText) {
  const re = /부\s*칙/g;
  let m;
  while ((m = re.exec(docText))) {
    const rest = docText.slice(m.index + m[0].length, m.index + m[0].length + 80);
    if (/^\s*(?:<[^>]*>\s*)?(?:이\s|제\s*1\s*조\s*\()/.test(rest)) return m.index;
  }
  const first = RE_ADDENDA.exec(docText);
  return first ? first.index : -1;
}

function stripBoilerplate(text) {
  const t = String(text ?? '');
  let last = -1;
  let m;
  RE_BOILERPLATE.lastIndex = 0;
  while ((m = RE_BOILERPLATE.exec(t))) last = m.index + m[0].length;
  const rest = last >= 0 ? t.slice(last).trim() : t.trim();
  return rest || t.trim();
}

// 자구 치환("…중 "A"를 "B"로 한다.")만으로 이루어졌는지
export function isSubstitutionOnly(text) {
  const t = String(text ?? '')
    .replace(/["“][^"“”]*["”]/g, '⟨Q⟩')
    .trim();
  if (!t) return false;
  const sentences = t
    .split(/(?<=한다\.)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    sentences.length > 0 &&
    sentences.every((x) => {
      if (!/한다\.$/.test(x) || /신설|삭제|다음과\s*같이|추가/.test(x)) return false;
      const q = (x.match(/⟨Q⟩/g) || []).length;
      const pairs = (x.match(/⟨Q⟩\s*(?:을|를)\s*(?:각각\s*)?⟨Q⟩\s*(?:으로|로)/g) || []).length;
      return pairs > 0 && q === pairs * 2 && /중\s*⟨Q⟩/.test(x);
    })
  );
}

// 영향 추정(항상 "(추정)" 표기). 순서가 중요하다: 재검토 → 자구 → 기준 → 모름
export function impactGuess({ amendment = '', reason = '', omnibus = false, names = [] } = {}) {
  const text = omnibus ? amendment : `${amendment}\n${reason}`;
  if (/재검토/.test(text)) return 'none';
  if (isSubstitutionOnly(amendment)) return 'wording';
  // 법령 이름 자체에 "설치"가 들어 있으므로 이름·「인용」을 지운 뒤 키워드를 본다
  let t = text.replace(/「[^」]*」/g, ' ');
  for (const n of names.filter(Boolean)) t = t.replace(new RegExp(namePattern(n), 'g'), ' ');
  if (RE_CRITERIA.test(t)) return 'criteria';
  return 'unknown';
}

export function transitionalSummary(headings = []) {
  const counts = TRANSIT_KINDS.map((k) => [k, headings.filter((h) => h.includes(k)).length]).filter(([, n]) => n > 0);
  return counts.length ? `${counts.map(([k, n]) => `${k} ${n}`).join(', ')} → 검토 필요` : '';
}

// 버전별 제정·개정문 문서 → 발췌 + 영향 추정
export function parseRevisionDoc(html, { kind, name = '', revisionType = '' } = {}) {
  const raw = String(html ?? '');
  const docName = hiddenValue(raw, kind === 'law' ? 'lsNm' : 'admNm');
  const text = htmlToText(raw);
  const reason = section(text, RE_SEC_REASON);
  const docText = section(text, RE_SEC_DOC);
  const ai = findAddenda(docText);
  const body = ai >= 0 ? docText.slice(0, ai) : docText;
  const addendaFull = ai >= 0 ? docText.slice(ai).replace(/^부\s*칙\s*/, '').trim() : '';
  const names = [...new Set([docName, name].filter(Boolean))];
  let own = null;
  if (revisionType === '타법개정') {
    for (const n of names) {
      const m = reOwn(n).exec(docText) || reOtherLaw(n).exec(docText);
      if (m) {
        own = m[0].trim();
        break;
      }
    }
  }
  const amendmentFull = stripBoilerplate(own ?? body);
  const transitional = [...addendaFull.matchAll(RE_TRANSIT)].map((m) => m[0]);
  return {
    name: docName,
    empty: !reason && !docText,
    omnibus: own != null,
    amendment: cap(amendmentFull, EXCERPT_CAPS.amendment),
    addenda: cap(addendaFull, EXCERPT_CAPS.addenda),
    reason: cap(reason, EXCERPT_CAPS.reason),
    transitional,
    impact: impactGuess({ amendment: amendmentFull, reason, omnibus: own != null, names }),
  };
}

// ───────────────────────── 레지스트리 ─────────────────────────

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const isStrArray = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string' && x.length > 0);

export function isValidKey(kind, key) {
  const k = String(key ?? '');
  if (kind === 'law') return /^\d{8}:\d+$/.test(k) && isValidYmd(k.slice(0, 8));
  return /^\d+$/.test(k) || (/^\d{8}#\d+(?:-\d+)?$/.test(k) && isValidYmd(k.slice(0, 8)));
}

// 레지스트리 형식 검사 → 오류 문자열 목록 (빈 배열이면 정상)
export function validateRegistry(reg) {
  const errs = [];
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) return ['레지스트리가 JSON 객체가 아님'];
  if (reg.version !== 1) errs.push('version 은 1 이어야 함');
  if (reg.http != null) {
    if (typeof reg.http !== 'object' || Array.isArray(reg.http)) errs.push('http 는 객체여야 함');
    else {
      for (const k of ['delayMs', 'jitterMs', 'timeoutMs', 'retries', 'maxRequests', 'retryAfterMaxMs', 'deadlineMs']) {
        if (reg.http[k] != null && !(Number.isInteger(reg.http[k]) && reg.http[k] >= 0)) errs.push(`http.${k} 는 0 이상 정수여야 함`);
      }
      if (reg.http.backoffMs != null && !(Array.isArray(reg.http.backoffMs) && reg.http.backoffMs.every((x) => Number.isInteger(x) && x >= 0))) {
        errs.push('http.backoffMs 는 0 이상 정수 배열이어야 함');
      }
      if (reg.http.userAgent != null && (typeof reg.http.userAgent !== 'string' || !reg.http.userAgent.trim())) errs.push('http.userAgent 는 문자열');
    }
  }
  if (!Array.isArray(reg.sources) || reg.sources.length === 0) {
    errs.push('sources 는 비어 있지 않은 배열이어야 함');
    return errs;
  }
  const ids = new Set();
  reg.sources.forEach((s, i) => {
    const at = `sources[${i}]${s && typeof s.id === 'string' ? `(${s.id})` : ''}`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      errs.push(`${at}: 객체가 아님`);
      return;
    }
    if (typeof s.id !== 'string' || !ID_RE.test(s.id)) errs.push(`${at}: id 는 영소문자·숫자·하이픈`);
    else if (ids.has(s.id)) errs.push(`${at}: id 중복`);
    else ids.add(s.id);
    if (!['law', 'admrul'].includes(s.kind)) errs.push(`${at}: kind 는 law | admrul`);
    const b = s.baseline;
    if (!b || typeof b !== 'object' || !['history', 'inline'].includes(b.from)) {
      errs.push(`${at}: baseline.from 은 history | inline`);
    } else if (b.from === 'history') {
      if (typeof b.file !== 'string' || !b.file.endsWith('.json')) errs.push(`${at}: baseline.file(.json) 필요`);
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.asOf ?? '') || !isValidYmd(String(b.asOf).replace(/-/g, ''))) errs.push(`${at}: baseline.asOf(YYYY-MM-DD) 필요`);
      // 빈 배열은 허용한다(추가 직후) — 실행하면 ANCHOR_MISSING 으로 실패하므로 --bootstrap 으로 채운다
      if (!isStrArray(b.known)) errs.push(`${at}: baseline.known 은 문자열 배열`);
      else {
        const bad = b.known.filter((k) => !isValidKey(s.kind, k));
        if (bad.length) errs.push(`${at}: baseline.known 키 형식 오류 ${bad.join(', ')}`);
      }
    }
    if (s.affects != null && !isStrArray(s.affects)) errs.push(`${at}: affects 는 문자열 배열`);
    if (s.lawNoStyle != null && (typeof s.lawNoStyle !== 'string' || !s.lawNoStyle.trim())) errs.push(`${at}: lawNoStyle 은 문자열`);
    if (s.expand != null) {
      if (s.expand !== 'nfsc' || s.kind !== 'admrul') errs.push(`${at}: expand 는 kind=admrul 에서 'nfsc' 만 지원`);
      if (b && b.from !== 'history') errs.push(`${at}: expand 소스는 baseline.from=history 여야 함`);
      if (s.overrides != null) {
        if (typeof s.overrides !== 'object' || Array.isArray(s.overrides)) errs.push(`${at}: overrides 는 객체`);
        else {
          for (const [k, o] of Object.entries(s.overrides)) {
            if (!o || typeof o !== 'object' || Array.isArray(o)) errs.push(`${at}: overrides['${k}'] 는 객체`);
            else {
              if (o.id != null && (typeof o.id !== 'string' || !ID_RE.test(o.id))) errs.push(`${at}: overrides['${k}'].id 형식 오류`);
              if (o.affects != null && !isStrArray(o.affects)) errs.push(`${at}: overrides['${k}'].affects 는 문자열 배열`);
              if (o.name != null && typeof o.name !== 'string') errs.push(`${at}: overrides['${k}'].name 은 문자열`);
            }
          }
        }
      }
    } else {
      if (typeof s.name !== 'string' || !s.name.trim()) errs.push(`${at}: name 필요`);
      if (s.kind === 'law' && !/^\d{6}$/.test(s.lsId ?? '')) errs.push(`${at}: lsId(숫자 6자리) 필요`);
      if (s.kind === 'admrul' && !/^\d+$/.test(s.admRulSeq ?? '')) errs.push(`${at}: admRulSeq(체인 조회용 seq) 필요`);
    }
  });
  return errs;
}

export function seqFromLink(link, param) {
  const m = new RegExp(`[?&]${param}=(\\d+)`).exec(String(link ?? ''));
  return m ? m[1] : null;
}

export function noticeNumber(s) {
  const m = /제\s*(\d+(?:-\d+)?)\s*호/.exec(String(s ?? ''));
  return m ? m[1] : null;
}

// 연혁 파일 행 → 키. 법령 `${시행일}:${lsiSeq}`, 고시 `${admRulSeq}` (seq 없으면 `${시행일}#${번호}`)
export function historyRowKey(kind, row) {
  if (kind === 'law') {
    const seq = seqFromLink(row?.link, 'lsiSeq');
    return { seq, key: seq ? `${row.effective_date}:${seq}` : null };
  }
  const seq = seqFromLink(row?.link, 'admRulSeq');
  if (seq) return { seq, key: seq };
  const no = noticeNumber(row?.notice_no);
  return { seq: null, key: no && row?.effective_date ? `${row.effective_date}#${no}` : null };
}

// 레지스트리 → 실행 단위 소스 목록. expand:"nfsc" 는 nfsc_history.json 키마다 하나씩 만든다.
export function expandSources(reg, baselines) {
  const sources = [];
  const errors = [];
  for (const s of reg.sources) {
    const affects = s.affects ?? [];
    if (s.expand === 'nfsc') {
      const data = baselines[s.baseline.file];
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        errors.push(`${s.id}: ${s.baseline.file} 는 {기준명: [연혁…]} 객체여야 함`);
        continue;
      }
      for (const [key, rows] of Object.entries(data)) {
        const ov = (s.overrides ?? {})[key] ?? {};
        const code = /\b(?:NFSC|NFPC)\s*(\d{3}[A-Z]?)\b/i.exec(key);
        const id = ov.id ?? (code ? `${s.id}-${code[1].toLowerCase()}` : null);
        if (!id) {
          errors.push(`${s.id}: '${key}' 에서 id 를 만들 수 없음 (overrides['${key}'].id 필요)`);
          continue;
        }
        if (!Array.isArray(rows) || rows.length === 0) {
          errors.push(`${id}: '${key}' 연혁이 비어 있음`);
          continue;
        }
        const anchorRow = rows.find((r) => seqFromLink(r?.link, 'admRulSeq'));
        if (!anchorRow) {
          errors.push(`${id}: '${key}' 에 admRulSeq 가 있는 행이 없음`);
          continue;
        }
        sources.push({
          id,
          group: s.id,
          kind: 'admrul',
          name: cleanName(ov.name ?? rows[0].name),
          label: key,
          anchorSeq: seqFromLink(anchorRow.link, 'admRulSeq'),
          lawNoStyle: s.lawNoStyle ?? null,
          baseline: { from: 'history', file: s.baseline.file, key },
          affects: ov.affects ?? affects,
          target: s.baseline.file,
          targetKey: key,
        });
      }
    } else {
      sources.push({
        id: s.id,
        group: null,
        kind: s.kind,
        name: cleanName(s.name),
        label: s.name,
        lsId: s.lsId ?? null,
        anchorSeq: s.admRulSeq ?? null,
        lawNoStyle: s.lawNoStyle ?? (s.kind === 'law' ? 'bare' : null),
        baseline: s.baseline,
        affects,
        target: s.baseline.from === 'history' ? s.baseline.file : null,
        targetKey: null,
      });
    }
  }
  const seen = new Set();
  for (const src of sources) {
    if (seen.has(src.id)) errors.push(`소스 id 중복: ${src.id}`);
    seen.add(src.id);
  }
  return { sources, errors };
}

// 기준선(= 사이트가 이미 아는 버전) 키 집합
export function baselineKeys(src, baselines) {
  if (src.baseline.from === 'inline') {
    const keys = new Set(src.baseline.known);
    let anchorKey = src.anchorSeq ?? null;
    if (src.kind === 'law') anchorKey = [...keys].sort((a, b) => b.localeCompare(a))[0] ?? null;
    return { keys, anchorKey, noSeq: [] };
  }
  const data = baselines[src.baseline.file];
  const rows = src.targetKey != null ? data?.[src.targetKey] : data;
  if (!Array.isArray(rows)) throw new Error(`${src.id}: 기준 연혁 ${src.baseline.file}${src.targetKey ? `['${src.targetKey}']` : ''} 가 배열이 아님`);
  const keys = new Set();
  const noSeq = [];
  let anchorKey = null;
  for (const r of rows) {
    const { seq, key } = historyRowKey(src.kind, r);
    if (!seq) noSeq.push({ row: r, key });
    if (key) keys.add(key);
    if (anchorKey == null && seq) anchorKey = key; // 가장 최근(맨 앞) 행
  }
  return { keys, anchorKey, noSeq };
}

// ───────────────────────── diff ─────────────────────────

// 고시에는 현행 표시가 없으므로 시행일이 오늘 이하인 것 중 가장 최근을 현행으로 본다
export function currentAdmKey(rows, today) {
  let best = null;
  for (const r of rows) {
    if (r.efYd > today) continue;
    if (!best || r.efYd > best.efYd || (r.efYd === best.efYd && r.ancYd > best.ancYd)) best = r;
  }
  return best ? best.key : null;
}

// 정합성 검사 + 집합 차이. 최대 시행일 워터마크는 쓰지 않는다(시행예정 행이 앞선 개정을 가린다).
export function analyzeSource(src, base, live) {
  const errors = [];
  const warnings = [];
  const liveKeys = new Set();
  for (const r of live) {
    liveKeys.add(r.key);
    if (r.altKey) liveKeys.add(r.altKey);
  }
  const knownLive = [...base.keys].filter((k) => liveKeys.has(k));
  if (base.keys.size === 0) {
    errors.push({ code: 'ANCHOR_MISSING', detail: '기준선 키가 비어 있음 — --bootstrap 으로 baseline.known 을 채우세요' });
  } else if (knownLive.length === 0) {
    errors.push({ code: 'ANCHOR_MISSING', detail: `기준선 키 ${base.keys.size}개 중 라이브 목록에 있는 것이 하나도 없음` });
  } else if (base.anchorKey && !liveKeys.has(base.anchorKey)) {
    errors.push({ code: 'ANCHOR_MISSING', detail: `기준 키 ${base.anchorKey} 가 라이브 목록에 없음` });
  } else if (live.length < base.keys.size) {
    errors.push({ code: 'LIVE_SHRUNK', detail: `라이브 ${live.length}행 < 기준선 ${base.keys.size}행` });
  }
  if (src.kind === 'law') {
    const cur = live.filter((r) => r.current);
    if (cur.length !== 1) errors.push({ code: 'CURRENT_NOT_UNIQUE', detail: `현행(Y) 행이 ${cur.length}개` });
  }
  if (errors.length) return { errors, warnings, pending: [] };
  const missing = [...base.keys].filter((k) => !liveKeys.has(k));
  if (missing.length) warnings.push({ code: 'KNOWN_NOT_LIVE', detail: `라이브 목록에 없는 기준선 키 ${missing.length}개: ${missing.join(', ')}` });
  const pending = live.filter((r) => !base.keys.has(r.key) && !(r.altKey && base.keys.has(r.altKey)));
  return { errors, warnings, pending };
}

// 이름 교차검증: 법령은 래퍼의 (시행일, lsiSeq) 가 현행(Y) 행과 같아야 하고, 고시는 래퍼 seq 가 체인에 있어야 한다
export function crossCheck(src, live, wrapper) {
  if (!wrapper) return { warning: { code: 'NAME_LOOKUP_MISS', detail: `'${src.name}' 이름으로 현행 버전을 찾지 못함(래퍼에 iframe 없음)` } };
  if (src.kind === 'law') {
    const cur = live.find((r) => r.current);
    const ok = cur && wrapper.lsiSeq === cur.seq && (!wrapper.efYd || wrapper.efYd === cur.efYd);
    return ok
      ? {}
      : { error: { code: 'CROSSCHECK_MISMATCH', detail: `래퍼 ${wrapper.efYd ?? '?'}:${wrapper.lsiSeq ?? '?'} ≠ 목록 현행 ${cur ? cur.key : '없음'}` } };
  }
  const ok = wrapper.admRulSeq && live.some((r) => r.seq === wrapper.admRulSeq);
  return ok ? {} : { error: { code: 'CROSSCHECK_MISMATCH', detail: `래퍼 admRulSeq=${wrapper.admRulSeq ?? '?'} 가 체인에 없음` } };
}

// ───────────────────────── 변경 항목 ─────────────────────────

export function lawNoString(style, no) {
  return !style || style === 'bare' ? `제${no}호` : `${style} 제${no}호`;
}
const issuerOf = (row) => (row.issuer && !isTruncated(row.issuer) ? row.issuer : '소방청고시');

export function displayNumber(src, row) {
  if (src.kind === 'admrul') return `${issuerOf(row)} 제${row.noticeNo}호`;
  const style = src.lawNoStyle ?? 'bare';
  if (style !== 'bare') return `${style} 제${row.ancNo}호`;
  return row.issuer && !isTruncated(row.issuer) ? `${row.issuer} 제${row.ancNo}호` : `제${row.ancNo}호`;
}

// 연혁 파일 행 모양의 제안 행 (이름은 목록 대신 문서/레지스트리 값 — 목록 이름은 잘려 있다)
export function suggestedRow(src, row, title) {
  const link = src.kind === 'law' ? lawLink(row.seq) : admLink(row.seq);
  if (src.kind === 'law') {
    return {
      name: title,
      effective_date: row.efYd,
      law_no: lawNoString(src.lawNoStyle, row.ancNo),
      promulgation_date: row.ancYd,
      revision_type: row.revisionType,
      link,
    };
  }
  return {
    name: title,
    effective_date: row.efYd,
    notice_no: `${issuerOf(row)} 제${row.noticeNo}호`,
    promulgation_date: row.ancYd,
    revision_type: row.revisionType,
    link,
  };
}

export function buildChange(src, row, { today, currentKey = null, doc = null } = {}) {
  const title =
    cleanName(doc?.name) || (src.kind === 'admrul' && row.name && !isTruncated(row.name) ? cleanName(row.name) : '') || src.name;
  const link = src.kind === 'law' ? lawLink(row.seq) : admLink(row.seq);
  const change = {
    id: `${src.id}:${row.key}`,
    sourceId: src.id,
    kind: src.kind,
    title,
    efYd: row.efYd,
    ancYd: row.ancYd,
    number: displayNumber(src, row),
    revisionType: row.revisionType,
    seq: row.seq,
    isCurrent: src.kind === 'law' ? !!row.current : row.key === currentKey,
    isFuture: row.efYd > today || !!row.future,
    link,
    target: src.target,
  };
  if (src.targetKey != null) change.targetKey = src.targetKey;
  change.suggestedRow = suggestedRow(src, row, title);
  change.excerpt = doc
    ? { amendment: doc.amendment, addenda: doc.addenda, reason: doc.reason, transitional: doc.transitional }
    : null;
  change.impactGuess = doc ? doc.impact : 'unknown';
  change.affects = src.affects ?? [];
  return change;
}

// ───────────────────────── 연혁 파일 반영 ─────────────────────────

function numTuple(row) {
  const m = /제\s*(\d+)(?:-(\d+))?\s*호/.exec(String(row?.law_no ?? row?.notice_no ?? ''));
  return m ? [+m[1], m[2] != null ? +m[2] : -1] : [-1, -1];
}

// 연혁 정렬 규칙: 시행일 내림차순 → 같으면 공포일 늦은 것 먼저 → 같으면 번호 큰 것 먼저
// (사이트는 시행일로만 안정 정렬하므로 동률 순서가 곧 화면에 보이는 순서다)
export function historyCmp(a, b) {
  const ef = String(b.effective_date).localeCompare(String(a.effective_date));
  if (ef) return ef;
  const pd = String(b.promulgation_date ?? '').localeCompare(String(a.promulgation_date ?? ''));
  if (pd) return pd;
  const [a1, a2] = numTuple(a);
  const [b1, b2] = numTuple(b);
  return b1 - a1 || b2 - a2;
}

// 기존 행 순서는 건드리지 않고, 새 행을 규칙에 맞는 자리에 끼운 뒤 no 를 1..N 으로 다시 매긴다
export function insertHistoryRow(rows, newRow, kind) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const newKey = historyRowKey(kind, newRow).key;
  if (newKey && list.some((r) => historyRowKey(kind, r).key === newKey)) return renumber(list);
  let at = list.findIndex((r) => historyCmp(newRow, r) < 0);
  if (at < 0) at = list.length;
  list.splice(at, 0, newRow);
  return renumber(list);
}

function renumber(list) {
  return list.map((r, i) => {
    const { no, ...rest } = r;
    return { no: i + 1, ...rest };
  });
}

// ───────────────────────── 결과·보고서 ─────────────────────────

export function fingerprint(ids) {
  return createHash('sha256').update(ids.slice().sort().join('\n')).digest('hex').slice(0, 12);
}

export function exitCodeFor(changes, errors) {
  if (errors.length) return 20;
  return changes.length ? 10 : 0;
}

export function statusFor(code) {
  return code === 0 ? 'ok' : code === 10 ? 'changes' : 'broken';
}

const mdText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mdCell = (s) => mdText(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const stateLabel = (c) => (c.isFuture ? '시행예정' : c.isCurrent ? '현행' : '연혁(이미 지난 시행일)');

export function stateMarker(fp, ids) {
  return `<!-- law-watch:state ${JSON.stringify({ fp, ids: ids.slice().sort() })} -->`;
}

export function parseState(body) {
  const m = STATE_RE.exec(String(body ?? ''));
  if (!m) return null;
  try {
    const s = JSON.parse(m[1]);
    return { fp: String(s.fp ?? ''), ids: Array.isArray(s.ids) ? s.ids.map(String) : [] };
  } catch {
    return null;
  }
}

export function summaryLine(result) {
  const { stats, changes, errors } = result;
  const only = result.scope?.only?.length ? result.scope.only : null;
  const base = `소스 ${stats.sources}개 중 정상 ${stats.healthy}개 · 요청 ${stats.requests}회 · 기준일 ${fmtYmd(result.todayKst)}(KST)${only ? ` · 부분 실행(--only ${only.join(',')})` : ''}`;
  if (result.status === 'ok') return `**변경 없음** — ${only ? '지정한' : '모든'} 소스가 사이트 데이터와 일치합니다. (${base})`;
  if (result.status === 'changes') return `**법령 개정 반영 필요: ${changes.length}건** (${base})`;
  // sourceId '-' 는 소스가 아니라 실행 전체의 오류(CONFIG_INVALID, CROSSCHECK_UNAVAILABLE 등)
  const failed = new Set(errors.map((e) => e.sourceId).filter((id) => id !== '-')).size;
  const runLevel = [...new Set(errors.filter((e) => e.sourceId === '-').map((e) => e.code))];
  const what = [failed ? `소스 ${failed}개 실패` : '', ...runLevel].filter(Boolean).join(', ') || '실행 실패';
  return `**감시 오류: ${what}** — 정상 소스에서 감지된 개정 ${changes.length}건 (${base})`;
}

function changeDetails(c) {
  const L = [];
  L.push(`<details><summary><b>${mdText(c.title)}</b> ${mdText(c.number)} · 시행 ${fmtYmd(c.efYd)} · <code>${mdText(c.id)}</code></summary>`);
  L.push('');
  L.push(`- 원문: ${c.link}`);
  L.push(`- 반영 대상: ${c.target ? `\`${c.target}\`${c.targetKey ? ` → \`${mdText(c.targetKey)}\`` : ''}` : '(inline 기준선 — `--ack` 로 확인 처리)'}`);
  if (c.affects?.length) L.push(`- 기준 변경 시 함께 볼 파일: ${c.affects.map((a) => `\`${a}\``).join(', ')}`);
  L.push(`- 영향: ${IMPACT_LABEL[c.impactGuess] ?? c.impactGuess} · ${stateLabel(c)}`);
  const tr = transitionalSummary(c.excerpt?.transitional ?? []);
  L.push(`- 부칙 경과규정: ${tr ? `${tr} (${c.excerpt.transitional.map(mdText).join(', ')})` : '없음(시행일 조항만)'}`);
  if (!c.excerpt) L.push('- 발췌: (개정문을 가져오지 못함 — 원문 링크 확인)');
  else {
    for (const [k, label] of [
      ['amendment', '개정문(발췌)'],
      ['addenda', '부칙(발췌)'],
      ['reason', '개정이유(발췌)'],
    ]) {
      if (c.excerpt[k]) {
        L.push('');
        L.push(`**${label}**`);
        L.push(`> ${mdText(c.excerpt[k])}`);
      }
    }
  }
  L.push('');
  L.push('**제안 연혁 행**');
  L.push('```json');
  L.push(JSON.stringify(c.suggestedRow, null, 2));
  L.push('```');
  L.push('</details>');
  return L.join('\n');
}

// report.md (한국어). 첫 두 줄은 이슈 동기화용 표지(marker)다.
export function renderReport(result, { runUrl = '', maxChars = REPORT_MAX_CHARS } = {}) {
  const head = [MARKER_LAW, stateMarker(result.fingerprint, result.changes.map((c) => c.id)), '', summaryLine(result), ''];
  const blocks = [];
  if (result.changes.length) {
    const T = ['| 대상 | 시행일 | 공포 | 번호 | 구분 | 현행/시행예정 | 영향(추정) | 원문 |', '|---|---|---|---|---|---|---|---|'];
    for (const c of result.changes) {
      T.push(
        `| ${mdCell(c.title)} | ${fmtYmd(c.efYd)} | ${fmtYmd(c.ancYd)} | ${mdCell(c.number)} | ${mdCell(c.revisionType)} | ${stateLabel(c)} | ${IMPACT_LABEL[c.impactGuess] ?? c.impactGuess} | [보기](${c.link}) |`,
      );
    }
    blocks.push(T.join('\n'));
    blocks.push('### 변경 상세');
    for (const c of result.changes) blocks.push(changeDetails(c));
  }
  if (result.warnings.length) {
    blocks.push(
      ['### 경고', ...result.warnings.map((w) => `- \`${mdText(w.sourceId)}\` **${w.code}** — ${mdText(w.detail ?? '')}`)].join('\n'),
    );
  }
  if (result.errors.length) {
    const T = ['### 오류', '| 소스 | 코드 | HTTP | 바이트 | 내용 | URL |', '|---|---|---|---|---|---|'];
    for (const e of result.errors) {
      T.push(
        `| \`${mdCell(e.sourceId)}\` | ${e.code} | ${e.http ?? ''} | ${e.bytes ?? ''} | ${mdCell([e.detail, e.snippet].filter(Boolean).join(' / '))} | ${mdCell(e.url ?? '')} |`,
      );
    }
    blocks.push(T.join('\n'));
  }
  if (runUrl) blocks.push(`실행 기록: ${runUrl}`);
  const tail = `\n\n> 보고서가 ${maxChars.toLocaleString('en-US')}자를 넘어 잘렸습니다. 전체 내용은 실행 아티팩트의 \`report.md\`·\`result.json\` 을 확인하세요.${runUrl ? ` (${runUrl})` : ''}`;
  let out = head.join('\n');
  for (let i = 0; i < blocks.length; i++) {
    const next = `${out}\n${blocks[i]}\n`;
    if (next.length > maxChars - tail.length) return out + tail;
    out = next;
  }
  return out;
}
