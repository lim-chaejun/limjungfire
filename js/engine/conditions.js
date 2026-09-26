// 조건 트리 평가 — 노드 하나를 3값(출처 포함)으로
//
// env = { dong, index, answers, policy, inputDefs, facility(id) → tv, release, explain, matched, maybeMatched }
// 모든 불확실한 잎(leaf)은 질문 키를 가지며, answers[키]가 있으면 그 답을 확정값으로 쓴다.
// release=true 이면 가정값(정책 기본값·대체값)을 쓰지 않고 모름으로 푼다 — 비해당 확정 전의 재평가용(§5.4).
// explain=false 이면 근거 문장(why)을 만들지 않는다 — 질문 선별·재평가처럼 결과값만 필요한 반복 평가용.
// track=false 이면 출처(deps)도 만들지 않는다 — 3값의 값(T/F/U)은 출처와 무관하므로 값만 필요한 평가에서 생략한다.

import { comparisonOps, nodeType, normalizeFloors, selectorKinds, selectorsKey, stableKey } from './schema.js';
import {
  ASSUMED, CONFIRMED, F, T, U, UNKNOWN,
  addInterval, all, any, capInterval, compareInterval, depCollector, depKey, exact, interval, makeDep, mergeDeps, not, tv,
} from './logic.js';
import { coverage, describeUses } from './uses.js';
import { countOf, effectiveFloors } from './facts.js';
import { describeFloors, fmtCondition, fmtInterval } from './format.js';

const NO_WHY = Object.freeze([]);
const EMPTY = Object.freeze([]);

export function makeEnv({ dong, index, answers = {}, policy, inputDefs = new Map(), names = new Map(), facility, release = false, explain = true, track = true }) {
  return {
    dong,
    index,
    answers,
    policy,
    inputDefs,
    names,
    facility: facility || (() => tv(U, [], ['타 시설 판정을 알 수 없음'])),
    release,
    explain,
    track,
    cache: new Map(),
    // 층 단위 메모 — 층 객체(effectiveFloors 가 층수 조합별로 재사용)를 키로, 문자열을 만들지 않는다
    rawAreaMemo: new Map(),
    floorAreaMemo: new Map(),
    windowlessMemo: new Map(),
    memberMemo: new Map(),
    usePresenceMemo: new Map(),
    matched: null,
    maybeMatched: null,
  };
}

const labelOf = (env, id) => env.inputDefs.get(id)?.label ?? id;
const unitOf = (env, id) => env.inputDefs.get(id)?.unit ?? '';
const why = (env, make) => (env.explain ? make() : NO_WHY);
const D = (env, make) => (env.track ? make() : EMPTY);

function numAnswer(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
const boolAnswer = (v) => (v === true || v === false ? v : null);
const userDep = (input, env, extra = {}) => makeDep(input, CONFIRMED, { dong: env.dong.id, source: 'user', ...extra });
const confirmedOnly = (x) => x.deps.every((d) => d.status === CONFIRMED);

function memo(env, key, fn) {
  if (!env.cache.has(key)) env.cache.set(key, fn());
  return env.cache.get(key);
}

function memoOn(map, key, fn) {
  let v = map.get(key);
  if (v === undefined) map.set(key, (v = fn()));
  return v;
}

function memoIn(outer, groupKey, key, fn) {
  let inner = outer.get(groupKey);
  if (!inner) outer.set(groupKey, (inner = new Map()));
  return memoOn(inner, key, fn);
}

// 용도 목록의 내용 키 — 다른 시설의 같은 용도 조건끼리 층 계산을 공유하는 메모 키
const USES_KEY = new WeakMap();
function usesKey(targets) {
  let key = USES_KEY.get(targets);
  if (key === undefined) USES_KEY.set(targets, (key = targets.join(',')));
  return key;
}

// ───────────── 지표 ─────────────

const hasAssumedDep = (iv) => iv.loDeps.some((d) => d.status === ASSUMED) || iv.hiDeps.some((d) => d.status === ASSUMED);

// 가정값을 푼 지표: inputs.json 의 range(있을 수 있는 값) 전체
function releasedMetric(env, id) {
  const [lo, hi] = env.inputDefs.get(id)?.range ?? [0, Infinity];
  return interval(lo, hi, { open: D(env, () => [makeDep(id, UNKNOWN, { dong: env.dong.id, range: [lo, hi], released: true })]) });
}

// 정책을 반영하지 않은 원값 (답변 > 사실 > 모름). 재평가(release)에서는 가정값 사실을 모름으로
function rawMetric(env, id) {
  return memo(env, `raw:${id}`, () => {
    const a = numAnswer(env.answers[depKey(id, env.dong.id)]);
    if (a !== null) return exact(a, D(env, () => [userDep(id, env)]));
    const m = env.dong.metrics[id];
    if (m && env.release && hasAssumedDep(m)) return releasedMetric(env, id);
    return m || interval(0, Infinity, { open: D(env, () => [makeDep(id, UNKNOWN, { dong: env.dong.id })]) });
  });
}

export function metric(env, id) {
  return memo(env, `m:${id}`, () => {
    if (id === 'floors_incl_basement') {
      const a = numAnswer(env.answers[depKey(id, env.dong.id)]);
      if (a !== null) return exact(a, D(env, () => [userDep(id, env)]));
      return addInterval(rawMetric(env, 'ground_floors'), rawMetric(env, 'basement_floors'));
    }
    if (id === 'ground_floors' && env.policy.basementCountsInFloors) {
      return addInterval(rawMetric(env, 'ground_floors'), rawMetric(env, 'basement_floors'));
    }
    return rawMetric(env, id);
  });
}

// ───────────── 층 ─────────────

// 평가에 쓰는 층 목록과 구분(지하·지상·옥탑)별 완전성. 불완전한 구분의 층 조건은 F 가 아니라 U(층수 질문)
export function floorsOf(env) {
  return memo(env, 'floors', () => {
    const g = rawMetric(env, 'ground_floors');
    const b = rawMetric(env, 'basement_floors');
    const gc = countOf(g);
    const bc = countOf(b);
    const { floors, complete } = effectiveFloors(env.dong, gc, bc);
    const kinds = {
      ground: { complete: complete.ground, deps: mergeDeps(g.loDeps, g.hiDeps), open: g.open },
      basement: { complete: complete.basement, deps: mergeDeps(b.loDeps, b.hiDeps), open: b.open },
      rooftop: { complete: true, deps: EMPTY, open: EMPTY },
    };
    // exactCounts: 층수를 정확히 안다(층 목록 = 실제 층) — 면적 항등식은 이때만 세운다
    return { floors, kinds, allComplete: complete.ground && complete.basement, exactCounts: Number.isInteger(gc) && Number.isInteger(bc) };
  });
}

// 선택자가 고르는 구분들의 층 목록 정보: 완전한가, 목록 근거(층수 입력), 모르는 층수 입력
function listFor(env, selectors) {
  return memo(env, `list:${selectorsKey(selectors)}`, () => {
    const { kinds } = floorsOf(env);
    const ks = selectorKinds(selectors);
    return {
      complete: ks.every((k) => kinds[k].complete),
      deps: mergeDeps(...ks.map((k) => kinds[k].deps)),
      open: mergeDeps(...ks.filter((k) => !kinds[k].complete).map((k) => kinds[k].open)),
    };
  });
}

const AREA_EPS = 1e-6;

// 좁힌 구간의 미확정 근거: 값이 정해지면 없음, 아니면 질문 범위(range)를 좁힌 구간으로 (출처를 모으지 않는 평가에서는 그대로)
function narrowedOpen(env, open, lo, hi) {
  if (hi - lo <= AREA_EPS) return EMPTY;
  return env.track ? open.map((d) => (d.range ? { ...d, range: [lo, hi] } : d)) : open;
}

// 층 면적(항등식으로 좁히기 전): 층 면적 답변 > 부분 면적 합(부분 답변 반영), 동 연면적으로 상한
export function rawFloorArea(env, floor) {
  return memoOn(env.rawAreaMemo, floor, () => {
    const a = numAnswer(env.answers[depKey('floor_area', env.dong.id, floor.key)]);
    if (a !== null) return exact(a, D(env, () => [userDep('floor_area', env, { floor: floor.key })]));
    const sum = floor.parts.length === 1 ? floor.parts[0].area : floor.parts.map((_, i) => partAreaRaw(env, floor, i)).reduce(addInterval);
    return capInterval(sum, metric(env, 'total_area'));
  });
}

// 면적 항등식: 연면적 = 각 층 바닥면적의 합(옥탑은 0 ~ 그 층 면적). 층수를 정확히 알고(층 목록 = 실제 층) 연면적이
// 유한할 때만 세운다 — 층수가 구간(표제부↔층별개요 충돌)이면 세우지 않는다.
// 층 면적들과 모순이면(확정 층 면적 합이 연면적보다 작거나 큼 — 층별개요에 없는 면적 등) consistent=false 로 두고
// 이 항등식으로는 아무것도 좁히지 않는다. 어느 층에 있는지 모르는 면적을 특정 층에 몰아 주면 답을 받을수록
// 판정이 뒤집히기 때문이다(단조성 — 리뷰 N1). 모순 없는 답변은 모순을 만들지 않는다(질문 범위가 이 항등식으로 좁혀져 있음).
export function areaIdentity(env) {
  return memo(env, 'areaIdentity', () => {
    const { floors, allComplete, exactCounts } = floorsOf(env);
    const total = metric(env, 'total_area');
    if (!allComplete || !exactCounts || !floors.length || !Number.isFinite(total.hi)) return null;
    let lo = 0;
    let hi = 0;
    let roofHi = 0;
    const loC = depCollector();
    const hiC = depCollector();
    for (const f of floors) {
      const a = rawFloorArea(env, f);
      if (f.kind === 'rooftop') roofHi += a.hi;
      else {
        lo += a.lo;
        hi += a.hi;
      }
      if (env.track) {
        loC.add(a.loDeps);
        hiC.add(a.hiDeps);
      }
    }
    const consistent = lo <= total.hi + AREA_EPS && hi + roofHi >= total.lo - AREA_EPS;
    return { total, lo, hi, roofHi, consistent, loDeps: loC.list(), hiDeps: hiC.list() };
  });
}

// 층 면적: 항등식으로 좁힌 값 — 나머지 층 면적이 정해지면 이 층도 정해진다(예: 1층 600 + 지하1층 400, 연면적 1,200 → 2층 200)
export function floorArea(env, floor) {
  return memoOn(env.floorAreaMemo, floor, () => {
    const raw = rawFloorArea(env, floor);
    if (raw.lo === raw.hi || floor.kind === 'rooftop') return raw;
    const id = areaIdentity(env);
    if (!id || !id.consistent) return raw;
    const lo = Math.max(raw.lo, id.total.lo - (id.hi - raw.hi) - id.roofHi);
    let hi = Math.min(raw.hi, id.total.hi - (id.lo - raw.lo));
    if (lo <= raw.lo && hi >= raw.hi) return raw;
    if (hi - lo <= AREA_EPS) hi = lo;
    const listDeps = () => {
      const { kinds } = floorsOf(env);
      return mergeDeps(kinds.ground.deps, kinds.basement.deps);
    };
    return interval(lo, hi, {
      loDeps: lo > raw.lo ? D(env, () => mergeDeps(id.total.loDeps, id.hiDeps, listDeps())) : raw.loDeps,
      hiDeps: hi < raw.hi ? D(env, () => mergeDeps(id.total.hiDeps, id.loDeps, listDeps())) : raw.hiDeps,
      open: narrowedOpen(env, raw.open, lo, hi),
    });
  });
}

const partSig = (part, i) => String(part.n ?? i + 1);

// 부분 면적(답변만 반영, 층 면적에서 역산하지 않음)
function partAreaRaw(env, floor, i) {
  const part = floor.parts[i];
  const a = numAnswer(env.answers[depKey('part_area', env.dong.id, floor.key, partSig(part, i))]);
  if (a !== null) return exact(a, D(env, () => [userDep('part_area', env, { floor: floor.key, sig: partSig(part, i) })]));
  return part.area;
}

// 한 층의 부분 면적. 빈 부분 = 층 면적(답변·항등식으로 좁힌 값) − 나머지 부분 (다른 빈 부분이 있으면 구간)
function partArea(env, floor, i) {
  if (floor.parts.length === 1) return floorArea(env, floor);
  const own = partAreaRaw(env, floor, i);
  if (!own.open.length) return capInterval(own, metric(env, 'total_area'));
  const fl = floorArea(env, floor);
  let othersLo = 0;
  let othersHi = 0;
  const loC = depCollector();
  const hiC = depCollector();
  floor.parts.forEach((_, j) => {
    if (j === i) return;
    const o = partAreaRaw(env, floor, j);
    othersLo += o.lo;
    othersHi += o.hi;
    if (env.track) {
      loC.add(o.hiDeps);
      hiC.add(o.loDeps);
    }
  });
  const lo = Math.max(own.lo, fl.lo - othersHi);
  let hi = Math.min(own.hi, fl.hi - othersLo);
  if (lo <= own.lo && hi >= own.hi) return own;
  if (hi - lo <= AREA_EPS) hi = lo;
  return interval(lo, hi, {
    loDeps: lo > own.lo ? D(env, () => mergeDeps(fl.loDeps, loC.list())) : own.loDeps,
    hiDeps: hi < own.hi ? D(env, () => mergeDeps(fl.hiDeps, hiC.list())) : own.hiDeps,
    open: narrowedOpen(env, own.open, lo, hi),
  });
}

// 무창층은 지상층에만 있다(소방시설법 시행령 제2조제1호). 지하층·옥탑은 확정 F
function windowless(env, floor) {
  return memoOn(env.windowlessMemo, floor, () => {
    const a = boolAnswer(env.answers[depKey('windowless', env.dong.id, floor.key)]);
    if (a !== null) return tv(a ? T : F, D(env, () => [userDep('windowless', env, { floor: floor.key })]), why(env, () => [`${floor.label} 무창층 ${a ? '예' : '아니오'}`]));
    if (floor.kind !== 'ground') return tv(F);
    const area = floorArea(env, floor);
    const info = { floorLabel: floor.label, area: [area.lo, area.hi] };
    const assumeNone = env.policy.windowless === 'assume_none';
    if (assumeNone && !env.release) {
      return tv(F, D(env, () => [makeDep('windowless', ASSUMED, { dong: env.dong.id, floor: floor.key, info, source: 'policy' })]), why(env, () => [`${floor.label} 무창층 아님(가정)`]));
    }
    return tv(U, D(env, () => [makeDep('windowless', UNKNOWN, { dong: env.dong.id, floor: floor.key, info, released: assumeNone })]), why(env, () => [`${floor.label} 무창층 여부 미확인`]));
  });
}

const usesDep = (env, floor) => makeDep('uses', CONFIRMED, { dong: env.dong.id, floor: floor?.key, source: env.dong.source === 'manual' ? 'user' : 'registry' });

// 부분의 용도가 대상 용도를 덮는가. 표제부 용도를 빌려 온 부분(보충한 층, 용도가 비어 표제부 용도로 채운 행)은
// 표제부 용도가 여럿이면 그중 무엇이 이 층에 있는지 모르므로 '일부'(some)를 '모름'(maybe)으로 본다 — 확정 T 로 두면
// 부정 조건(not·excluded_if)에서 확정 비해당이 되고 이 층 답변도 읽지 않는다(리뷰 N2′).
function partCoverage(env, part, targets) {
  const c = coverage(part.terms, targets, env.index);
  return c === 'some' && part.fromTitle ? 'maybe' : c;
}

// 층에 대상 용도가 있는가 (층 부분의 용도 목록 기준)
function floorUsePresence(env, floor, targets) {
  return memoIn(env.usePresenceMemo, usesKey(targets), floor, () => {
    const cs = floor.parts.map((p) => partCoverage(env, p, targets));
    if (cs.some((c) => c === 'all' || c === 'some')) return tv(T, D(env, () => [usesDep(env, floor)]), why(env, () => [`${floor.label} ${describeUses(targets, env.index)} 용도 있음`]));
    if (cs.every((c) => c === 'none')) return tv(F, D(env, () => [usesDep(env, floor)]));
    const sig = stableKey({ use: targets });
    const a = boolAnswer(env.answers[depKey('use_presence', env.dong.id, floor.key, sig)]);
    if (a !== null) return tv(a ? T : F, D(env, () => [userDep('use_presence', env, { floor: floor.key, sig })]));
    const info = { floorLabel: floor.label, use: targets };
    return tv(U, D(env, () => [makeDep('use_presence', UNKNOWN, { dong: env.dong.id, floor: floor.key, sig, info })]), why(env, () => [
      `${floor.label} ${describeUses(targets, env.index)} 용도 여부 미확인`,
    ]));
  });
}

function cmp(x, op, c) {
  return op === 'gte' ? x >= c : op === 'gt' ? x > c : op === 'lte' ? x <= c : op === 'lt' ? x < c : x === c;
}

function selectorMatch(env, floor, s) {
  const parts = [];
  if (s.kind !== undefined) parts.push(tv([].concat(s.kind).includes(floor.kind) ? T : F));
  if (s.level !== undefined) parts.push(tv(comparisonOps(s.level).every((op) => cmp(floor.level, op, s.level[op])) ? T : F));
  if (s.windowless) parts.push(windowless(env, floor));
  if (s.use) parts.push(floorUsePresence(env, floor, s.use));
  return all(parts);
}

export function floorMember(env, floor, selectors) {
  return memoIn(env.memberMemo, selectorsKey(selectors), floor, () => any(selectors.map((s) => selectorMatch(env, floor, s))));
}

// 층 하나에서 대상 용도의 면적. 용도가 섞였거나 미상인 부분은 [0, 부분 면적] + openDep
function floorUseArea(env, floor, targets, openDep) {
  let sum = exact(0);
  floor.parts.forEach((part, i) => {
    const a = partArea(env, floor, i);
    const c = partCoverage(env, part, targets);
    const ud = D(env, () => [usesDep(env, floor)]);
    if (c === 'all') sum = addInterval(sum, { ...a, loDeps: mergeDeps(a.loDeps, ud), hiDeps: mergeDeps(a.hiDeps, ud) });
    else if (c === 'none') sum = addInterval(sum, exact(0, ud));
    else sum = addInterval(sum, interval(0, a.hi, { hiDeps: a.hiDeps, open: env.track ? mergeDeps(a.open, [openDep]) : EMPTY }));
  });
  return sum;
}

// ───────────── 노드별 평가 ─────────────

function evalMetric(node, env) {
  const iv = metric(env, node.m);
  const r = compareInterval(iv, node, comparisonOps(node));
  return tv(r.v, r.deps, why(env, () => {
    const unit = unitOf(env, node.m);
    return [`${labelOf(env, node.m)} ${fmtInterval(iv, unit)} (기준 ${fmtCondition(node, unit)})`];
  }));
}

const SUM_SIGS = new WeakMap();
function sumSig(spec) {
  if (!SUM_SIGS.has(spec)) SUM_SIGS.set(spec, stableKey({ floors: spec.floors ?? 'all', use: spec.use || null }));
  return SUM_SIGS.get(spec);
}

function sumArea(env, spec) {
  const selectors = normalizeFloors(spec.floors);
  const targets = spec.use || null;
  const sig = sumSig(spec);
  const desc = () => `${describeFloors(spec.floors, env.index)}${targets ? ` 중 ${describeUses(targets, env.index)}` : ''} 바닥면적 합계`;
  if (targets) {
    const a = numAnswer(env.answers[depKey('use_area', env.dong.id, undefined, sig)]);
    if (a !== null) return { iv: exact(a, D(env, () => [userDep('use_area', env, { sig })])), members: [], maybe: [], desc };
  }
  const sumDep = targets && env.track ? makeDep('use_area', UNKNOWN, { dong: env.dong.id, sig, info: { floors: spec.floors ?? 'all', use: targets } }) : null;
  const { floors, allComplete } = floorsOf(env);
  const list = listFor(env, selectors);
  let lo = 0;
  let hi = 0;
  const loC = depCollector();
  const hiC = depCollector();
  const openC = depCollector();
  const restC = depCollector();
  const track = env.track;
  if (track) hiC.add(list.deps);
  const members = [];
  const maybe = [];
  let restHi = 0; // 대상 층이 아닌(또는 미확정인) 층 면적 상한 — 연면적에서 빼 하한을 좁힐 때 쓴다
  for (const f of floors) {
    const m = floorMember(env, f, selectors);
    if (m.v !== T) {
      const fa = floorArea(env, f);
      restHi += fa.hi;
      if (track) {
        restC.add(m.deps);
        restC.add(fa.hiDeps);
      }
    }
    if (m.v === F) {
      if (track) hiC.add(m.deps);
      continue;
    }
    const a = targets ? floorUseArea(env, f, targets, sumDep) : floorArea(env, f);
    if (m.v === T) {
      lo += a.lo;
      if (track) {
        loC.add(m.deps);
        loC.add(a.loDeps);
      }
      if (a.hi > 0) members.push(f.key);
    } else {
      if (track) openC.add(m.deps);
      if (a.hi > 0) maybe.push(f.key);
    }
    hi += a.hi;
    if (track) {
      hiC.add(m.deps);
      hiC.add(a.hiDeps);
      openC.add(a.open);
    }
  }
  const total = metric(env, 'total_area');
  let loDeps = loC.list();
  if (!list.complete) {
    hi = Infinity;
    if (track) openC.add(list.open);
  } else if (!targets && allComplete && total.lo - restHi > lo && areaIdentity(env)?.consistent) {
    // 면적 항등식이 성립하면(층 목록 완전, 층 면적과 연면적이 모순 없음) 대상 층 면적 합계 ≥ 연면적 − 나머지 층 면적 상한.
    // 모순이면 쓰지 않는다 — 층별개요에 없는 면적을 대상 층에 몰아 주는 셈이라 답에 따라 뒤집힌다(리뷰 N1)
    lo = Math.min(total.lo - restHi, hi);
    loDeps = track ? mergeDeps(total.loDeps, restC.list(), list.deps) : EMPTY;
  }
  const iv = capInterval(interval(lo, hi, { loDeps, hiDeps: hiC.list(), open: openC.list() }), total);
  if (sumDep) sumDep.range = [iv.lo, iv.hi];
  return { iv, members, maybe, desc };
}

function evalSumArea(node, env) {
  const { iv, members, maybe, desc } = sumArea(env, node.sum_area);
  const r = compareInterval(iv, node, comparisonOps(node));
  if (r.v === T && env.matched) members.forEach((k) => env.matched.add(k));
  if (r.v === U && env.maybeMatched) [...members, ...maybe].forEach((k) => env.maybeMatched.add(k));
  return tv(r.v, r.deps, why(env, () => [`${desc()} ${fmtInterval(iv, '㎡')} (기준 ${fmtCondition(node, '㎡')})`]));
}

function evalFloorExists(node, env) {
  const spec = node.floor_exists;
  const selectors = normalizeFloors(spec.floors);
  const { floors } = floorsOf(env);
  const list = listFor(env, selectors);
  const results = floors.map((f) => {
    const m = floorMember(env, f, selectors);
    // 확정 F(층 구분이 다름 등)는 바로, 가정·미확인 F 는 면적도 보고 더 확실한 근거를 남긴다
    if (m.v === F && confirmedOnly(m)) return { f, r: m };
    let c = tv(T, EMPTY, why(env, () => [`${f.label}`]));
    if (spec.area) {
      const floorDep = spec.use && env.track
        ? makeDep('floor_use_area', UNKNOWN, { dong: env.dong.id, floor: f.key, sig: stableKey({ use: spec.use }), info: { floorLabel: f.label, use: spec.use } })
        : null;
      const a = spec.use ? floorUseArea(env, f, spec.use, floorDep) : floorArea(env, f);
      if (floorDep) floorDep.range = [a.lo, a.hi];
      const r = compareInterval(a, spec.area, comparisonOps(spec.area));
      c = tv(r.v, r.deps, why(env, () => [`${f.label} ${spec.use ? `${describeUses(spec.use, env.index)} ` : ''}${fmtInterval(a, '㎡')}`]));
    } else if (spec.use) c = floorUsePresence(env, f, spec.use);
    return { f, r: all([m, c]) };
  });
  for (const { f, r } of results) {
    if (r.v === T && env.matched) env.matched.add(f.key);
    if (r.v === U && env.maybeMatched) env.maybeMatched.add(f.key);
  }
  const res = any(results.map((x) => x.r));
  if (res.v !== F) return res;
  const none = () => `${describeFloors(spec.floors, env.index)}${spec.area ? ` 바닥면적 ${fmtCondition(spec.area, '㎡')}` : ''}인 층 없음`;
  if (!list.complete) return tv(U, list.open.length ? list.open : list.deps, why(env, () => [`${none()}(층수 미확인)`]));
  return tv(F, mergeDeps(res.deps, list.deps), why(env, () => [none()]));
}

function evalUse(node, env) {
  const targets = node.use;
  const sig = stableKey({ use: targets, floors: node.floors ?? null });
  const a = boolAnswer(env.answers[depKey('use_presence', env.dong.id, undefined, sig)]);
  const name = () => describeUses(targets, env.index);
  if (a !== null) return tv(a ? T : F, D(env, () => [userDep('use_presence', env, { sig })]), why(env, () => [`${name()} 용도 ${a ? '있음' : '없음'}`]));
  const { floors, allComplete, kinds } = floorsOf(env);
  if (node.floors !== undefined) {
    // 선택한 층에서만: 층 목록이 불완전하면(층수를 모르면) 빠진 층에 있을 수 있으므로 F 가 아니라 U
    const selectors = normalizeFloors(node.floors);
    const list = listFor(env, selectors);
    const res = any(floors.map((f) => all([floorMember(env, f, selectors), floorUsePresence(env, f, targets)])));
    if (res.v !== F) return tv(res.v, res.deps, why(env, () => [`${describeFloors(node.floors, env.index)} ${name()} 용도 ${res.v === T ? '있음' : '미확인'}`]));
    if (!list.complete) return tv(U, list.open.length ? list.open : list.deps, why(env, () => [`${describeFloors(node.floors, env.index)} ${name()} 용도 — 층수 미확인`]));
    return tv(F, mergeDeps(res.deps, list.deps), why(env, () => [`${describeFloors(node.floors, env.index)} ${name()} 용도 없음`]));
  }
  // 동 전체: 층별 용도 + 층 목록이 불완전하면 빠진 층의 몫. 빠진 층은 표제부 용도 가운데 무엇을 가졌는지 모르므로
  // 표제부에 대상 용도가 없을 때만 F, 있으면(확정 T 가 아니라) U — 층수를 답해 층이 채워지면 그 층들로 판정한다(리뷰 N2)
  const results = floors.map((f) => floorUsePresence(env, f, targets));
  if (!allComplete || !floors.length) {
    const c = coverage(env.dong.synthTerms, targets, env.index);
    results.push(tv(c === 'none' ? F : U, D(env, () => [usesDep(env)])));
  }
  const res = any(results);
  if (res.v === U) {
    return tv(U, D(env, () => [makeDep('use_presence', UNKNOWN, { dong: env.dong.id, sig, info: { use: targets } })]), why(env, () => [`${name()} 용도 여부 미확인`]));
  }
  const deps = res.v === F && env.track ? mergeDeps(res.deps.length ? res.deps : [usesDep(env)], kinds.ground.deps, kinds.basement.deps) : res.deps;
  return tv(res.v, deps, why(env, () => [`${name()} 용도 ${res.v === T ? '있음' : '없음'}`]));
}

function evalFlag(node, env) {
  const id = node.flag;
  const a = boolAnswer(env.answers[depKey(id, env.dong.id)]);
  const label = () => labelOf(env, id);
  if (a !== null) return tv(a ? T : F, D(env, () => [userDep(id, env)]), why(env, () => [`${label()}: ${a ? '예' : '아니오'}`]));
  const known = env.dong.flags?.[id];
  if (known) return tv(known.v, known.deps, why(env, () => (known.why?.length ? known.why : [`${label()}: ${known.v === T ? '예' : '아니오'}`])));
  return tv(U, D(env, () => [makeDep(id, UNKNOWN, { dong: env.dong.id })]), why(env, () => [`${label()} 미확인`]));
}

function evalInstalled(node, env) {
  const id = node.installed;
  const a = boolAnswer(env.answers[depKey('installed', env.dong.id, undefined, id)]);
  const name = () => env.names.get(id) ?? id;
  if (a !== null) return tv(a ? T : F, D(env, () => [userDep('installed', env, { sig: id })]), why(env, () => [`${name()} 설치 ${a ? '예' : '아니오'}`]));
  return tv(U, D(env, () => [makeDep('installed', UNKNOWN, { dong: env.dong.id, sig: id, info: { facility: id } })]), why(env, () => [`${name()} 설치 여부 미확인`]));
}

export function evalCondition(node, env) {
  switch (nodeType(node)) {
    case 'const':
      return tv(node.const ? T : F, EMPTY, why(env, () => [node.const ? '적용' : '비적용']));
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
      return tv(U, D(env, () => [makeDep('invalid_condition', UNKNOWN, { dong: env.dong.id })]), why(env, () => ['조건 형식 오류']));
  }
}
