// 연결된 동(대지 전체) 모으기 — 3차 리뷰: 합친 동의 무창층·플래그를 '어느 동이든'으로 모으면 부정 조건(not·excluded_if)에서
// 틀린 비해당이 났다. 여기서는 무작위 대지(상가동 + 주차 전용 동)로
//   A) 사실을 모두 아는 상태에서 합친 동의 조건 값을 독립 계산(오라클)과 맞춰 보고 — 무창층·용도는 동별 층마다, 층 면적 기준은
//      동별 층 읽기와 같은 층을 합친 한 층 읽기가 같을 때만 확정(다르면 모름), 플래그는 입력 정의의 site_aggregation 대로
//   B) 부정 조건이 섞인 기준으로 질문에 답해 가도 처음의 비해당이 비해당으로 남는지(단조성) 본다.
// 시드 고정. 더 돌리려면: ENGINE_SITE_FUZZ_SEEDS=1,2,3,4,5 ENGINE_SITE_FUZZ_CASES=300 node --test scripts/engine/test/site-aggregation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  F, T, U, evalCondition, evaluateBuilding, inputDefsFrom, makeEnv, mergeDongs, normalizeRegistry, not, resolvePolicy, tv,
} from '../../../js/engine/index.js';
import { FACILITIES, INDEX, INPUTS, TODAY } from './helpers.mjs';

const SEEDS = (process.env.ENGINE_SITE_FUZZ_SEEDS || '1,2').split(',').map(Number).filter(Number.isFinite);
const CASES = Number(process.env.ENGINE_SITE_FUZZ_CASES) || 60;
const DEFS = inputDefsFrom(INPUTS);
const POLICY = resolvePolicy();

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

// 상가동(지상 1~3층, 지하 0~1층) + 주차 전용 동(주차타워 1~2층 또는 지하주차장 1~2층). 층 면적은 모두 층별개요에 있음
function randomSite(rnd, { blankAreas = false } = {}) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const g = 1 + Math.floor(rnd() * 3);
  const b = Math.floor(rnd() * 2);
  const areas = [100, 300, 500, 700, 900];
  const floors = [];
  let total = 0;
  const item = (dongNm, gb, no, main, etc) => {
    const area = pick(areas);
    total += area;
    floors.push({ dongNm, flrGbCd: gb, flrNo: no, mainPurpsCdNm: main, etcPurps: etc, area: blankAreas && rnd() < 0.3 ? '' : area });
    return area;
  };
  for (let k = 1; k <= g; k++) item('상가동', '20', k, '제1종근린생활시설', pick(['소매점', '일반음식점']));
  for (let k = 1; k <= b; k++) item('상가동', '10', k, '제1종근린생활시설', '소매점');
  const shopTotal = total;
  total = 0;
  const tower = rnd() < 0.5;
  const pc = 1 + Math.floor(rnd() * 2);
  for (let k = 1; k <= pc; k++) item('주차동', tower ? '20' : '10', k, '자동차관련시설', '주차장');
  const parkTotal = total;
  return {
    title: [
      { dongNm: '상가동', mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: shopTotal, grndFlrCnt: g, ugrndFlrCnt: b },
      { dongNm: '주차동', mainPurpsCdNm: '자동차관련시설', etcPurps: '주차장', totArea: parkTotal, grndFlrCnt: tower ? pc : 0, ugrndFlrCnt: tower ? 0 : pc },
    ],
    floors,
    permit: [{ archPmsDay: '20150101', archGbCdNm: '신축' }],
  };
}

const floorKey = (it) => (it.flrGbCd === '10' ? `B${it.flrNo}` : `${it.flrNo}F`);

// ───── A) 오라클 ─────

function oracleCase(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const registry = randomSite(rnd);
  const members = registry.floors.map((it) => ({ dong: it.dongNm, key: floorKey(it), kind: it.flrGbCd === '10' ? 'basement' : 'ground', level: it.flrNo, area: it.area }));
  const answers = { site_connected: true };
  for (const m of members) {
    m.windowless = m.kind === 'ground' ? rnd() < 0.5 : false;
    if (m.kind === 'ground') answers[`windowless@${m.dong}/${m.key}`] = m.windowless;
  }
  const flags = {};
  for (const d of ['상가동', '주차동']) {
    flags[d] = { gas_facility: rnd() < 0.4, noncombustible_structure: rnd() < 0.5 };
    for (const [id, v] of Object.entries(flags[d])) answers[`${id}@${d}`] = v;
  }
  const choice = pick([undefined, undefined, true, false]);
  if (choice !== undefined) answers['site_combined_floors@대지 전체'] = choice;
  const building = normalizeRegistry(registry, { useIndex: INDEX });
  const site = mergeDongs(building.dongs, { useIndex: INDEX });
  const env = makeEnv({ dong: site, index: INDEX, answers, policy: POLICY, inputDefs: DEFS });
  return { pick, members, flags, choice, env };
}

const V = (b) => (b ? T : F);
const consensus = (perMember, combined, choice) => (choice === true ? combined : choice === false ? perMember : perMember === combined ? perMember : U);

// 합친 층 읽기: 선택된 동별 층 면적을 층 키별로 합쳐 기준을 보는가
function combinedExists(selected, x) {
  const byKey = new Map();
  for (const m of selected) byKey.set(m.key, (byKey.get(m.key) || 0) + m.area);
  return [...byKey.values()].some((a) => a >= x);
}

function oracleChecks(c) {
  const { pick, members, flags, choice, env } = c;
  const checks = [];
  const X = pick([300, 500, 800, 1000, 1400, 1800]);
  const L = pick([1, 2, 3]);
  const windowlessFloors = members.filter((m) => m.windowless);
  const sumW = windowlessFloors.reduce((s, m) => s + m.area, 0);
  checks.push([{ sum_area: { floors: ['windowless'] }, gte: X }, V(sumW >= X)]);
  checks.push([{ sum_area: { floors: ['windowless'] }, lt: X }, V(sumW < X)]);
  checks.push([{ floor_exists: { floors: ['windowless'] } }, V(windowlessFloors.length > 0)]);
  checks.push([
    { floor_exists: { floors: ['windowless'], area: { gte: X } } },
    consensus(V(windowlessFloors.some((m) => m.area >= X)), V(combinedExists(windowlessFloors, X)), choice),
  ]);
  const upper = members.filter((m) => m.kind === 'ground' && m.level >= L);
  checks.push([
    { floor_exists: { floors: [{ kind: 'ground', level: { gte: L } }], area: { gte: X } } },
    consensus(V(upper.some((m) => m.area >= X)), V(combinedExists(upper, X)), choice),
  ]);
  checks.push([{ sum_area: { floors: [{ kind: 'ground', level: { gte: L } }] }, gte: X }, V(upper.reduce((s, m) => s + m.area, 0) >= X)]);
  checks.push([{ flag: 'gas_facility' }, V(flags['상가동'].gas_facility || flags['주차동'].gas_facility)]);
  checks.push([{ flag: 'noncombustible_structure' }, V(flags['상가동'].noncombustible_structure && flags['주차동'].noncombustible_structure)]);
  // 부정: Kleene not
  for (const [node, want] of [...checks]) checks.push([{ not: node }, not(tv(want)).v]);
  return checks.map(([node, want]) => ({ node, want, got: evalCondition(node, env).v }));
}

for (const seed of SEEDS) {
  test(`합친 동 오라클 seed ${seed}: 무창층·층 면적 기준·플래그를 독립 계산과 맞춰 본다(부정 포함, 사례 ${CASES})`, () => {
    const rnd = prng(seed);
    let n = 0;
    for (let i = 0; i < CASES; i++) {
      const c = oracleCase(rnd);
      for (const { node, want, got } of oracleChecks(c)) {
        n++;
        assert.equal(got, want, `${JSON.stringify(node)} — 사례 ${i}: ${JSON.stringify(c.members)} ${JSON.stringify(c.flags)} 합친 층=${c.choice}`);
      }
    }
    assert.ok(n > 0);
  });
}

// ───── B) 부정 조건이 섞인 기준의 단조성 ─────

const TEMPLATES = [
  (x) => ({ excluded_if: { sum_area: { floors: ['windowless'] }, gte: x } }),
  (x) => ({ excluded_if: { floor_exists: { floors: ['windowless'], area: { gte: x } } } }),
  () => ({ excluded_if: { flag: 'noncombustible_structure' } }),
  () => ({ excluded_if: { not: { flag: 'gas_facility' } } }),
  (x) => ({ excluded_if: { floor_exists: { floors: [{ kind: 'ground', level: { gte: 1 } }], area: { gte: x } } } }),
  (x) => ({ excluded_if: { all: [{ flag: 'noncombustible_structure' }, { not: { sum_area: { floors: ['windowless'] }, gte: x } }] } }),
];
const TRIGGERS = [
  (x) => ({ m: 'total_area', gte: x }),
  (x) => ({ not: { sum_area: { floors: ['windowless'] }, gte: x } }),
  (x) => ({ any: [{ flag: 'gas_facility' }, { floor_exists: { floors: ['windowless'], area: { gte: x } } }] }),
  () => ({ not: { flag: 'noncombustible_structure' } }),
];

function siteData(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const facilities = Array.from({ length: 3 }, (_, i) => ({
    facility_id: `s${i}`,
    facility_name: `S${i}`,
    regulations: [{ id: `r${i}`, start_date: null, end_date: null, criteria: `r${i}`, kind: 'trigger', scope: 'all_floors', conditions: pick(TRIGGERS)(pick([300, 800, 1200, 2000])) }],
    ...pick(TEMPLATES)(pick([300, 800, 1000, 1500])),
  }));
  const file = (code, facs) => ({ schema_version: 2, type_code: code, review: { status: 'draft', by: null, date: null }, fire_facilities: facs });
  return { '02': file('02', facilities), '18': file('18', facilities), '30': file('30', []) };
}

function run(sc, answers) {
  const building = normalizeRegistry(sc.registry, { useIndex: INDEX });
  return evaluateBuilding({ building, dataFiles: sc.data, useIndex: INDEX, inputs: INPUTS, facilities: FACILITIES, answers, today: TODAY });
}

function questionValues(q) {
  if (q.type === 'boolean') return [true, false];
  if (q.type !== 'number' && q.type !== 'integer') return [];
  const [lo, hi] = q.range ?? [0, 3000];
  const top = Number.isFinite(hi) ? hi : lo + 3000;
  return [...new Set([lo, top, (lo + top) / 2].map((v) => (q.type === 'integer' ? Math.round(v) : v)))];
}

for (const seed of SEEDS) {
  test(`합친 동 단조성 seed ${seed}: 부정·제외 조건(무창층·플래그)이 섞여도 질문에 답해 가며 비해당이 뒤집히지 않는다(사례 ${CASES})`, () => {
    const rnd = prng(seed * 31 + 7);
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    let checks = 0;
    for (let i = 0; i < CASES; i++) {
      const sc = { registry: randomSite(rnd, { blankAreas: true }), data: siteData(rnd) };
      const base = run(sc, {});
      const initial = base.dongs.flatMap((d) => d.facilities.filter((f) => f.verdict === '비해당').map((f) => [d.id, f.id]));
      let answers = {};
      let r = base;
      for (let round = 0; round < 6; round++) {
        let n = 0;
        for (const q of r.questions) {
          if (q.key in answers || q.type === 'date') continue;
          const vs = questionValues(q);
          if (!vs.length) continue;
          answers = { ...answers, [q.key]: pick(vs) };
          n++;
        }
        if (!n) break;
        r = run(sc, answers);
        for (const [dong, fid] of initial) {
          const f = r.dongs.find((d) => d.id === dong)?.facilities.find((x) => x.id === fid);
          checks++;
          assert.ok(!f || f.verdict === '비해당', `${dong}/${fid}: 비해당 → ${f?.verdict} — 사례 ${i} ${JSON.stringify({ answers, registry: sc.registry, rules: sc.data['02'].fire_facilities })}`);
        }
      }
    }
    assert.ok(checks > 0);
  });
}
