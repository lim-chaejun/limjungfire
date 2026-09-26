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
  ['windowless', 'boolean', '무창층 여부', ''],
  ['use_presence', 'boolean', '용도 존재 여부', ''],
  ['installed', 'boolean', '설치 여부', ''],
  ['mixed_use', 'boolean', '복합건축물 해당 여부', ''],
  ['review', 'boolean', '기준 해당 여부', ''],
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
  };
  const label = def.label ?? dep.input;
  const fallback = `${vars.where ? `${vars.where} — ` : ''}${label}${josa(label, '을', '를')} 확인해 주세요.`;
  const text = info.question || (def.question ? fill(def.question, vars) : fallback);
  const q = { key: dep.key, input: dep.input, dong: dep.dong ?? null, floor: dep.floor ?? null, type: def.type ?? 'boolean', unit: def.unit ?? '', label: def.label ?? dep.input, text, status: dep.status };
  if (dep.range) q.range = dep.range;
  if (dep.status === ASSUMED) q.note = '가정값으로 판정했으나 결과를 바꿀 수 있어 확인이 필요합니다';
  return q;
}

const COARSE_GRID = [0, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 100000];
const EPS = 0.001;

// 수치 입력의 시험값: 기준값 앞뒤 + 거친 격자. 입력 정의의 range(있을 수 있는 값) 밖은 버리고,
// 모르는 입력은 현재 알려진 구간 안으로 제한한다
export function testValues(dep, def = {}, constants = []) {
  const type = def.type ?? 'boolean';
  if (type === 'boolean') return [true, false];
  if (type !== 'number' && type !== 'integer') return [];
  const vals = new Set(COARSE_GRID);
  for (const c of constants) {
    if (type === 'integer') [Math.floor(c) - 1, Math.floor(c), Math.ceil(c), Math.ceil(c) + 1].forEach((v) => vals.add(v));
    else [c - EPS, c, c + EPS].forEach((v) => vals.add(v));
  }
  const [min, max] = Array.isArray(def.range) ? def.range : [0, Infinity];
  let out = [...vals].filter((v) => v >= min && v <= max);
  if (dep.status === UNKNOWN && Array.isArray(dep.range)) {
    const [lo, hi] = dep.range;
    out = out.filter((v) => v >= lo && v <= hi);
    if (Number.isFinite(lo)) out.push(lo);
    if (Number.isFinite(hi)) out.push(hi);
  }
  if (type === 'integer') out = out.map((v) => Math.round(v));
  return [...new Set(out)].sort((a, b) => a - b);
}

// 시험값에 쓸 기준 상수의 입력 대응: 층수 입력은 'N층 이상인 층'(level)·'지하층 포함 N개층'의 기준도 본다
export function constantsFor(input, constants) {
  const related = {
    ground_floors: ['ground_floors', 'floors_incl_basement', 'level'],
    basement_floors: ['basement_floors', 'floors_incl_basement', 'level'],
    floor_area: ['floor_area', 'use_area', 'floor_use_area'],
    use_area: ['use_area', 'floor_area'],
    floor_use_area: ['floor_use_area', 'floor_area'],
  }[input] || [input];
  return constants.filter((c) => related.includes(c.input)).map((c) => c.value);
}
