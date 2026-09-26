// 조건 트리 평가 — 노드 하나를 3값(출처 포함)으로
//
// env = { dong, index, answers, policy, inputDefs, facility(id) → tv, matched, maybeMatched }
// 모든 불확실한 잎(leaf)은 질문 키를 가지며, answers[키]가 있으면 그 답을 확정값으로 쓴다.
// 그래서 "이 질문에 답하면 판정이 바뀌는가"는 answers 를 바꿔 다시 평가하는 것만으로 확인된다.

import { comparisonOps, nodeType, normalizeFloors, stableKey } from './schema.js';
import {
  ASSUMED, CONFIRMED, F, T, U, UNKNOWN,
  addInterval, all, any, capInterval, compareInterval, depKey, exact, interval, makeDep, mergeDeps, not, tv,
} from './logic.js';
import { coverage, describeUses } from './uses.js';
import { effectiveFloors } from './facts.js';
import { describeFloors, fmtCondition, fmtInterval } from './format.js';

export function makeEnv({ dong, index, answers = {}, policy, inputDefs = new Map(), names = new Map(), facility }) {
  return {
    dong,
    index,
    answers,
    policy,
    inputDefs,
    names,
    facility: facility || (() => tv(U, [], ['타 시설 판정을 알 수 없음'])),
    cache: new Map(),
    matched: null,
    maybeMatched: null,
  };
}

const labelOf = (env, id) => env.inputDefs.get(id)?.label ?? id;
const unitOf = (env, id) => env.inputDefs.get(id)?.unit ?? '';

function numAnswer(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
const boolAnswer = (v) => (v === true || v === false ? v : null);
const userDep = (input, env, extra = {}) => makeDep(input, CONFIRMED, { dong: env.dong.id, source: 'user', ...extra });

function memo(env, key, fn) {
  if (!env.cache.has(key)) env.cache.set(key, fn());
  return env.cache.get(key);
}

// ───────────── 지표 ─────────────

// 정책을 반영하지 않은 원값 (답변 > 사실 > 모름)
function rawMetric(env, id) {
  return memo(env, `raw:${id}`, () => {
    const a = numAnswer(env.answers[depKey(id, env.dong.id)]);
    if (a !== null) return exact(a, [userDep(id, env)]);
    return env.dong.metrics[id] || interval(0, Infinity, { open: [makeDep(id, UNKNOWN, { dong: env.dong.id })] });
  });
}

export function metric(env, id) {
  return memo(env, `m:${id}`, () => {
    if (id === 'floors_incl_basement') {
      const a = numAnswer(env.answers[depKey(id, env.dong.id)]);
      if (a !== null) return exact(a, [userDep(id, env)]);
      return addInterval(rawMetric(env, 'ground_floors'), rawMetric(env, 'basement_floors'));
    }
    if (id === 'ground_floors' && env.policy.basementCountsInFloors) {
      return addInterval(rawMetric(env, 'ground_floors'), rawMetric(env, 'basement_floors'));
    }
    return rawMetric(env, id);
  });
}

// ───────────── 층 ─────────────

const exactInt = (iv) => (iv.lo === iv.hi && !iv.open.length && Number.isInteger(iv.lo) ? iv.lo : null);

// 평가에 쓰는 층 목록과 그 근거(층수 입력의 출처)
export function floorsOf(env) {
  return memo(env, 'floors', () => {
    const g = rawMetric(env, 'ground_floors');
    const b = rawMetric(env, 'basement_floors');
    const { floors, complete } = effectiveFloors(env.dong, exactInt(g), exactInt(b));
    return { floors, complete, listDeps: mergeDeps(g.hiDeps, b.hiDeps), listOpen: mergeDeps(g.open, b.open) };
  });
}

export function floorArea(env, floor) {
  const a = numAnswer(env.answers[depKey('floor_area', env.dong.id, floor.key)]);
  if (a !== null) return exact(a, [userDep('floor_area', env, { floor: floor.key })]);
  return capInterval(floor.area, metric(env, 'total_area'));
}

// 무창층은 지상층에만 있다(소방시설법 시행령 제2조제1호). 지하층·옥탑은 확정 F
function windowless(env, floor) {
  const key = depKey('windowless', env.dong.id, floor.key);
  const a = boolAnswer(env.answers[key]);
  if (a !== null) return tv(a ? T : F, [userDep('windowless', env, { floor: floor.key })], [`${floor.label} 무창층 ${a ? '예' : '아니오'}`]);
  if (floor.kind !== 'ground') return tv(F);
  const area = floorArea(env, floor);
  const info = { floorLabel: floor.label, area: [area.lo, area.hi] };
  if (env.policy.windowless === 'assume_none') {
    return tv(F, [makeDep('windowless', ASSUMED, { dong: env.dong.id, floor: floor.key, info, source: 'policy' })], [`${floor.label} 무창층 아님(가정)`]);
  }
  return tv(U, [makeDep('windowless', UNKNOWN, { dong: env.dong.id, floor: floor.key, info })], [`${floor.label} 무창층 여부 미확인`]);
}

const usesDep = (env, floor) => makeDep('uses', CONFIRMED, { dong: env.dong.id, floor: floor?.key, source: env.dong.source === 'manual' ? 'user' : 'registry' });

// 층에 대상 용도가 있는가 (층 부분의 용도 목록 기준)
function floorUsePresence(env, floor, targets) {
  const cs = floor.parts.map((p) => coverage(p.terms, targets, env.index));
  if (cs.some((c) => c === 'all' || c === 'some')) return tv(T, [usesDep(env, floor)], [`${floor.label} ${describeUses(targets, env.index)} 용도 있음`]);
  if (cs.every((c) => c === 'none')) return tv(F, [usesDep(env, floor)]);
  const sig = stableKey({ use: targets });
  const a = boolAnswer(env.answers[depKey('use_presence', env.dong.id, floor.key, sig)]);
  if (a !== null) return tv(a ? T : F, [userDep('use_presence', env, { floor: floor.key, sig })]);
  const info = { floorLabel: floor.label, use: targets };
  return tv(U, [makeDep('use_presence', UNKNOWN, { dong: env.dong.id, floor: floor.key, sig, info })], [
    `${floor.label} ${describeUses(targets, env.index)} 용도 여부 미확인`,
  ]);
}

function selectorMatch(env, floor, s) {
  const parts = [];
  if (s.kind !== undefined) parts.push(tv([].concat(s.kind).includes(floor.kind) ? T : F));
  if (s.level !== undefined) parts.push(tv(comparisonOps(s.level).every((op) => cmp(floor.level, op, s.level[op])) ? T : F));
  if (s.windowless) parts.push(windowless(env, floor));
  if (s.use) parts.push(floorUsePresence(env, floor, s.use));
  return all(parts);
}

function cmp(x, op, c) {
  return op === 'gte' ? x >= c : op === 'gt' ? x > c : op === 'lte' ? x <= c : op === 'lt' ? x < c : x === c;
}

export function floorMember(env, floor, selectors) {
  return any(selectors.map((s) => selectorMatch(env, floor, s)));
}

// 층 하나에서 대상 용도의 면적. 용도가 섞였거나 미상인 부분은 [0, 부분 면적] + openDep
function floorUseArea(env, floor, targets, openDep) {
  const areaAnswered = numAnswer(env.answers[depKey('floor_area', env.dong.id, floor.key)]) !== null;
  let sum = exact(0);
  for (const part of floor.parts) {
    const a = areaAnswered && floor.parts.length === 1 ? floorArea(env, floor) : capInterval(part.area, metric(env, 'total_area'));
    const c = coverage(part.terms, targets, env.index);
    const ud = [usesDep(env, floor)];
    if (c === 'all') sum = addInterval(sum, { ...a, loDeps: mergeDeps(a.loDeps, ud), hiDeps: mergeDeps(a.hiDeps, ud) });
    else if (c === 'none') sum = addInterval(sum, exact(0, ud));
    else sum = addInterval(sum, interval(0, a.hi, { hiDeps: a.hiDeps, open: mergeDeps(a.open, [openDep]) }));
  }
  return sum;
}

// ───────────── 노드별 평가 ─────────────

function evalMetric(node, env) {
  const iv = metric(env, node.m);
  const unit = unitOf(env, node.m);
  const r = compareInterval(iv, node, comparisonOps(node));
  return tv(r.v, r.deps, [`${labelOf(env, node.m)} ${fmtInterval(iv, unit)} (기준 ${fmtCondition(node, unit)})`]);
}

function sumArea(env, spec) {
  const selectors = normalizeFloors(spec.floors);
  const targets = spec.use || null;
  const sig = stableKey({ floors: spec.floors ?? 'all', use: targets });
  const desc = `${describeFloors(spec.floors, env.index)}${targets ? ` 중 ${describeUses(targets, env.index)}` : ''} 바닥면적 합계`;
  if (targets) {
    const a = numAnswer(env.answers[depKey('use_area', env.dong.id, undefined, sig)]);
    if (a !== null) return { iv: exact(a, [userDep('use_area', env, { sig })]), members: [], maybe: [], desc };
  }
  const sumDep = targets ? makeDep('use_area', UNKNOWN, { dong: env.dong.id, sig, info: { floors: spec.floors ?? 'all', use: targets } }) : null;
  const { floors, complete, listDeps, listOpen } = floorsOf(env);
  let lo = 0;
  let hi = 0;
  let loDeps = [];
  let hiDeps = listDeps;
  let open = [];
  const members = [];
  const maybe = [];
  let restHi = 0; // 대상 층이 아닌(또는 미확정인) 층 면적 상한 — 연면적에서 빼 하한을 좁힐 때 쓴다
  let restDeps = [];
  for (const f of floors) {
    const m = floorMember(env, f, selectors);
    if (m.v !== T) {
      const fa = floorArea(env, f);
      restHi += fa.hi;
      restDeps = mergeDeps(restDeps, m.deps, fa.hiDeps);
    }
    if (m.v === F) {
      hiDeps = mergeDeps(hiDeps, m.deps);
      continue;
    }
    const a = targets ? floorUseArea(env, f, targets, sumDep) : floorArea(env, f);
    if (m.v === T) {
      lo += a.lo;
      loDeps = mergeDeps(loDeps, m.deps, a.loDeps);
      if (a.hi > 0) members.push(f.key);
    } else {
      open = mergeDeps(open, m.deps);
      if (a.hi > 0) maybe.push(f.key);
    }
    hi += a.hi;
    hiDeps = mergeDeps(hiDeps, m.deps, a.hiDeps);
    open = mergeDeps(open, a.open);
  }
  const total = metric(env, 'total_area');
  if (!complete) {
    hi = Infinity;
    open = mergeDeps(open, listOpen);
  } else if (!targets && total.lo - restHi > lo) {
    // 층 목록이 완전하면 대상 층 면적 합계 ≥ 연면적 − 나머지 층 면적 상한 (연면적 = 각 층 바닥면적의 합)
    lo = Math.min(total.lo - restHi, hi);
    loDeps = mergeDeps(total.loDeps, restDeps, listDeps);
  }
  const iv = capInterval(interval(lo, hi, { loDeps, hiDeps, open }), total);
  if (sumDep) sumDep.range = [iv.lo, iv.hi];
  return { iv, members, maybe, desc };
}

function evalSumArea(node, env) {
  const { iv, members, maybe, desc } = sumArea(env, node.sum_area);
  const r = compareInterval(iv, node, comparisonOps(node));
  if (r.v === T && env.matched) members.forEach((k) => env.matched.add(k));
  if (r.v === U && env.maybeMatched) [...members, ...maybe].forEach((k) => env.maybeMatched.add(k));
  return tv(r.v, r.deps, [`${desc} ${fmtInterval(iv, '㎡')} (기준 ${fmtCondition(node, '㎡')})`]);
}

function evalFloorExists(node, env) {
  const spec = node.floor_exists;
  const selectors = normalizeFloors(spec.floors);
  const { floors, complete, listDeps, listOpen } = floorsOf(env);
  const sig = stableKey({ use: spec.use || null });
  const results = floors.map((f) => {
    const m = floorMember(env, f, selectors);
    if (m.v === F) return { f, r: m };
    let c = tv(T, [], [`${f.label}`]);
    if (spec.area) {
      const floorDep = spec.use ? makeDep('floor_use_area', UNKNOWN, { dong: env.dong.id, floor: f.key, sig, info: { floorLabel: f.label, use: spec.use } }) : null;
      const a = spec.use ? floorUseArea(env, f, spec.use, floorDep) : floorArea(env, f);
      if (floorDep) floorDep.range = [a.lo, a.hi];
      const r = compareInterval(a, spec.area, comparisonOps(spec.area));
      c = tv(r.v, r.deps, [`${f.label} ${spec.use ? `${describeUses(spec.use, env.index)} ` : ''}${fmtInterval(a, '㎡')}`]);
    } else if (spec.use) c = floorUsePresence(env, f, spec.use);
    return { f, r: all([m, c]) };
  });
  for (const { f, r } of results) {
    if (r.v === T && env.matched) env.matched.add(f.key);
    if (r.v === U && env.maybeMatched) env.maybeMatched.add(f.key);
  }
  const res = any(results.map((x) => x.r));
  const cond = spec.area ? ` 바닥면적 ${fmtCondition(spec.area, '㎡')}` : '';
  if (res.v !== F) return res;
  const none = `${describeFloors(spec.floors, env.index)}${cond}인 층 없음`;
  if (!complete) return tv(U, listOpen.length ? listOpen : listDeps, [`${none}(층수 미확인)`]);
  return tv(F, mergeDeps(res.deps, listDeps), [none]);
}

function evalUse(node, env) {
  const targets = node.use;
  const sig = stableKey({ use: targets, floors: node.floors ?? null });
  const a = boolAnswer(env.answers[depKey('use_presence', env.dong.id, undefined, sig)]);
  const name = describeUses(targets, env.index);
  if (a !== null) return tv(a ? T : F, [userDep('use_presence', env, { sig })], [`${name} 용도 ${a ? '있음' : '없음'}`]);
  const { floors } = floorsOf(env);
  let res;
  if (node.floors !== undefined) {
    const selectors = normalizeFloors(node.floors);
    res = any(floors.map((f) => all([floorMember(env, f, selectors), floorUsePresence(env, f, targets)])));
  } else if (floors.length) res = any(floors.map((f) => floorUsePresence(env, f, targets)));
  else {
    const c = coverage(env.dong.synthTerms, targets, env.index);
    res = tv(c === 'all' || c === 'some' ? T : c === 'none' ? F : U, [usesDep(env)]);
  }
  if (res.v === U && node.floors === undefined) {
    const dep = makeDep('use_presence', UNKNOWN, { dong: env.dong.id, sig, info: { use: targets } });
    return tv(U, [dep], [`${name} 용도 여부 미확인`]);
  }
  return tv(res.v, res.deps.length ? res.deps : [usesDep(env)], [`${name} 용도 ${res.v === T ? '있음' : res.v === F ? '없음' : '미확인'}`]);
}

function evalFlag(node, env) {
  const id = node.flag;
  const a = boolAnswer(env.answers[depKey(id, env.dong.id)]);
  const label = labelOf(env, id);
  if (a !== null) return tv(a ? T : F, [userDep(id, env)], [`${label}: ${a ? '예' : '아니오'}`]);
  const known = env.dong.flags?.[id];
  if (known) return tv(known.v, known.deps, known.why?.length ? known.why : [`${label}: ${known.v === T ? '예' : '아니오'}`]);
  return tv(U, [makeDep(id, UNKNOWN, { dong: env.dong.id })], [`${label} 미확인`]);
}

function evalInstalled(node, env) {
  const id = node.installed;
  const a = boolAnswer(env.answers[depKey('installed', env.dong.id, undefined, id)]);
  const name = env.names.get(id) ?? id;
  if (a !== null) return tv(a ? T : F, [userDep('installed', env, { sig: id })], [`${name} 설치 ${a ? '예' : '아니오'}`]);
  return tv(U, [makeDep('installed', UNKNOWN, { dong: env.dong.id, sig: id, info: { facility: id } })], [`${name} 설치 여부 미확인`]);
}

export function evalCondition(node, env) {
  switch (nodeType(node)) {
    case 'const':
      return tv(node.const ? T : F, [], [node.const ? '적용' : '비적용']);
    case 'all':
      return all(node.all.map((n) => evalCondition(n, env)));
    case 'any':
      return any(node.any.map((n) => evalCondition(n, env)));
    case 'not':
      return not(evalCondition(node.not, env));
    case 'm':
      return evalMetric(node, env);
    case 'sum_area':
      return evalSumArea(node, env);
    case 'floor_exists':
      return evalFloorExists(node, env);
    case 'use':
      return evalUse(node, env);
    case 'flag':
      return evalFlag(node, env);
    case 'installed':
      return evalInstalled(node, env);
    case 'facility':
      return env.facility(node.facility);
    default:
      // 검증기를 통과하지 못한 형식 — 비해당으로 흘리지 않도록 U
      return tv(U, [makeDep('invalid_condition', UNKNOWN, { dong: env.dong.id })], ['조건 형식 오류']);
  }
}

