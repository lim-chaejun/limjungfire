// 판정 평가기 — 행 → 시설(파일별, 동 안에서 결합) → 확정 판정(해당 / 확인 필요 / 비해당)
//
// 한 번의 "패스(pass)"는 (기준일, 답변) 하나에 대한 평가다. 시설 간 의존(facility 노드)은 같은 패스 안에서
// 재귀·메모로 풀고, 개정 경계 검사와 결정적 질문 검사는 기준일·답변만 바꾼 새 패스로 다시 평가한다.
//
// 확정 규칙
//   T → 해당(적용 범위)
//   U → 확인 필요(결정적 질문만)
//   F → 비해당. 단, 가정값에 기대는 F 는 그 가정을 바꿔 결과가 달라지면 확인 필요 (불변식)
//   허가일 전 신청 구간 안의 개정 경계로 결과가 갈리면 확인 필요(허가 신청일)

import { SCHEMA_VERSION, normalizeFloors, normalizeScope, numericConstants, referencedFacilities, rowConditionRoots, stableKey } from './schema.js';
import { ASSUMED, CONFIRMED, F, T, U, UNKNOWN, all, any, depKey, ite, makeDep, not, tv } from './logic.js';
import { addDays, formatYmd, rowValidAt } from './dates.js';
import { evalCondition, floorMember, floorsOf, makeEnv } from './conditions.js';
import { DATE_INPUTS, buildQuestion, constantsFor, testValues } from './questions.js';

export const VERDICT = Object.freeze({ T: '해당', U: '확인 필요', F: '비해당' });

// ───────────── 행 ─────────────

function reviewValue(row, env) {
  const sig = row.id ?? stableKey(row.criteria ?? '');
  const a = env.answers[depKey('review', env.dong.id, undefined, sig)];
  if (a === true || a === false) {
    return tv(a ? T : F, [makeDep('review', CONFIRMED, { dong: env.dong.id, sig, source: 'user' })], [`기준 해당 여부 답변: ${a ? '예' : '아니오'}`]);
  }
  const info = { criteria: row.criteria ?? '', question: row.needs_review?.question };
  return tv(U, [makeDep('review', UNKNOWN, { dong: env.dong.id, sig, info })], ['조건 구조화 전 — 기준 원문 확인 필요']);
}

// 분기: 앞에서부터 when 이 맞는 첫 분기. when 이 U 여도 양쪽 결과가 같으면 확정 (ite)
function evalBranches(branches, env, i = 0) {
  if (i >= branches.length) return { value: tv(F, [], ['해당 분기 없음']), scope: null, matched: [], maybe: [] };
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
  } else value = kind === 'trigger' ? reviewValue(row, env) : tv(T, [], ['조건 없음(항상 적용)']);
  const scope = value.v === F ? null : resolveScope(normalizeScope(scopeSpec ?? (kind === 'modifier' ? 'inherit' : 'all_floors')), env, matched, maybe);
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

// ───────────── 패스 ─────────────

function mixedUseValue(env, dctx) {
  const a = env.answers[depKey('mixed_use', env.dong.id)];
  if (a === true || a === false) return tv(a ? T : F, [makeDep('mixed_use', CONFIRMED, { dong: env.dong.id, source: 'user' })], [`복합건축물 ${a ? '해당' : '아님'}(답변)`]);
  const info = { groups: env.dong.fileGroups };
  if (!dctx.policy.mixedUseRequiresConfirmation) return tv(T, [makeDep('mixed_use', ASSUMED, { dong: env.dong.id, info, source: 'policy' })], ['복합건축물로 가정']);
  return tv(U, [makeDep('mixed_use', UNKNOWN, { dong: env.dong.id, info })], ['복합건축물 해당 여부 미확인']);
}

function fileFacility(def, pass) {
  const { env, dctx } = pass;
  const rows = selectRows(def, pass.date, dctx).map(({ row, basis }) => ({ ...evaluateRow(row, env), basis, typeCode: def.typeCode }));
  const counted = rows.filter((r) => counts(r, dctx.policy));
  let base = counted.length ? any(counted.map((r) => r.value)) : tv(F, [], [`${formatYmd(pass.date)} 기준 유효한 설치 기준 없음`]);
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
    return { fid, perFile: [], tv: tv(U, [makeDep('facility_cycle', UNKNOWN, { dong: pass.dctx.dong.id, sig: fid })], [`${name} 순환 참조`]) };
  }
  pass.visiting.add(fid);
  const perFile = (pass.dctx.defs.get(fid) || []).map((def) => fileFacility(def, pass));
  const value = perFile.length ? any(perFile.map((r) => r.value)) : tv(F, [], [`${name} 기준 없음`]);
  pass.visiting.delete(fid);
  const core = { fid, perFile, tv: value };
  pass.memo.set(fid, core);
  return core;
}

function makePass(dctx, date, answers) {
  const pass = { dctx, date, answers, memo: new Map(), visiting: new Set() };
  pass.env = makeEnv({
    dong: dctx.dong,
    index: dctx.index,
    answers,
    policy: dctx.policy,
    inputDefs: dctx.inputDefs,
    names: dctx.names,
    facility: (id) => {
      const core = facilityCore(id, pass);
      return tv(core.tv.v, core.tv.deps, [`${dctx.names.get(id) ?? id} ${VERDICT[core.tv.v]}`]);
    },
  });
  return pass;
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

function transitionPoints(fid, dctx, span) {
  const pts = new Set();
  for (const id of facilityClosure(fid, dctx)) {
    for (const def of dctx.defs.get(id) || []) {
      for (const row of def.facility.regulations || []) {
        for (const p of [row.start_date, row.end_date ? addDays(row.end_date, 1) : null]) if (p && span.from < p && p <= span.to) pts.add(p);
      }
    }
  }
  return [...pts].sort();
}

function boundaryCheck(fid, dctx, answers, baseV) {
  const w = dctx.dateInfo.window;
  if (!w) return null;
  const points = transitionPoints(fid, dctx, w);
  if (!points.length) return null;
  const epochs = [w.from, ...points].map((date) => ({ from: date, value: facilityCore(fid, makePass(dctx, date, answers)).tv.v }));
  if (epochs.every((e) => e.value === baseV)) return null;
  return { window: w, points, epochs, question: w.question };
}

// ───────────── 결정적 질문 ─────────────

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

// 이 입력에 어떤 값을 답하면 판정(v)이 달라지는가
function isDecisive(fid, dctx, answers, dep, currentV, constants) {
  const def = dctx.inputDefs.get(dep.input) ?? { type: 'boolean' };
  for (const value of testValues(dep, def, constantsFor(dep.input, constants))) {
    if (facilityCore(fid, makePass(dctx, dctx.dateInfo.refDate, { ...answers, [dep.key]: value })).tv.v !== currentV) return true;
  }
  return false;
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

function describeAssumption(dep, dctx) {
  const label = dctx.inputDefs.get(dep.input)?.label ?? dep.input;
  return `${label}${dep.floor ? `(${dep.floor})` : ''}: ${dep.status === ASSUMED ? '가정값' : '미확인'}`;
}

function exemptionFor(fid, dctx, env) {
  const rule = (dctx.exemptions?.exemption_rules || []).find((r) => r.facility_id === fid);
  if (!rule) return null;
  const rows = (rule.regulations || []).filter((r) => rowValidAt(r, dctx.dateInfo.refDate));
  const possible = rows.filter((r) => r.exempt_if === undefined || evalCondition(r.exempt_if, env).v !== F);
  return possible.length ? { possible: true, rules: possible.map((r) => ({ criteria: r.criteria, source: r.source ?? null })) } : null;
}

export function finalizeFacility(fid, dctx) {
  const { answers } = dctx;
  const pass = makePass(dctx, dctx.dateInfo.refDate, answers);
  const core = facilityCore(fid, pass);
  const boundary = boundaryCheck(fid, dctx, answers, core.tv.v);
  const constants = facilityConstants(fid, dctx);
  let v = core.tv.v;
  let questionDeps = [];
  let joint = false;
  const reasons = [];

  if (boundary) {
    v = U;
    questionDeps = [makeDep(boundary.question, UNKNOWN, { info: { boundaries: boundary.points } })];
    const steps = boundary.epochs.map((e) => `${formatYmd(e.from)}~ ${VERDICT[e.value]}`).join(' → ');
    reasons.push(`개정 시행일(${boundary.points.map(formatYmd).join(', ')}) 전후로 판정이 달라짐: ${steps}`);
  } else if (v === F) {
    // 불변식: 가정·미확인 입력에 기대는 F 는, 그 입력을 다른 값으로 바꿔 결과가 달라지면 비해당으로 내지 않는다
    const dec = core.tv.deps.filter((d) => d.status !== CONFIRMED && !DATE_INPUTS.has(d.input) && isDecisive(fid, dctx, answers, d, F, constants));
    if (dec.length) {
      v = U;
      questionDeps = dec;
      reasons.push(`가정값·미확인 입력에 기대는 비해당이라 확인이 필요함: ${dec.map((d) => describeAssumption(d, dctx)).join(', ')}`);
    }
  } else if (v === U) {
    const cands = core.tv.deps.filter((d) => d.status !== CONFIRMED && !DATE_INPUTS.has(d.input));
    const dec = cands.filter((d) => isDecisive(fid, dctx, answers, d, U, constants));
    questionDeps = dec.length ? dec : cands;
    joint = !dec.length && cands.length > 0;
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
  const questions = [];
  for (const d of questionDeps) if (!questions.some((q) => q.key === d.key)) questions.push(buildQuestion(d, qctx));
  const selected = allRows.map((r) => r.row);
  return {
    id: fid,
    name: first.facility_name ?? dctx.names.get(fid) ?? fid,
    category: first.category ?? null,
    value: v,
    verdict: VERDICT[v],
    required: v !== F,
    reason: reasons[0] ?? '',
    reasons,
    scope: v === T ? mergeScopes([...tRows.map((r) => r.scope), ...decided.flatMap((r) => r.rows.filter((x) => x.kind === 'modifier' && x.value.v === T).map((x) => x.scope))], order) : null,
    // 확인 필요일 때 답에 따라 적용될 수 있는 범위 (개정 경계로 U 가 된 T 는 기준일 기준의 범위)
    possibleScope:
      v === U && (uRows.length || tRows.length) ? mergeScopes([...uRows, ...(boundary ? tRows : [])].map((r) => r.scope), order) : null,
    extensions: decided.flatMap((r) => r.rows.filter((x) => x.kind === 'modifier' && x.value.v === T).map((x) => x.row.specs?.label ?? x.row.criteria)),
    questions,
    jointQuestions: joint,
    assumptions: core.tv.deps.filter((d) => d.status === ASSUMED).map((d) => describeAssumption(d, dctx)),
    boundary,
    exemption: v !== F ? exemptionFor(fid, dctx, pass.env) : null,
    retroactive: allRows.filter((r) => r.basis !== 'ref' && r.value.v !== F).map((r) => ({ id: r.id, basis: r.basis, criteria: r.row.criteria, ...(r.row.retroactive || {}) })),
    review: allRows.filter((r) => r.row.needs_review).map((r) => ({ id: r.id, ...r.row.needs_review })),
    info: allRows.filter((r) => r.kind === 'info').map((r) => ({ id: r.id, criteria: r.row.criteria, specs: r.row.specs ?? null })),
    files: core.perFile.map((r) => ({ type_code: r.def.typeCode, value: r.value.v, gated: Boolean(r.def.gate) })),
    rows: allRows.map((r) => ({ id: r.id, type_code: r.typeCode, kind: r.kind, basis: r.basis, value: r.value.v, scope: r.scope, questions: r.questions, reasons: r.reasons })),
    // v1 호환: 기준일에 선택된 규정 행(모달 표시용)과 시설의 모든 규정 행
    regulations: selected,
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

// bctx = { dataFiles, index, inputDefs, names, exemptions, answers, policy, today, dateInfo }
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
  const dctx = { ...bctx, dong, defs };
  dctx.floorOrder = new Map(floorsOf(makePass(dctx, dctx.dateInfo.refDate, dctx.answers).env).floors.map((f, i) => [f.key, i]));
  const facilities = [...defs.keys()].map((fid) => finalizeFacility(fid, dctx));
  const questions = [];
  for (const q of facilities.flatMap((f) => f.questions)) if (!questions.some((x) => x.key === q.key)) questions.push(q);
  return { ...summary, status: v2.length === files.length ? 'v2' : 'partial', facilities, questions, counts: tally(facilities) };
}
