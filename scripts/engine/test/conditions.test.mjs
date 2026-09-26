// 조건 노드 평가 — 구간으로 결론이 나면 묻지 않기, 질문 키, 답변 반영, 무창층·층 선택자
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSUMED, F, T, U, evalCondition, makeEnv, normalizeManual, normalizeRegistry, resolvePolicy, tv } from '../../../js/engine/index.js';
import { INDEX, INPUTS } from './helpers.mjs';
import { inputDefsFrom } from '../../../js/engine/questions.js';

const DEFS = inputDefsFrom(INPUTS);
const floor = (gb, no, etc, area, main = '제2종근린생활시설') => ({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: main, etcPurps: etc, area });
function dongOf(title, floors = []) {
  return normalizeRegistry({ title: [{ mainPurpsCdNm: '제2종근린생활시설', ugrndFlrCnt: 0, ...title }], floors }, { useIndex: INDEX }).dongs[0];
}
function run(node, dong, { answers = {}, policy = {}, facility } = {}) {
  return evalCondition(node, makeEnv({ dong, index: INDEX, answers, policy: resolvePolicy(policy), inputDefs: DEFS, facility }));
}
const keys = (r) => r.deps.map((d) => d.key).sort();
const MIDWIFE = { sum_area: { use: ['midwifery_clinic', 'postpartum_care'] }, gte: 600 };

test('연면적 450㎡ 동: 세부 용도를 몰라도 "조산원 600㎡ 이상"은 묻지 않고 확정 F', () => {
  const d = dongOf({ totArea: 450, grndFlrCnt: 3 }, [floor('20', 1, '', 150), floor('20', 2, '', 150), floor('20', 3, '', 150)]);
  const r = run(MIDWIFE, d);
  assert.equal(r.v, F);
  assert.ok(r.deps.every((d) => d.status === 'confirmed'), JSON.stringify(r.deps));
  assert.ok(!keys(r).some((k) => k.startsWith('use_area')));
});

test('연면적 800㎡ 동, 세부 용도 미상: 조산원 600㎡ 이상은 U — 질문은 용도별 면적 합계 하나', () => {
  const d = dongOf({ totArea: 800, grndFlrCnt: 2 }, [floor('20', 1, '', 400), floor('20', 2, '', 400)]);
  const r = run(MIDWIFE, d);
  assert.equal(r.v, U);
  assert.deepEqual(keys(r), ['use_area[{"floors":"all","use":["midwifery_clinic","postpartum_care"]}]@본동']);
  assert.deepEqual(r.deps[0].range, [0, 800]);
  assert.equal(run(MIDWIFE, d, { answers: { [keys(r)[0]]: 650 } }).v, T);
  assert.equal(run(MIDWIFE, d, { answers: { [keys(r)[0]]: 100 } }).v, F);
});

test('용도가 확정된 층은 정확한 합계, 한 행에 섞인 용도는 [0, 면적]', () => {
  const exactD = dongOf({ totArea: 900, grndFlrCnt: 2 }, [floor('20', 1, '조산원', 650, '제1종근린생활시설'), floor('20', 2, '소매점', 250)]);
  assert.equal(run(MIDWIFE, exactD).v, T);
  const mixedD = dongOf({ totArea: 900, grndFlrCnt: 2 }, [floor('20', 1, '조산원, 소매점', 650, '제1종근린생활시설'), floor('20', 2, '소매점', 250)]);
  assert.equal(run(MIDWIFE, mixedD).v, U);
  const smallMixed = dongOf({ totArea: 900, grndFlrCnt: 2 }, [floor('20', 1, '조산원, 소매점', 550, '제1종근린생활시설'), floor('20', 2, '소매점', 350)]);
  assert.equal(run(MIDWIFE, smallMixed).v, F);
});

const WL_1000 = { floor_exists: { floors: ['basement', 'windowless', { kind: 'ground', level: { gte: 4 } }], area: { gte: 1000 } } };

test('무창층: 면적 기준을 넘는 지상층만 질문 대상, 작은 층은 묻지 않음', () => {
  const d = dongOf({ totArea: 2600, grndFlrCnt: 3 }, [floor('20', 1, '소매점', 1050), floor('20', 2, '소매점', 1050), floor('20', 3, '소매점', 500)]);
  const r = run(WL_1000, d);
  assert.equal(r.v, U);
  assert.deepEqual(keys(r), ['windowless@본동/1F', 'windowless@본동/2F']);
  assert.equal(run(WL_1000, d, { answers: { 'windowless@본동/2F': true } }).v, T);
  assert.equal(run(WL_1000, d, { answers: { 'windowless@본동/1F': false, 'windowless@본동/2F': false } }).v, F);
});

test('무창층 정책 assume_none: 답이 없으면 가정 F (가정값 근거가 남음)', () => {
  const d = dongOf({ totArea: 2100, grndFlrCnt: 2 }, [floor('20', 1, '소매점', 1050), floor('20', 2, '소매점', 1050)]);
  const r = run(WL_1000, d, { policy: { windowless: 'assume_none' } });
  assert.equal(r.v, F);
  assert.ok(r.deps.some((x) => x.input === 'windowless' && x.status === ASSUMED));
});

test('지하층은 무창층 대상이 아님(지상층 정의) — 지하층은 층 구분으로 선택', () => {
  const d = dongOf({ totArea: 1400, grndFlrCnt: 1, ugrndFlrCnt: 1 }, [floor('10', 1, '소매점', 1100), floor('20', 1, '소매점', 300)]);
  const r = run({ floor_exists: { floors: ['windowless'], area: { gte: 1000 } } }, d);
  assert.equal(r.v, F);
  assert.equal(run(WL_1000, d).v, T);
});

test('층 선택자: N층 이상인 층, 지하 깊이(지하3층 이하), 지상 3~10층', () => {
  const floors = [floor('10', 3, '', 100), floor('10', 2, '', 100), floor('10', 1, '', 100), ...[1, 2, 3, 4].map((n) => floor('20', n, '', 100))];
  const d = dongOf({ totArea: 700, grndFlrCnt: 4, ugrndFlrCnt: 3 }, floors);
  assert.equal(run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 4 } }] } }, d).v, T);
  assert.equal(run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 5 } }] } }, d).v, F);
  assert.equal(run({ floor_exists: { floors: [{ kind: 'basement', level: { gte: 3 } }] } }, d).v, T);
  assert.equal(run({ sum_area: { floors: [{ kind: 'ground', level: { gte: 3, lte: 10 } }] }, gte: 200 }, d).v, T);
});

test('층 목록이 완전하면 모든 층 면적 합계 = 연면적 (층별 면적을 몰라도)', () => {
  const d = normalizeManual({ mainPurpsCdNm: '제2종근린생활시설', totArea: 800, grndFlrCnt: 2, ugrndFlrCnt: 0, enteredFields: ['ugrndFlrCnt'] }, { useIndex: INDEX }).dongs[0];
  assert.equal(run({ sum_area: {}, gte: 800 }, d).v, T);
  assert.equal(run({ sum_area: {}, gte: 801 }, d).v, F);
});

test('층수를 모르면 층 존재 여부는 F 가 아니라 U (층수 질문)', () => {
  const d = normalizeRegistry({ title: [{ mainPurpsCdNm: '업무시설', totArea: 500 }] }, { useIndex: INDEX }).dongs[0];
  const r = run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 11 } }] } }, d);
  assert.equal(r.v, U);
  assert.ok(keys(r).includes('ground_floors@본동'));
});

test('use 노드: 확정 용도 T/F, 와일드카드는 동 단위 질문 하나', () => {
  const known = dongOf({ totArea: 300, grndFlrCnt: 1 }, [floor('20', 1, '일반음식점', 300)]);
  assert.equal(run({ use: ['restaurant'] }, known).v, T);
  assert.equal(run({ use: ['bathhouse'] }, known).v, F);
  assert.equal(run({ use: ['02'] }, known).v, T);
  const wild = dongOf({ totArea: 300, grndFlrCnt: 1 }, [floor('20', 1, '', 300)]);
  const r = run({ use: ['bathhouse'] }, wild);
  assert.equal(r.v, U);
  assert.deepEqual(keys(r), ['use_presence[{"floors":null,"use":["bathhouse"]}]@본동']);
  assert.equal(run({ use: ['bathhouse'] }, wild, { answers: { [keys(r)[0]]: false } }).v, F);
});

test('flag·installed·const·facility 노드', () => {
  const d = normalizeRegistry({ title: [{ mainPurpsCdNm: '공동주택', totArea: 3000, grndFlrCnt: 10, ugrndFlrCnt: 0, rideUseElvtCnt: 2, emgenUseElvtCnt: 0 }] }, { useIndex: INDEX }).dongs[0];
  assert.equal(run({ flag: 'elevator' }, d).v, T);
  const gas = run({ flag: 'gas_facility' }, d);
  assert.equal(gas.v, U);
  assert.deepEqual(keys(gas), ['gas_facility@본동']);
  assert.equal(run({ flag: 'gas_facility' }, d, { answers: { 'gas_facility@본동': false } }).v, F);
  const inst = run({ installed: 'co2_extinguishing' }, d);
  assert.deepEqual(keys(inst), ['installed[co2_extinguishing]@본동']);
  assert.equal(run({ const: true }, d).v, T);
  assert.equal(run({ facility: 'auto_fire_detection' }, d, { facility: () => tv(T, [], ['자동화재탐지설비 해당']) }).v, T);
});

test('형식이 틀린 노드는 F 가 아니라 U (비해당으로 흘리지 않음)', () => {
  const d = dongOf({ totArea: 100, grndFlrCnt: 1 });
  assert.equal(run({ mystery: 1 }, d).v, U);
  assert.equal(run({ m: 'total_area', gte: 1, flag: 'x' }, d).v, U);
});
