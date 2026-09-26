// 성질 시험(M4) — 비해당은 확정된 사실만으로 성립해야 한다: 가정값·미확인 입력에 (사실 모형이 허용하는) 어떤 값을 답해도
// 비해당은 비해당으로 남는다. 엔진의 근거 추적(deps)이나 질문 선별에 기대지 않고, 건물 사실과 데이터에서 답할 수 있는
// 입력을 직접 모아 값을 넣어 본다(끝값 조합 + 시드 고정 무작위 조합).
//   대상: 골든 픽스처(기본·변형) × 무창층 정책(기본·assume_none) + 리뷰 재현 사례(review-cases.mjs)
//   더 많이: ENGINE_PROPERTY_SAMPLES=200 node --test scripts/engine/test/property.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRMED, EARLIEST, countOf, coverage, effectiveFloors, evaluateBuilding, normalizeManual, normalizeRegistry, resolvePolicy,
} from '../../../js/engine/index.js';
import { addDays } from '../../../js/engine/dates.js';
import { nodeType, normalizeFloors, numericConstants, rowConditionRoots, stableKey, walkConditions } from '../../../js/engine/schema.js';
import { FACILITIES, FIXTURE_SET, INDEX, INPUTS, TODAY, loadBuildingFixtures } from './helpers.mjs';
import { CASES } from './review-cases.mjs';

const SAMPLES = Number(process.env.ENGINE_PROPERTY_SAMPLES) || 12;
const DEFS = new Map(INPUTS.inputs.map((d) => [d.id, d]));
const BOOL = [true, false];

// 시드 고정 난수(mulberry32) — 실패하면 같은 조합이 다시 나온다
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
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function normalize(input, policy) {
  return input.manual ? normalizeManual(input.manual, { useIndex: INDEX, policy }) : normalizeRegistry(input.registry || {}, { useIndex: INDEX, policy });
}
function run(sc, extra = {}) {
  return evaluateBuilding({
    building: normalize(sc.input, sc.policy),
    dataFiles: sc.dataFiles,
    exemptions: sc.exemptions,
    useIndex: INDEX,
    inputs: INPUTS,
    facilities: FACILITIES,
    answers: { ...sc.answers, ...extra },
    policy: sc.policy,
    today: TODAY,
  });
}

// 데이터가 쓰는 기준 상수·날짜 경계·플래그·설치 여부·용도 목록
function dataFacts(dataFiles) {
  const consts = new Map();
  const dates = new Set();
  const flags = new Set();
  const installed = new Set();
  const useTargets = new Map(); // stableKey → { use, floors(use 노드의 층 선택자) }
  const reviewKeys = new Set();
  for (const file of Object.values(dataFiles)) {
    if (file?.schema_version !== 2) continue;
    for (const fac of file.fire_facilities || []) {
      const rows = fac.regulations || [];
      if (!rows.some((r) => (r.kind ?? 'trigger') === 'trigger')) reviewKeys.add(`facility:${fac.facility_id}`);
      const roots = [...(fac.excluded_if ? [fac.excluded_if] : [])];
      for (const r of rows) {
        if (r.start_date) dates.add(r.start_date);
        if (r.end_date) dates.add(addDays(r.end_date, 1));
        if (r.needs_review && r.conditions === undefined && !r.branches) reviewKeys.add(r.id);
        roots.push(...rowConditionRoots(r).map(([n]) => n));
      }
      for (const root of roots) {
        for (const { input, value } of numericConstants(root)) {
          if (!consts.has(input)) consts.set(input, new Set());
          consts.get(input).add(value);
        }
        walkConditions(root, (n) => {
          const t = nodeType(n);
          if (t === 'flag') flags.add(n.flag);
          else if (t === 'installed') installed.add(n.installed);
          else if (t === 'use') useTargets.set(stableKey({ use: n.use, floors: n.floors ?? null }), { use: n.use, floors: n.floors ?? null });
          const spec = t === 'sum_area' || t === 'floor_exists' ? n[t] : null;
          const selectors = t === 'use' ? n.floors : spec?.floors;
          if (spec?.use) useTargets.set(stableKey({ use: spec.use }), { use: spec.use, floors: undefined });
          for (const s of selectors === undefined ? [] : normalizeFloors(selectors) || []) {
            if (s.use) useTargets.set(stableKey({ use: s.use }), { use: s.use, floors: undefined });
          }
        });
      }
    }
  }
  const constsFor = (...inputs) => [...new Set(inputs.flatMap((i) => [...(consts.get(i) || [])]))];
  return { constsFor, dates: [...dates].sort(), flags, installed, useTargets: [...useTargets.values()], reviewKeys };
}

// 수치 입력의 값 후보: 구간 양 끝 + 기준값 앞뒤 (정수이고 폭이 좁으면 모든 값)
function numericDomain(lo, hi, integer, consts) {
  const top = Number.isFinite(hi) ? hi : Math.max(lo, ...consts, 1) * 2 + 10;
  const vals = new Set([lo, top]);
  if (integer && top - lo <= 40) for (let v = Math.ceil(lo); v <= top; v++) vals.add(v);
  for (const c of consts) for (const v of integer ? [Math.floor(c) - 1, Math.floor(c), Math.ceil(c), Math.ceil(c) + 1] : [c - 1, c, c + 1]) vals.add(v);
  return [...vals].filter((v) => v >= lo && v <= top && (!integer || Number.isInteger(v))).sort((a, b) => a - b);
}

const isExactConfirmed = (iv) => iv.lo === iv.hi && !iv.open.length && [...iv.loDeps, ...iv.hiDeps].every((d) => d.status === CONFIRMED);
const hasAssumed = (iv) => [...iv.loDeps, ...iv.hiDeps].some((d) => d.status !== CONFIRMED);

// 모형이 허용하는 값 범위: 가정값이면 입력 정의 range 전체(가정을 푼 값), 아니면 지금 구간
function metricRange(iv, def) {
  const [rlo, rhi] = def?.range ?? [0, Infinity];
  if (!iv) return [rlo, rhi];
  if (hasAssumed(iv)) return [rlo, rhi];
  return [iv.lo, iv.hi];
}

// 답할 수 있는 입력과 값 후보 { 키: 값[] } — 이미 답한 입력(확정)은 뺀다
function answerUniverse(sc, base) {
  const building = normalize(sc.input, sc.policy);
  const data = dataFacts(sc.dataFiles);
  const answered = new Set(Object.keys(sc.answers || {}));
  const out = new Map();
  const add = (key, values) => {
    if (!answered.has(key) && values.length) out.set(key, values);
  };
  const METRIC_CONSTS = {
    ground_floors: ['ground_floors', 'floors_incl_basement', 'level'],
    basement_floors: ['basement_floors', 'floors_incl_basement', 'level'],
    floors_incl_basement: ['floors_incl_basement', 'ground_floors', 'basement_floors'],
    total_area: ['total_area', 'floor_area', 'use_area'],
  };
  const areaConsts = data.constsFor('floor_area', 'floor_use_area', 'use_area', 'total_area');
  for (const dong of building.dongs) {
    const at = (id) => `${id}@${dong.id}`;
    const m = dong.metrics;
    // 건물 단위 수치 입력
    for (const def of INPUTS.inputs) {
      if (def.scope !== 'building' || !['number', 'integer'].includes(def.type) || ['use_area'].includes(def.id)) continue;
      let iv = m[def.id];
      if (def.id === 'floors_incl_basement') {
        const [glo, ghi] = metricRange(m.ground_floors, DEFS.get('ground_floors'));
        const [blo, bhi] = metricRange(m.basement_floors, DEFS.get('basement_floors'));
        if (isExactConfirmed(m.ground_floors) && isExactConfirmed(m.basement_floors)) continue;
        add(at(def.id), numericDomain(glo + blo, ghi + bhi, true, data.constsFor(...METRIC_CONSTS.floors_incl_basement)));
        continue;
      }
      if (iv && isExactConfirmed(iv)) continue;
      const [lo, hi] = metricRange(iv, def);
      const consts = data.constsFor(...(METRIC_CONSTS[def.id] || [def.id]));
      // 지상·지하 층수: '지하층 포함 N개층' 기준에서 다른 쪽 층수를 뺀 값도 (폭 1짜리 합계 기준을 놓치지 않게)
      const other = { ground_floors: 'basement_floors', basement_floors: 'ground_floors' }[def.id];
      if (other) {
        const [olo, ohi] = metricRange(m[other], DEFS.get(other));
        for (const c of data.constsFor('floors_incl_basement')) for (let o = olo; o <= Math.min(ohi, olo + 40); o++) consts.push(c - o);
      }
      add(at(def.id), numericDomain(lo, hi, def.type === 'integer', consts));
    }
    // 예/아니오 입력: 승강기(대장에 없을 때), 사용자 확인 플래그, 설치 여부, 복합건축물, 원문 확인
    if (!dong.flags?.elevator) add(at('elevator'), BOOL);
    for (const f of data.flags) if (f !== 'elevator') add(at(f), BOOL);
    for (const id of data.installed) add(`installed[${id}]@${dong.id}`, BOOL);
    if (dong.mixedUseCandidate) add(at('mixed_use'), BOOL);
    for (const k of data.reviewKeys) add(`review[${k}]@${dong.id}`, BOOL);
    // 층 단위: 무창층(지상층), 면적 미상 층·부분, 용도가 미상인 층의 용도 여부
    const { floors, complete } = effectiveFloors(dong, countOf(m.ground_floors), countOf(m.basement_floors));
    const totalHi = m.total_area.hi;
    for (const floor of floors) {
      const fk = `${dong.id}/${floor.key}`;
      if (floor.kind === 'ground') add(`windowless@${fk}`, BOOL);
      if (floor.parts.length > 1) {
        floor.parts.forEach((p, i) => {
          if (p.area.open.length) add(`part_area[${p.n ?? i + 1}]@${fk}`, numericDomain(p.area.lo, Math.min(p.area.hi, totalHi), false, areaConsts));
        });
      } else if (floor.area.open.length) {
        add(`floor_area@${fk}`, numericDomain(floor.area.lo, Math.min(floor.area.hi, totalHi), false, areaConsts));
      }
      for (const { use } of data.useTargets) {
        if (floor.parts.some((p) => coverage(p.terms, use, INDEX) === 'maybe')) add(`use_presence[${stableKey({ use })}]@${fk}`, BOOL);
      }
    }
    // 동 전체 용도 여부(층 선택자 없는 use 노드): 어느 층에도 확정으로 있지 않고, 미상인 층이 있거나 빠진 층(표제부 용도)에 있을 수 있을 때만
    // (층 선택자가 있는 use 노드는 층별 용도 여부·층수 입력으로 답한다)
    const incomplete = !complete.ground || !complete.basement;
    for (const t of data.useTargets) {
      if (t.floors !== null) continue;
      const cs = floors.flatMap((f) => f.parts.map((p) => coverage(p.terms, t.use, INDEX)));
      const synth = coverage(dong.synthTerms, t.use, INDEX);
      if (cs.some((c) => c === 'all' || c === 'some')) continue;
      if (cs.includes('maybe') || (incomplete && synth !== 'none')) add(`use_presence[${stableKey({ use: t.use, floors: null })}]@${dong.id}`, BOOL);
    }
  }
  // 엔진이 이 건물에서 묻는 입력(용도 면적 등 파생 입력 포함) — 값 후보는 질문의 가능한 범위 안에서
  for (const q of base.questions) {
    if (out.has(q.key) || answered.has(q.key) || q.type === 'date' || q.dong === '대지 전체') continue;
    if (q.type === 'boolean') add(q.key, BOOL);
    else if (q.type === 'number' || q.type === 'integer') {
      const [lo, hi] = q.range ?? DEFS.get(q.input)?.range ?? [0, Infinity];
      add(q.key, numericDomain(lo, hi, q.type === 'integer', data.constsFor(q.input, 'floor_area', 'use_area', 'total_area')));
    }
  }
  if (base.site) add('site_connected', BOOL);
  // 날짜: 엔진의 검사 구간(dateInfo.window)이 아니라 건물의 날짜 사실에서 직접 — 허가일 후보가 여럿·사용승인일만·날짜 없음이면
  // 허가일을, 허가일이 하나로 확정이면 신청일을 답한다(모형이 문서로 정한 범위 안의 값만)
  const question = dateQuestion(building.dates || {}, sc.answers || {}, resolvePolicy(sc.policy));
  if (question) {
    const { id, from, to } = question;
    const W = resolvePolicy(sc.policy).applicationWindowDays;
    const cands = new Set([from, to]);
    for (const b of data.dates) for (const d of [b, addDays(b, -1), addDays(b, W), addDays(b, W - 1)]) cands.add(d);
    add(id, [...cands].filter((d) => d >= from && d <= to).sort());
  }
  return out;
}

function dateQuestion(dates, answers, pol) {
  if (answers.application_date || answers.permit_date) return null;
  const W = pol.applicationWindowDays;
  const permit = dates.permit;
  if (permit?.value) {
    const cands = permit.candidates?.length ? permit.candidates : [permit.value];
    if (cands.length > 1) return { id: 'permit_date', from: cands[0], to: cands[cands.length - 1] };
    return { id: 'application_date', from: addDays(permit.value, -W), to: permit.value };
  }
  const approval = dates.approval?.value;
  if (approval) return { id: 'permit_date', from: addDays(approval, -pol.approvalOnlyLookbackDays), to: approval };
  return { id: 'permit_date', from: addDays(EARLIEST, W), to: TODAY };
}

// 끝값 조합 4개 + 무작위 조합 — 조합마다 각 입력을 확률 p 로 답한다
function* assignments(universe, seed) {
  const keys = [...universe.keys()];
  const pick = (f) => Object.fromEntries(keys.map((k) => [k, f(universe.get(k))]));
  yield pick((vs) => vs[vs.length - 1]);
  yield pick((vs) => vs[0]);
  yield pick((vs) => (vs.includes(true) ? true : vs[vs.length - 1]));
  yield pick((vs) => (vs.includes(false) ? false : vs[0]));
  const rnd = prng(seed);
  for (let i = 0; i < SAMPLES; i++) {
    const a = {};
    for (const k of keys) if (rnd() < 0.4) a[k] = universe.get(k)[Math.floor(rnd() * universe.get(k).length)];
    yield a;
  }
}

function checkScenario(sc) {
  const base = run(sc);
  const notApplicable = [];
  for (const d of base.dongs) for (const f of d.facilities) if (f.verdict === '비해당') notApplicable.push([d.id, f.id]);
  if (!notApplicable.length) return { checked: 0, combos: 0 };
  const universe = answerUniverse(sc, base);
  let combos = 0;
  for (const a of assignments(universe, hash(sc.id))) {
    combos++;
    const r = run(sc, a);
    for (const [dongId, fid] of notApplicable) {
      const f = r.dongs.find((d) => d.id === dongId)?.facilities.find((x) => x.id === fid);
      if (!f) continue;
      assert.equal(f.verdict, '비해당', `${sc.id}: ${dongId}/${fid} 가 답변 ${JSON.stringify(a)} 에서 ${f.verdict}${f.questions.length ? ` (질문 ${f.questions.map((q) => q.key).join(', ')})` : ''}`);
    }
  }
  return { checked: notApplicable.length, combos, inputs: universe.size };
}

function goldenScenarios() {
  const out = [];
  for (const fx of loadBuildingFixtures()) {
    const set = { dataFiles: FIXTURE_SET.dataFiles, exemptions: FIXTURE_SET.exemptions };
    for (const policy of [undefined, { windowless: 'assume_none' }]) {
      const tag = policy ? ' [assume_none]' : '';
      out.push({ id: `${fx.id}${tag}`, input: fx.input, answers: fx.answers || {}, policy, ...set });
      for (const v of fx.variants || []) {
        const input = v.patch ? { registry: { ...fx.input.registry, ...v.patch } } : v.manualPatch ? { manual: { ...fx.input.manual, ...v.manualPatch } } : fx.input;
        out.push({ id: `${fx.id} [${v.name}]${tag}`, input, answers: v.answers || {}, policy, ...set });
      }
    }
  }
  return out;
}

test('비해당은 가정값·미확인 입력에 어떤 값을 답해도 비해당 — 골든 픽스처(기본·변형) × 무창층 정책', () => {
  let facilities = 0;
  let combos = 0;
  for (const sc of goldenScenarios()) {
    const r = checkScenario(sc);
    facilities += r.checked;
    combos += r.combos;
  }
  assert.ok(facilities > 50, `확인한 비해당 ${facilities}개`);
  assert.ok(combos > 100, `조합 ${combos}개`);
});

test('비해당은 가정값·미확인 입력에 어떤 값을 답해도 비해당 — 리뷰 재현 사례', () => {
  let facilities = 0;
  for (const c of CASES) {
    for (const policy of [c.policy, { ...(c.policy || {}), windowless: 'assume_none' }]) {
      facilities += checkScenario({ ...c, id: `${c.id}${policy === c.policy ? '' : ' [assume_none]'}`, answers: c.answers || {}, policy }).checked;
    }
  }
  assert.ok(facilities > 20, `확인한 비해당 ${facilities}개`);
});

test('시험 도구 자체 점검: 가정값을 확정처럼 쓰던 옛 동작(가정 F 를 비해당으로)이면 이 성질 시험이 잡아낸다', () => {
  // 가정값 정책에 기대는 비해당을 흉내: assume_none 에서 무창층 두 개가 함께여야 넘는 기준(리뷰 CE1)을 답변 없이 본 결과는 확인 필요여야 하고,
  // 두 층을 모두 '예'로 답하는 조합이 성질 시험의 끝값 조합(모두 true)에 들어 있어야 한다
  const sc = { ...CASES.find((c) => c.id === 'ce1-joint-assumed'), answers: {} };
  const base = run(sc);
  const universe = answerUniverse(sc, base);
  assert.deepEqual([...universe.keys()].filter((k) => k.startsWith('windowless@')), ['windowless@본동/1F', 'windowless@본동/2F']);
  const allTrue = assignments(universe, 1);
  allTrue.next();
  allTrue.next();
  const a = allTrue.next().value;
  assert.equal(run(sc, a).dongs[0].facilities.find((f) => f.id === 'smoke_control').verdict, '해당');
});
