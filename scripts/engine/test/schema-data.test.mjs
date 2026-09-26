// 스키마 데이터(use_vocabulary.json · inputs.json)·정책·문서 정합성, 엔진 모듈 순수성
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_POLICY, ERROR_CODES, POLICY_OPTIONS, classifyUses, resolvePolicy } from '../../../js/engine/index.js';
import { TYPE_CODE_RE } from '../../../js/engine/schema.js';
import { inputDefsFrom } from '../../../js/engine/questions.js';
import { INDEX, INPUTS, ROOT, VOCABULARY, readJson } from './helpers.mjs';

const TYPE_CODE_RE_FOR_TEST = TYPE_CODE_RE;

const REF01 = readJson(path.join(ROOT, 'data', 'ref01_fire_target_classification.json'));
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'engine-v2.md'), 'utf8');
const ENGINE_DIR = path.join(ROOT, 'js', 'engine');

test('용도 어휘는 ref01 의 모든 용도(번호)와 세부 항목을 덮는다', () => {
  for (const bt of REF01.building_types) {
    const num = String(bt.number);
    const group = VOCABULARY.groups.find((g) => g.ref01_numbers.includes(num));
    assert.ok(group, `ref01 ${num} ${bt.name} 에 대응하는 그룹 없음`);
    for (const sub of bt.sub_types || []) {
      assert.ok(group.uses.some((u) => u.ref01 === sub.name), `그룹 ${group.type_code}: ref01 세부 '${sub.name}' 없음`);
    }
  }
});

test('용도 어휘 형식: 그룹 코드·파일명·id 유일, 그룹 안 별칭 유일, ref01 밖 용도는 출처 표시', () => {
  const codes = VOCABULARY.groups.map((g) => g.type_code);
  assert.equal(new Set(codes).size, codes.length);
  const ids = new Set();
  for (const g of VOCABULARY.groups) {
    assert.match(g.type_code, TYPE_CODE_RE_FOR_TEST);
    assert.ok(g.file.startsWith(`${g.type_code}_`) && g.file.endsWith('.json'), g.file);
    if (g.type_code !== '00') assert.ok(fs.existsSync(path.join(ROOT, 'data', g.file)), `data/${g.file} 없음`);
    assert.ok(g.uses.length > 0, `그룹 ${g.type_code} 에 용도 없음`);
    const aliases = new Map();
    for (const u of g.uses) {
      assert.ok(!ids.has(u.id), `용도 id 중복 ${u.id}`);
      ids.add(u.id);
      assert.match(u.id, /^[a-z][a-z0-9_]*$/);
      assert.ok(u.name);
      if (u.ref01 === null) assert.ok(u.source_note, `${u.id}: ref01 밖 용도는 source_note 필요`);
      for (const a of u.aliases) {
        assert.ok(!aliases.has(a), `그룹 ${g.type_code} 안에서 별칭 '${a}' 중복 (${aliases.get(a)}, ${u.id})`);
        aliases.set(a, u.id);
      }
    }
  }
  for (const u of VOCABULARY.auxiliary) assert.ok(!ids.has(u.id) && /^[a-z_]+$/.test(u.id));
});

test('건축물대장 주용도명(기존 main.js 매핑 표의 이름)이 용도군으로 분류된다', () => {
  const cases = {
    아파트: '01', 공동주택: '01', '공동주택(아파트)': '01', 제1종근린생활시설: '02', 제2종근린생활시설: '02', '문화 및 집회시설': '03',
    판매시설: '05', 의료시설: '07', 교육연구및복지시설: '08', 노유자시설: '09', 업무시설: '12', 오피스텔: '12', 숙박시설: '13',
    위락시설: '14', 공장: '15', 창고시설: '16', 위험물저장및처리시설: '17', 자동차관련시설: '18', '분뇨.쓰레기처리시설': '20',
    방송통신시설: '22', 묘지관련시설: '24', 장례시설: '26', 지하상가: '27', 단독주택: '00', 다가구주택: '00',
  };
  for (const [name, code] of Object.entries(cases)) assert.deepEqual(classifyUses(name, '', INDEX).groups, [code], name);
});

test('기타용도 분류: 세부 용도·혼재·주용도 군 우선·부분 일치', () => {
  const t = (main, etc) => classifyUses(main, etc, INDEX).terms;
  assert.deepEqual(t('제2종근린생활시설', '사무소'), [{ use: 'office_small' }]);
  assert.deepEqual(t('업무시설', '사무소'), [{ use: 'general_office' }]);
  assert.deepEqual(t('제1종근린생활시설', '소매점, 사무소'), [{ use: 'retail_small' }, { use: 'office_small' }]);
  assert.deepEqual(t('제1종근린생활시설', '의원(조산원)'), [{ use: 'clinic' }, { use: 'midwifery_clinic' }]);
  assert.deepEqual(t('제2종근린생활시설', ''), [{ group: '02' }]);
  assert.deepEqual(t('제1종근린생활시설', '주차장'), [{ use: 'indoor_parking' }]);
  assert.deepEqual(t('제1종근린생활시설', '소매점, 업무시설'), [{ use: 'retail_small' }, { group: '12' }]);
  assert.deepEqual(t('제2종근린생활시설', '일반 음식점 및 노래연습장'), [{ use: 'restaurant' }, { use: 'singing_room' }]);
});

const VALID_TYPES = ['number', 'integer', 'boolean', 'date', 'uses'];
const VALID_SOURCES = ['registry', 'user', 'derived'];
const PLACEHOLDERS = ['dong', 'floor', 'where', 'area', 'uses', 'floors', 'facility', 'criteria', 'boundary', 'groups'];

test('inputs.json: id 유일, 필수 필드, 유형·출처·범위 값, 질문 틀의 자리표시자', () => {
  const ids = INPUTS.inputs.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of INPUTS.inputs) {
    assert.match(d.id, /^[a-z][a-z0-9_]*$/);
    for (const k of ['label', 'type', 'source', 'scope', 'question']) assert.ok(d[k], `${d.id}.${k}`);
    assert.ok(VALID_TYPES.includes(d.type), `${d.id}.type`);
    assert.ok(VALID_SOURCES.includes(d.source), `${d.id}.source`);
    assert.ok(['building', 'floor', 'site'].includes(d.scope), `${d.id}.scope`);
    if (d.type === 'number' || d.type === 'integer') assert.ok(d.unit, `${d.id}.unit`);
    for (const m of d.question.matchAll(/\{(\w+)(?::[^}]*)?\}/g)) assert.ok(PLACEHOLDERS.includes(m[1]), `${d.id}: 모르는 자리표시자 {${m[1]}}`);
  }
});

test('엔진이 만드는 질문의 입력 id 는 모두 inputs.json 에 있다', () => {
  const engineInputs = [...inputDefsFrom(undefined).keys()];
  const ids = new Set(INPUTS.inputs.map((d) => d.id));
  for (const id of [...engineInputs, 'uses', 'elevator', 'occupants']) assert.ok(ids.has(id), id);
  for (const d of INPUTS.inputs.filter((x) => x.derived_from)) for (const src of d.derived_from) assert.ok(ids.has(src));
});

test('정책: 기본값 동결, 모르는 키·값은 예외, 옵션마다 문서화', () => {
  assert.ok(Object.isFrozen(DEFAULT_POLICY));
  assert.equal(resolvePolicy().windowless, 'unknown');
  assert.equal(resolvePolicy({ applicationWindowDays: 90 }).applicationWindowDays, 90);
  assert.throws(() => resolvePolicy({ nope: 1 }), /알 수 없는 정책/);
  assert.throws(() => resolvePolicy({ windowless: 'maybe' }), /허용되지 않는 값/);
  assert.throws(() => resolvePolicy({ applicationWindowDays: -1 }), /이상의 수/);
  const resolved = resolvePolicy({ windowless: 'assume_none' });
  assert.equal(resolvePolicy(resolved), resolved);
  for (const key of Object.keys(POLICY_OPTIONS)) assert.ok(DOC.includes(`\`${key}\``), `docs/engine-v2.md 에 정책 ${key} 설명 없음`);
});

test('문서: 오류 코드 전부와 CP1 법령 검수 질문 절이 있다', () => {
  for (const code of Object.keys(ERROR_CODES)) assert.ok(DOC.includes(code), `docs/engine-v2.md 에 ${code} 없음`);
  assert.match(DOC, /CP1 법령 검수 질문/);
});

test('엔진 모듈은 순수 ES 모듈: 상대 경로 import 만, Node 내장·DOM·fetch 없음', () => {
  for (const name of fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'))) {
    // 주석은 빼고 코드만 본다 (주석의 'node:test' 같은 설명은 허용)
    const src = fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('./'), `${name}: ${m[1]}`);
    assert.ok(!/\bimport\s*\(/.test(src), `${name}: 동적 import`);
    for (const bad of [/\bfetch\s*\(/, /\bdocument\./, /\bwindow\./, /\brequire\s*\(/, /\bprocess\./, /['"]node:/, /localStorage/]) {
      assert.ok(!bad.test(src), `${name}: ${bad}`);
    }
  }
});
