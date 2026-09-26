// 판정 엔진 v2 — 데이터 스키마 상수와 조건 트리 공용 도구
// 검증기(validate.js)와 평가기(conditions.js·evaluate.js)가 같은 정의를 쓰도록 한 곳에 모은다.
// 순수 ES 모듈: DOM·fetch·Node 내장 모듈을 쓰지 않는다.

export const SCHEMA_VERSION = 2;

// 조건 노드 종류 — 노드 객체는 이 중 정확히 하나의 키를 가진다.
export const NODE_TYPES = Object.freeze([
  'all', 'any', 'not', 'm', 'sum_area', 'floor_exists', 'use', 'flag', 'facility', 'installed', 'const',
]);

// 비교 연산자. 법령 문구 ↔ 연산자 대응(WORDING_TO_OP)은 CP1 법령 검수 대상이다.
export const COMPARISON_OPS = Object.freeze(['gte', 'gt', 'lte', 'lt', 'eq']);
export const WORDING_TO_OP = Object.freeze({ 이상: 'gte', 초과: 'gt', 이하: 'lte', 미만: 'lt' });
export const OP_SYMBOL = Object.freeze({ gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=' });
export const OP_WORD = Object.freeze({ gte: '이상', gt: '초과', lte: '이하', lt: '미만', eq: '' });

export const ROW_KINDS = Object.freeze(['trigger', 'modifier', 'info']);
export const SCOPE_TYPES = Object.freeze(['all_floors', 'floors', 'matching_floors', 'part', 'inherit']);
export const FLOOR_KINDS = Object.freeze(['basement', 'ground', 'rooftop']);
export const REVIEW_STATUSES = Object.freeze(['draft', 'reviewed', 'approved']);
export const TYPE_CODE_RE = /^(0\d|[12]\d|30)$/;

// v1 필드(불변) · v2 행 필드(추가형)
export const V1_ROW_FIELDS = Object.freeze(['start_date', 'end_date', 'criteria', 'applicable_to', 'note']);
export const V2_ROW_FIELDS = Object.freeze([
  'id', 'kind', 'conditions', 'scope', 'branches', 'specs', 'retroactive', 'item_key', 'needs_review', 'inputs_required',
]);

// 층 선택자 약칭. 'all'은 지하층·지상층(옥탑 제외 — 정책 rooftopCountsAsFloor 참고).
export const FLOOR_SHORTHANDS = Object.freeze({
  all: { kind: ['basement', 'ground'] },
  basement: { kind: 'basement' },
  ground: { kind: 'ground' },
  rooftop: { kind: 'rooftop' },
  windowless: { windowless: true },
});
export const SELECTOR_KEYS = Object.freeze(['kind', 'level', 'windowless', 'use']);

// 노드 종류별로 허용하는 키 (종류 키 자신 포함)
export const NODE_ALLOWED_KEYS = Object.freeze({
  all: ['all'],
  any: ['any'],
  not: ['not'],
  m: ['m', ...COMPARISON_OPS],
  sum_area: ['sum_area', ...COMPARISON_OPS],
  floor_exists: ['floor_exists'],
  use: ['use', 'floors'],
  flag: ['flag'],
  facility: ['facility'],
  installed: ['installed'],
  const: ['const'],
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const NODE_TYPE_CACHE = new WeakMap();

// 노드 종류 판별 — 종류 키가 0개이거나 2개 이상이면 null (평가 중 반복 호출이 많아 노드별 캐시)
export function nodeType(node) {
  if (!isPlainObject(node)) return null;
  let t = NODE_TYPE_CACHE.get(node);
  if (t === undefined) {
    const found = NODE_TYPES.filter((k) => Object.prototype.hasOwnProperty.call(node, k));
    t = found.length === 1 ? found[0] : null;
    NODE_TYPE_CACHE.set(node, t);
  }
  return t;
}

const OPS_CACHE = new WeakMap();

// 객체에 들어 있는 비교 연산자 목록 (예: { gte: 300, lt: 600 } → ['gte', 'lt']). 평가 중 반복 호출이 많아 캐시
export function comparisonOps(obj) {
  if (!isPlainObject(obj)) return [];
  let ops = OPS_CACHE.get(obj);
  if (!ops) OPS_CACHE.set(obj, (ops = COMPARISON_OPS.filter((op) => op in obj)));
  return ops;
}

const SELECTORS_KEY = new WeakMap();

// 선택자 목록의 내용 키 — 내용이 같은 선택자(다른 시설의 같은 조건)끼리 층 계산을 공유하는 메모 키
export function selectorsKey(selectors) {
  let key = SELECTORS_KEY.get(selectors);
  if (key === undefined) SELECTORS_KEY.set(selectors, (key = selectors.map((s) => stableKey(s)).join('|')));
  return key;
}

const DEFAULT_FLOORS = Object.freeze([FLOOR_SHORTHANDS.all]);
const FLOORS_CACHE = new WeakMap(); // 조건 트리의 floors 배열 → 정규화 결과 (평가 중 반복 호출이 많아 캐시)

// 층 선택자 목록 정규화: 문자열 약칭·단일 객체 → 객체 배열. 형식이 틀리면 null
export function normalizeFloors(floors) {
  if (floors === undefined) return DEFAULT_FLOORS;
  const cacheable = floors !== null && typeof floors === 'object';
  if (cacheable && FLOORS_CACHE.has(floors)) return FLOORS_CACHE.get(floors);
  const list = Array.isArray(floors) ? floors : [floors];
  let out = [];
  for (const s of list) {
    if (typeof s === 'string') {
      if (!FLOOR_SHORTHANDS[s]) {
        out = null;
        break;
      }
      out.push(FLOOR_SHORTHANDS[s]);
    } else if (isPlainObject(s)) out.push(s);
    else {
      out = null;
      break;
    }
  }
  if (out && !out.length) out = null;
  if (cacheable) FLOORS_CACHE.set(floors, out);
  return out;
}

export const ALL_FLOOR_KINDS = Object.freeze(['basement', 'ground', 'rooftop']);
const KINDS_CACHE = new WeakMap();

// 선택자 목록이 고를 수 있는 층 구분 — 층 목록의 완전성(층수를 아는가)을 구분별로 따질 때 쓴다.
// kind 가 없으면 모든 구분, 단 무창층만 고르는 선택자는 지상층(무창층은 지상층의 정의)
export function selectorKinds(selectors) {
  if (KINDS_CACHE.has(selectors)) return KINDS_CACHE.get(selectors);
  const out = new Set();
  for (const s of selectors || []) {
    if (s.kind !== undefined) [].concat(s.kind).forEach((k) => out.add(k));
    else if (s.windowless) out.add('ground');
    else ALL_FLOOR_KINDS.forEach((k) => out.add(k));
  }
  const kinds = [...out];
  if (selectors) KINDS_CACHE.set(selectors, kinds);
  return kinds;
}

// 범위(scope) 정규화: 문자열 약칭 → { type, floors?, label? }. 형식이 틀리면 null
export function normalizeScope(scope) {
  if (typeof scope === 'string') return SCOPE_TYPES.includes(scope) && scope !== 'floors' ? { type: scope } : null;
  if (!isPlainObject(scope) || !SCOPE_TYPES.includes(scope.type)) return null;
  return scope;
}

// 조건 노드의 자식 노드 [[노드, 경로]] — 순회·검증 공용
export function childNodes(node, path = '') {
  const t = nodeType(node);
  if (t === 'all' || t === 'any') return Array.isArray(node[t]) ? node[t].map((c, i) => [c, `${path}.${t}[${i}]`]) : [];
  if (t === 'not') return [[node.not, `${path}.not`]];
  return [];
}

// 트리 전위 순회. fn(node, path)
export function walkConditions(node, fn, path = '') {
  fn(node, path);
  for (const [c, p] of childNodes(node, path)) walkConditions(c, fn, p);
}

// 행이 가진 조건 트리 뿌리들: conditions, branches[i].when, branches[i].conditions
export function rowConditionRoots(row) {
  const roots = [];
  if (row && row.conditions !== undefined) roots.push([row.conditions, 'conditions']);
  if (row && Array.isArray(row.branches)) {
    row.branches.forEach((b, i) => {
      if (b && b.when !== undefined) roots.push([b.when, `branches[${i}].when`]);
      if (b && b.conditions !== undefined) roots.push([b.conditions, `branches[${i}].conditions`]);
    });
  }
  return roots;
}

// 층 선택자가 참조하는 입력 id
function selectorInputs(floors, out) {
  for (const s of normalizeFloors(floors) || []) {
    if (s.windowless) out.add('windowless');
    if (s.use) out.add('uses');
  }
}

// 조건 트리가 참조하는 입력 id 집합 (inputs.json 의 id)
export function referencedInputs(node, out = new Set()) {
  walkConditions(node, (n) => {
    const t = nodeType(n);
    if (t === 'm') out.add(n.m);
    else if (t === 'flag') out.add(n.flag);
    else if (t === 'installed') out.add('installed');
    else if (t === 'use') {
      out.add('uses');
      if (n.floors !== undefined) selectorInputs(n.floors, out);
    } else if (t === 'sum_area' && isPlainObject(n.sum_area)) {
      out.add('floor_area');
      if (n.sum_area.use) out.add('uses');
      selectorInputs(n.sum_area.floors, out);
    } else if (t === 'floor_exists' && isPlainObject(n.floor_exists)) {
      if (n.floor_exists.area) out.add('floor_area');
      if (n.floor_exists.use) out.add('uses');
      selectorInputs(n.floor_exists.floors, out);
    }
  });
  return out;
}

// 조건 트리가 참조하는 타 시설 id 집합 (facility 노드)
export function referencedFacilities(node, out = new Set()) {
  walkConditions(node, (n) => {
    if (nodeType(n) === 'facility' && typeof n.facility === 'string') out.add(n.facility);
  });
  return out;
}

// 조건 트리의 수치 상수 [{ input, value }] — 결정적 질문의 시험값, 문구 대조 경고에 쓴다
export function numericConstants(node, out = []) {
  const push = (input, obj) => {
    for (const op of comparisonOps(obj)) if (typeof obj[op] === 'number') out.push({ input, value: obj[op], op });
  };
  const pushSelectors = (floors) => {
    for (const s of normalizeFloors(floors) || []) if (isPlainObject(s.level)) push('level', s.level);
  };
  walkConditions(node, (n) => {
    const t = nodeType(n);
    if (t === 'm') push(n.m, n);
    else if (t === 'sum_area' && isPlainObject(n.sum_area)) {
      push(n.sum_area.use ? 'use_area' : 'floor_area', n);
      pushSelectors(n.sum_area.floors);
    } else if (t === 'floor_exists' && isPlainObject(n.floor_exists)) {
      if (n.floor_exists.area) push(n.floor_exists.use ? 'floor_use_area' : 'floor_area', n.floor_exists.area);
      pushSelectors(n.floor_exists.floors);
    } else if (t === 'use' && n.floors !== undefined) pushSelectors(n.floors);
  });
  return out;
}

// 키 순서를 고정한 JSON — 질문 키(답변 저장 키)를 안정적으로 만든다
export function stableKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableKey(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export { isPlainObject };
