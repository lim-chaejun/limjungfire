#!/usr/bin/env node
// 판정 비교(verdict-diff) — 같은 건물 픽스처를 두 데이터 디렉터리로 판정해 달라진 판정·적용 범위·질문을 보여준다.
// 데이터 변환·법령 반영 PR 마다 "무엇이 바뀌는가"를 검토하는 용도(엔진 v2 P1 이후 모든 데이터 PR 필수).
//
// 사용법:
//   node scripts/engine/verdict-diff.mjs --a <데이터 디렉터리 A> --b <데이터 디렉터리 B>
//        [--buildings <픽스처 디렉터리 또는 .json 파일> ...] [--today YYYYMMDD] [--json] [--fail-on-diff]
//   데이터 디렉터리: NN_*.json(카테고리 파일) · exemption_criteria.json · facilities.json · schema/{use_vocabulary,inputs}.json
//                   (없는 공용 파일은 저장소 data/ 의 것을 쓴다)
//   --today 가 없으면 한국 시간(KST) 오늘 — UTC 는 오전 9시 전까지 하루 늦다
//   픽스처 기본값: scripts/engine/test/fixtures/buildings (각 파일의 input·answers 만 쓰고 variants 는 건너뜀)
// 종료 코드: 0 정상(차이가 있어도) · 1 차이 있음(--fail-on-diff 일 때) · 2 사용법·입력 오류

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildUseIndex, evaluateBuilding, normalizeManual, normalizeRegistry } from '../../js/engine/index.js';
import { normalizeYmd } from '../../js/engine/dates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_BUILDINGS = path.join(HERE, 'test', 'fixtures', 'buildings');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const readIf = (p, fallback) => (fs.existsSync(p) ? readJson(p) : fallback());

export function parseArgs(argv) {
  const opts = { buildings: [], json: false, failOnDiff: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} 다음에 값이 필요함`);
      return argv[++i];
    };
    if (arg === '--a') opts.a = next();
    else if (arg === '--b') opts.b = next();
    else if (arg === '--buildings') opts.buildings.push(next());
    else if (arg === '--today') opts.today = next();
    else if (arg === '--json') opts.json = true;
    else if (arg === '--fail-on-diff') opts.failOnDiff = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (!opts.help && (!opts.a || !opts.b)) throw new Error('--a 와 --b(비교할 데이터 디렉터리)가 필요함');
  if (opts.today !== undefined && !normalizeYmd(opts.today)) throw new Error(`--today 는 YYYYMMDD: ${opts.today}`);
  if (!opts.buildings.length) opts.buildings.push(DEFAULT_BUILDINGS);
  return opts;
}

// 데이터 디렉터리 → 평가에 필요한 묶음
export function loadDataSet(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`데이터 디렉터리가 없음: ${dir}`);
  const dataFiles = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const m = /^(\d\d)_.+\.json$/.exec(name);
    if (m) dataFiles[m[1]] = readJson(path.join(dir, name));
  }
  const base = path.join(ROOT, 'data');
  const vocabulary = readIf(path.join(dir, 'schema', 'use_vocabulary.json'), () => readJson(path.join(base, 'schema', 'use_vocabulary.json')));
  return {
    dir,
    dataFiles,
    exemptions: readIf(path.join(dir, 'exemption_criteria.json'), () => readIf(path.join(base, 'exemption_criteria.json'), () => undefined)),
    facilities: readIf(path.join(dir, 'facilities.json'), () => readJson(path.join(base, 'facilities.json'))),
    inputs: readIf(path.join(dir, 'schema', 'inputs.json'), () => readJson(path.join(base, 'schema', 'inputs.json'))),
    useIndex: buildUseIndex(vocabulary),
  };
}

export function loadBuildings(paths) {
  const files = paths.flatMap((p) =>
    fs.statSync(p).isDirectory()
      ? fs.readdirSync(p).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(p, f))
      : [p],
  );
  return files.map((f) => {
    const fx = readJson(f);
    if (!fx.input || (!fx.input.registry && !fx.input.manual)) throw new Error(`픽스처 형식 오류(input.registry|manual 필요): ${f}`);
    return { id: fx.id ?? path.basename(f, '.json'), input: fx.input, answers: fx.answers || {} };
  });
}

export function evaluateFixture(fx, set, today) {
  const opts = { useIndex: set.useIndex };
  const building = fx.input.manual ? normalizeManual(fx.input.manual, opts) : normalizeRegistry(fx.input.registry, opts);
  return evaluateBuilding({ building, ...set, answers: fx.answers, today });
}

const scopeText = (f) => {
  if (!f?.scope) return '-';
  const s = f.scope;
  const parts = s.parts?.length ? ` +${s.parts.join('·')}` : '';
  return `${s.type === 'all_floors' ? '모든 층' : s.floors.join(',') || '-'}${parts}`;
};
const questionText = (f) => (f?.questions || []).map((q) => q.key).sort().join(' | ') || '-';
const exemptionText = (f) => (f?.exemption?.possible ? `면제 가능(${f.exemption.rules.length})` : '-');
const retroText = (f) => (f?.retroactive || []).map((r) => `${r.id}:${r.basis}${r.deadline ? `~${r.deadline}` : ''}`).join(' | ') || '-';
const extText = (f) => (f?.extensions || []).join(' | ') || '-';

// 시설 하나를 비교용 문자열 묶음으로
const snapshot = (f) => ({
  verdict: f?.verdict ?? '없음',
  scope: scopeText(f),
  questions: questionText(f),
  exemption: exemptionText(f),
  retroactive: retroText(f),
  extensions: extText(f),
});
const FIELDS = ['verdict', 'scope', 'questions', 'exemption', 'retroactive', 'extensions'];
const FIELD_LABEL = { scope: '범위', questions: '질문', exemption: '면제', retroactive: '소급', extensions: '범위 확장' };

// 두 평가 결과의 차이 (순수 함수) → [{ dong, facility, name, before, after }]
export function diffResults(a, b) {
  const diffs = [];
  const dongIds = [...new Set([...a.dongs.map((d) => d.id), ...b.dongs.map((d) => d.id)])];
  for (const id of dongIds) {
    const da = a.dongs.find((d) => d.id === id);
    const db = b.dongs.find((d) => d.id === id);
    if (da?.status !== db?.status) diffs.push({ dong: id, facility: null, name: '동 상태', before: da?.status ?? '없음', after: db?.status ?? '없음' });
    const fids = [...new Set([...(da?.facilities || []).map((f) => f.id), ...(db?.facilities || []).map((f) => f.id)])];
    for (const fid of fids) {
      const fa = da?.facilities.find((f) => f.id === fid);
      const fb = db?.facilities.find((f) => f.id === fid);
      const before = snapshot(fa);
      const after = snapshot(fb);
      if (FIELDS.some((k) => before[k] !== after[k])) {
        diffs.push({ dong: id, facility: fid, name: fb?.name ?? fa?.name ?? fid, before, after });
      }
    }
  }
  return diffs;
}

export function formatDiff(report) {
  const lines = [`verdict-diff  A=${report.a}  B=${report.b}  건물 ${report.buildings}개 · 오늘 ${report.today}`];
  for (const { building, dong, name, facility, before, after } of report.diffs) {
    if (!facility) {
      lines.push(`[${building}] ${dong}: ${name} ${before} → ${after}`);
      continue;
    }
    const parts = [`${before.verdict} → ${after.verdict}`];
    for (const k of FIELDS.slice(1)) if (before[k] !== after[k]) parts.push(`${FIELD_LABEL[k]} ${before[k]} → ${after[k]}`);
    lines.push(`[${building}] ${dong} · ${name}: ${parts.join(' | ')}`);
  }
  const buildingsWithDiff = new Set(report.diffs.map((d) => d.building)).size;
  lines.push(report.diffs.length ? `차이 ${report.diffs.length}건 (건물 ${buildingsWithDiff}개)` : '차이 없음');
  return lines.join('\n');
}

export function runDiff({ a, b, buildings, today }) {
  const setA = loadDataSet(a);
  const setB = loadDataSet(b);
  const fixtures = loadBuildings(buildings);
  const diffs = [];
  for (const fx of fixtures) {
    for (const d of diffResults(evaluateFixture(fx, setA, today), evaluateFixture(fx, setB, today))) diffs.push({ building: fx.id, ...d });
  }
  return { a, b, today, buildings: fixtures.length, diffs };
}

// 한국 시간(UTC+9) 오늘 — Date 의 UTC 날짜에 9시간을 더해 읽는다
export function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

export function main(argv, out = console) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    out.error(`verdict-diff: ${e.message}`);
    return 2;
  }
  if (opts.help) {
    out.log('사용법: node scripts/engine/verdict-diff.mjs --a <데이터 디렉터리> --b <데이터 디렉터리> [--buildings <경로>] [--today YYYYMMDD] [--json] [--fail-on-diff]');
    return 0;
  }
  let report;
  try {
    const today = normalizeYmd(opts.today) || kstToday();
    report = runDiff({ ...opts, today });
  } catch (e) {
    out.error(`verdict-diff: ${e.message}`);
    return 2;
  }
  out.log(opts.json ? JSON.stringify(report, null, 2) : formatDiff(report));
  return opts.failOnDiff && report.diffs.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
