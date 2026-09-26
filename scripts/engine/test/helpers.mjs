// 엔진 테스트 공용 도구 — 스키마·픽스처 데이터 적재 (Node 전용; 엔진 모듈 자체는 fs 를 쓰지 않는다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUseIndex, evaluateBuilding, normalizeManual, normalizeRegistry } from '../../../js/engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const FIXTURES = path.join(HERE, 'fixtures');
export const FIXTURE_DATA = path.join(FIXTURES, 'data');
export const FIXTURE_BUILDINGS = path.join(FIXTURES, 'buildings');
export const TODAY = '20260926';

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

export const VOCABULARY = readJson(path.join(ROOT, 'data', 'schema', 'use_vocabulary.json'));
export const INPUTS = readJson(path.join(ROOT, 'data', 'schema', 'inputs.json'));
export const FACILITIES = readJson(path.join(ROOT, 'data', 'facilities.json'));
export const INDEX = buildUseIndex(VOCABULARY);

// 데이터 디렉터리의 NN_*.json → { 'NN': json } (+ exemption_criteria.json)
export function loadDataDir(dir) {
  const dataFiles = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const m = /^(\d\d)_.+\.json$/.exec(name);
    if (m) dataFiles[m[1]] = readJson(path.join(dir, name));
  }
  const exPath = path.join(dir, 'exemption_criteria.json');
  return { dataFiles, exemptions: fs.existsSync(exPath) ? readJson(exPath) : undefined };
}

export const FIXTURE_SET = loadDataDir(FIXTURE_DATA);

// 픽스처 입력 { registry: {...} } | { manual: {...} } → Building
export function normalizeInput(input, policy) {
  if (input.manual) return normalizeManual(input.manual, { useIndex: INDEX, policy });
  return normalizeRegistry(input.registry || {}, { useIndex: INDEX, policy });
}

// 건물 하나 평가 (기본: 픽스처 데이터·오늘 2026-09-26)
export function evaluate(input, { answers = {}, policy, today = TODAY, set = FIXTURE_SET } = {}) {
  const building = normalizeInput(input, policy);
  return evaluateBuilding({
    building,
    dataFiles: set.dataFiles,
    exemptions: set.exemptions,
    useIndex: INDEX,
    inputs: INPUTS,
    facilities: FACILITIES,
    answers,
    policy,
    today,
  });
}

export function loadBuildingFixtures(dir = FIXTURE_BUILDINGS) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, ...readJson(path.join(dir, f)) }));
}

// 동 결과 → { 시설id: 판정 }
export const verdictMap = (dong) => Object.fromEntries(dong.facilities.map((f) => [f.id, f.verdict]));
export const dongOf = (result, id) => result.dongs.find((d) => d.id === id);
export const facilityOf = (result, dongId, fid) => dongOf(result, dongId)?.facilities.find((f) => f.id === fid);
