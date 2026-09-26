// 3값 논리(T/F/U)와 출처(provenance), 구간 연산
//
// 값(tv): { v: 'T'|'F'|'U', deps: Dep[], why: string[] }
//   deps — 이 값을 결정한 입력들. 입력마다 상태를 가진다:
//     confirmed(건축물대장·사용자 답변) · assumed(정책 기본값·대체값) · unknown(값 없음 → 질문 대상)
//   why  — 사람이 읽는 근거 문장(사실 서술). 참/거짓 여부와 무관하게 관측값을 적는다.
//
// 결합 규칙(Kleene): all 은 F 하나로 F, any 는 T 하나로 T. 이때 근거는 "가장 확실한 증인" 하나만 남긴다.
// 그래서 확정 F 가 하나라도 있으면 all 의 F 는 확정이고, 가정값에 기대는 F 는 가정으로 드러난다.
//
// 구간(interval): { lo, hi, loDeps, hiDeps, open }
//   lo·hi 각각의 근거를 따로 들고 있어, 상한만으로 결론이 나면(예: 연면적 450㎡ 동의 조산원 600㎡ 이상 → F)
//   미확정 입력(open)을 묻지 않고도 확정 F 를 낼 수 있다.

export const T = 'T';
export const F = 'F';
export const U = 'U';

export const CONFIRMED = 'confirmed';
export const ASSUMED = 'assumed';
export const UNKNOWN = 'unknown';
const STATUS_RANK = Object.freeze({ confirmed: 0, assumed: 1, unknown: 2 });

// 질문·답변 키: input[sig]@동/층  (예: windowless@본동/2F, use_area[{...}]@101동, application_date)
export function depKey(input, dong, floor, sig) {
  return `${input}${sig ? `[${sig}]` : ''}${dong ? `@${dong}` : ''}${floor ? `/${floor}` : ''}`;
}

// 입력 의존 하나. info 는 질문 문장을 만들 때 쓰는 부가 정보(층 범위·용도·시설 등)
export function makeDep(input, status, { dong, floor, sig, info, range, source } = {}) {
  const dep = { key: depKey(input, dong, floor, sig), input, status };
  if (dong) dep.dong = dong;
  if (floor) dep.floor = floor;
  if (info) dep.info = info;
  if (range) dep.range = range;
  if (source) dep.source = source;
  return dep;
}

// 같은 키는 하나로 — 상태는 더 불확실한 쪽(unknown > assumed > confirmed)
export function mergeDeps(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const d of list || []) {
      const prev = byKey.get(d.key);
      if (!prev || STATUS_RANK[d.status] > STATUS_RANK[prev.status]) byKey.set(d.key, d);
    }
  }
  return [...byKey.values()];
}

export function tv(v, deps = [], why = []) {
  return { v, deps, why: Array.isArray(why) ? why : why ? [why] : [] };
}

export const hasAssumed = (x) => x.deps.some((d) => d.status === ASSUMED);
export const hasUnknown = (x) => x.deps.some((d) => d.status === UNKNOWN);

const uncertainty = (x) => x.deps.reduce((n, d) => n + STATUS_RANK[d.status], 0);

// 가장 확실한 증인: 불확실 점수가 낮고, 의존이 적은 값 (동점이면 앞의 것)
function witness(xs) {
  let best = xs[0];
  for (const x of xs.slice(1)) {
    const d = uncertainty(x) - uncertainty(best);
    if (d < 0 || (d === 0 && x.deps.length < best.deps.length)) best = x;
  }
  return best;
}

const joinWhy = (xs) => xs.flatMap((x) => x.why);

export function not(x) {
  return tv(x.v === T ? F : x.v === F ? T : U, x.deps, x.why);
}

export function all(xs) {
  if (!xs.length) return tv(T);
  const fs = xs.filter((x) => x.v === F);
  if (fs.length) {
    const w = witness(fs);
    return tv(F, w.deps, w.why);
  }
  const us = xs.filter((x) => x.v === U);
  if (us.length) return tv(U, mergeDeps(...us.map((x) => x.deps)), joinWhy(us));
  return tv(T, mergeDeps(...xs.map((x) => x.deps)), joinWhy(xs));
}

export function any(xs) {
  if (!xs.length) return tv(F);
  const ts = xs.filter((x) => x.v === T);
  if (ts.length) {
    const w = witness(ts);
    return tv(T, w.deps, w.why);
  }
  const us = xs.filter((x) => x.v === U);
  if (us.length) return tv(U, mergeDeps(...us.map((x) => x.deps)), joinWhy(us));
  return tv(F, mergeDeps(...xs.map((x) => x.deps)), joinWhy(xs));
}

// if c then a else b — c 가 U 라도 a·b 가 같은 확정값이면 그 값
export function ite(c, a, b) {
  if (c.v === T) return tv(a.v, mergeDeps(c.deps, a.deps), [...c.why, ...a.why]);
  if (c.v === F) return tv(b.v, mergeDeps(c.deps, b.deps), [...c.why, ...b.why]);
  if (a.v === b.v && a.v !== U) return tv(a.v, mergeDeps(a.deps, b.deps), [...a.why, ...b.why]);
  const us = [c, a, b].filter((x) => x.v === U);
  return tv(U, mergeDeps(...(us.length ? us : [c, a, b]).map((x) => x.deps)), joinWhy([c, a, b]));
}

// ───────────── 구간 ─────────────

export function interval(lo, hi, { loDeps = [], hiDeps = [], open = [] } = {}) {
  return { lo, hi, loDeps, hiDeps, open };
}

export function exact(value, deps = []) {
  return interval(value, value, { loDeps: deps, hiDeps: deps });
}

export const isExact = (iv) => iv.lo === iv.hi && !iv.open.length;

export function addInterval(a, b) {
  return interval(a.lo + b.lo, a.hi + b.hi, {
    loDeps: mergeDeps(a.loDeps, b.loDeps),
    hiDeps: mergeDeps(a.hiDeps, b.hiDeps),
    open: mergeDeps(a.open, b.open),
  });
}

// 상한을 cap 의 상한으로 제한 (예: 부분 합계 ≤ 동 연면적)
export function capInterval(iv, cap) {
  if (!(cap.hi < iv.hi)) return iv;
  return interval(Math.min(iv.lo, cap.hi), cap.hi, { loDeps: iv.loDeps, hiDeps: cap.hiDeps, open: iv.open });
}

function compareOne(iv, op, c) {
  switch (op) {
    case 'gte':
      if (iv.lo >= c) return tv(T, iv.loDeps);
      if (iv.hi < c) return tv(F, iv.hiDeps);
      break;
    case 'gt':
      if (iv.lo > c) return tv(T, iv.loDeps);
      if (iv.hi <= c) return tv(F, iv.hiDeps);
      break;
    case 'lte':
      if (iv.hi <= c) return tv(T, iv.hiDeps);
      if (iv.lo > c) return tv(F, iv.loDeps);
      break;
    case 'lt':
      if (iv.hi < c) return tv(T, iv.hiDeps);
      if (iv.lo >= c) return tv(F, iv.loDeps);
      break;
    case 'eq':
      if (iv.lo === c && iv.hi === c) return tv(T, mergeDeps(iv.loDeps, iv.hiDeps));
      if (iv.lo > c) return tv(F, iv.loDeps);
      if (iv.hi < c) return tv(F, iv.hiDeps);
      break;
    default:
      throw new Error(`알 수 없는 비교 연산자: ${op}`);
  }
  return tv(U, iv.open.length ? iv.open : mergeDeps(iv.loDeps, iv.hiDeps));
}

// 구간과 비교 조건 { gte: 300, lt: 600 } — 연산자가 여럿이면 모두 만족(all)
export function compareInterval(iv, cond, ops) {
  return all(ops.map((op) => compareOne(iv, op, cond[op])));
}
