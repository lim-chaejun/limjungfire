// 단조성 퍼즈(2차 리뷰) — 비해당 재평가(docs §5.4)의 전제인 단조성을 무작위 건물·무작위 기준(TEST-ONLY)으로 확인한다.
//   (1) 확정이 아닌 사실과 엔진이 묻는 질문에 (모형 안의) 값을 답해 가도, 처음에 비해당이던 시설은 비해당으로 남는다
//   (2) 각 단계의 비해당은 가정값을 만드는 정책을 모두 끈 평가(재평가와 같은 모형)에서도 비해당이다
// 답은 질문의 범위(range) 안에서 고르고, 연면적과 모순되는 면적 조합은 거른다(answer-model.mjs — 모순 답변은 경고 대상).
// 시드 고정. 더 돌리려면: ENGINE_FUZZ_SEEDS=1,2,3,4,5 ENGINE_FUZZ_CASES=200 node --test scripts/engine/test/monotonicity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  U, countOf, effectiveFloors, evalCondition, evaluateBuilding, inputDefsFrom, makeEnv, normalizeManual, normalizeRegistry, resolvePolicy,
} from '../../../js/engine/index.js';
import { addDays } from '../../../js/engine/dates.js';
import { stableKey } from '../../../js/engine/schema.js';
import { FACILITIES, INDEX, INPUTS, TODAY } from './helpers.mjs';

const DEFS = inputDefsFrom(INPUTS);
import { areasConsistent, isExactConfirmed } from './answer-model.mjs';

const SEEDS = (process.env.ENGINE_FUZZ_SEEDS || '1,2,3').split(',').map(Number).filter(Number.isFinite);
const CASES = Number(process.env.ENGINE_FUZZ_CASES) || 40;
const WALKS = Number(process.env.ENGINE_FUZZ_WALKS) || 4;
const STEPS = Number(process.env.ENGINE_FUZZ_STEPS) || 3;

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───── 무작위 기준·건물 ─────

const FLOOR_SELS = [undefined, 'basement', 'windowless', ['basement', 'windowless'], [{ kind: 'ground', level: { gte: 2 } }], ['basement', 'windowless', { kind: 'ground', level: { gte: 3 } }], [{ use: ['singing_room'] }], 'ground'];
const USES = [['02'], ['singing_room'], ['indoor_parking', 'garage'], ['restaurant', 'singing_room'], ['electrical_room'], ['retail_small']];
// 여러 용도를 적은 표제부·빈 용도 행을 자주 — 표제부 용도 투영·보충 층(리뷰 N2·N2′)이 드러나게
const ETC = ['소매점', '노래연습장', '일반음식점', '', '주차장', '소매점, 노래연습장', '소매점, 노래연습장', '일반음식점, 노래연습장'];

function generator(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const chance = (p) => rnd() < p;
  const cmp = (base, lo, hi) => {
    const v = Math.round(lo + rnd() * (hi - lo));
    return chance(0.15) ? { ...base, gt: 0, lt: v || 1 } : { ...base, [pick(['gte', 'gt', 'lt', 'lte'])]: v };
  };
  function leaf(facIdx) {
    const t = pick(['m', 'm', 'sum', 'sum', 'fe', 'fe', 'use', 'flag', 'inst', 'const', 'fac']);
    if (t === 'm') {
      const m = pick(['total_area', 'ground_floors', 'basement_floors', 'floors_incl_basement', 'occupants', 'households']);
      const [lo, hi] = m === 'total_area' ? [100, 2500] : m === 'occupants' || m === 'households' ? [10, 200] : [1, 7];
      return cmp({ m }, lo, hi);
    }
    if (t === 'sum') {
      const spec = {};
      const fl = pick(FLOOR_SELS);
      if (fl !== undefined) spec.floors = fl;
      if (chance(0.5)) spec.use = pick(USES);
      return cmp({ sum_area: spec }, 50, 1500);
    }
    if (t === 'fe') {
      const spec = { floors: pick(FLOOR_SELS.filter(Boolean)) };
      if (chance(0.6)) spec.area = { gte: Math.round(50 + rnd() * 900) };
      if (chance(0.4)) spec.use = pick(USES);
      return { floor_exists: spec };
    }
    if (t === 'use') return chance(0.5) ? { use: pick(USES) } : { use: pick(USES), floors: pick(FLOOR_SELS.filter(Boolean)) };
    if (t === 'flag') return { flag: pick(['gas_facility', 'elevator']) };
    if (t === 'inst') return { installed: 'co2_extinguishing' };
    if (t === 'const') return { const: chance(0.5) };
    return facIdx > 0 ? { facility: `fz${Math.floor(rnd() * facIdx)}` } : { const: true };
  }
  function tree(depth, facIdx) {
    if (depth <= 0 || chance(0.35)) return leaf(facIdx);
    const k = pick(['all', 'any', 'not', 'all', 'any']);
    if (k === 'not') return { not: tree(depth - 1, facIdx) };
    return { [k]: Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => tree(depth - 1, facIdx)) };
  }
  function data(permit) {
    const near = (d) => (d ? addDays(d, -Math.floor(rnd() * 170)) : pick(['20100101', '20180127', '20221201']));
    const facilities = [];
    for (let i = 0; i < 3; i++) {
      const rows = [];
      for (let j = 0; j < 1 + Math.floor(rnd() * 2); j++) {
        // 부정(not·제외 조건)을 자주 — 잘못된 확정 T 가 확정 비해당으로 드러나는 경로
        const cond = tree(3, i);
        const r = { id: `r${i}_${j}`, start_date: null, end_date: null, criteria: `r${i}_${j}`, kind: 'trigger', scope: 'all_floors', conditions: chance(0.3) ? { not: cond } : cond };
        if (chance(0.4)) {
          const d = near(permit);
          if (chance(0.5)) r.start_date = d;
          else r.end_date = addDays(d, -1);
        }
        if (chance(0.15)) {
          r.branches = [{ when: tree(1, i), conditions: tree(2, i) }, { conditions: tree(2, i) }];
          delete r.conditions;
        }
        rows.push(r);
      }
      const fac = { facility_id: `fz${i}`, facility_name: `FZ${i}`, regulations: rows };
      if (chance(0.3)) fac.excluded_if = tree(2, i);
      facilities.push(fac);
    }
    return { '02': { schema_version: 2, type_code: '02', review: { status: 'draft', by: null, date: null }, fire_facilities: facilities } };
  }
  // 층별개요 행의 면적제외여부·주/부속 구분(4차 리뷰) — 실제 대장처럼 '0'·빈칸이 대부분, 가끔 제외('1'·'Y')·'N'·필로티·부속건축물 행
  const rowFlags = () => {
    const out = {};
    const v = pick(['0', '0', '0', '0', ' ', ' ', '', undefined, '1', 'Y', 'N']);
    if (v !== undefined) out.areaExctYn = v;
    if (chance(0.06)) out.mainAtchGbCd = pick(['1', '0', ' ']);
    if (chance(0.06)) out.etcPurps = pick(['필로티주차장', '다락']);
    return out;
  };
  // 단조성을 깨기 쉬운 건물 모양(2차 리뷰 N1·N2·N2′·면적 항등식) — 기준은 무작위. 행은 대부분 산입('0')이라 면적 항등식이 선다
  const item = (gb, no, etc, area) => ({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: '제2종근린생활시설', etcPurps: etc, area, ...(chance(0.8) ? { areaExctYn: '0' } : rowFlags()) });
  function template() {
    const permit = [{ archPmsDay: '20150601', archGbCdNm: '신축' }];
    const multi = pick(['소매점, 노래연습장', '일반음식점, 노래연습장']);
    const a = pick([200, 300, 400]);
    const t = pick([
      // N1: 층별개요 면적 합 < 연면적
      () => ({ title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 2 * a + pick([100, 200, 300]), grndFlrCnt: 2, ugrndFlrCnt: 0 }], floors: [item('20', 1, '소매점', a), item('20', 2, '소매점', a)] }),
      // N2: 지하층수 빈칸, 표제부 여러 용도, 용도 빈 행
      () => ({ title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: multi, totArea: 3 * a, grndFlrCnt: 1, ugrndFlrCnt: '' }], floors: [item('20', 1, '', 3 * a)] }),
      // N2′: 보충한 2층에 표제부의 여러 용도
      () => ({ title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: multi, totArea: 4 * a, grndFlrCnt: 2, ugrndFlrCnt: 0 }], floors: [item('20', 1, pick(['노래연습장', '소매점']), 2 * a)] }),
      // 면적 항등식으로 정해지는 층(2층 = 연면적 − 1층 − 지하1층)
      () => ({ title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 4 * a, grndFlrCnt: 2, ugrndFlrCnt: 1 }], floors: [item('20', 1, '소매점', 2 * a), item('10', 1, '소매점', a)] }),
    ])();
    return { input: { registry: { ...t, permit } }, permit: '20150601' };
  }
  function building() {
    if (chance(0.3)) return template();
    const dateMode = pick(['permit', 'permit', 'none', 'approval', 'multi']);
    const P = pick(['20150601', '20180302', '20230101']);
    if (chance(0.3)) {
      const manual = { mainPurpsCdNm: '제2종근린생활시설', totArea: pick([400, 900, 1600, 3000]), grndFlrCnt: 1 + Math.floor(rnd() * 3), ugrndFlrCnt: chance(0.6) ? 0 : 1, pmsDay: P };
      if (dateMode === 'none') Object.assign(manual, { pmsDay: TODAY, permitDateIsDefault: true });
      return { input: { manual }, permit: dateMode === 'none' ? null : P };
    }
    const g = 1 + Math.floor(rnd() * 3);
    const b = Math.floor(rnd() * 2);
    const title = { mainPurpsCdNm: '제2종근린생활시설', etcPurps: pick(ETC), totArea: chance(0.85) ? pick([300, 700, 1200, 2400]) : '', grndFlrCnt: chance(0.85) ? g : '', ugrndFlrCnt: chance(0.8) ? b : '', ...(chance(0.7) ? { mainAtchGbCd: '0' } : {}) };
    const floors = [];
    const add = (gb, no) => {
      for (let p = 0; p < (chance(0.2) ? 2 : 1); p++) floors.push({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: '제2종근린생활시설', etcPurps: pick(ETC), area: chance(0.8) ? pick([100, 200, 400, 600]) : '', ...rowFlags() });
    };
    // 빠진 층(보충)·층수 빈칸·층별개요 면적 합 ≠ 연면적이 자주 나오게
    for (let k = 1; k <= g + (chance(0.15) ? 1 : 0); k++) if (chance(0.75)) add('20', k);
    for (let k = 1; k <= b + (chance(0.15) ? 1 : 0); k++) if (chance(0.75)) add('10', k);
    const registry = { title: [title], floors };
    if (dateMode === 'permit') registry.permit = [{ archPmsDay: P, archGbCdNm: '신축' }];
    if (dateMode === 'multi') registry.permit = [{ archPmsDay: P, archGbCdNm: '신축' }, { archPmsDay: addDays(P, 400), archGbCdNm: '증축' }];
    if (dateMode === 'approval') title.useAprDay = addDays(P, 500);
    return { input: { registry }, permit: dateMode === 'none' ? null : P };
  }
  return { pick, chance, data, building, leaf, tree };
}

const normalize = (sc, policy = sc.policy) =>
  (sc.input.manual ? normalizeManual(sc.input.manual, { useIndex: INDEX, policy }) : normalizeRegistry(sc.input.registry, { useIndex: INDEX, policy }));
const run = (sc, answers, policy = sc.policy) =>
  evaluateBuilding({ building: normalize(sc, policy), dataFiles: sc.data, useIndex: INDEX, inputs: INPUTS, facilities: FACILITIES, answers, policy, today: TODAY });

// 가정값을 만드는 정책을 모두 끈 정책(재평가와 같은 모형): 해석 정책(floorCountConflict 등)은 그대로
const releasedPolicy = (p) => ({ ...p, windowless: 'unknown', manualBlankBasement: 'unknown', mixedUseRequiresConfirmation: true });

// 확정이 아닌 사실과 그 값 후보 — 층수 답변으로 생길 수 있는 층까지 (지상 5층·지하 3층까지)
function factUniverse(dong, dateInfo, data) {
  const id = dong.id;
  const out = new Map();
  const B = [true, false];
  const m = dong.metrics;
  const upto = (iv, extra = 3) => {
    const lo = Math.max(0, Math.ceil(iv.lo));
    const hi = Number.isFinite(iv.hi) ? Math.min(iv.hi, lo + extra) : lo + extra;
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  };
  const assumedBasement = [...m.basement_floors.loDeps].some((d) => d.status === 'assumed');
  if (!isExactConfirmed(m.ground_floors)) out.set(`ground_floors@${id}`, upto(m.ground_floors));
  if (!isExactConfirmed(m.basement_floors) || assumedBasement) out.set(`basement_floors@${id}`, assumedBasement ? [0, 1, 2, 3] : upto(m.basement_floors));
  if (!isExactConfirmed(m.total_area)) out.set(`total_area@${id}`, [Math.max(m.total_area.lo, 1), m.total_area.lo + 400, m.total_area.lo + 1500].map(Math.round));
  for (const k of ['occupants', 'households']) if (!m[k] || !isExactConfirmed(m[k])) out.set(`${k}@${id}`, [0, 30, 99, 100, 150, 300]);
  out.set(`gas_facility@${id}`, B);
  out.set('review[floor_area_basis]', B); // 바닥면적 바탕 검수 질문(CP1 Q19) — 정책이 uncertain 일 때만 읽힌다
  if (!dong.flags?.elevator) out.set(`elevator@${id}`, B);
  out.set(`installed[co2_extinguishing]@${id}`, B);
  if (dong.mixedUseCandidate) out.set(`mixed_use@${id}`, B);
  const grounds = out.get(`ground_floors@${id}`) || [m.ground_floors.lo];
  const basements = out.get(`basement_floors@${id}`) || [m.basement_floors.lo];
  const totalHi = Number.isFinite(m.total_area.hi) ? m.total_area.hi : 5000;
  const areas = [0, 60, 150, 300, 600, 1000, 2000].filter((v) => v <= totalHi);
  for (const g of grounds) {
    for (const b of basements) {
      for (const f of effectiveFloors(dong, g, b).floors) {
        if (f.kind === 'ground') out.set(`windowless@${id}/${f.key}`, B);
        // 표제부 용도를 빌려 온 층(보충한 층·빈 용도 행)·용도군만 아는 층: 그 층에 대상 용도가 있는지는 모른다
        if (f.parts.some((p) => p.fromTitle || p.terms.some((t) => !t.use))) for (const use of USES) out.set(`use_presence[${stableKey({ use })}]@${id}/${f.key}`, B);
        if (f.parts.length > 1) f.parts.forEach((p, i) => p.area.open.length && out.set(`part_area[${p.n ?? i + 1}]@${id}/${f.key}`, areas));
        else if (f.area.open.length) out.set(`floor_area@${id}/${f.key}`, areas);
      }
    }
  }
  const w = dateInfo.window;
  if (w) {
    const dates = new Set([w.from, w.to]);
    for (const fac of data['02'].fire_facilities) {
      for (const r of fac.regulations) {
        for (const d of [r.start_date, r.end_date && addDays(r.end_date, 1), r.start_date && addDays(r.start_date, -1), r.end_date]) if (d && d >= w.from && d <= w.to) dates.add(d);
      }
    }
    // 허가일을 묻는 구간이면 답한 허가일의 신청 구간도 그 안에 있도록 시작을 신청 구간만큼 늦춘다
    out.set(w.question, [...dates].filter((d) => w.question !== 'permit_date' || d >= addDays(w.from, 180)));
  }
  return out;
}

function questionValues(q) {
  if (q.type === 'boolean') return [true, false];
  if (q.type !== 'number' && q.type !== 'integer') return [];
  const [lo, hi] = q.range ?? [0, 3000];
  let top = Number.isFinite(hi) ? hi : lo + 3000;
  // 층수는 몇 층만 더 본다(층마다 질문이 생겨 평가가 커지므로 — 기준의 층수 값은 1~7)
  if (['ground_floors', 'basement_floors', 'floors_incl_basement'].includes(q.input)) top = Math.min(top, lo + 5);
  const vs = [lo, top, (lo + top) / 2, lo + 1, top - 1].filter((v) => v >= lo && v <= top);
  return [...new Set(q.type === 'integer' ? vs.map(Math.round) : vs)];
}

function fuzz(seed) {
  const rnd = prng(seed);
  const G = generator(rnd);
  const stats = { cases: 0, notApplicable: 0, checks: 0, released: 0 };
  for (let c = 0; c < CASES; c++) {
    const b = G.building();
    const policy = { windowless: G.pick(['unknown', 'assume_none']), manualBlankBasement: G.pick(['assume_zero', 'unknown']), floorCountConflict: G.pick(['ask', 'ask', 'title']), floorAreaBasis: G.pick(['uncertain', 'uncertain', 'all_rows', 'counted_only']) };
    const sc = { input: b.input, data: G.data(b.permit), policy };
    const base = run(sc, {});
    stats.cases++;
    if (base.status !== 'v2') continue;
    const initial = base.dongs[0].facilities.filter((f) => f.verdict === '비해당').map((f) => f.id);
    stats.notApplicable += initial.length;
    const dong = normalize(sc).dongs[0];
    const facts = factUniverse(dong, base.dateInfo, sc.data);
    const keys = [...facts.keys()];
    const building = normalize(sc);
    // 산책 0·1 은 끝값(모두 아니오·최솟값 / 모두 예·최댓값), 나머지는 무작위
    for (let w = 0; w < WALKS + 2; w++) {
      const answers = {};
      let r = base;
      const choose = w === 0 ? (vs) => (vs.includes(false) ? false : vs[0]) : w === 1 ? (vs) => (vs.includes(true) ? true : vs[vs.length - 1]) : (vs) => G.pick(vs);
      for (let s = 0; s < STEPS; s++) {
        const p = w < 2 ? 1 : [0.15, 0.4, 0.8][(w + s) % 3];
        for (const k of keys) if (!(k in answers) && rnd() < p) answers[k] = choose(facts.get(k));
        for (const q of r.dongs.flatMap((d) => d.questions)) {
          if (q.key in answers || q.type === 'date' || (w >= 2 && rnd() >= 0.6)) continue;
          const vs = questionValues(q);
          if (vs.length) answers[q.key] = choose(vs);
        }
        if (!areasConsistent(building, answers)) break;
        r = run(sc, answers);
        const where = () => JSON.stringify({ seed, case: c, policy, input: sc.input, rules: sc.data['02'].fire_facilities, answers });
        for (const fid of initial) {
          const f = r.dongs[0].facilities.find((x) => x.id === fid);
          stats.checks++;
          assert.ok(!f || f.verdict === '비해당', `(1) ${fid}: 비해당 → ${f?.verdict} ${where()}`);
        }
        // (2) 이 단계의 비해당은 가정값 정책을 끈 평가에서도 비해당
        const now = r.dongs[0].facilities.filter((f) => f.verdict === '비해당').map((f) => f.id);
        if (now.length && s === STEPS - 1) {
          const rr = run(sc, answers, releasedPolicy(policy));
          for (const fid of now) {
            const f = rr.dongs[0].facilities.find((x) => x.id === fid);
            stats.released++;
            assert.ok(!f || f.verdict === '비해당', `(2) ${fid}: 가정값 정책을 끄면 ${f?.verdict} ${where()}`);
          }
        }
      }
    }
  }
  return stats;
}

// 질문 후보(근거 dep)에 넣을 값: 참/거짓, 수치는 dep 의 범위(없으면 입력 정의 range) 안의 끝·가운데
function depValues(dep) {
  const def = DEFS.get(dep.input);
  const type = def?.type ?? 'boolean';
  if (type === 'boolean') return [true, false];
  if (type !== 'number' && type !== 'integer') return [];
  return questionValues({ input: dep.input, type, range: dep.range ?? def?.range });
}

// 조건 잎 단위 단조성: 가정값을 푼(release) 평가에서 확정(T·F)이던 잎은, 모형 안의 어떤 답을 더해도 같은 값이어야 한다.
// 시설·판정 단위보다 훨씬 민감하다(부정 조건이나 비해당이 우연히 만들어질 필요가 없음).
function leafFuzz(seed) {
  const rnd = prng(seed * 7919 + 13);
  const G = generator(rnd);
  const stats = { cases: 0, definite: 0, checks: 0 };
  for (let c = 0; c < CASES; c++) {
    const b = G.building();
    const policy = resolvePolicy({ windowless: G.pick(['unknown', 'assume_none']), manualBlankBasement: G.pick(['assume_zero', 'unknown']), floorCountConflict: G.pick(['ask', 'ask', 'title']), floorAreaBasis: G.pick(['uncertain', 'uncertain', 'all_rows', 'counted_only']) });
    const sc = { input: b.input, policy };
    const building = normalize(sc);
    const dong = building.dongs[0];
    const leaves = Array.from({ length: 12 }, () => (G.chance(0.3) ? G.tree(1, 0) : G.leaf(0)));
    const envOf = (answers) => makeEnv({ dong, index: INDEX, answers, policy, inputDefs: DEFS, release: true });
    const base = leaves.map((n) => evalCondition(n, envOf({})).v);
    stats.cases++;
    stats.definite += base.filter((v) => v !== U).length;
    const facts = factUniverse(dong, { window: null }, { '02': { fire_facilities: [] } });
    const keys = [...facts.keys()];
    for (let w = 0; w < WALKS + 2; w++) {
      const answers = {};
      const choose = w === 0 ? (vs) => (vs.includes(false) ? false : vs[0]) : w === 1 ? (vs) => (vs.includes(true) ? true : vs[vs.length - 1]) : (vs) => G.pick(vs);
      for (let s = 0; s < STEPS; s++) {
        for (const k of keys) if (!(k in answers) && (w < 2 || rnd() < 0.35)) answers[k] = choose(facts.get(k));
        const env = envOf(answers);
        for (const n of leaves) {
          const v = evalCondition(n, env);
          if (v.v !== U) continue;
          for (const d of v.deps) {
            if (d.key in answers || d.status === 'confirmed' || (w >= 2 && rnd() >= 0.5)) continue;
            const vs = depValues(d);
            if (vs.length) answers[d.key] = choose(vs);
          }
        }
        if (!areasConsistent(building, answers)) break;
        const after = envOf(answers);
        leaves.forEach((n, i) => {
          if (base[i] === U) return;
          stats.checks++;
          const v = evalCondition(n, after).v;
          assert.equal(v, base[i], `잎 ${JSON.stringify(n)}: ${base[i]} → ${v} ${JSON.stringify({ seed, case: c, policy: { ...policy }, input: sc.input, answers })}`);
        });
      }
    }
  }
  return stats;
}

for (const seed of SEEDS) {
  test(`단조성 퍼즈 seed ${seed} — 조건 잎: 가정값을 푼 평가의 확정값은 답을 더해도 그대로 (사례 ${CASES})`, () => {
    const stats = leafFuzz(seed);
    assert.ok(stats.definite > 0 && stats.checks > 0, JSON.stringify(stats));
  });
  test(`단조성 퍼즈 seed ${seed} — 판정: 답해 가도 비해당은 비해당, 가정값 정책을 꺼도 비해당 (사례 ${CASES} × 산책 ${WALKS} × 단계 ${STEPS})`, () => {
    const stats = fuzz(seed);
    assert.ok(stats.notApplicable > 0 && stats.checks > 0, JSON.stringify(stats));
  });
}

// 질문 차례 산책(3차 리뷰 fz_rounds 와 같은 방식): 매 차례 보이는 질문(시설마다 최대 5개)에만 범위 안의 값으로 답한다.
// 면적 항등식으로 묶인 질문(층·부분 면적, 연면적, 층수)은 동마다 하나씩만 나오고 답을 받을 때마다 범위가 다시 좁혀지므로
// 답변이 서로 모순될 수 없다 — AREA_ANSWER_MISMATCH 가 없어야 한다
function roundsFuzz(seed) {
  const rnd = prng(seed * 104729 + 3);
  const G = generator(rnd);
  let rounds = 0;
  for (let c = 0; c < CASES; c++) {
    const b = G.building();
    const policy = { windowless: G.pick(['unknown', 'assume_none']), manualBlankBasement: G.pick(['assume_zero', 'unknown']), floorCountConflict: G.pick(['ask', 'title']), floorAreaBasis: G.pick(['uncertain', 'uncertain', 'all_rows', 'counted_only']) };
    const sc = { input: b.input, data: G.data(b.permit), policy };
    let r = run(sc, {});
    if (r.status !== 'v2') continue;
    const answers = {};
    for (let round = 0; round < 10; round++) {
      let n = 0;
      for (const f of r.dongs[0].facilities.filter((x) => x.value === U)) {
        for (const q of f.questions) {
          if (q.key in answers) continue;
          if (q.type === 'date') {
            const w = r.dateInfo.window;
            answers[q.key] = w ? G.pick([w.from, w.to]) : r.dateInfo.refDate;
          } else {
            const vs = questionValues(q);
            if (!vs.length) continue;
            answers[q.key] = G.pick(vs);
          }
          n++;
        }
      }
      if (!n) break;
      r = run(sc, answers);
      rounds++;
      assert.ok(!r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH'), `면적 모순 — ${JSON.stringify({ seed, case: c, input: sc.input, answers })}`);
    }
  }
  return rounds;
}

for (const seed of SEEDS) {
  test(`질문 차례 산책 seed ${seed}: 보이는 질문에만 범위 안에서 답하면 면적 답변 모순(AREA_ANSWER_MISMATCH)이 생기지 않는다`, () => {
    assert.ok(roundsFuzz(seed) > 0);
  });
}

test('퍼즈 도구 자체 점검: 층 목록이 완전해지는 층수 답변까지 층 질문 후보에 들어간다', () => {
  const dong = normalizeRegistry({ title: [{ mainPurpsCdNm: '제2종근린생활시설', totArea: 600, grndFlrCnt: '', ugrndFlrCnt: 0 }], floors: [] }, { useIndex: INDEX }).dongs[0];
  const keys = [...factUniverse(dong, { window: null }, { '02': { fire_facilities: [] } }).keys()];
  assert.ok(keys.includes('ground_floors@본동'));
  assert.ok(keys.includes('windowless@본동/3F') && keys.includes('floor_area@본동/3F'), keys.join());
  assert.equal(countOf(dong.metrics.ground_floors), null);
});
