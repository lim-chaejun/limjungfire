// 검증기 — 오류 코드별 동작, 순환 의존, item_key 기간 중복, v1 필드 불변, 원문 대조 경고
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ERROR_CODES, WARNING_CODES, checkItemKeyOverlaps, compareV1Fields, findFacilityCycles, lintRow, makeValidationContext, validateConditions, validateFile,
  validateFileSet, validateRow,
} from '../../../js/engine/index.js';
import { FACILITIES, FIXTURE_DATA, INPUTS, ROOT, VOCABULARY, readJson } from './helpers.mjs';

const ctx = makeValidationContext({ inputs: INPUTS, vocabulary: VOCABULARY, facilities: FACILITIES });
const codes = (errs) => errs.map((e) => e.code);
const condCodes = (node) => codes(validateConditions(node, ctx));

test('모든 오류·경고 코드에는 한국어 설명이 있다', () => {
  for (const [code, msg] of Object.entries({ ...ERROR_CODES, ...WARNING_CODES })) assert.ok(typeof msg === 'string' && msg.length > 5, code);
});

test('유효한 조건 트리는 오류 없음', () => {
  const node = {
    any: [
      { all: [{ m: 'ground_floors', gte: 5 }, { m: 'total_area', gte: 6000 }] },
      { floor_exists: { floors: ['basement', 'windowless', { kind: 'ground', level: { gte: 4 } }], area: { gte: 300 } } },
      { sum_area: { floors: ['basement'], use: ['garage', 'indoor_parking'] }, gt: 0, lt: 200 },
      { not: { use: ['02', 'bathhouse'], floors: [{ use: ['retail_small'] }] } },
      { flag: 'gas_facility' },
      { facility: 'auto_fire_detection' },
      { installed: 'co2_extinguishing' },
      { installed: 'sprinkler' },
      { const: true },
    ],
  };
  assert.deepEqual(validateConditions(node, ctx), []);
});

test('노드 형식 오류: COND_NOT_NODE · COND_EXTRA_KEY · COND_EMPTY_LIST · COND_TOO_DEEP', () => {
  assert.deepEqual(condCodes({}), ['COND_NOT_NODE']);
  assert.deepEqual(condCodes('x'), ['COND_NOT_NODE']);
  assert.deepEqual(condCodes(null), ['COND_NOT_NODE']);
  assert.deepEqual(condCodes({ all: [{ const: true }], any: [{ const: true }] }), ['COND_NOT_NODE']);
  assert.deepEqual(condCodes({ m: 'total_area', gte: 1, foo: 1 }), ['COND_EXTRA_KEY']);
  assert.deepEqual(condCodes({ all: [] }), ['COND_EMPTY_LIST']);
  let deep = { const: true };
  for (let i = 0; i < 25; i++) deep = { not: deep };
  assert.ok(condCodes(deep).includes('COND_TOO_DEEP'));
});

test('비교·지표·플래그: COND_BAD_OP · COND_UNKNOWN_METRIC · COND_UNKNOWN_FLAG · COND_BAD_CONST', () => {
  assert.deepEqual(condCodes({ m: 'total_area' }), ['COND_BAD_OP']);
  assert.deepEqual(condCodes({ m: 'total_area', gte: '600' }), ['COND_BAD_OP']);
  assert.deepEqual(condCodes({ m: 'nope', gte: 1 }), ['COND_UNKNOWN_METRIC']);
  assert.deepEqual(condCodes({ m: 'windowless', gte: 1 }), ['COND_UNKNOWN_METRIC'], '참/거짓 입력은 m 불가');
  assert.deepEqual(condCodes({ m: 'floor_area', gte: 1 }), ['COND_UNKNOWN_METRIC'], '층 단위 입력은 m 불가');
  assert.deepEqual(condCodes({ m: 'use_area', gte: 1 }), ['COND_UNKNOWN_METRIC'], '엔진 전용 입력은 m 불가');
  assert.deepEqual(condCodes({ flag: 'total_area' }), ['COND_UNKNOWN_FLAG']);
  assert.deepEqual(condCodes({ flag: 'mixed_use' }), ['COND_UNKNOWN_FLAG']);
  assert.deepEqual(condCodes({ const: 'yes' }), ['COND_BAD_CONST']);
});

test('용도·층·면적 형식: COND_UNKNOWN_USE · COND_BAD_FLOORS · COND_BAD_AREA_SPEC', () => {
  assert.deepEqual(condCodes({ use: ['nope'] }), ['COND_UNKNOWN_USE']);
  assert.deepEqual(condCodes({ use: [] }), ['COND_UNKNOWN_USE']);
  assert.deepEqual(condCodes({ use: ['99'] }), ['COND_UNKNOWN_USE']);
  assert.deepEqual(condCodes({ floor_exists: { floors: ['upstairs'] } }), ['COND_BAD_FLOORS']);
  assert.deepEqual(condCodes({ floor_exists: { floors: [{ kind: 'attic' }] } }), ['COND_BAD_FLOORS']);
  assert.deepEqual(condCodes({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 3.5 } }] } }), ['COND_BAD_OP']);
  assert.deepEqual(condCodes({ floor_exists: { floors: [{ windowless: false }] } }), ['COND_BAD_FLOORS']);
  assert.deepEqual(condCodes({ floor_exists: { floors: [{}] } }), ['COND_BAD_FLOORS']);
  assert.deepEqual(condCodes({ floor_exists: { floors: [{ storey: 3 }] } }), ['COND_BAD_FLOORS']);
  assert.deepEqual(condCodes({ sum_area: { floor: 'all' }, gte: 1 }), ['COND_BAD_AREA_SPEC']);
  assert.deepEqual(condCodes({ floor_exists: { area: { min: 3 } } }), ['COND_BAD_AREA_SPEC']);
});

test('시설 참조: COND_UNKNOWN_FACILITY · COND_UNKNOWN_INSTALLABLE (시설 마스터 없으면 건너뜀)', () => {
  assert.deepEqual(condCodes({ facility: 'nope' }), ['COND_UNKNOWN_FACILITY']);
  assert.deepEqual(condCodes({ installed: 'nope' }), ['COND_UNKNOWN_INSTALLABLE']);
  const loose = makeValidationContext({ inputs: INPUTS, vocabulary: VOCABULARY });
  assert.deepEqual(validateConditions({ facility: 'anything' }, loose), []);
});

test('오류 경로는 트리 위치를 가리킨다', () => {
  const errs = validateConditions({ all: [{ const: true }, { m: 'nope', gte: 1 }] }, ctx, 'fire_facilities[0].regulations[2].conditions');
  assert.equal(errs[0].path, 'fire_facilities[0].regulations[2].conditions.all[1].m');
});

const ROW = {
  id: 'x-1',
  start_date: '20180127',
  end_date: null,
  criteria: '층수가 6층 이상인 경우 모든 층',
  kind: 'trigger',
  conditions: { m: 'ground_floors', gte: 6 },
  scope: 'all_floors',
  inputs_required: ['ground_floors'],
};
const rowCodes = (patch) => codes(validateRow({ ...ROW, ...patch }, ctx));

test('유효한 행은 오류 없음', () => {
  assert.deepEqual(rowCodes({}), []);
});

test('행 오류 코드', () => {
  assert.deepEqual(rowCodes({ id: '' }), ['ROW_BAD_ID']);
  assert.deepEqual(rowCodes({ kind: 'rule' }), ['ROW_BAD_KIND']);
  assert.deepEqual(rowCodes({ criteria: undefined }), ['ROW_MISSING_CRITERIA']);
  assert.deepEqual(rowCodes({ start_date: '2018-01-27' }), ['ROW_BAD_DATE']);
  assert.deepEqual(rowCodes({ start_date: '20180230' }), ['ROW_BAD_DATE']);
  assert.deepEqual(rowCodes({ end_date: '20170101' }), ['ROW_DATE_ORDER']);
  assert.deepEqual(rowCodes({ conditions: undefined, inputs_required: undefined }), ['ROW_NO_CONDITIONS']);
  assert.deepEqual(rowCodes({ conditions: undefined, inputs_required: undefined, needs_review: { reason: '구조화 전' } }), []);
  assert.deepEqual(rowCodes({ scope: undefined }), ['ROW_BAD_SCOPE']);
  assert.deepEqual(rowCodes({ scope: 'floors' }), ['ROW_BAD_SCOPE']);
  assert.deepEqual(rowCodes({ scope: { type: 'floors' } }), ['ROW_BAD_SCOPE']);
  assert.deepEqual(rowCodes({ specs: 'x' }), ['ROW_BAD_SPECS']);
  assert.deepEqual(rowCodes({ retroactive: { deadline: '20261231', grace_until: '20251231' } }), ['ROW_BAD_RETROACTIVE']);
  assert.deepEqual(rowCodes({ retroactive: { until: '20261231' } }), ['ROW_BAD_RETROACTIVE']);
  assert.deepEqual(rowCodes({ item_key: '' }), ['ROW_BAD_ITEM_KEY']);
  assert.deepEqual(rowCodes({ needs_review: {} }), ['ROW_BAD_NEEDS_REVIEW']);
  assert.deepEqual(rowCodes({ inputs_required: ['nope'] }), ['ROW_BAD_INPUTS_REQUIRED']);
  assert.deepEqual(rowCodes({ inputs_required: [] }), ['ROW_INPUTS_MISSING']);
  assert.deepEqual(rowCodes({ condition: { const: true } }), ['ROW_UNKNOWN_FIELD']);
  assert.deepEqual(codes(validateRow('x', ctx)), ['ROW_NOT_OBJECT']);
});

test('분기 형식: when 없는 분기는 마지막만, 각 분기에 conditions', () => {
  const ok = { branches: [{ when: { use: ['bathhouse'] }, conditions: { m: 'total_area', gte: 1000 } }, { conditions: { m: 'total_area', gte: 600 } }], conditions: undefined, inputs_required: undefined };
  assert.deepEqual(rowCodes(ok), []);
  assert.deepEqual(rowCodes({ ...ok, branches: [{ conditions: { const: true } }, { when: { const: true }, conditions: { const: true } }] }), ['ROW_BAD_BRANCHES']);
  assert.deepEqual(rowCodes({ ...ok, branches: [{ when: { const: true } }] }), ['ROW_BAD_BRANCHES']);
  assert.deepEqual(rowCodes({ ...ok, branches: [] }), ['ROW_BAD_BRANCHES']);
  assert.deepEqual(rowCodes({ ...ok, branches: [{ conditions: { m: 'nope', gte: 1 } }] }), ['COND_UNKNOWN_METRIC']);
});

const span = (id, s, e, key = 'k') => ({ row: { id, start_date: s, end_date: e, item_key: key }, path: id });

test('item_key 버전 체인: 기간이 겹치면 ITEM_KEY_OVERLAP, 이어지기만 하면 통과', () => {
  assert.deepEqual(checkItemKeyOverlaps([span('a', '20050101', '20180126'), span('b', '20180127', null)]), []);
  assert.deepEqual(codes(checkItemKeyOverlaps([span('a', '20050101', '20180127'), span('b', '20180127', null)])), ['ITEM_KEY_OVERLAP']);
  assert.deepEqual(codes(checkItemKeyOverlaps([span('a', null, null), span('b', '20200101', null)])), ['ITEM_KEY_OVERLAP']);
  assert.deepEqual(checkItemKeyOverlaps([span('a', null, null, 'k1'), span('b', null, null, 'k2')]), []);
  const three = checkItemKeyOverlaps([span('a', '20000101', '20101231'), span('b', '20050101', '20151231'), span('c', '20100101', null)]);
  assert.equal(three.length, 3);
});

const fac = (id, refs = [], excluded) => ({
  facility_id: id,
  regulations: refs.map((r, i) => ({ id: `${id}-${i}`, criteria: '', kind: 'trigger', scope: 'all_floors', conditions: { facility: r } })),
  ...(excluded ? { excluded_if: { facility: excluded } } : {}),
});

test('시설 의존 순환 감지 (자기 참조·간접 순환·excluded_if 경유)', () => {
  assert.deepEqual(findFacilityCycles([fac('a', ['b']), fac('b', ['a'])]), [['a', 'b', 'a']]);
  assert.deepEqual(findFacilityCycles([fac('a', ['a'])]), [['a', 'a']]);
  assert.deepEqual(findFacilityCycles([fac('a', ['b']), fac('b', ['c']), fac('c', [], 'a')]), [['a', 'b', 'c', 'a']]);
  assert.deepEqual(findFacilityCycles([fac('visual_alarm', ['auto_fire_detection']), fac('auto_fire_detection')]), []);
});

const FILE = () => ({
  schema_version: 2,
  type_code: '02',
  review: { status: 'draft', by: null, date: null },
  strengthened_retroactive: ['fire_extinguisher'],
  fire_facilities: [
    { facility_id: 'fire_extinguisher', facility_name: '소화기구', regulations: [{ ...ROW, id: 'r1' }] },
    { facility_id: 'visual_alarm', facility_name: '시각경보기', regulations: [{ ...ROW, id: 'r2', conditions: { facility: 'auto_fire_detection' }, inputs_required: [] }] },
  ],
});
const fileCodes = (mut, name = '02_neighborhood_facilities.json') => {
  const f = FILE();
  mut(f);
  return codes(validateFile(f, ctx, { fileName: name }).errors);
};

test('파일 검증: 정상 파일, v1 파일은 건너뜀', () => {
  assert.deepEqual(fileCodes(() => {}), []);
  const v1 = validateFile({ building_type: 'x', fire_facilities: [] }, ctx);
  assert.equal(v1.v1, true);
});

test('파일 오류 코드', () => {
  assert.deepEqual(fileCodes((f) => (f.schema_version = 3)), ['FILE_BAD_SCHEMA_VERSION']);
  assert.deepEqual(fileCodes((f) => (f.type_code = '2')), ['FILE_BAD_TYPE_CODE']);
  assert.deepEqual(fileCodes((f) => (f.type_code = '12')), ['FILE_TYPE_CODE_MISMATCH']);
  assert.deepEqual(fileCodes((f) => (f.review = { status: 'ok' })), ['FILE_BAD_REVIEW']);
  assert.deepEqual(fileCodes((f) => delete f.review), ['FILE_BAD_REVIEW']);
  assert.deepEqual(fileCodes((f) => (f.strengthened_retroactive = ['sprinkler'])), ['FILE_BAD_STRENGTHENED']);
  assert.deepEqual(fileCodes((f) => (f.fire_facilities[0].facility_id = 'nope')), ['FACILITY_UNKNOWN_ID', 'FILE_BAD_STRENGTHENED']);
  assert.deepEqual(fileCodes((f) => (f.fire_facilities[1].facility_id = 'fire_extinguisher')), ['FACILITY_DUPLICATE']);
  assert.deepEqual(fileCodes((f) => (f.fire_facilities[1].regulations[0].id = 'r1')), ['ROW_DUPLICATE_ID']);
  assert.deepEqual(fileCodes((f) => (f.fire_facilities = {})), ['FILE_BAD_FACILITIES']);
  assert.deepEqual(
    fileCodes((f) => {
      f.fire_facilities[0].regulations[0].conditions = { facility: 'visual_alarm' };
      f.fire_facilities[0].regulations[0].inputs_required = [];
      f.fire_facilities[1].regulations[0].conditions = { facility: 'fire_extinguisher' };
    }),
    ['FACILITY_CYCLE'],
  );
  assert.deepEqual(
    fileCodes((f) => {
      f.fire_facilities[0].regulations.push({ ...ROW, id: 'r3', item_key: 'same' });
      f.fire_facilities[0].regulations[0].item_key = 'same';
    }),
    ['ITEM_KEY_OVERLAP'],
  );
});

test('픽스처 v2 파일은 오류 없음, 실제 data/NN_*.json 은 모두 v1 이라 건너뜀', () => {
  for (const name of fs.readdirSync(FIXTURE_DATA).filter((n) => /^\d\d_/.test(n))) {
    const r = validateFile(readJson(path.join(FIXTURE_DATA, name)), ctx, { fileName: name });
    assert.deepEqual(r.errors, [], name);
  }
  const dataDir = path.join(ROOT, 'data');
  for (const name of fs.readdirSync(dataDir).filter((n) => /^\d\d_.+\.json$/.test(n))) {
    assert.equal(validateFile(readJson(path.join(dataDir, name)), ctx, { fileName: name }).v1, true, name);
  }
});

test('v1 필드 불변: 추가형 변경은 통과, criteria·날짜·행 수·시설 순서 변경은 오류', () => {
  const before = readJson(path.join(ROOT, 'data', '02_neighborhood_facilities.json'));
  const additive = structuredClone(before);
  Object.assign(additive, { schema_version: 2, type_code: '02' });
  additive.fire_facilities[0].regulations[0].id = 'x';
  additive.fire_facilities[0].regulations[0].conditions = { m: 'total_area', gte: 33 };
  assert.deepEqual(compareV1Fields(before, additive), []);

  const edited = structuredClone(before);
  // 실제 데이터와 반드시 다른 날짜로 바꾼다 (데이터 정정으로 원래 값이 같아지면 바뀐 것이 없게 된다)
  const origStart = before.fire_facilities[2].regulations[0].start_date;
  edited.fire_facilities[2].regulations[0].start_date = origStart === '19000101' ? '19000102' : '19000101';
  edited.fire_facilities[1].regulations[0].criteria += ' ';
  assert.deepEqual(codes(compareV1Fields(before, edited)), ['V1_FIELD_CHANGED', 'V1_FIELD_CHANGED']);

  const added = structuredClone(before);
  added.fire_facilities[0].regulations.push({ start_date: null, end_date: null, criteria: '새 행' });
  assert.deepEqual(codes(compareV1Fields(before, added)), ['V1_ROW_COUNT_CHANGED']);

  const swapped = structuredClone(before);
  [swapped.fire_facilities[0], swapped.fire_facilities[1]] = [swapped.fire_facilities[1], swapped.fire_facilities[0]];
  assert.deepEqual(codes(compareV1Fields(before, swapped)), ['V1_FACILITY_CHANGED', 'V1_FACILITY_CHANGED']);
});

test('원문 대조 경고: 이상/초과/미만/이하 ↔ 연산자, 빠진 수치, 모든 층/해당 층 ↔ scope', () => {
  const w = (row) => lintRow({ id: 'x', kind: 'trigger', ...row }).map((x) => x.code);
  assert.deepEqual(w({ criteria: '연면적 600㎡ 이상', conditions: { m: 'total_area', gte: 600 }, scope: 'all_floors' }), []);
  assert.deepEqual(w({ criteria: '연면적 600㎡ 이상', conditions: { m: 'total_area', gt: 600 }, scope: 'all_floors' }), ['W_OP_MISMATCH']);
  // 문구는 맞지만 '미만' 면적 기준이라 면적이 클수록 덜 적용된다 — 검수 경고(W_ANTIMONOTONE_AREA, CP1 Q19(a))
  assert.deepEqual(w({ criteria: '지하에 차고·주차장이 200㎡ 미만', conditions: { sum_area: { floors: ['basement'] }, gt: 0, lt: 200 }, scope: 'all_floors' }), ['W_ANTIMONOTONE_AREA']);
  assert.deepEqual(w({ criteria: '수용인원 100명(460㎡) 이상', conditions: { m: 'occupants', gte: 100 }, scope: 'all_floors' }), ['W_NUMBER_MISSING']);
  assert.deepEqual(w({ criteria: '연면적 400㎡ 이상 모든 층', conditions: { m: 'total_area', gte: 400 }, scope: 'matching_floors' }), ['W_SCOPE_WORDING']);
  assert.deepEqual(w({ criteria: '바닥면적 1,000㎡ 이상인 층이 있는 경우 해당 층', conditions: { floor_exists: { area: { gte: 1000 } } }, scope: 'all_floors' }), ['W_SCOPE_WORDING']);
  assert.deepEqual(w({ criteria: '30층 이상은 16층 이상의 층', conditions: { m: 'ground_floors', gte: 30 }, scope: { type: 'floors', floors: [{ kind: 'ground', level: { gte: 16 } }] } }), []);
  assert.deepEqual(w({ criteria: '구조화 전', needs_review: { reason: '검토' } }), ['W_NEEDS_REVIEW']);
});

test('경고: 판정 행 없는 시설(W_NO_TRIGGER) · kind 없는 level(W_LEVEL_WITHOUT_KIND) · 보조 용도 use(W_AUXILIARY_USE)', () => {
  const file = FILE();
  file.fire_facilities.push({
    facility_id: 'guide_light',
    facility_name: '유도등',
    regulations: [{ id: 'i1', start_date: null, end_date: null, criteria: '피난구유도등 설치', kind: 'info' }],
  });
  const r = validateFile(file, ctx, { fileName: '02_neighborhood_facilities.json' });
  assert.deepEqual(r.errors, []);
  const noTrigger = r.warnings.filter((w) => w.code === 'W_NO_TRIGGER');
  assert.deepEqual(noTrigger.map((w) => [w.path, w.message.endsWith('guide_light')]), [['fire_facilities[2]', true]]);
  const lw =(conditions, criteria) => codes(lintRow({ ...ROW, criteria, conditions, scope: 'all_floors' }, 'row', ctx));
  assert.deepEqual(lw({ floor_exists: { floors: [{ level: { gte: 4 } }] } }, '4층 이상인 층이 있는 경우'), ['W_LEVEL_WITHOUT_KIND']);
  assert.deepEqual(lw({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 4 } }] } }, '4층 이상인 층이 있는 경우'), []);
  assert.deepEqual(lw({ sum_area: { floors: [{ level: { gte: 4 } }] }, gte: 100 }, '4층 이상 바닥면적 합계 100㎡ 이상'), ['W_LEVEL_WITHOUT_KIND']);
  assert.deepEqual(lw({ use: ['electrical_room'] }, '전기실이 있는 경우'), ['W_AUXILIARY_USE']);
  assert.deepEqual(lw({ use: ['singing_room', '02'] }, '노래연습장이 있는 경우'), []);
  // 문맥(ctx) 없이 부르면 보조 용도 검사는 건너뜀
  assert.deepEqual(codes(lintRow({ ...ROW, criteria: '전기실', conditions: { use: ['electrical_room'] } })), []);
});

test('경고: 면적이 클수록 덜 적용되는 층 면적 조건(W_ANTIMONOTONE_AREA) — 제외 조건·not 아래, 미만·이하·같음·구간 (CP1 Q19(a))', () => {
  const at = (conditions) => codes(lintRow({ ...ROW, criteria: '바닥면적 기준', conditions, scope: 'all_floors' }, 'row', ctx)).filter((c) => c === 'W_ANTIMONOTONE_AREA');
  const fe = (area) => ({ floor_exists: { floors: [{ kind: 'ground', level: { lte: 1 } }], area } });
  const sa = (cmp) => ({ sum_area: { floors: 'ground' }, ...cmp });
  // 설치 조건: 이상·초과는 괜찮고, 미만·이하·같음·구간, not 아래의 이상은 경고
  assert.deepEqual([fe({ gte: 500 }), fe({ gt: 500 }), sa({ gte: 1000 })].map(at), [[], [], []]);
  assert.deepEqual([fe({ lt: 500 }), sa({ lte: 1000 }), sa({ gt: 0, lt: 1000 }), fe({ eq: 500 })].map(at), [['W_ANTIMONOTONE_AREA'], ['W_ANTIMONOTONE_AREA'], ['W_ANTIMONOTONE_AREA'], ['W_ANTIMONOTONE_AREA']]);
  assert.deepEqual(at({ all: [{ m: 'total_area', gte: 900 }, { not: fe({ gte: 500 }) }] }), ['W_ANTIMONOTONE_AREA']);
  assert.deepEqual(at({ not: { not: fe({ gte: 500 }) } }), []);
  // 면적 없는 층 조건·표제부 지표(m)는 대상이 아니다
  assert.deepEqual([{ floor_exists: { floors: 'basement' } }, { not: { m: 'total_area', gte: 900 } }, { m: 'total_area', lt: 900 }].map(at), [[], [], []]);
  // 분기 조건(when)도 설치 조건처럼 본다
  const br = codes(lintRow({ ...ROW, criteria: '분기', conditions: undefined, branches: [{ when: sa({ lt: 300 }), conditions: { const: true } }, { conditions: { const: false } }], scope: 'all_floors' }, 'row', ctx));
  assert.ok(br.includes('W_ANTIMONOTONE_AREA'));
  // 제외 조건: 방향이 반대 — 이상이면 경고(rv5_blank: 1층 ≥ 500 이면 제외), not 아래의 이상은 괜찮다
  const file = (excluded_if) => {
    const f = FILE();
    f.fire_facilities[0].excluded_if = excluded_if;
    return validateFile(f, ctx, { fileName: '02_neighborhood_facilities.json' });
  };
  const r = file(fe({ gte: 500 }));
  assert.deepEqual(r.errors, []);
  const w = r.warnings.filter((x) => x.code === 'W_ANTIMONOTONE_AREA');
  assert.deepEqual(w.map((x) => x.path), ['fire_facilities[0].excluded_if']);
  assert.match(w[0].message, /면적제외여부가 빈칸인 보통 층별개요 행은 면적을 그대로 넣으므로\(CP1 Q19\(a\)\)/);
  assert.deepEqual(codes(file({ not: fe({ gte: 500 }) }).warnings).filter((c) => c === 'W_ANTIMONOTONE_AREA'), []);
  assert.deepEqual(codes(file(sa({ lt: 300 })).warnings).filter((c) => c === 'W_ANTIMONOTONE_AREA'), []);
});

const CYCLE_ROW = { ...ROW, criteria: '다른 설비를 설치해야 하는 경우', inputs_required: [] };
const vfile = (code, facilities) => ({ schema_version: 2, type_code: code, review: { status: 'draft', by: null, date: null }, fire_facilities: facilities });

test('파일 묶음 검증: 파일마다 정상이어도 합쳐 평가하면 생기는 순환은 오류 FACILITY_CROSS_FILE_CYCLE (복합건축물 동)', () => {
  const f02 = vfile('02', [
    { facility_id: 'visual_alarm', facility_name: '시각경보기', regulations: [{ ...CYCLE_ROW, id: 'a', conditions: { facility: 'auto_fire_detection' } }] },
    { facility_id: 'auto_fire_detection', facility_name: '자동화재탐지설비', regulations: [{ ...ROW, id: 'b' }] },
  ]);
  const f30 = vfile('30', [
    { facility_id: 'auto_fire_detection', facility_name: '자동화재탐지설비', regulations: [{ ...CYCLE_ROW, id: 'c', conditions: { facility: 'visual_alarm' } }] },
  ]);
  assert.deepEqual(validateFile(f02, ctx, { fileName: '02_x.json' }).errors, []);
  assert.deepEqual(validateFile(f30, ctx, { fileName: '30_x.json' }).errors, []);
  const set = validateFileSet({ '02_x.json': f02, '30_x.json': f30 }, ctx);
  assert.deepEqual(codes(set.errors), ['FACILITY_CROSS_FILE_CYCLE']);
  assert.equal(set.errors[0].file, null);
  assert.match(set.errors[0].message, /visual_alarm → auto_fire_detection → visual_alarm|auto_fire_detection → visual_alarm → auto_fire_detection/);
  assert.deepEqual(Object.keys(set.byFile), ['02_x.json', '30_x.json']);
  // 한 파일 안의 순환은 그 파일의 오류(FACILITY_CYCLE)로만 — 교차 경고로 중복하지 않는다
  const inner = vfile('02', [
    { facility_id: 'visual_alarm', facility_name: '시각경보기', regulations: [{ ...CYCLE_ROW, id: 'a', conditions: { facility: 'auto_fire_detection' } }] },
    { facility_id: 'auto_fire_detection', facility_name: '자동화재탐지설비', regulations: [{ ...CYCLE_ROW, id: 'b', conditions: { facility: 'visual_alarm' } }] },
  ]);
  const one = validateFileSet([{ name: '02_x.json', json: inner }], ctx);
  assert.deepEqual(codes(one.errors), ['FACILITY_CYCLE']);
  assert.equal(one.errors[0].file, '02_x.json');
  assert.deepEqual(codes(one.warnings), []);
});

test('v1 필드 불변(변환 PR 전용): v2 추가 필드(허용 목록)만 빼고 파일 최상위·시설·행의 나머지를 깊게 비교', () => {
  const before = readJson(path.join(ROOT, 'data', '08_education_research.json'));
  const dropped = structuredClone(before);
  delete dropped.modular_classroom;
  assert.deepEqual(compareV1Fields(before, dropped).map((e) => [e.code, e.path]), [['V1_FIELD_CHANGED', 'modular_classroom']]);
  const nested = structuredClone(before);
  nested.modular_classroom.fire_facilities[0].criteria = '바뀐 문구';
  assert.deepEqual(compareV1Fields(before, nested).map((e) => e.path), ['modular_classroom.fire_facilities[0].criteria']);
  const renamed = structuredClone(before);
  renamed.fire_facilities[0].category = '다른 분류';
  assert.deepEqual(compareV1Fields(before, renamed).map((e) => e.path), ['fire_facilities[0].category']);
  const additive = structuredClone(before);
  Object.assign(additive, { schema_version: 2, type_code: '08', review: { status: 'draft', by: null, date: null }, strengthened_retroactive: [] });
  additive.fire_facilities[0].excluded_if = { const: false };
  Object.assign(additive.fire_facilities[0].regulations[0], { id: 'x', kind: 'trigger', conditions: { const: true }, scope: 'all_floors' });
  assert.deepEqual(compareV1Fields(before, additive), []);
});
