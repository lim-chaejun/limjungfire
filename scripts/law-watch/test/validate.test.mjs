// 데이터 가드(scripts/validate-data.mjs) — 작은 메모리 데이터로 검사별 동작 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CHECKS, filesFromObject, formatReport, runChecks } from '../../validate-data.mjs';
import { REGISTRY, readJson } from './helpers.mjs';

const LAW = (no, ef, prom, num, seq) => ({
  no,
  name: '소방시설 설치 및 관리에 관한 법률 시행령',
  effective_date: ef,
  law_no: `제${num}호`,
  promulgation_date: prom,
  revision_type: '일부개정',
  link: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${seq}`,
});
const ADM = (no, ef, prom, num, seq) => ({
  no,
  name: '분말소화설비의 화재안전성능기준(NFPC 108)',
  effective_date: ef,
  notice_no: `소방청고시 제${num}호`,
  promulgation_date: prom,
  revision_type: '일부개정',
  link: `https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=${seq}`,
});

function good() {
  return {
    'law_history_decree.json': [LAW(1, '20270101', '20241231', 35151, 267669), LAW(2, '20240517', '20240507', 34488, 262427), LAW(3, '20240517', '20240507', 34487, 262301)],
    'nfsc_history.json': {
      '분말소화설비의 화재안전기준(NFSC 108)': [ADM(1, '20230210', '20230210', '2023-4', 2100000253098), ADM(2, '20221201', '20221125', '2022-42', 2100000216110)],
    },
    'facilities.json': { facilities: [{ id: 'powder', nfsc_key: '분말소화설비의 화재안전기준(NFSC 108)' }, { id: 'firewall', nfsc_key: null }] },
    '01_residential_complex.json': { fire_facilities: [{ regulations: [{ start_date: '19940720', end_date: '19970926' }, { start_date: null, end_date: null }] }] },
    'law_watch.json': {
      version: 1,
      sources: [
        { id: 'decree', kind: 'law', lsId: '009694', name: '소방시설 설치 및 관리에 관한 법률 시행령', baseline: { from: 'history', file: 'data/law_history_decree.json' } },
        { id: 'nfpc', kind: 'admrul', expand: 'nfsc', baseline: { from: 'history', file: 'data/nfsc_history.json' } },
      ],
    },
  };
}

const run = (data, names) => runChecks(filesFromObject(data), names ? { checks: CHECKS.filter((c) => names.includes(c.name)) } : {});
const errorsOf = (res, name) => res.results.find((r) => r.name === name).errors;

test('정상 데이터는 모든 검사를 통과한다', () => {
  const res = run(good());
  assert.equal(res.errorCount, 0, formatReport(res));
  assert.equal(res.results.length, CHECKS.length);
  assert.match(formatReport(res), /결과: 통과 — 오류 0건, 경고 0건/);
});

test('검사는 이름 있는 배열이다 (다른 작업에서 추가하기 쉽게)', () => {
  const names = CHECKS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const c of CHECKS) assert.equal(typeof c.run, 'function');
  assert.ok(names.includes('law-watch-registry'));
});

test('JSON 해석 실패', () => {
  const d = good();
  d['ref02_fire_facility_types.json'] = '{ "a": 1, }';
  assert.equal(errorsOf(run(d), 'json-parse').length, 1);
});

test('시행일 역순·동률 순서 위반·번호 불연속·키 중복', () => {
  const d = good();
  const rows = d['law_history_decree.json'];
  [rows[1], rows[2]] = [rows[2], rows[1]]; // 34487 이 34488 앞 → 동률 위반
  rows[1].no = 2;
  rows[2].no = 3;
  let res = run(d, ['history-order']);
  assert.match(errorsOf(res, 'history-order')[0].detail, /동률 순서 위반/);

  const d2 = good();
  d2['law_history_decree.json'].push(LAW(4, '20250101', '20241201', 1, 1));
  res = run(d2, ['history-order', 'history-numbering']);
  assert.match(errorsOf(res, 'history-order')[0].detail, /시행일 역순/);
  assert.equal(errorsOf(res, 'history-numbering').length, 0);

  const d3 = good();
  d3['law_history_decree.json'][2].no = 5;
  d3['law_history_decree.json'][2].link = 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=262427'; // [1] 과 같은 키
  res = run(d3, ['history-numbering', 'history-unique-keys']);
  assert.equal(errorsOf(res, 'history-numbering').length, 1);
  assert.match(errorsOf(res, 'history-unique-keys')[0].detail, /20240517:262427 중복/);
});

test('날짜 형식·시행일 < 공포일', () => {
  const d = good();
  d['law_history_decree.json'][0].effective_date = '20270230';
  d['nfsc_history.json']['분말소화설비의 화재안전기준(NFSC 108)'][1].promulgation_date = '20221202';
  const res = run(d, ['history-dates', 'history-effective-after-promulgation']);
  assert.equal(errorsOf(res, 'history-dates').length, 1);
  assert.match(errorsOf(res, 'history-effective-after-promulgation')[0].detail, /20221201 < 공포일 20221202/);
});

test('링크: seq 없으면 오류(옛 고시 2행만 허용), law.go.kr 이외 주소는 오류', () => {
  const d = good();
  const list = d['nfsc_history.json']['분말소화설비의 화재안전기준(NFSC 108)'];
  list[1].link = 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=';
  let res = run(d, ['history-link-seq']);
  assert.match(errorsOf(res, 'history-link-seq')[0].detail, /admRulSeq 가 없음/);

  const allowed = good();
  allowed['nfsc_history.json'] = {
    '할론소화설비의 화재안전기준(NFSC 107)': [
      { ...ADM(1, '20061230', '20061230', '2006-19', 0), notice_no: '소방청고시 제2006-19호', link: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=' },
    ],
  };
  res = run(allowed, ['history-link-seq', 'history-unique-keys']);
  assert.equal(res.errorCount, 0);

  const js = good();
  js['law_history_decree.json'][0].link = 'javascript:alert(1)';
  assert.match(errorsOf(run(js, ['history-link-seq']), 'history-link-seq')[0].detail, /연혁 링크가 아님/);
});

test('facilities.json 의 nfsc_key 는 연혁에 있어야 한다', () => {
  const d = good();
  d['facilities.json'].facilities.push({ id: 'ghost', nfsc_key: '없는 기준(NFSC 999)' });
  const e = errorsOf(run(d, ['facilities-nfsc-key']), 'facilities-nfsc-key');
  assert.equal(e.length, 1);
  assert.match(e[0].at, /ghost/);
});

test('용도별 파일: end_date < start_date 와 잘못된 날짜', () => {
  const d = good();
  d['01_residential_complex.json'].fire_facilities[0].regulations.push({ start_date: '20200101', end_date: '20191231' }, { start_date: '2020-01-01', end_date: null });
  d['ref03_emergency_power.json'] = { rows: [{ start_date: '20200101', end_date: '20000101' }] }; // 용도별 파일이 아니면 검사 안 함
  const e = errorsOf(run(d, ['category-date-range']), 'category-date-range');
  assert.equal(e.length, 2);
  assert.match(e[0].detail, /end_date 20191231 < start_date 20200101/);
});

test('레지스트리 형식과 기준 연혁 파일 존재', () => {
  const d = good();
  d['law_watch.json'].sources[0].baseline.file = 'data/law_history_missing.json';
  assert.match(errorsOf(run(d, ['law-watch-registry']), 'law-watch-registry')[0].detail, /찾을 수 없음/);
  const d2 = good();
  delete d2['law_watch.json'];
  assert.equal(errorsOf(run(d2, ['law-watch-registry']), 'law-watch-registry').length, 1);
  const d3 = good();
  d3['law_watch.json'] = readJson(REGISTRY);
  d3['law_history_act.json'] = [];
  d3['law_history_rules.json'] = [];
  assert.equal(errorsOf(run(d3, ['law-watch-registry']), 'law-watch-registry').length, 0);
  assert.equal(path.basename(REGISTRY), 'registry.json');
});

test('KNOWN_ISSUES 에 맞는 문제는 경고로 내려 보고한다', () => {
  const d = good();
  d['law_history_decree.json'][0].effective_date = '20270230';
  const res = runChecks(filesFromObject(d), {
    checks: CHECKS.filter((c) => c.name === 'history-dates'),
    knownIssues: [{ check: 'history-dates', file: 'law_history_decree.json', contains: '20270230' }],
  });
  assert.equal(res.errorCount, 0);
  assert.equal(res.warningCount, 1);
  assert.match(formatReport(res), /⚠ .*알려진 문제/);
});
