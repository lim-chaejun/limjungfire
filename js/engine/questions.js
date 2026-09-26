// 질문 — 입력 의존(dep) → 사용자에게 묻는 문장, 그리고 "답하면 판정이 바뀌는가" 시험값
// 문장 틀은 data/schema/inputs.json 의 question 이 정본이고, 아래 BUILTIN 은 inputs.json 을 넘기지 않았을 때의 최소 정의다.

import { ASSUMED, UNKNOWN } from './logic.js';
import { formatYmd } from './dates.js';
import { describeFloors, fmtNum } from './format.js';
import { describeUses, useName } from './uses.js';

export const DATE_INPUTS = new Set(['application_date', 'permit_date', 'use_approval_date']);

const BUILTIN = [
  ['total_area', 'number', '연면적', '㎡'],
  ['ground_floors', 'integer', '층수(지상)', '층', [0, 200]],
  ['basement_floors', 'integer', '지하층수', '층', [0, 30]],
  ['floors_incl_basement', 'integer', '지하층 포함 층수', '층', [0, 230]],
  ['height', 'number', '높이', 'm'],
  ['households', 'integer', '세대수', '세대'],
  ['floor_area', 'number', '층 바닥면적', '㎡'],
  ['use_area', 'number', '용도별 바닥면적 합계', '㎡'],
  ['floor_use_area', 'number', '층의 용도별 면적', '㎡'],
  ['part_area', 'number', '층 부분 면적', '㎡'],
  ['windowless', 'boolean', '무창층 여부', ''],
  ['use_presence', 'boolean', '용도 존재 여부', ''],
  ['installed', 'boolean', '설치 여부', ''],
  ['mixed_use', 'boolean', '복합건축물 해당 여부', ''],
  ['review', 'boolean', '기준 해당 여부', ''],
  ['site_connected', 'boolean', '동 연결 여부', ''],
  ['site_combined_floors', 'boolean', '합친 층으로 보기(연결된 동)', ''],
  ['area_check', 'boolean', '면적 답변 확인', ''],
  ['application_date', 'date', '건축허가 신청일', ''],
  ['permit_date', 'date', '건축허가일', ''],
];

// inputs.json → Map(id → 정의). BUILTIN 위에 덮어쓴다
export function inputDefsFrom(inputsJson) {
  const map = new Map(BUILTIN.map(([id, type, label, unit, range]) => [id, range ? { id, type, label, unit, range } : { id, type, label, unit }]));
  for (const def of inputsJson?.inputs || []) map.set(def.id, { ...map.get(def.id), ...def });
  return map;
}

// 받침 유무로 조사 선택 (마지막 글자가 한글이 아니면 '이(가)' 꼴)
export function josa(word, withBatchim, without) {
  const code = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return `${withBatchim}(${without})`;
  return code % 28 ? withBatchim : without;
}

// 틀 채우기: {name} · 조사까지 붙이기 {name:이/가}
const fill = (template, vars) =>
  template
    .replace(/\{(\w+)(?::([^/}]+)\/([^}]+))?\}/g, (_, k, a, b) => {
      const v = vars[k] ?? '';
      return a && v ? `${v}${josa(v, a, b)}` : v;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

function areaText(area) {
  if (!Array.isArray(area)) return '';
  const [lo, hi] = area;
  if (lo === hi) return `(${fmtNum(lo)}㎡)`;
  return Number.isFinite(hi) && hi > 0 ? `(최대 ${fmtNum(hi)}㎡)` : '';
}

function answerRange(known, defined) {
  if (!known) return defined ? [...defined] : null;
  if (!defined) return known;
  const lo = Math.max(known[0], defined[0]);
  const hi = Math.min(known[1], defined[1]);
  return lo <= hi ? [lo, hi] : known;
}

// dep → { key, input, dong, floor, type, unit, label, text, status, range }
export function buildQuestion(dep, { inputDefs, index, names = new Map() }) {
  const def = inputDefs.get(dep.input) || { label: dep.input, type: 'boolean' };
  const info = dep.info || {};
  const vars = {
    dong: dep.dong ?? '',
    floor: info.floorLabel ?? dep.floor ?? '',
    where: [dep.dong, info.floorLabel ?? dep.floor].filter(Boolean).join(' '),
    area: areaText(info.area),
    uses: info.use ? describeUses(info.use, index) : '',
    floors: info.floors ? describeFloors(info.floors, index) : '',
    facility: info.facility ? names.get(info.facility) ?? info.facility : '',
    criteria: info.criteria ?? '',
    boundary: (info.boundaries || []).map(formatYmd).join(', '),
    groups: (info.groups || []).map((g) => useName(g, index)).join('·'),
    part: info.partLabel ?? '',
  };
  const label = def.label ?? dep.input;
  const fallback = `${vars.where ? `${vars.where} — ` : ''}${label}${josa(label, '을', '를')} 확인해 주세요.`;
  const text = info.question || (def.question ? fill(def.question, vars) : fallback);
  const q = { key: dep.key, input: dep.input, dong: dep.dong ?? null, floor: dep.floor ?? null, type: def.type ?? 'boolean', unit: def.unit ?? '', label: def.label ?? dep.input, text, status: dep.status };
  // 답할 수 있는 범위: 지금 알려진 구간 ∩ 입력 정의의 range (예: 지하층수 [2, ∞) ∩ [0, 30] → [2, 30])
  const range = answerRange(dep.range, def.range);
  if (range) q.range = range;
  if (dep.status === ASSUMED || dep.released) q.note = '가정값(정책 기본값)으로 두면 판정을 확정할 수 없어 확인이 필요합니다';
  return q;
}

const SMALL_RANGE = 40; // 정수 입력의 가능한 값 개수가 이 이하이면 모두 시험 (예: 지하층수 0~30)
const EPS = 0.001;
const SPARSE_GRID = [0, 1, 10, 100, 1000, 10000]; // 범위도 기준값도 없는 수치 입력에만

// 수치 입력의 시험값 — 질문을 고를 때만 쓴다(비해당의 안전성은 가정값을 푼 재평가가 보장한다).
// 가능한 값의 범위(입력 정의 range ∩ 지금 알려진 구간)의 양 끝과 조건 기준값 앞뒤. 정수이고 범위가 좁으면 모든 값
// (파생 합계의 폭 1짜리 구간 — 예: 지상 2층 + 지하 x층 = 7층 — 을 놓치지 않게).
export function testValues(dep, def = {}, constants = []) {
  const type = def.type ?? 'boolean';
  if (type === 'boolean') return [true, false];
  if (type !== 'number' && type !== 'integer') return [];
  let [lo, hi] = Array.isArray(def.range) ? def.range : [0, Infinity];
  if (dep.status === UNKNOWN && Array.isArray(dep.range)) {
    lo = Math.max(lo, dep.range[0]);
    hi = Math.min(hi, dep.range[1]);
  }
  if (!(hi >= lo)) return [];
  if (type === 'integer' && Number.isFinite(hi) && hi - lo <= SMALL_RANGE) {
    return Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.ceil(lo) + i);
  }
  const vals = new Set();
  if (Number.isFinite(lo)) vals.add(lo);
  if (Number.isFinite(hi)) vals.add(hi);
  for (const c of constants) {
    if (type === 'integer') [Math.floor(c) - 1, Math.floor(c), Math.ceil(c), Math.ceil(c) + 1].forEach((v) => vals.add(v));
    else [c - EPS, c, c + EPS].forEach((v) => vals.add(v));
  }
  if (!constants.length && !Number.isFinite(hi)) SPARSE_GRID.forEach((v) => vals.add(v));
  let out = [...vals].filter((v) => v >= lo && v <= hi);
  if (type === 'integer') out = out.map((v) => Math.round(v));
  return [...new Set(out)].sort((a, b) => a - b);
}

// 끝값 시험값(질문 선별 1·2단계): 참/거짓은 둘 다, 수치는 가능한 범위의 위·아래 끝(위부터 — '이상' 조건이 흔하다).
// 위 끝이 무한이면 기준값 가운데 가장 큰 값보다 조금 큰 값
export function extremeValues(dep, def = {}, constants = []) {
  const type = def.type ?? 'boolean';
  if (type === 'boolean') return [true, false];
  if (type !== 'number' && type !== 'integer') return [];
  let [lo, hi] = Array.isArray(def.range) ? def.range : [0, Infinity];
  if (dep.status === UNKNOWN && Array.isArray(dep.range)) {
    lo = Math.max(lo, dep.range[0]);
    hi = Math.min(hi, dep.range[1]);
  }
  if (!(hi >= lo)) return [];
  if (!Number.isFinite(hi)) hi = constants.length ? Math.max(...constants) + 1 : null;
  const out = [hi, lo].filter((v) => v !== null && Number.isFinite(v)).map((v) => (type === 'integer' ? Math.round(v) : v));
  return [...new Set(out)];
}

// 시험값에 쓸 기준 상수의 입력 대응: 층수 입력은 'N층 이상인 층'(level)·'지하층 포함 N개층'의 기준도 본다
export function constantsFor(input, constants) {
  const related = {
    ground_floors: ['ground_floors', 'floors_incl_basement', 'level'],
    basement_floors: ['basement_floors', 'floors_incl_basement', 'level'],
    floor_area: ['floor_area', 'use_area', 'floor_use_area'],
    part_area: ['floor_area', 'use_area', 'floor_use_area'],
    use_area: ['use_area', 'floor_area'],
    floor_use_area: ['floor_use_area', 'floor_area'],
  }[input] || [input];
  return constants.filter((c) => related.includes(c.input)).map((c) => c.value);
}
