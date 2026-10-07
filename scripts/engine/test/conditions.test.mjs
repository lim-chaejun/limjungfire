// 조건 노드 평가 — 구간으로 결론이 나면 묻지 않기, 질문 키, 답변 반영, 무창층·층 선택자
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSUMED, F, T, U, evalCondition, makeEnv, normalizeManual, normalizeRegistry, resolvePolicy, tv } from '../../../js/engine/index.js';
import { FIXTURE_SET, INDEX, INPUTS, loadBuildingFixtures, normalizeInput } from './helpers.mjs';
import { inputDefsFrom } from '../../../js/engine/questions.js';
import { rowConditionRoots } from '../../../js/engine/schema.js';

const DEFS = inputDefsFrom(INPUTS);
// 층별개요 행 — 면적제외여부 '0'(연면적 산입, 실제 대장 값). 빈칸·필로티 등 산입 여부를 모르는 행은 시험에서 따로 만든다
const floor = (gb, no, etc, area, main = '제2종근린생활시설') => ({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: main, etcPurps: etc, area, areaExctYn: '0' });
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

test('use 노드 + floors(H2): 층 목록이 불완전하면(지하층수 모름) 빠진 층에 있을 수 있으므로 F 가 아니라 U — 층수 질문', () => {
  const node = { use: ['singing_room'], floors: ['basement'] };
  const ground = [floor('20', 1, '일반음식점', 300), floor('20', 2, '일반음식점', 300)];
  const unknownB = dongOf({ etcPurps: '일반음식점, 노래연습장', totArea: 900, grndFlrCnt: 2, ugrndFlrCnt: '' }, ground);
  const r = run(node, unknownB);
  assert.equal(r.v, U);
  assert.deepEqual(keys(r), ['basement_floors@본동']);
  // 층도 층수도 없으면 역시 U
  assert.equal(run(node, dongOf({ etcPurps: '노래연습장', totArea: 500, grndFlrCnt: '', ugrndFlrCnt: '' })).v, U);
  // 지하층이 없다고 확정되면 F, 층별개요가 지하층을 모두 보이면 그 용도로 결정
  assert.equal(run(node, dongOf({ etcPurps: '일반음식점', totArea: 600, grndFlrCnt: 2, ugrndFlrCnt: 0 }, ground)).v, F);
  const listed = dongOf({ etcPurps: '일반음식점', totArea: 900, grndFlrCnt: 2, ugrndFlrCnt: 1 }, [floor('10', 1, '노래연습장', 300), ...ground]);
  assert.equal(run(node, listed).v, T);
  const listedNone = dongOf({ etcPurps: '일반음식점', totArea: 900, grndFlrCnt: 2, ugrndFlrCnt: 1 }, [floor('10', 1, '일반음식점', 300), ...ground]);
  assert.equal(run(node, listedNone).v, F);
  // 같은 데이터를 floor_exists 로 써도 결과가 같다
  assert.equal(run({ floor_exists: { floors: ['basement'], use: ['singing_room'] } }, unknownB).v, U);
});

test('층 목록 완전성은 구분별: 지상층수를 몰라도 지하층 조건은 결정되고, 지상층 조건만 층수 질문', () => {
  const d = dongOf({ totArea: 900, grndFlrCnt: '', ugrndFlrCnt: 1 }, [floor('10', 1, '', 300), floor('20', 1, '', 300)]);
  assert.equal(run({ floor_exists: { floors: ['basement'], area: { gte: 200 } } }, d).v, T);
  assert.equal(run({ floor_exists: { floors: [{ kind: 'basement', level: { gte: 2 } }] } }, d).v, F);
  assert.equal(run({ sum_area: { floors: ['basement'] }, gte: 301 }, d).v, F);
  const g = run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 6 } }] } }, d);
  assert.equal(g.v, U);
  assert.deepEqual(keys(g), ['ground_floors@본동']);
});

test('여러 행으로 나뉜 층(M6): 부분 면적 답변 part_area[n] 이 그 부분의 용도 면적 — 층 면적 답변이면 나머지로 역산', () => {
  // 2층(소매점)은 면적 미상 → 1층 노래연습장 행은 [0, 900 − 300]
  const d = dongOf({ etcPurps: '소매점, 노래연습장', totArea: 900, grndFlrCnt: 2 }, [
    floor('20', 1, '소매점', 300),
    floor('20', 1, '노래연습장', ''),
    floor('20', 2, '소매점', ''),
  ]);
  const node = { sum_area: { use: ['singing_room'] }, gte: 150 };
  const r = run(node, d);
  assert.equal(r.v, U);
  const dep = r.deps.find((x) => x.key === 'part_area[2]@본동/1F');
  assert.deepEqual(dep.range, [0, 600]);
  assert.equal(run(node, d, { answers: { 'part_area[2]@본동/1F': 200 } }).v, T);
  assert.equal(run(node, d, { answers: { 'part_area[2]@본동/1F': 100 } }).v, F);
  assert.equal(run(node, d, { answers: { 'floor_area@본동/1F': 420 } }).v, F);
  assert.equal(run(node, d, { answers: { 'floor_area@본동/1F': 500 } }).v, T);
});

test('면적 항등식(연면적 = 각 층 바닥면적의 합): 나머지가 정해지면 그 층·부분도 정해져 묻지 않는다, 질문 범위도 좁힌다', () => {
  // 한 층뿐이면 층 면적 = 연면적 → 빈 행 = 600 − 300
  const one = dongOf({ etcPurps: '소매점, 노래연습장', totArea: 600, grndFlrCnt: 1 }, [floor('20', 1, '소매점', 300), floor('20', 1, '노래연습장', '')]);
  const r = run({ sum_area: { use: ['singing_room'] }, gte: 150 }, one);
  assert.equal(r.v, T);
  assert.ok(r.deps.every((x) => x.status === 'confirmed'));
  // 1층 600 + 지하1층 400, 연면적 1,200 → 보충한 2층 = 200 (리뷰 LOW: 2층 0 답변으로 뒤집히던 사례)
  const d = dongOf({ totArea: 1200, grndFlrCnt: 2, ugrndFlrCnt: 1 }, [floor('20', 1, '', 600), floor('10', 1, '', 400)]);
  const two = run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 2 } }], area: { gte: 150 } } }, d);
  assert.equal(two.v, T);
  assert.equal(run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 2 } }], area: { gte: 250 } } }, d).v, F);
  // 두 층이 미상이면 각 층 [0, 나머지] — 질문 범위(range)가 좁혀진다
  const open = dongOf({ totArea: 1200, grndFlrCnt: 3 }, [floor('20', 1, '', 600)]);
  const u = run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 2 } }], area: { gte: 700 } } }, open);
  assert.equal(u.v, F);
  const u2 = run({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 2 } }], area: { gte: 500 } } }, open);
  assert.equal(u2.v, U);
  assert.deepEqual(u2.deps.map((x) => [x.key, x.range]).sort(), [['floor_area@본동/2F', [0, 600]], ['floor_area@본동/3F', [0, 600]]]);
});

test('면적 항등식이 모순이면(확정 층 면적 합 < 연면적) 쓰지 않는다 — 대상 층에 빈 면적을 몰아 주지 않음(리뷰 N1)', () => {
  const d = dongOf({ etcPurps: '소매점', totArea: 1000, grndFlrCnt: 2 }, [floor('20', 1, '소매점', 400), floor('20', 2, '소매점', 400)]);
  for (const node of [{ sum_area: { floors: ['windowless'] }, lt: 150 }, { sum_area: { floors: ['windowless'] }, gte: 150 }]) {
    const r = run(node, d);
    assert.equal(r.v, U, JSON.stringify(node));
    assert.deepEqual(keys(r), ['windowless@본동/1F', 'windowless@본동/2F']);
  }
  const no = { 'windowless@본동/1F': false, 'windowless@본동/2F': false };
  assert.equal(run({ sum_area: { floors: ['windowless'] }, lt: 150 }, d, { answers: no }).v, T);
  // 모순이 없으면 하한 보강은 그대로: 1·2층 미상, 연면적 1,000 → 모든 층 합계 = 1,000
  const ok = dongOf({ totArea: 1000, grndFlrCnt: 2 }, []);
  assert.equal(run({ sum_area: { floors: 'all' }, gte: 1000 }, ok).v, T);
});

test('층 목록이 불완전할 때 동 전체 use 노드의 빠진 층 몫은 표제부 용도가 있으면 U(확정 T 아님), 보충한 층의 여러 표제부 용도도 U(리뷰 N2·N2′)', () => {
  const n2 = dongOf({ etcPurps: '소매점, 노래연습장', totArea: 600, grndFlrCnt: 1, ugrndFlrCnt: '' }, [floor('20', 1, '', 600)]);
  assert.equal(run({ not: { use: ['singing_room'] } }, n2).v, U);
  const done = { 'basement_floors@본동': 0, 'use_presence[{"use":["singing_room"]}]@본동/1F': false };
  assert.equal(run({ not: { use: ['singing_room'] } }, n2, { answers: done }).v, T);
  // 표제부에 대상 용도가 없으면 빠진 층에도 없다고 본다(F)
  const plain = dongOf({ etcPurps: '소매점', totArea: 600, grndFlrCnt: 1, ugrndFlrCnt: '' }, [floor('20', 1, '소매점', 600)]);
  assert.equal(run({ use: ['singing_room'] }, plain).v, F);
  // 보충한 2층: 표제부 용도가 둘(소매점·노래연습장)이면 2층에 무엇이 있는지 모름 → 그 층 질문, 답하면 반영
  const synth = dongOf({ etcPurps: '소매점, 노래연습장', totArea: 800, grndFlrCnt: 2 }, [floor('20', 1, '노래연습장', 400)]);
  const node = { use: ['singing_room'], floors: [{ kind: 'ground', level: { gte: 2 } }] };
  const r = run({ not: node }, synth);
  assert.equal(r.v, U);
  assert.deepEqual(keys(r), ['use_presence[{"use":["singing_room"]}]@본동/2F']);
  assert.equal(run({ not: node }, synth, { answers: { 'use_presence[{"use":["singing_room"]}]@본동/2F': false } }).v, T);
  // 표제부 용도가 하나면 보충한 층은 그 용도(문서화한 가정): 확정
  const single = dongOf({ etcPurps: '노래연습장', totArea: 800, grndFlrCnt: 2 }, [floor('20', 1, '노래연습장', 400)]);
  assert.equal(run(node, single).v, T);
});

test('재평가(release, H1): 가정값(무창층 assume_none · 수동 입력 지하층 빈칸 0)을 모름으로 풀어 다시 평가', () => {
  const d = dongOf({ totArea: 1200, grndFlrCnt: 2 }, [floor('20', 1, '', 600), floor('20', 2, '', 600)]);
  const node = { floor_exists: { floors: ['windowless'] } };
  const envW = (release) => makeEnv({ dong: d, index: INDEX, answers: {}, policy: resolvePolicy({ windowless: 'assume_none' }), inputDefs: DEFS, release });
  const normal = evalCondition(node, envW(false));
  assert.equal(normal.v, F);
  assert.deepEqual(normal.deps.filter((x) => x.status === ASSUMED).map((x) => x.key), ['windowless@본동/1F', 'windowless@본동/2F']);
  const released = evalCondition(node, envW(true));
  assert.equal(released.v, U);
  assert.deepEqual(keys(released), ['windowless@본동/1F', 'windowless@본동/2F']);
  assert.ok(released.deps.every((x) => x.released));

  const m = normalizeManual({ mainPurpsCdNm: '제2종근린생활시설', totArea: 3000, grndFlrCnt: 5, ugrndFlrCnt: 0, pmsDay: '20240101' }, { useIndex: INDEX }).dongs[0];
  const envM = (release, answers = {}) => makeEnv({ dong: m, index: INDEX, answers, policy: resolvePolicy(), inputDefs: DEFS, release });
  const b = { m: 'floors_incl_basement', gte: 7 };
  assert.equal(evalCondition(b, envM(false)).v, F);
  const rb = evalCondition(b, envM(true));
  assert.equal(rb.v, U);
  assert.deepEqual(keys(rb), ['basement_floors@직접입력']);
  // 답변은 확정값이라 풀지 않는다
  assert.equal(evalCondition(b, envM(true, { 'basement_floors@직접입력': 1 })).v, F);
  assert.equal(evalCondition(b, envM(true, { 'basement_floors@직접입력': 2 })).v, T);
});

test('보조 용도(전기실 등, M5)는 층별개요에 거의 적히지 않으므로 다른 세부 용도 층에서도 F 가 아니라 미확인', () => {
  const d = dongOf({ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 600, grndFlrCnt: 1 }, [floor('20', 1, '소매점', 600, '제1종근린생활시설')]);
  assert.equal(run({ use: ['electrical_room'] }, d).v, U);
  assert.equal(run({ use: ['singing_room'] }, d).v, F);
});

test('값 전용 평가(track·explain 끔)는 근거를 모으는 평가와 같은 값 — 골든 건물 × TEST-ONLY 데이터의 모든 조건 (보통·재평가)', () => {
  let n = 0;
  for (const fx of loadBuildingFixtures()) {
    for (const dong of normalizeInput(fx.input).dongs) {
      for (const code of dong.typeCodes) {
        const file = FIXTURE_SET.dataFiles[code];
        if (file?.schema_version !== 2) continue;
        for (const fac of file.fire_facilities) {
          for (const r of fac.regulations) {
            for (const [node, where] of rowConditionRoots(r)) {
              for (const release of [false, true]) {
                const mk = (track) => makeEnv({ dong, index: INDEX, answers: fx.answers || {}, policy: resolvePolicy(), inputDefs: DEFS, release, track, explain: track });
                assert.equal(evalCondition(node, mk(false)).v, evalCondition(node, mk(true)).v, `${fx.id}/${dong.id}/${r.id}.${where} release=${release}`);
                n++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(n > 100, `비교한 조건 ${n}개`);
});
