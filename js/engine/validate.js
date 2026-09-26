// 검증기 — 조건 트리·행·파일(v2)을 검사해 코드가 붙은 오류·경고 목록을 돌려준다 (순수 함수)
// 오류 { code, path, message } / 경고는 같은 모양에 code 가 W_ 로 시작.
// 이후 scripts/validate-data.mjs 가 이 함수들을 불러 데이터 가드 검사로 연결한다(P0 이후 단계).

import {
  FLOOR_KINDS, FLOOR_SHORTHANDS, NODE_ALLOWED_KEYS, REVIEW_STATUSES, ROW_KINDS, SCHEMA_VERSION, SELECTOR_KEYS, TYPE_CODE_RE,
  V1_ROW_FIELDS, V2_ROW_FIELDS, WORDING_TO_OP, comparisonOps, isPlainObject, nodeType, normalizeFloors, normalizeScope,
  numericConstants, referencedFacilities, referencedInputs, rowConditionRoots, stableKey, walkConditions,
} from './schema.js';
import { isValidYmd } from './dates.js';
import { buildUseIndex, isGroupCode } from './uses.js';
import { inputDefsFrom } from './questions.js';

export const ERROR_CODES = Object.freeze({
  COND_NOT_NODE: '조건 노드는 종류 키(all·any·not·m·sum_area·floor_exists·use·flag·facility·installed·const)를 정확히 하나 가진 객체여야 함',
  COND_EXTRA_KEY: '이 노드 종류에 허용되지 않는 키',
  COND_EMPTY_LIST: 'all·any 는 비어 있지 않은 배열이어야 함',
  COND_BAD_OP: '비교 연산자(gte·gt·lte·lt·eq)가 없거나 값이 유한한 수가 아님',
  COND_UNKNOWN_METRIC: 'm 이 참조하는 입력이 inputs.json 에 없거나 동 단위 수치 입력이 아님',
  COND_UNKNOWN_FLAG: 'flag 가 참조하는 입력이 inputs.json 에 없거나 동 단위 참/거짓 입력이 아님',
  COND_UNKNOWN_USE: '용도 어휘에 없는 용도 id 또는 용도군 코드',
  COND_BAD_FLOORS: '층 선택자 형식 오류',
  COND_BAD_AREA_SPEC: 'sum_area·floor_exists 형식 오류',
  COND_UNKNOWN_FACILITY: '시설 마스터(facilities.json)에 없는 시설 id',
  COND_UNKNOWN_INSTALLABLE: 'installed 대상이 시설 마스터나 inputs.json installed.targets 에 없음',
  COND_BAD_CONST: 'const 는 true 또는 false',
  COND_TOO_DEEP: '조건 트리가 너무 깊음(20단계 초과)',
  ROW_NOT_OBJECT: '규정 행은 객체여야 함',
  ROW_UNKNOWN_FIELD: '규정 행에 알 수 없는 필드',
  ROW_BAD_ID: 'v2 행은 비어 있지 않은 문자열 id 가 필요함',
  ROW_DUPLICATE_ID: '파일 안에서 행 id 가 중복됨',
  ROW_BAD_KIND: 'kind 는 trigger·modifier·info 중 하나',
  ROW_MISSING_CRITERIA: 'v1 필드 criteria(문자열)가 없음',
  ROW_BAD_DATE: 'start_date·end_date 는 null 또는 유효한 YYYYMMDD',
  ROW_DATE_ORDER: 'end_date 가 start_date 보다 이름',
  ROW_NO_CONDITIONS: 'trigger 행에 conditions·branches 가 없음 (구조화 전이면 needs_review 필요)',
  ROW_BAD_SCOPE: 'scope 형식 오류 (trigger 행은 scope 필요)',
  ROW_BAD_BRANCHES: 'branches 형식 오류 (비어 있지 않은 배열, 각 분기 conditions 필수, when 없는 분기는 마지막만)',
  ROW_BAD_SPECS: 'specs 는 객체',
  ROW_BAD_RETROACTIVE: 'retroactive 는 { deadline: YYYYMMDD, grace_until?: YYYYMMDD(≥ deadline), note? }',
  ROW_BAD_ITEM_KEY: 'item_key 는 비어 있지 않은 문자열',
  ROW_BAD_NEEDS_REVIEW: 'needs_review 는 { reason: 문자열, question?: 문자열 }',
  ROW_BAD_INPUTS_REQUIRED: 'inputs_required 는 inputs.json 의 입력 id 배열',
  ROW_INPUTS_MISSING: '조건이 참조하는 입력이 inputs_required 에 빠짐',
  ITEM_KEY_OVERLAP: '같은 item_key(버전 체인) 행들의 유효 기간이 겹침',
  FACILITY_BAD_ID: '시설 facility_id 가 문자열이 아님',
  FACILITY_UNKNOWN_ID: '시설 마스터(facilities.json)에 없는 facility_id',
  FACILITY_DUPLICATE: '파일 안에서 facility_id 가 중복됨',
  FACILITY_CYCLE: '시설 판정 의존(facility 노드)이 순환함',
  FACILITY_CROSS_FILE_CYCLE: '파일끼리 합쳐 평가하면(복합건축물 동: 구성 용도 파일 + 30번) 시설 판정 의존이 순환함',
  FILE_NOT_OBJECT: '데이터 파일은 객체여야 함',
  FILE_BAD_SCHEMA_VERSION: `schema_version 은 ${SCHEMA_VERSION}`,
  FILE_BAD_TYPE_CODE: "type_code 는 '00'~'30' 문자열",
  FILE_TYPE_CODE_MISMATCH: 'type_code 가 파일명 앞 번호와 다름',
  FILE_BAD_REVIEW: 'review 는 { status: draft|reviewed|approved, by: 문자열|null, date: YYYYMMDD|null }',
  FILE_BAD_STRENGTHENED: 'strengthened_retroactive 는 이 파일에 있는 facility_id 배열',
  FILE_BAD_FACILITIES: 'fire_facilities 는 배열, 각 시설의 regulations 는 배열',
  V1_FIELD_CHANGED: 'v1 필드(criteria·날짜·applicable_to·note 등)가 바뀜 — 스키마는 추가형이어야 함',
  V1_ROW_COUNT_CHANGED: 'v1 규정 행 수가 바뀜',
  V1_FACILITY_CHANGED: 'v1 시설 목록(순서·id·이름·분류·note)이 바뀜',
});

export const WARNING_CODES = Object.freeze({
  W_NUMBER_MISSING: '기준 원문의 수치가 조건에 없음',
  W_OP_MISMATCH: '원문의 이상·초과·이하·미만과 비교 연산자가 다름',
  W_SCOPE_WORDING: "원문의 '모든 층'·'해당 층'·'해당 부분'과 scope 가 다름",
  W_NEEDS_REVIEW: '검수 필요 표시(needs_review)가 있는 행',
  W_NO_TRIGGER: '판정 행(trigger)이 없는 시설 — 평가 시 원문 확인 질문(확인 필요)이 된다',
  W_LEVEL_WITHOUT_KIND: "층 선택자의 level 에 kind 가 없음 — 지하층 깊이에도 맞는다(지하4층이 '4층 이상'에 해당)",
  W_AUXILIARY_USE: '보조 용도(전기실 등)를 use 로 참조 — 층별개요에 거의 없어 늘 모름이 되므로 지표(electrical_room_area 등)를 권장',
});

const MAX_DEPTH = 20;
const issue = (table) => (code, path, detail) => ({ code, path, message: detail !== undefined ? `${table[code]}: ${detail}` : table[code] });
const err = issue(ERROR_CODES);
const warn = issue(WARNING_CODES);

// 검증 문맥: inputs.json · 용도 어휘 · 시설 마스터 (시설 마스터가 없으면 시설 id 검사는 건너뜀)
export function makeValidationContext({ inputs, vocabulary, useIndex, facilities } = {}) {
  const installed = (inputs?.inputs || []).find((d) => d.id === 'installed');
  return {
    inputDefs: inputDefsFrom(inputs),
    index: useIndex || buildUseIndex(vocabulary),
    facilityIds: facilities ? new Set((facilities.facilities || []).map((f) => f.id)) : null,
    installables: new Set((installed?.targets || []).map((t) => t.id)),
  };
}

function checkOps(obj, path, out, { integer = false } = {}) {
  const ops = comparisonOps(obj);
  if (!ops.length) out.push(err('COND_BAD_OP', path, '연산자 없음'));
  for (const op of ops) {
    const v = obj[op];
    if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v))) out.push(err('COND_BAD_OP', `${path}.${op}`, JSON.stringify(v)));
  }
}

function checkUses(uses, path, ctx, out) {
  if (!Array.isArray(uses) || !uses.length) {
    out.push(err('COND_UNKNOWN_USE', path, '비어 있지 않은 배열이어야 함'));
    return;
  }
  for (const id of uses) {
    const ok = typeof id === 'string' && (isGroupCode(id) ? ctx.index.groups.has(id) : ctx.index.uses.has(id));
    if (!ok) out.push(err('COND_UNKNOWN_USE', path, JSON.stringify(id)));
  }
}

function checkFloors(floors, path, ctx, out) {
  const list = Array.isArray(floors) ? floors : [floors];
  if (!list.length) out.push(err('COND_BAD_FLOORS', path, '빈 목록'));
  list.forEach((s, i) => {
    const p = Array.isArray(floors) ? `${path}[${i}]` : path;
    if (typeof s === 'string') {
      if (!FLOOR_SHORTHANDS[s]) out.push(err('COND_BAD_FLOORS', p, `알 수 없는 약칭 ${JSON.stringify(s)}`));
      return;
    }
    if (!isPlainObject(s) || !Object.keys(s).length) {
      out.push(err('COND_BAD_FLOORS', p, '선택자는 약칭 문자열 또는 비어 있지 않은 객체'));
      return;
    }
    for (const k of Object.keys(s)) if (!SELECTOR_KEYS.includes(k)) out.push(err('COND_BAD_FLOORS', `${p}.${k}`, `알 수 없는 키 ${k}`));
    if (s.kind !== undefined && ![].concat(s.kind).every((k) => FLOOR_KINDS.includes(k))) out.push(err('COND_BAD_FLOORS', `${p}.kind`, JSON.stringify(s.kind)));
    if (s.level !== undefined) {
      if (!isPlainObject(s.level)) out.push(err('COND_BAD_FLOORS', `${p}.level`, '비교 객체여야 함'));
      else checkOps(s.level, `${p}.level`, out, { integer: true });
    }
    if (s.windowless !== undefined && s.windowless !== true) out.push(err('COND_BAD_FLOORS', `${p}.windowless`, 'true 만 허용'));
    if (s.use !== undefined) checkUses(s.use, `${p}.use`, ctx, out);
  });
}

function checkAreaSpec(spec, allowed, path, ctx, out) {
  if (!isPlainObject(spec)) {
    out.push(err('COND_BAD_AREA_SPEC', path, '객체여야 함'));
    return false;
  }
  for (const k of Object.keys(spec)) if (!allowed.includes(k)) out.push(err('COND_BAD_AREA_SPEC', `${path}.${k}`, `알 수 없는 키 ${k}`));
  if (spec.floors !== undefined) checkFloors(spec.floors, `${path}.floors`, ctx, out);
  if (spec.use !== undefined) checkUses(spec.use, `${path}.use`, ctx, out);
  return true;
}

const isMetricInput = (def) => def && !def.engine && (def.type === 'number' || def.type === 'integer') && (def.scope ?? 'building') === 'building';
const isFlagInput = (def) => def && !def.engine && def.type === 'boolean' && (def.scope ?? 'building') === 'building';

export function validateConditions(node, ctx, path = 'conditions', depth = 0, out = []) {
  if (depth > MAX_DEPTH) {
    out.push(err('COND_TOO_DEEP', path));
    return out;
  }
  const t = nodeType(node);
  if (!t) {
    out.push(err('COND_NOT_NODE', path, JSON.stringify(node)?.slice(0, 80)));
    return out;
  }
  for (const k of Object.keys(node)) if (!NODE_ALLOWED_KEYS[t].includes(k)) out.push(err('COND_EXTRA_KEY', `${path}.${k}`, k));
  switch (t) {
    case 'all':
    case 'any':
      if (!Array.isArray(node[t]) || !node[t].length) out.push(err('COND_EMPTY_LIST', `${path}.${t}`));
      else node[t].forEach((c, i) => validateConditions(c, ctx, `${path}.${t}[${i}]`, depth + 1, out));
      break;
    case 'not':
      validateConditions(node.not, ctx, `${path}.not`, depth + 1, out);
      break;
    case 'm':
      if (!isMetricInput(ctx.inputDefs.get(node.m))) out.push(err('COND_UNKNOWN_METRIC', `${path}.m`, JSON.stringify(node.m)));
      checkOps(node, path, out);
      break;
    case 'sum_area':
      checkAreaSpec(node.sum_area, ['floors', 'use'], `${path}.sum_area`, ctx, out);
      checkOps(node, path, out);
      break;
    case 'floor_exists':
      if (checkAreaSpec(node.floor_exists, ['floors', 'area', 'use'], `${path}.floor_exists`, ctx, out) && node.floor_exists.area !== undefined) {
        const area = node.floor_exists.area;
        if (!isPlainObject(area) || Object.keys(area).some((k) => !comparisonOps({ [k]: 0 }).length)) out.push(err('COND_BAD_AREA_SPEC', `${path}.floor_exists.area`, '비교 연산자만 허용'));
        else checkOps(area, `${path}.floor_exists.area`, out);
      }
      break;
    case 'use':
      checkUses(node.use, `${path}.use`, ctx, out);
      if (node.floors !== undefined) checkFloors(node.floors, `${path}.floors`, ctx, out);
      break;
    case 'flag':
      if (!isFlagInput(ctx.inputDefs.get(node.flag))) out.push(err('COND_UNKNOWN_FLAG', `${path}.flag`, JSON.stringify(node.flag)));
      break;
    case 'facility':
      if (typeof node.facility !== 'string' || (ctx.facilityIds && !ctx.facilityIds.has(node.facility))) out.push(err('COND_UNKNOWN_FACILITY', `${path}.facility`, JSON.stringify(node.facility)));
      break;
    case 'installed': {
      const id = node.installed;
      const known = typeof id === 'string' && (!ctx.facilityIds || ctx.facilityIds.has(id) || ctx.installables.has(id));
      if (!known) out.push(err('COND_UNKNOWN_INSTALLABLE', `${path}.installed`, JSON.stringify(id)));
      break;
    }
    case 'const':
      if (typeof node.const !== 'boolean') out.push(err('COND_BAD_CONST', `${path}.const`, JSON.stringify(node.const)));
      break;
    default:
      break;
  }
  return out;
}

function validateScope(scope, path, ctx, out) {
  const s = normalizeScope(scope);
  if (!s) {
    out.push(err('ROW_BAD_SCOPE', path, JSON.stringify(scope)));
    return;
  }
  if (s.type === 'floors') {
    if (s.floors === undefined) out.push(err('ROW_BAD_SCOPE', `${path}.floors`, "type 'floors' 는 floors 필요"));
    else checkFloors(s.floors, `${path}.floors`, ctx, out);
  }
  if (s.label !== undefined && typeof s.label !== 'string') out.push(err('ROW_BAD_SCOPE', `${path}.label`, '문자열이어야 함'));
}

function validateBranches(branches, path, ctx, out) {
  if (!Array.isArray(branches) || !branches.length) {
    out.push(err('ROW_BAD_BRANCHES', path));
    return;
  }
  branches.forEach((b, i) => {
    const p = `${path}[${i}]`;
    if (!isPlainObject(b) || b.conditions === undefined || Object.keys(b).some((k) => !['when', 'conditions', 'scope'].includes(k))) {
      out.push(err('ROW_BAD_BRANCHES', p));
      return;
    }
    if (b.when === undefined && i !== branches.length - 1) out.push(err('ROW_BAD_BRANCHES', p, 'when 없는 분기는 마지막에만'));
    if (b.when !== undefined) validateConditions(b.when, ctx, `${p}.when`, 0, out);
    validateConditions(b.conditions, ctx, `${p}.conditions`, 0, out);
    if (b.scope !== undefined) validateScope(b.scope, `${p}.scope`, ctx, out);
  });
}

export function validateRow(row, ctx, path = 'row', out = []) {
  if (!isPlainObject(row)) {
    out.push(err('ROW_NOT_OBJECT', path));
    return out;
  }
  for (const k of Object.keys(row)) if (!V1_ROW_FIELDS.includes(k) && !V2_ROW_FIELDS.includes(k)) out.push(err('ROW_UNKNOWN_FIELD', `${path}.${k}`, k));
  if (typeof row.id !== 'string' || !row.id.trim()) out.push(err('ROW_BAD_ID', `${path}.id`));
  if (!ROW_KINDS.includes(row.kind)) out.push(err('ROW_BAD_KIND', `${path}.kind`, JSON.stringify(row.kind)));
  if (typeof row.criteria !== 'string') out.push(err('ROW_MISSING_CRITERIA', `${path}.criteria`));
  for (const k of ['start_date', 'end_date']) if (row[k] !== null && row[k] !== undefined && !isValidYmd(row[k])) out.push(err('ROW_BAD_DATE', `${path}.${k}`, JSON.stringify(row[k])));
  if (isValidYmd(row.start_date) && isValidYmd(row.end_date) && row.end_date < row.start_date) out.push(err('ROW_DATE_ORDER', path, `${row.start_date} ~ ${row.end_date}`));
  if (row.conditions !== undefined) validateConditions(row.conditions, ctx, `${path}.conditions`, 0, out);
  if (row.branches !== undefined) validateBranches(row.branches, `${path}.branches`, ctx, out);
  const trigger = row.kind === 'trigger';
  if (trigger && row.conditions === undefined && row.branches === undefined && row.needs_review === undefined) out.push(err('ROW_NO_CONDITIONS', path));
  const branchScopes = Array.isArray(row.branches) && row.branches.length && row.branches.every((b) => b?.scope !== undefined);
  if (row.scope !== undefined) validateScope(row.scope, `${path}.scope`, ctx, out);
  else if (trigger && !branchScopes) out.push(err('ROW_BAD_SCOPE', `${path}.scope`, 'trigger 행은 scope 필요'));
  if (row.specs !== undefined && !isPlainObject(row.specs)) out.push(err('ROW_BAD_SPECS', `${path}.specs`));
  if (row.retroactive !== undefined) {
    const r = row.retroactive;
    const ok = isPlainObject(r) && isValidYmd(r.deadline) && Object.keys(r).every((k) => ['deadline', 'grace_until', 'note'].includes(k))
      && (r.grace_until === undefined || (isValidYmd(r.grace_until) && r.grace_until >= r.deadline));
    if (!ok) out.push(err('ROW_BAD_RETROACTIVE', `${path}.retroactive`, JSON.stringify(r)));
  }
  if (row.item_key !== undefined && (typeof row.item_key !== 'string' || !row.item_key.trim())) out.push(err('ROW_BAD_ITEM_KEY', `${path}.item_key`));
  if (row.needs_review !== undefined) {
    const n = row.needs_review;
    const ok = isPlainObject(n) && typeof n.reason === 'string' && n.reason.trim() && (n.question === undefined || typeof n.question === 'string');
    if (!ok) out.push(err('ROW_BAD_NEEDS_REVIEW', `${path}.needs_review`));
  }
  if (row.inputs_required !== undefined) {
    const list = row.inputs_required;
    if (!Array.isArray(list) || list.some((id) => typeof id !== 'string' || !ctx.inputDefs.has(id))) {
      out.push(err('ROW_BAD_INPUTS_REQUIRED', `${path}.inputs_required`, JSON.stringify(list)));
    } else {
      const used = new Set();
      for (const [node] of rowConditionRoots(row)) if (nodeType(node)) referencedInputs(node, used);
      const missing = [...used].filter((id) => !list.includes(id));
      if (missing.length) out.push(err('ROW_INPUTS_MISSING', `${path}.inputs_required`, missing.join(', ')));
    }
  }
  return out;
}

// 같은 item_key 행들의 기간 [start, end] 가 겹치면 오류 (버전 체인은 끊김 없이 이어지되 겹치지 않아야 함)
export function checkItemKeyOverlaps(entries) {
  const out = [];
  const byKey = new Map();
  for (const e of entries) {
    if (typeof e.row?.item_key !== 'string') continue;
    if (!byKey.has(e.row.item_key)) byKey.set(e.row.item_key, []);
    byKey.get(e.row.item_key).push(e);
  }
  for (const [key, list] of byKey) {
    const spans = list.map((e) => ({ ...e, s: e.row.start_date || '00000000', t: e.row.end_date || '99999999' })).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        if (spans[j].s <= spans[i].t) {
          out.push(err('ITEM_KEY_OVERLAP', spans[j].path, `${key}: ${spans[i].row.id ?? spans[i].path}(${spans[i].s}~${spans[i].t}) ↔ ${spans[j].row.id ?? spans[j].path}(${spans[j].s}~${spans[j].t})`));
        }
      }
    }
  }
  return out;
}

// 시설 의존 그래프의 순환 → [['a','b','a'], …] (같은 순환은 한 번만)
export function findFacilityCycles(facilities) {
  const graph = new Map();
  for (const fac of facilities || []) {
    const refs = new Set();
    for (const row of fac.regulations || []) for (const [node] of rowConditionRoots(row)) referencedFacilities(node, refs);
    if (fac.excluded_if !== undefined) referencedFacilities(fac.excluded_if, refs);
    graph.set(fac.facility_id, [...(graph.get(fac.facility_id) || []), ...refs]);
  }
  const cycles = [];
  const seen = new Set();
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 'active');
    stack.push(id);
    for (const next of graph.get(id) || []) {
      if (state.get(next) === 'active') {
        const cyc = stack.slice(stack.indexOf(next));
        const start = cyc.indexOf([...cyc].sort()[0]);
        const norm = [...cyc.slice(start), ...cyc.slice(0, start)];
        const key = norm.join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...norm, norm[0]]);
        }
      } else if (!state.has(next) && graph.has(next)) visit(next);
    }
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of graph.keys()) if (!state.has(id)) visit(id);
  return cycles;
}

// 원문 대조 경고: 수치·이상/초과/이하/미만·'모든 층/해당 층/해당 부분'
const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)\s*(㎡|m²|개층|층|m|명|세대|대|배)\s*(이상|초과|이하|미만)?/g;

// 조건 트리·범위의 층 선택자와 용도 목록 점검: level 에 kind 없음, 보조 용도 참조
function lintSelectorsAndUses(row, path, ctx, out) {
  const selectorLists = [];
  const useLists = [];
  for (const [node] of rowConditionRoots(row)) {
    if (!nodeType(node)) continue;
    walkConditions(node, (n) => {
      const t = nodeType(n);
      if (t === 'use') {
        useLists.push(n.use);
        if (n.floors !== undefined) selectorLists.push(n.floors);
      } else if ((t === 'sum_area' || t === 'floor_exists') && isPlainObject(n[t])) {
        if (n[t].use) useLists.push(n[t].use);
        selectorLists.push(n[t].floors);
      }
    });
  }
  for (const sc of [row.scope, ...(row.branches || []).map((b) => b?.scope)].map(normalizeScope).filter(Boolean)) {
    if (sc.type === 'floors') selectorLists.push(sc.floors);
  }
  for (const list of selectorLists) {
    for (const sel of normalizeFloors(list) || []) {
      if (sel.use) useLists.push(sel.use);
      if (sel.level !== undefined && sel.kind === undefined) out.push(warn('W_LEVEL_WITHOUT_KIND', path, JSON.stringify(sel)));
    }
  }
  if (ctx?.index) {
    for (const uses of useLists) {
      const aux = (Array.isArray(uses) ? uses : []).filter((id) => !isGroupCode(id) && ctx.index.uses.get(id) && !ctx.index.uses.get(id).group);
      if (aux.length) out.push(warn('W_AUXILIARY_USE', path, aux.join(', ')));
    }
  }
}

export function lintRow(row, path = 'row', ctx = null) {
  const out = [];
  if (row.needs_review) out.push(warn('W_NEEDS_REVIEW', path, row.needs_review.reason));
  lintSelectorsAndUses(row, path, ctx, out);
  const roots = rowConditionRoots(row);
  if (!roots.length || typeof row.criteria !== 'string') return out;
  const consts = [];
  for (const [node] of roots) if (nodeType(node)) numericConstants(node, consts);
  const scopes = [row.scope, ...(row.branches || []).map((b) => b?.scope)].map(normalizeScope).filter(Boolean);
  for (const s of scopes) {
    for (const sel of (s.type === 'floors' && normalizeFloors(s.floors)) || []) {
      for (const op of comparisonOps(sel.level)) consts.push({ input: 'level', value: sel.level[op], op });
    }
  }
  for (const m of row.criteria.matchAll(NUMBER_RE)) {
    const value = Number(m[1].replace(/,/g, ''));
    const same = consts.filter((c) => c.value === value);
    if (!same.length) out.push(warn('W_NUMBER_MISSING', path, `${m[0].trim()}`));
    else if (m[3] && !same.some((c) => c.op === WORDING_TO_OP[m[3]])) out.push(warn('W_OP_MISMATCH', path, `${m[0].trim()} → ${WORDING_TO_OP[m[3]]} 기대, 조건: ${same.map((c) => c.op).join('/')}`));
  }
  const types = scopes.map((s) => s.type);
  const text = row.criteria.replace(/\s+/g, '');
  if ((text.includes('모든층') || text.includes('전층')) && !types.some((t) => t === 'all_floors' || t === 'floors')) out.push(warn('W_SCOPE_WORDING', path, "'모든 층' ↔ " + (types.join(',') || '없음')));
  else if (text.includes('해당층') && !types.some((t) => t === 'matching_floors' || t === 'floors')) out.push(warn('W_SCOPE_WORDING', path, "'해당 층' ↔ " + (types.join(',') || '없음')));
  else if (text.includes('해당부분') && !types.includes('part')) out.push(warn('W_SCOPE_WORDING', path, "'해당 부분' ↔ " + (types.join(',') || '없음')));
  return out;
}

// v2 파일 검증. schema_version 이 없으면 v1 로 보고 검사하지 않는다 ({ v1: true })
export function validateFile(file, ctx, { fileName } = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(file)) return { v1: false, errors: [err('FILE_NOT_OBJECT', '')], warnings };
  if (file.schema_version === undefined) return { v1: true, errors, warnings };
  if (file.schema_version !== SCHEMA_VERSION) errors.push(err('FILE_BAD_SCHEMA_VERSION', 'schema_version', JSON.stringify(file.schema_version)));
  if (typeof file.type_code !== 'string' || !TYPE_CODE_RE.test(file.type_code)) errors.push(err('FILE_BAD_TYPE_CODE', 'type_code', JSON.stringify(file.type_code)));
  else if (fileName && /^\d\d_/.test(fileName) && fileName.slice(0, 2) !== file.type_code) errors.push(err('FILE_TYPE_CODE_MISMATCH', 'type_code', `${fileName} ↔ ${file.type_code}`));
  const rv = file.review;
  const reviewOk = isPlainObject(rv) && REVIEW_STATUSES.includes(rv.status) && (rv.by === null || typeof rv.by === 'string') && (rv.date === null || isValidYmd(rv.date));
  if (!reviewOk) errors.push(err('FILE_BAD_REVIEW', 'review', JSON.stringify(rv)));
  const facilities = file.fire_facilities;
  if (!Array.isArray(facilities)) {
    errors.push(err('FILE_BAD_FACILITIES', 'fire_facilities'));
    return { v1: false, errors, warnings };
  }
  const ids = new Set();
  const rowIds = new Set();
  const entries = [];
  facilities.forEach((fac, i) => {
    const p = `fire_facilities[${i}]`;
    if (typeof fac?.facility_id !== 'string') errors.push(err('FACILITY_BAD_ID', `${p}.facility_id`));
    else {
      if (ctx.facilityIds && !ctx.facilityIds.has(fac.facility_id)) errors.push(err('FACILITY_UNKNOWN_ID', `${p}.facility_id`, fac.facility_id));
      if (ids.has(fac.facility_id)) errors.push(err('FACILITY_DUPLICATE', `${p}.facility_id`, fac.facility_id));
      ids.add(fac.facility_id);
    }
    if (fac?.excluded_if !== undefined) validateConditions(fac.excluded_if, ctx, `${p}.excluded_if`, 0, errors);
    if (!Array.isArray(fac?.regulations)) {
      errors.push(err('FILE_BAD_FACILITIES', `${p}.regulations`));
      return;
    }
    if (!fac.regulations.some((r) => (r?.kind ?? 'trigger') === 'trigger')) warnings.push(warn('W_NO_TRIGGER', p, fac.facility_id));
    fac.regulations.forEach((row, j) => {
      const rp = `${p}.regulations[${j}]`;
      validateRow(row, ctx, rp, errors);
      warnings.push(...(isPlainObject(row) ? lintRow(row, rp, ctx) : []));
      if (typeof row?.id === 'string') {
        if (rowIds.has(row.id)) errors.push(err('ROW_DUPLICATE_ID', `${rp}.id`, row.id));
        rowIds.add(row.id);
      }
      entries.push({ row, path: rp });
    });
  });
  const st = file.strengthened_retroactive;
  if (st !== undefined && (!Array.isArray(st) || st.some((id) => !ids.has(id)))) errors.push(err('FILE_BAD_STRENGTHENED', 'strengthened_retroactive', JSON.stringify(st)));
  errors.push(...checkItemKeyOverlaps(entries));
  for (const cyc of findFacilityCycles(facilities)) errors.push(err('FACILITY_CYCLE', 'fire_facilities', cyc.join(' → ')));
  return { v1: false, errors, warnings };
}

// 파일 묶음 검증: 파일마다 validateFile + 파일끼리의 시설 의존 순환(복합건축물 동은 여러 파일을 합쳐 평가한다)
// files: { 파일명: json } 또는 [{ name, json }]
export function validateFileSet(files, ctx) {
  const entries = Array.isArray(files) ? files : Object.entries(files).map(([name, json]) => ({ name, json }));
  const byFile = {};
  const errors = [];
  const warnings = [];
  const facilities = [];
  const within = new Set();
  for (const { name, json } of entries) {
    const r = validateFile(json, ctx, { fileName: name });
    byFile[name] = r;
    errors.push(...r.errors.map((e) => ({ ...e, file: name })));
    warnings.push(...r.warnings.map((w) => ({ ...w, file: name })));
    if (r.v1 || !Array.isArray(json?.fire_facilities)) continue;
    facilities.push(...json.fire_facilities);
    for (const cyc of findFacilityCycles(json.fire_facilities)) within.add(cyc.join('>'));
  }
  for (const cyc of findFacilityCycles(facilities)) {
    if (!within.has(cyc.join('>'))) errors.push({ ...err('FACILITY_CROSS_FILE_CYCLE', 'files', cyc.join(' → ')), file: null });
  }
  return { byFile, errors, warnings };
}

// v2 가 더하는 필드(파일·시설·행). v1 비교에서 빼는 허용 목록
const V2_FILE_KEYS = new Set(['schema_version', 'type_code', 'review', 'strengthened_retroactive']);
const V2_FACILITY_KEYS = new Set(['excluded_if']);
const V2_ROW_KEYS = new Set(V2_ROW_FIELDS);
const omit = (obj, keys) => (isPlainObject(obj) ? Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.has(k))) : obj);

// 두 값의 다른 경로들 (깊은 비교)
function diffPaths(a, b, path, out) {
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], path ? `${path}.${k}` : k, out);
  } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diffPaths(x, b[i], `${path}[${i}]`, out));
  } else if (stableKey(a ?? null) !== stableKey(b ?? null)) out.push(path);
}

// v1 필드 불변 검사 — 데이터 변환(구조화) PR 전용: 변환 전(before)·후(after) 파일에서 v2 추가 필드(허용 목록)만 빼고
// 나머지 전부(파일 최상위의 building_type·definition·modular_classroom 등 포함)가 그대로인지 위치 기준으로 대조한다.
// 법령 개정 반영 PR 은 종료일 변경·행 추가가 정상이므로 이 검사를 쓰지 않는다.
export function compareV1Fields(before, after) {
  const out = [];
  const b = omit(before ?? {}, V2_FILE_KEYS);
  const a = omit(after ?? {}, V2_FILE_KEYS);
  const top = [];
  diffPaths(omit(b, new Set(['fire_facilities'])), omit(a, new Set(['fire_facilities'])), '', top);
  for (const p of top) out.push(err('V1_FIELD_CHANGED', p));
  const bf = Array.isArray(b.fire_facilities) ? b.fire_facilities : [];
  const af = Array.isArray(a.fire_facilities) ? a.fire_facilities : [];
  if (bf.length !== af.length) out.push(err('V1_FACILITY_CHANGED', 'fire_facilities', `${bf.length} → ${af.length}`));
  bf.forEach((bFac, i) => {
    const aFac = af[i];
    const p = `fire_facilities[${i}]`;
    if (!aFac) return;
    if (bFac?.facility_id !== aFac?.facility_id) {
      out.push(err('V1_FACILITY_CHANGED', p, `${bFac?.facility_id} → ${aFac?.facility_id}`));
      return;
    }
    const facPaths = [];
    diffPaths(omit(omit(bFac, V2_FACILITY_KEYS), new Set(['regulations'])), omit(omit(aFac, V2_FACILITY_KEYS), new Set(['regulations'])), p, facPaths);
    for (const fp of facPaths) out.push(err('V1_FIELD_CHANGED', fp));
    const br = Array.isArray(bFac.regulations) ? bFac.regulations : [];
    const ar = Array.isArray(aFac.regulations) ? aFac.regulations : [];
    if (br.length !== ar.length) out.push(err('V1_ROW_COUNT_CHANGED', `${p}.regulations`, `${br.length} → ${ar.length}`));
    br.forEach((row, j) => {
      if (!ar[j]) return;
      const rowPaths = [];
      diffPaths(omit(row, V2_ROW_KEYS), omit(ar[j], V2_ROW_KEYS), `${p}.regulations[${j}]`, rowPaths);
      for (const rp of rowPaths) out.push(err('V1_FIELD_CHANGED', rp));
    });
  });
  return out;
}
