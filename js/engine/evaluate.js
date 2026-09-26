// 판정 평가기 — 행 → 시설(파일별, 동 안에서 결합) → 확정 판정(해당 / 확인 필요 / 비해당)
//
// 한 번의 "패스(pass)"는 (기준일, 답변, 가정값 사용 여부) 하나에 대한 평가다. 시설 간 의존(facility 노드)은 같은 패스
// 안에서 재귀·메모로 풀고, 패스는 동 안의 모든 시설이 공유한다.
//
// 판정 절차(judge)
//   1. 기준일 구간(개정 경계 검사 구간)의 각 시기(epoch)마다 보통 평가(가정값 사용)
//      모두 T → 해당 / 시기마다 다르거나 U 가 있으면 → 확인 필요
//   2. 모두 F 이면, 가정값을 모두 풀어(무창층·수동 입력 지하층·복합건축물 가정 → 모름) 각 시기마다 다시 평가
//      모두 F → 비해당 / 하나라도 F 가 아니면 → 확인 필요
//   이 재평가가 건전하려면 평가 전체가 단조여야 한다 — 어떤 입력을 모름에서 값으로 좁혀도 이미 확정된 T·F 는 바뀌지 않아야 한다.
//   Kleene 논리·구간 비교는 그 자체로 단조이고, 사실에서 값을 추론하는 단계는 conditions.js 에서 모름을 확정값으로 바꾸지 않게 제한한다
//   (면적 항등식은 모순 없을 때만, 층 목록이 불완전할 때 표제부 용도는 모름, 보충한 층에 표제부 용도가 여럿이면 모름).
//   그러면 푼 평가에서도 F 인 비해당은 어떤 가정값·시기 조합에서도 F 다 — property.test.mjs(끝값·무작위 답변 조합)와
//   monotonicity.test.mjs(무작위 건물·기준에서 묻는 질문에 답해 가는 산책)가 확인한다.
// 질문 선별: 확인 필요일 때 확정이 아닌 입력마다 시험값을 넣어 판정이 바뀌는지 본다(한 입력으로 바뀌면 결정적).
//   결정적 입력이 하나도 없으면 관련 입력을 모두 함께 묻는다(jointQuestions). 시험 예산을 다 쓰면 그때까지 찾은 결정적 입력을,
//   하나도 못 찾았으면 역시 모두 함께 묻는다. 물을 질문은 날짜 → 대지 → 동 → 층 순으로 늘어놓고, 건물 단위(limitQuestions)에서
//   면적 항등식으로 묶인 질문(층·부분 면적, 연면적, 층수)은 동마다 한 번에 하나만, 시설마다 QUESTION_LIMIT 개까지만 내보낸다
//   (나머지는 moreQuestions 수로 — 답을 받으면 다시 골라 다음 질문이 나온다).

import { SCHEMA_VERSION, normalizeFloors, normalizeScope, numericConstants, referencedFacilities, rowConditionRoots, stableKey } from './schema.js';
import { ASSUMED, CONFIRMED, F, T, U, UNKNOWN, all, any, depKey, ite, makeDep, not, tv } from './logic.js';
import { addDays, formatYmd, resolveDateInfo, rowValidAt } from './dates.js';
import { areaIdentity, evalCondition, floorMember, floorsOf, makeEnv, metric, uncappedFloorArea } from './conditions.js';
import { DATE_INPUTS, buildQuestion, constantsFor, extremeValues, testValues } from './questions.js';
import { fmtNum } from './format.js';

export const VERDICT = Object.freeze({ T: '해당', U: '확인 필요', F: '비해당' });

// 시설 하나의 질문 선별에 쓰는 시설 평가 횟수 상한. 넘으면 선별을 멈추고 관련 입력을 모두 함께 묻는다.
export const DECISIVE_TEST_BUDGET = 400;

// 시설 하나가 한 번에 내보내는 질문 수 상한. 넘는 것은 moreQuestions 수로만 알린다.
export const QUESTION_LIMIT = 5;

// 질문 순서: 날짜(허가일·신청일) → 대지 단위 → 동 단위(층수·연면적·플래그·용도 합계 등) → 층 단위(층 순서대로).
// 날짜·동 단위 답 하나가 여러 층 질문을 한꺼번에 없애는 경우가 많다.
function orderQuestions(questions, floorOrder) {
  const rank = (q) => (DATE_INPUTS.has(q.input) ? 0 : !q.dong ? 1 : !q.floor ? 2 : 3);
  return questions
    .map((q, i) => ({ q, i, r: rank(q), f: q.floor ? floorOrder.get(q.floor) ?? 999 : -1 }))
    .sort((a, b) => a.r - b.r || a.f - b.f || a.i - b.i)
    .map((x) => x.q);
}

// ───────────── 행 ─────────────

const NO_WHY = Object.freeze([]);
const NO_DEPS = Object.freeze([]);
const whyOf = (env, make) => (env.explain ? make() : NO_WHY);
const depsOf = (env, make) => (env.track ? make() : NO_DEPS);

function reviewValue(sig, env, criteria, question, unresolved = '조건 구조화 전 — 기준 원문 확인 필요') {
  const a = env.answers[depKey('review', env.dong.id, undefined, sig)];
  if (a === true || a === false) {
    return tv(a ? T : F, depsOf(env, () => [makeDep('review', CONFIRMED, { dong: env.dong.id, sig, source: 'user' })]), whyOf(env, () => [`기준 해당 여부 답변: ${a ? '예' : '아니오'}`]));
  }
  return tv(U, depsOf(env, () => [makeDep('review', UNKNOWN, { dong: env.dong.id, sig, info: { criteria, question } })]), whyOf(env, () => [unresolved]));
}

// 분기: 앞에서부터 when 이 맞는 첫 분기. when 이 U 여도 양쪽 결과가 같으면 확정 (ite)
function evalBranches(branches, env, i = 0) {
  if (i >= branches.length) return { value: tv(F, [], whyOf(env, () => ['해당 분기 없음'])), scope: null, matched: [], maybe: [] };
  const b = branches[i];
  env.matched = new Set();
  env.maybeMatched = new Set();
  const body = evalCondition(b.conditions, env);
  const mine = { matched: [...env.matched], maybe: [...env.maybeMatched] };
  if (b.when === undefined) return { value: body, scope: b.scope, ...mine };
  const w = evalCondition(b.when, env);
  const rest = evalBranches(branches, env, i + 1);
  const value = ite(w, body, rest.value);
  if (w.v === T) return { value, scope: b.scope, ...mine };
  if (w.v === F) return { value, scope: rest.scope, matched: rest.matched, maybe: rest.maybe };
  return { value, scope: b.scope ?? rest.scope, matched: [...mine.matched, ...rest.matched], maybe: [...mine.maybe, ...rest.maybe] };
}

function resolveScope(scope, env, matched, maybe) {
  if (!scope) return null;
  const { floors } = floorsOf(env);
  switch (scope.type) {
    case 'all_floors':
      return { type: 'all_floors', floors: floors.filter((f) => f.kind !== 'rooftop').map((f) => f.key), maybe: [] };
    case 'floors': {
      const sels = normalizeFloors(scope.floors) || [];
      const out = { type: 'floors', floors: [], maybe: [] };
      for (const f of floors) {
        const m = floorMember(env, f, sels);
        if (m.v === T) out.floors.push(f.key);
        else if (m.v === U) out.maybe.push(f.key);
      }
      if (scope.label) out.label = scope.label;
      return out;
    }
    case 'matching_floors':
      return { type: 'floors', floors: [...new Set(matched)], maybe: [...new Set(maybe)].filter((k) => !matched.includes(k)) };
    case 'part':
      return { type: 'part', parts: [scope.label || '해당 부분'] };
    default:
      return { type: 'inherit' };
  }
}

export function evaluateRow(row, env) {
  const kind = row.kind || 'trigger';
  let value;
  let scopeSpec = row.scope;
  let matched = [];
  let maybe = [];
  if (Array.isArray(row.branches) && row.branches.length) {
    const b = evalBranches(row.branches, env);
    value = row.conditions !== undefined ? all([evalCondition(row.conditions, env), b.value]) : b.value;
    scopeSpec = b.scope ?? row.scope;
    ({ matched, maybe } = b);
  } else if (row.conditions !== undefined) {
    env.matched = new Set();
    env.maybeMatched = new Set();
    value = evalCondition(row.conditions, env);
    matched = [...env.matched];
    maybe = [...env.maybeMatched];
  } else if (kind === 'trigger') {
    value = reviewValue(row.id ?? stableKey(row.criteria ?? ''), env, row.criteria ?? '', row.needs_review?.question);
  } else value = tv(T, [], whyOf(env, () => ['조건 없음(항상 적용)']));
  const scope = !env.explain || value.v === F ? null : resolveScope(normalizeScope(scopeSpec ?? (kind === 'modifier' ? 'inherit' : 'all_floors')), env, matched, maybe);
  // 행 단위 질문 후보(확정이 아닌 입력)와 근거 — 결정적 질문 선별은 시설 단위(finalizeFacility)에서 한다
  const questions = [...new Set(value.deps.filter((d) => d.status !== CONFIRMED).map((d) => d.key))];
  return { id: row.id ?? null, kind, row, value, scope, questions, reasons: value.why };
}

// ───────────── 행 선택 ─────────────

// 기준일에 유효한 행 + 소급 행(retroactive: 기준일 이후 시작했지만 기존 건물에도 적용)
// + 제13조 강화기준 소급 시설(파일 strengthened_retroactive)은 오늘 유효한 행도
function selectRows(def, date, dctx) {
  const strengthened = dctx.policy.strengthenedRetroactive !== 'off' && (def.file.strengthened_retroactive || []).includes(def.facility.facility_id);
  const out = [];
  for (const row of def.facility.regulations || []) {
    if (rowValidAt(row, date)) out.push({ row, basis: 'ref' });
    else if (row.retroactive && row.start_date && date < row.start_date && rowValidAt(row, dctx.today)) out.push({ row, basis: 'retroactive' });
    else if (strengthened && rowValidAt(row, dctx.today)) out.push({ row, basis: 'strengthened' });
  }
  return out;
}

const counts = (r, policy) => r.kind === 'trigger' && !(r.basis === 'strengthened' && policy.strengthenedRetroactive === 'badge');
const hasTrigger = (facility) => (facility.regulations || []).some((r) => (r.kind || 'trigger') === 'trigger');

// ───────────── 패스 ─────────────

function mixedUseValue(env, dctx) {
  const a = env.answers[depKey('mixed_use', env.dong.id)];
  if (a === true || a === false) {
    return tv(a ? T : F, depsOf(env, () => [makeDep('mixed_use', CONFIRMED, { dong: env.dong.id, source: 'user' })]), whyOf(env, () => [`복합건축물 ${a ? '해당' : '아님'}(답변)`]));
  }
  const info = { groups: env.dong.fileGroups };
  if (!dctx.policy.mixedUseRequiresConfirmation && !env.release) {
    return tv(T, depsOf(env, () => [makeDep('mixed_use', ASSUMED, { dong: env.dong.id, info, source: 'policy' })]), whyOf(env, () => ['복합건축물로 가정']));
  }
  const released = !dctx.policy.mixedUseRequiresConfirmation;
  return tv(U, depsOf(env, () => [makeDep('mixed_use', UNKNOWN, { dong: env.dong.id, info, released })]), whyOf(env, () => ['복합건축물 해당 여부 미확인']));
}

function fileFacility(def, pass) {
  const { env, dctx } = pass;
  const rows = selectRows(def, pass.date, dctx).map(({ row, basis }) => ({ ...evaluateRow(row, env), basis, typeCode: def.typeCode }));
  const counted = rows.filter((r) => counts(r, dctx.policy));
  let base;
  if (counted.length) base = any(counted.map((r) => r.value));
  else if (!hasTrigger(def.facility)) {
    // 판정 행(trigger)이 전혀 없는 시설(안내·범위 행만) — 조용히 비해당으로 두지 않고 원문 확인을 묻는다
    const name = def.facility.facility_name ?? def.facility.facility_id;
    base = reviewValue(`facility:${def.facility.facility_id}`, env, `${name} 설치 기준(구조화된 판정 행 없음)`, `${env.dong.id}이(가) ${name} 설치 대상입니까? (구조화된 판정 기준이 없어 원문 확인 필요)`);
  } else base = tv(F, [], whyOf(env, () => [`${formatYmd(pass.date)} 기준 유효한 설치 기준 없음`]));
  let excluded = null;
  if (def.facility.excluded_if !== undefined) {
    excluded = evalCondition(def.facility.excluded_if, env);
    base = all([base, not(excluded)]);
  }
  const value = def.gate === 'mixed_use' ? all([mixedUseValue(env, dctx), base]) : base;
  return { def, rows, base, excluded, value };
}

function facilityCore(fid, pass) {
  if (pass.memo.has(fid)) return pass.memo.get(fid);
  const name = pass.dctx.names.get(fid) ?? fid;
  if (pass.visiting.has(fid)) {
    // 시설 기준이 서로를 참조(순환 — 검증기는 FACILITY_CYCLE·FACILITY_CROSS_FILE_CYCLE 오류) — 자동으로 판정할 수 없으므로
    // 이 시설의 설치 대상 여부를 원문 확인 질문(review[facility:id])으로 받아 순환을 끊는다(답하면 순환이 풀린다)
    const dongId = pass.dctx.dong.id;
    return {
      fid,
      perFile: [],
      tv: reviewValue(
        `facility:${fid}`,
        pass.env,
        `${name} 설치 기준(다른 시설 판정과 서로 참조)`,
        `${dongId}이(가) ${name} 설치 대상입니까? (설치 기준이 다른 시설의 판정과 서로를 참조해 자동으로 판정할 수 없어 원문 확인 필요)`,
        `${name} 설치 기준이 다른 시설 판정과 서로 참조(순환) — 원문 확인 필요`,
      ),
    };
  }
  pass.visiting.add(fid);
  if (pass.budget) pass.budget.count++;
  const perFile = (pass.dctx.defs.get(fid) || []).map((def) => fileFacility(def, pass));
  const value = perFile.length ? any(perFile.map((r) => r.value)) : tv(F, [], [`${name} 기준 없음`]);
  pass.visiting.delete(fid);
  const core = { fid, perFile, tv: value };
  pass.memo.set(fid, core);
  return core;
}

function makePass(dctx, date, answers, { release = false, explain = false, track = explain } = {}) {
  const pass = { dctx, date, answers, memo: new Map(), visiting: new Set(), budget: null };
  pass.env = makeEnv({
    dong: dctx.dong,
    index: dctx.index,
    answers,
    policy: dctx.policy,
    inputDefs: dctx.inputDefs,
    names: dctx.names,
    release,
    explain,
    track,
    facility: (id) => {
      const core = facilityCore(id, pass);
      return tv(core.tv.v, core.tv.deps, whyOf(pass.env, () => [`${dctx.names.get(id) ?? id} ${VERDICT[core.tv.v]}`]));
    },
  });
  return pass;
}

// 패스는 (기준일, 가정값 사용 여부, 답변 변경)으로 동 전체에서 공유 — 시설마다 같은 질문 시험을 하므로 층 계산을 재사용한다
function getPass(dctx, date, release, answers, overrideKey) {
  const key = `${date}|${release ? 1 : 0}|${overrideKey}`;
  let pass = dctx.passes.get(key);
  if (!pass) {
    // 기본 답변 패스만 근거 문장·출처를 만든다(판정 설명·질문 후보용). 질문 시험 패스는 값(T/F/U)만 필요하다
    pass = makePass(dctx, date, answers, { release, explain: overrideKey === '', track: overrideKey === '' });
    dctx.passes.set(key, pass);
  }
  return pass;
}

function coreAt(fid, dctx, date, release, answers, overrideKey, budget) {
  const pass = getPass(dctx, date, release, answers, overrideKey);
  pass.budget = budget;
  const core = facilityCore(fid, pass);
  pass.budget = null;
  return core;
}

function dateInfoFor(dctx, answers) {
  const key = `${answers.application_date ?? ''}|${answers.permit_date ?? ''}`;
  if (!dctx.dateCache.has(key)) dctx.dateCache.set(key, resolveDateInfo(dctx.dates, answers, dctx.policy, dctx.today));
  return dctx.dateCache.get(key);
}

// ───────────── 개정 경계 ─────────────

function facilityClosure(fid, dctx, seen = new Set()) {
  if (seen.has(fid)) return seen;
  seen.add(fid);
  for (const def of dctx.defs.get(fid) || []) {
    const refs = new Set();
    for (const row of def.facility.regulations || []) for (const [node] of rowConditionRoots(row)) referencedFacilities(node, refs);
    if (def.facility.excluded_if !== undefined) referencedFacilities(def.facility.excluded_if, refs);
    for (const r of refs) facilityClosure(r, dctx, seen);
  }
  return seen;
}

// 구간 안의 시기 시작일: 구간 시작 + 시설(과 의존 시설) 행의 시작일·종료 다음 날
function epochDates(fid, dctx, di) {
  if (!di.window) return [di.refDate];
  const key = `${fid}|${di.window.from}|${di.window.to}`;
  if (dctx.epochCache.has(key)) return dctx.epochCache.get(key);
  const pts = new Set();
  for (const id of facilityClosure(fid, dctx)) {
    for (const def of dctx.defs.get(id) || []) {
      for (const row of def.facility.regulations || []) {
        for (const p of [row.start_date, row.end_date ? addDays(row.end_date, 1) : null]) if (p && di.window.from < p && p <= di.window.to) pts.add(p);
      }
    }
  }
  const dates = [di.window.from, ...[...pts].sort()];
  dctx.epochCache.set(key, dates);
  return dates;
}

// ───────────── 판정 ─────────────

// 답변(answers) 아래 시설 판정값. full=false 면 결과값만(결정되는 즉시 멈춤)
function judge(fid, dctx, answers, overrideKey, budget, full) {
  const di = dateInfoFor(dctx, answers);
  const dates = epochDates(fid, dctx, di);
  const normal = [];
  for (const date of dates) {
    const c = coreAt(fid, dctx, date, false, answers, overrideKey, budget);
    normal.push({ date, tv: c.tv });
    if (!full && (c.tv.v === U || c.tv.v !== normal[0].tv.v)) return { v: U };
  }
  const nv = normal.map((n) => n.tv.v);
  if (nv.every((v) => v === T)) return { v: T, di, dates, normal, released: null };
  if (!nv.every((v) => v === F)) return { v: U, di, dates, normal, released: null };
  const released = [];
  for (const date of dates) {
    const c = coreAt(fid, dctx, date, true, answers, overrideKey, budget);
    released.push({ date, tv: c.tv });
    if (!full && c.tv.v !== F) return { v: U };
  }
  return { v: released.every((r) => r.tv.v === F) ? F : U, di, dates, normal, released };
}

const distinct = (list) => new Set(list.map((x) => x.tv.v)).size;

function facilityConstants(fid, dctx) {
  const out = [];
  for (const id of facilityClosure(fid, dctx)) {
    for (const def of dctx.defs.get(id) || []) {
      for (const row of def.facility.regulations || []) for (const [node] of rowConditionRoots(row)) numericConstants(node, out);
      if (def.facility.excluded_if !== undefined) numericConstants(def.facility.excluded_if, out);
    }
  }
  return out;
}

// 질문 후보: 각 시기의 보통 평가(T 가 아닌 것)와 푼 평가(F 가 아닌 것)의 확정이 아닌 입력 (+날짜가 판정을 가르면 날짜 질문)
function candidatesOf(j) {
  const byKey = new Map();
  const add = (deps) => {
    for (const d of deps) if (d.status !== CONFIRMED && !DATE_INPUTS.has(d.input) && !byKey.has(d.key)) byKey.set(d.key, d);
  };
  for (const n of j.normal) add(n.tv.deps); // 확인 필요일 때만 부른다 — 모든 시기의 가정·미확인 입력이 후보
  for (const r of j.released || []) if (r.tv.v !== F) add(r.tv.deps);
  const out = [...byKey.values()];
  const dateSplit = j.dates.length > 1 && (distinct(j.normal) > 1 || (j.released && distinct(j.released) > 1));
  if (dateSplit) out.unshift({ ...makeDep(j.di.window.question, UNKNOWN, { info: { boundaries: j.dates.slice(1) } }), isDate: true });
  return { candidates: out, dateSplit };
}

function hashKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 결정적 질문 선별 — 한 입력만 답해도 판정이 바뀌는 입력만 묻는다. 비해당의 안전성과는 무관한 '무엇을 물을지'의 문제라
// 비용을 제한한다(시험 예산). 단계:
//   1. 묶음 확인: 같은 종류 입력이 여럿(예: 층마다 무창층)이면 모두 한쪽 끝값으로 두어 본다. 어느 끝으로도 판정이
//      안 바뀌면 — 조건이 그 입력에 단조이면 — 하나만 답해서도 바뀌지 않으므로 개별 시험을 건너뛴다.
//   2. 끝값 시험: 입력마다 참/거짓, 수치는 범위 양 끝, 날짜는 각 시기.
//   3. 여전히 결정적 입력이 없으면 기준값 앞뒤와 좁은 정수 범위 전체(폭 1짜리 구간 조건용).
//   결정적 입력이 하나도 없으면(여러 답이 함께 있어야 풀림, 또는 예산을 다 쓸 때까지 못 찾음) 후보 전부를 함께 묻는다(jointQuestions).
//   예산을 다 썼어도 찾은 결정적 입력이 있으면 그것만 묻는다(나머지는 답을 받은 뒤 다시 고른다).
function chooseQuestions(fid, dctx, j, candidates) {
  const budget = { count: 0, limit: DECISIVE_TEST_BUDGET };
  const constants = facilityConstants(fid, dctx);
  const defOf = (d) => dctx.inputDefs.get(d.input) ?? { type: 'boolean' };
  const consts = (d) => constantsFor(d.input, constants);
  const decisive = new Set();
  const tried = new Map();
  let exhausted = false;
  const resolves = (overrides, key) => {
    if (budget.count >= budget.limit) {
      exhausted = true;
      return null;
    }
    return judge(fid, dctx, { ...dctx.answers, ...overrides }, key, budget, false).v !== U;
  };
  const trySingle = (d, values) => {
    const seen = tried.get(d.key) ?? new Set();
    tried.set(d.key, seen);
    for (const value of values) {
      if (seen.has(value)) continue;
      seen.add(value);
      const r = resolves({ [d.key]: value }, `${d.key}=${value}`);
      if (r === null) return;
      if (r) {
        decisive.add(d.key);
        return;
      }
    }
  };

  // 1. 묶음 확인
  const skip = new Set();
  const groups = new Map();
  for (const d of candidates) if (!d.isDate) groups.set(d.input, [...(groups.get(d.input) || []), d]);
  for (const [input, members] of groups) {
    if (members.length < 3) continue;
    const sig = hashKey(members.map((m) => m.key).join('|'));
    const sides = defOf(members[0]).type === 'boolean' ? [true, false] : [0, 1]; // 수치는 각자의 위 끝(0)·아래 끝(1)
    let any = false;
    for (const side of sides) {
      const ov = {};
      for (const m of members) {
        const ex = typeof side === 'boolean' ? [side] : extremeValues(m, defOf(m), consts(m));
        if (ex.length) ov[m.key] = ex[Math.min(side === 1 ? ex.length - 1 : 0, ex.length - 1)] ?? ex[0];
      }
      const r = resolves(ov, `grp:${input}:${side}:${sig}`);
      if (r === null) break;
      if (r) {
        any = true;
        break;
      }
    }
    if (!any && !exhausted) members.forEach((m) => skip.add(m.key));
  }

  // 2. 끝값
  for (const d of candidates) {
    if (exhausted) break;
    if (skip.has(d.key)) continue;
    trySingle(d, d.isDate ? j.dates : extremeValues(d, defOf(d), consts(d)));
  }
  // 3. 기준값 앞뒤·좁은 정수 범위 전체
  if (!decisive.size) {
    for (const d of candidates) {
      if (exhausted) break;
      if (skip.has(d.key) || d.isDate) continue;
      trySingle(d, testValues(d, defOf(d), consts(d)));
    }
  }
  const joint = !decisive.size;
  // 면적 질문(층·부분 면적, 연면적)을 고르면 같은 동의 층수(모름·가정값)도 함께 묻는다 — 층수가 정해지기 전의 면적 범위는
  // 층수 가정값을 푼 재평가의 범위라, 그 안의 답이 가정값 층수로 온전해진 면적 항등식(본 평가)과 모순될 수 있다.
  // 층수가 먼저 나온다(limitQuestions)
  const areaDongs = new Set(candidates.filter((d) => decisive.has(d.key) && AREA_IDENTITY_INPUTS.has(d.input)).map((d) => d.dong));
  const chosen = (d) => decisive.has(d.key) || (COUNT_INPUTS.has(d.input) && areaDongs.has(d.dong));
  return { deps: joint ? candidates : candidates.filter(chosen), joint, exhausted, tests: budget.count };
}

// ───────────── 확정·출력 ─────────────

function mergeScopes(scopes, order) {
  const floors = new Set();
  const maybe = new Set();
  const parts = [];
  let allFloors = false;
  for (const s of scopes) {
    if (!s) continue;
    if (s.type === 'all_floors') allFloors = true;
    if (s.floors) s.floors.forEach((k) => floors.add(k));
    if (s.maybe) s.maybe.forEach((k) => maybe.add(k));
    if (s.parts) parts.push(...s.parts.filter((p) => !parts.includes(p)));
  }
  const sort = (keys) => [...keys].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  const type = allFloors ? 'all_floors' : floors.size ? 'floors' : parts.length ? 'part' : maybe.size ? 'floors' : 'none';
  return { type, floors: sort(floors), maybeFloors: sort([...maybe].filter((k) => !floors.has(k))), parts };
}

const reasonOf = (r, gated = false) =>
  `「${r.row.criteria ?? r.id}」 ${VERDICT[r.value.v]}${gated && r.value.v === T ? '(복합건축물인 경우)' : ''}${r.value.why.length ? ` — ${r.value.why.join(', ')}` : ''}`;

function describeDep(dep, dctx) {
  const label = dctx.inputDefs.get(dep.input)?.label ?? dep.input;
  return `${label}${dep.floor ? `(${dep.floor})` : ''}: ${dep.status === ASSUMED ? '가정값' : dep.released ? '가정값을 풀어 모름' : '미확인'}`;
}

function describeDateAssumption(di) {
  if (di.status !== ASSUMED) return null;
  if (di.source === 'today') return `기준일: 오늘(${formatYmd(di.today)}) — 허가일·사용승인일 없음(가정, 모든 개정 경계 확인)`;
  if (di.source === 'approval') return `기준일: 사용승인일 ${formatYmd(di.refDate)} — 허가일 없음(가정, 추정 구간 안의 개정 경계 확인)`;
  const n = di.permits?.length ?? 0;
  return `기준일: 허가일 ${formatYmd(di.refDate)} — 인허가 ${n || '여러'}건 중 판정 기준 허가 미확인(가정)`;
}

function exemptionFor(fid, dctx, env) {
  const rule = (dctx.exemptions?.exemption_rules || []).find((r) => r.facility_id === fid);
  if (!rule) return null;
  const rows = (rule.regulations || []).filter((r) => rowValidAt(r, dctx.dateInfo.refDate));
  const possible = rows.filter((r) => r.exempt_if === undefined || evalCondition(r.exempt_if, env).v !== F);
  return possible.length ? { possible: true, rules: possible.map((r) => ({ criteria: r.criteria, source: r.source ?? null })) } : null;
}

export function finalizeFacility(fid, dctx) {
  const j = judge(fid, dctx, dctx.answers, '', null, true);
  const di = j.di;
  const refPass = getPass(dctx, di.refDate, false, dctx.answers, '');
  const core = facilityCore(fid, refPass);
  let v = j.v;
  const reasons = [];
  let questionDeps = [];
  let joint = false;
  let selection = null;
  let boundary = null;
  const { candidates, dateSplit } = v === U ? candidatesOf(j) : { candidates: [], dateSplit: false };
  if (j.dates.length > 1 && (dateSplit || distinct(j.normal) > 1)) {
    boundary = {
      window: di.window,
      points: j.dates.slice(1),
      epochs: j.normal.map((n, i) => ({ from: n.date, value: n.tv.v, released: j.released ? j.released[i].tv.v : null })),
      question: di.window.question,
    };
    const steps = boundary.epochs.map((e) => `${formatYmd(e.from)}~ ${VERDICT[e.value]}${e.released && e.released !== e.value ? `(가정값을 풀면 ${VERDICT[e.released]})` : ''}`);
    reasons.push(`기준일에 따라 판정이 달라짐: ${steps.join(' → ')}`);
  }
  if (v === U) {
    selection = chooseQuestions(fid, dctx, j, candidates);
    questionDeps = selection.deps;
    joint = selection.joint;
    if (j.released && j.normal.every((n) => n.tv.v === F)) {
      const released = candidates.filter((d) => !d.isDate);
      reasons.push(`가정값·미확인 입력을 모름으로 두면 비해당이 확정되지 않음${released.length ? `: ${released.map((d) => describeDep(d, dctx)).join(', ')}` : ''}`);
    }
  }

  // M7b: 이 동에 v2 로 평가하지 못한 파일(v1·없음)이 있으면 그 파일 기준이 빠진 비해당이므로 확정하지 않는다
  if (v === F && dctx.pendingV1.length) {
    v = U;
    reasons.push(`이 동의 ${dctx.pendingV1.join('·')}번 기준 파일이 v1 이라 판정에 빠짐 — 기존(v1) 판정과 함께 확인 필요`);
  }

  // 답변한 면적이 연면적·층별개요와 모순이면(AREA_ANSWER_MISMATCH) 면적에 기대는 비해당은 확정하지 않는다 — 모형 밖의 답이라
  // 판정이 답에 따라 뒤집힐 수 있다. 면적 답변 확인 질문(area_check)에 '예'(지금 답이 맞다)라고 하면 그 답대로 판정한다
  let areaCheck = false;
  if (v === F && dctx.areaMismatch && dctx.answers[depKey('area_check', dctx.dong.id)] !== true && dependsOnAreas(j)) {
    v = U;
    areaCheck = true;
    reasons.push('답변한 면적이 연면적과 맞지 않아(AREA_ANSWER_MISMATCH) 면적에 기대는 비해당을 확정하지 않음 — 면적 답변 확인 필요');
  }

  const defs = dctx.defs.get(fid) || [];
  const allRows = core.perFile.flatMap((r) => r.rows);
  const decided = core.perFile.filter((r) => r.value.v === T);
  const tRows = decided.flatMap((r) => r.rows.filter((x) => counts(x, dctx.policy) && x.value.v === T));
  const uRows = core.perFile.flatMap((r) =>
    r.rows.filter((x) => counts(x, dctx.policy) && (x.value.v === U || (x.value.v === T && r.value.v !== T))).map((x) => ({ ...x, gated: Boolean(r.def.gate) })),
  );
  const order = dctx.floorOrder;

  if (v === T) reasons.push(...tRows.map((r) => reasonOf(r)));
  else if (v === U) reasons.push(...uRows.map((r) => reasonOf(r, r.gated)));
  else reasons.push(...allRows.filter((r) => counts(r, dctx.policy)).map((r) => reasonOf(r)));
  for (const r of core.perFile) {
    if (r.excluded && r.excluded.v !== F) reasons.push(`제외 조건 ${r.excluded.v === T ? '해당' : '확인 필요'} — ${r.excluded.why.join(', ')}`);
    if (r.def.gate && r.base.v !== F && r.value.v !== T) reasons.push('복합건축물 기준(30번) — 복합건축물 해당 여부 확인 필요');
  }
  if (!reasons.length) reasons.push(...core.tv.why);

  const first = defs[0]?.facility || {};
  const qctx = { inputDefs: dctx.inputDefs, index: dctx.index, names: dctx.names };
  const asked = [];
  if (areaCheck) asked.push(buildQuestion(makeDep('area_check', UNKNOWN, { dong: dctx.dong.id }), qctx));
  for (const d of questionDeps) if (!asked.some((q) => q.key === d.key)) asked.push(buildQuestion(d, qctx));
  // 순서만 정하고 상한·면적 질문 묶음은 건물 단위에서(limitQuestions) — 여러 시설·동의 질문을 함께 봐야 해서
  const questions = orderQuestions(asked, order);
  const assumptions = core.tv.deps.filter((d) => d.status === ASSUMED).map((d) => describeDep(d, dctx));
  const dateAssumption = describeDateAssumption(di);
  if (dateAssumption) assumptions.push(dateAssumption);
  const extScopes = decided.flatMap((r) => r.rows.filter((x) => x.kind === 'modifier' && x.value.v === T).map((x) => x.scope));
  return {
    id: fid,
    name: first.facility_name ?? dctx.names.get(fid) ?? fid,
    category: first.category ?? null,
    value: v,
    verdict: VERDICT[v],
    required: v !== F,
    reason: reasons[0] ?? '',
    reasons,
    scope: v === T ? mergeScopes([...tRows.map((r) => r.scope), ...extScopes], order) : null,
    // 확인 필요일 때 답에 따라 적용될 수 있는 범위 (기준일에 따라 갈리는 T 는 기준일 기준의 범위)
    possibleScope: v === U && (uRows.length || tRows.length) ? mergeScopes([...uRows, ...(boundary ? tRows : [])].map((r) => r.scope), order) : null,
    extensions: decided.flatMap((r) => r.rows.filter((x) => x.kind === 'modifier' && x.value.v === T).map((x) => x.row.specs?.label ?? x.row.criteria)),
    questions,
    moreQuestions: 0,
    jointQuestions: joint,
    assumptions,
    boundary,
    exemption: v !== F ? exemptionFor(fid, dctx, refPass.env) : null,
    retroactive: allRows.filter((r) => r.basis !== 'ref' && r.value.v !== F).map((r) => ({ id: r.id, basis: r.basis, criteria: r.row.criteria, ...(r.row.retroactive || {}) })),
    review: allRows.filter((r) => r.row.needs_review).map((r) => ({ id: r.id, ...r.row.needs_review })),
    info: allRows.filter((r) => r.kind === 'info').map((r) => ({ id: r.id, criteria: r.row.criteria, specs: r.row.specs ?? null })),
    pendingV1: dctx.pendingV1.length ? [...dctx.pendingV1] : null,
    files: core.perFile.map((r) => ({ type_code: r.def.typeCode, value: r.value.v, gated: Boolean(r.def.gate) })),
    rows: allRows.map((r) => ({ id: r.id, type_code: r.typeCode, kind: r.kind, basis: r.basis, value: r.value.v, scope: r.scope, questions: r.questions, reasons: r.reasons })),
    diagnostics: selection ? { questionTests: selection.tests, budgetExhausted: selection.exhausted } : null,
    // v1 호환: 기준일에 선택된 규정 행(모달 표시용)과 시설의 모든 규정 행
    regulations: allRows.map((r) => r.row),
    allRegulations: defs.flatMap((d) => d.facility.regulations || []),
  };
}

// ───────────── 동 ─────────────

export function classifyFile(code, json) {
  if (!json) return { type_code: code, status: 'missing', message: '데이터 파일 없음' };
  if (json.schema_version !== SCHEMA_VERSION) return { type_code: code, status: 'v1', message: 'v1 — v2 엔진 미평가', json };
  return { type_code: code, status: 'v2', json };
}

const tally = (facilities) => ({
  applicable: facilities.filter((f) => f.value === T).length,
  check: facilities.filter((f) => f.value === U).length,
  notApplicable: facilities.filter((f) => f.value === F).length,
});

const AREA_ANSWER_RE = /^(floor_area|part_area\[[^\]]*\]|total_area)@(.*)$/;
const AREA_INPUTS = new Set(['floor_area', 'part_area', 'total_area', 'use_area', 'floor_use_area']);

// 비해당(모든 시기에서 가정값을 푼 평가도 F)의 근거에 면적 입력이 있는가
function dependsOnAreas(j) {
  return [...(j.released || []), ...(j.normal || [])].some((e) => e.tv.deps.some((d) => AREA_INPUTS.has(d.input)));
}

// 면적 항등식(연면적 = 각 층 바닥면적의 합)으로 묶인 입력 — 한 동에서 여러 개를 한꺼번에 답하면 각자 범위 안이어도
// 합이 어긋날 수 있다(3차 리뷰: 2층·3층을 각각 [0, 600] 에서 550·550). 층수도 묶음이다 — 층수가 층 목록(항등식이 온전한지)을
// 정한다(지하층수와 1층 면적을 함께 물어 0·0 을 답하면 연면적과 모순). 그래서 한 번에 동마다 하나만 묻고(층수가 먼저),
// 답을 받으면 나머지 범위를 다시 좁혀 묻는다
const AREA_IDENTITY_INPUTS = new Set(['floor_area', 'part_area', 'total_area']);
const COUNT_INPUTS = new Set(['ground_floors', 'basement_floors']);
const IDENTITY_INPUTS = new Set([...AREA_IDENTITY_INPUTS, ...COUNT_INPUTS]);

// 건물 단위 질문 정리: 면적 항등식 묶음(동)마다 질문 하나(층수 질문이 있으면 층수, 없으면 가장 먼저 나온 것)만 남기고,
// 시설마다 QUESTION_LIMIT 개까지.
// 그 묶음의 다른 면적 질문만 있던 시설에는 대표 질문을 대신 넣는다(답하면 범위가 좁혀져 다음에 자기 질문이 나온다)
export function limitQuestions(dongResults) {
  const rep = new Map();
  for (const d of dongResults) {
    for (const f of d.facilities || []) {
      for (const q of f.questions) {
        if (!IDENTITY_INPUTS.has(q.input) || !q.dong) continue;
        const cur = rep.get(q.dong);
        if (!cur || (COUNT_INPUTS.has(q.input) && !COUNT_INPUTS.has(cur.input))) rep.set(q.dong, q);
      }
    }
  }
  for (const d of dongResults) {
    for (const f of d.facilities || []) {
      const shown = [];
      for (const q of f.questions) {
        const r = IDENTITY_INPUTS.has(q.input) && q.dong ? rep.get(q.dong) : q;
        if (!shown.some((x) => x.key === r.key)) shown.push(r);
      }
      f.moreQuestions = Math.max(0, f.questions.length - Math.min(shown.length, QUESTION_LIMIT));
      f.questions = shown.slice(0, QUESTION_LIMIT);
    }
    const questions = [];
    for (const q of (d.facilities || []).flatMap((f) => f.questions)) if (!questions.some((x) => x.key === q.key)) questions.push(q);
    d.questions = questions;
  }
  return dongResults;
}

// 답변한 면적이 답변끼리·확정 사실과 맞지 않으면 경고 — 한 층이 연면적보다 크거나, 층 면적 합이 연면적과 모순
// (이때 엔진은 모순된 쪽으로 추론하지 않으며, 그런 답은 단조성 보장 밖이다). env·strippedEnv 는 가정값을 푼 평가다(evaluateDong)
// 모순이 면적 답변 때문인가: 이 동의 면적 답변(층·부분 면적, 연면적)만 뺀 평가(stripped)에서는 모순이 없어야 한다 — 대장 자체의
// 불일치(FLOOR_AREA_MISMATCH)는 답변 탓이 아니므로 경고·비해당 보류 대상이 아니다(그때는 면적 항등식을 아예 쓰지 않는다)
function areaAnswerWarnings(dong, env, strippedEnv, answers) {
  const mine = Object.keys(answers).some((k) => {
    const m = AREA_ANSWER_RE.exec(k);
    return m && (m[2] === dong.id || m[2].startsWith(`${dong.id}/`));
  });
  if (!mine) return [];
  const total = metric(env, 'total_area');
  const totalText = total.lo === total.hi ? fmtNum(total.lo) : `${fmtNum(total.lo)}~${fmtNum(total.hi)}`;
  // 층 면적은 연면적 상한을 씌우기 전 값으로 본다 — 상한을 씌우면 부분 면적 답이 연면적을 넘어도 가려진다(3차 리뷰 LOW:
  // 지하1층 600 + 부분 답 600 = 1,200 > 연면적 700 이 700 으로 잘려 경고가 없었다)
  const overIn = (e) => {
    const t = metric(e, 'total_area');
    return new Set(floorsOf(e).floors.filter((f) => uncappedFloorArea(e, f).lo > t.hi + 1e-6).map((f) => f.key));
  };
  const before = overIn(strippedEnv);
  const over = floorsOf(env).floors.filter((f) => uncappedFloorArea(env, f).lo > total.hi + 1e-6 && !before.has(f.key));
  if (over.length) {
    return [{ code: 'AREA_ANSWER_MISMATCH', dong: dong.id, message: `${dong.id}: ${over.map((f) => f.label).join('·')} 면적(답변 포함)이 연면적 ${totalText}㎡ 보다 큼 — 면적 답변을 확인해 주세요` }];
  }
  const id = areaIdentity(env);
  if (!id || id.consistent) return [];
  const base = areaIdentity(strippedEnv);
  if (base && !base.consistent) return [];
  const sum = id.lo === id.hi + id.roofHi ? fmtNum(id.lo) : `${fmtNum(id.lo)}~${fmtNum(id.hi + id.roofHi)}`;
  return [{ code: 'AREA_ANSWER_MISMATCH', dong: dong.id, message: `${dong.id}: 답변을 반영한 층 면적 합계 ${sum}㎡ 가 연면적 ${totalText}㎡ 와 맞지 않음 — 면적 답변을 확인해 주세요` }];
}

// 이 동의 면적 답변만 뺀 답변
function withoutAreaAnswers(dong, answers) {
  return Object.fromEntries(Object.entries(answers).filter(([k]) => {
    const m = AREA_ANSWER_RE.exec(k);
    return !(m && (m[2] === dong.id || m[2].startsWith(`${dong.id}/`)));
  }));
}

// bctx = { dataFiles, index, inputDefs, names, exemptions, answers, policy, today, dates, dateInfo }
export function evaluateDong(dong, bctx) {
  const files = dong.typeCodes.map((code) => classifyFile(code, bctx.dataFiles?.[code]));
  const summary = {
    id: dong.id,
    name: dong.name,
    groups: dong.groups,
    typeCodes: dong.typeCodes,
    mixedUseCandidate: dong.mixedUseCandidate,
    notCovered: dong.notCovered,
    notes: dong.notes,
    files: files.map(({ type_code, status, message }) => ({ type_code, status, ...(message ? { message } : {}) })),
  };
  const v2 = files.filter((f) => f.status === 'v2');
  if (!v2.length) {
    const status = !files.length ? 'unmapped' : files.some((f) => f.status === 'v1') ? 'v1' : 'missing';
    return { ...summary, status, facilities: [], questions: [], counts: tally([]) };
  }
  const defs = new Map();
  for (const f of v2) {
    for (const facility of f.json.fire_facilities || []) {
      const def = { typeCode: f.type_code, file: f.json, facility, gate: f.type_code === '30' && dong.mixedUseCandidate ? 'mixed_use' : null };
      if (!defs.has(facility.facility_id)) defs.set(facility.facility_id, []);
      defs.get(facility.facility_id).push(def);
    }
  }
  const dctx = {
    ...bctx,
    dong,
    defs,
    passes: new Map(),
    dateCache: new Map(),
    epochCache: new Map(),
    pendingV1: files.filter((f) => f.status !== 'v2').map((f) => f.type_code),
  };
  dctx.dateInfo = dateInfoFor(dctx, dctx.answers);
  const baseEnv = getPass(dctx, dctx.dateInfo.refDate, false, dctx.answers, '').env;
  dctx.floorOrder = new Map(floorsOf(baseEnv).floors.map((f, i) => [f.key, i]));
  // 면적 답변의 모순은 가정값을 푼 평가에서 본다 — 답변끼리 또는 확정 사실과 어긋날 때만 답변 탓이다. 가정값(예: 지하층수 0)과만
  // 어긋나면 가정값을 푼 재평가가 비해당을 지키고, 가정값 층수는 면적보다 먼저 묻는다(chooseQuestions)
  const checkEnv = getPass(dctx, dctx.dateInfo.refDate, true, dctx.answers, '').env;
  const strippedEnv = makePass(dctx, dctx.dateInfo.refDate, withoutAreaAnswers(dong, dctx.answers), { release: true }).env;
  const warnings = areaAnswerWarnings(dong, checkEnv, strippedEnv, dctx.answers);
  dctx.areaMismatch = warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH');
  const facilities = [...defs.keys()].map((fid) => finalizeFacility(fid, dctx));
  const questions = [];
  for (const q of facilities.flatMap((f) => f.questions)) if (!questions.some((x) => x.key === q.key)) questions.push(q);
  return {
    ...summary,
    status: v2.length === files.length ? 'v2' : 'partial',
    pendingV1: dctx.pendingV1.length ? dctx.pendingV1 : null,
    facilities,
    questions,
    counts: tally(facilities),
    warnings,
  };
}
