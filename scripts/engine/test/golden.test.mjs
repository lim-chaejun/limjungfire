// 골든 픽스처 — fixtures/buildings/*.json 의 건물을 TEST-ONLY 데이터(fixtures/data)로 판정해 기대값과 대조
// 기본 기대값의 verdicts 는 동의 전체 판정표와 정확히 같아야 하고, 변형(variants)은 적힌 항목만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, loadBuildingFixtures, verdictMap } from './helpers.mjs';

const fixtures = loadBuildingFixtures();

function patchInput(input, variant) {
  if (variant.patch) return { registry: { ...input.registry, ...variant.patch } };
  if (variant.manualPatch) return { manual: { ...input.manual, ...variant.manualPatch } };
  return input;
}

function check(result, expect, label, { exact }) {
  if (expect.status) assert.equal(result.status, expect.status, `${label}: status`);
  if (expect.dateSource) assert.equal(result.dateInfo.source, expect.dateSource, `${label}: 기준일 출처`);
  if (expect.refDate) assert.equal(result.permitDate, expect.refDate, `${label}: 기준일`);
  if (expect.usedApprovalDate !== undefined) assert.equal(result.usedApprovalDate, expect.usedApprovalDate, `${label}: 사용승인일 사용`);
  if (expect.site !== undefined) {
    assert.deepEqual(result.site && { members: result.site.members, connected: result.site.connected }, expect.site, `${label}: 대지 연결`);
  }
  if (expect.notEvaluated) {
    assert.deepEqual(
      result.notEvaluated.map(({ dong, type_code, status }) => ({ dong, type_code, status })),
      expect.notEvaluated,
      `${label}: v2 미평가 목록`,
    );
  }
  for (const [dongId, e] of Object.entries(expect.dongs || {})) {
    const dong = result.dongs.find((d) => d.id === dongId);
    assert.ok(dong, `${label}: 동 ${dongId} 없음 (있는 동: ${result.dongs.map((d) => d.id).join(', ')})`);
    const where = `${label}/${dongId}`;
    if (e.status) assert.equal(dong.status, e.status, `${where}: status`);
    if (e.mixedUseCandidate !== undefined) assert.equal(dong.mixedUseCandidate, e.mixedUseCandidate, `${where}: 복합건축물 후보`);
    if (e.typeCodes) assert.deepEqual(dong.typeCodes, e.typeCodes, `${where}: 평가 파일`);
    if (e.verdicts) {
      const actual = verdictMap(dong);
      if (exact) assert.deepEqual(actual, e.verdicts, `${where}: 판정표`);
      else for (const [fid, v] of Object.entries(e.verdicts)) assert.equal(actual[fid], v, `${where}: ${fid}`);
    }
    const fac = (fid) => {
      const f = dong.facilities.find((x) => x.id === fid);
      assert.ok(f, `${where}: 시설 ${fid} 없음`);
      return f;
    };
    for (const [fid, keys] of Object.entries(e.questions || {})) assert.deepEqual(fac(fid).questions.map((q) => q.key), keys, `${where}: ${fid} 질문`);
    for (const [fid, floors] of Object.entries(e.scope || {})) assert.deepEqual(fac(fid).scope?.floors, floors, `${where}: ${fid} 적용 층`);
    for (const [fid, parts] of Object.entries(e.parts || {})) assert.deepEqual(fac(fid).scope?.parts, parts, `${where}: ${fid} 적용 부분`);
    for (const [fid, ext] of Object.entries(e.extensions || {})) assert.deepEqual(fac(fid).extensions, ext, `${where}: ${fid} 범위 확장`);
    for (const [fid, pts] of Object.entries(e.boundary || {})) assert.deepEqual(fac(fid).boundary?.points, pts, `${where}: ${fid} 개정 경계`);
  }
}

test('골든 픽스처가 10건 이상 있다', () => {
  assert.ok(fixtures.length >= 10, `픽스처 ${fixtures.length}건`);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length, 'id 중복');
});

for (const fx of fixtures) {
  test(`골든 ${fx.id} — ${fx.title}`, () => {
    check(evaluate(fx.input, { answers: fx.answers || {} }), fx.expect, fx.id, { exact: true });
    for (const v of fx.variants || []) {
      check(evaluate(patchInput(fx.input, v), { answers: v.answers || {} }), v.expect, `${fx.id} [${v.name}]`, { exact: false });
    }
  });
}
