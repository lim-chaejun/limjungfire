// 건물 판정 — 기준일 결정, 동별 평가, 연결된 동(대지) 확인, v1 호환 결과 조립
//
// 결과는 main.js getRequiredFireFacilities 의 모양(facilities[].required·regulations·allRegulations, permitDate,
// usedApprovalDate, summary, buildingType)을 유지하고 v2 필드(verdict·scope·questions·dongs…)를 더한다.
// required 는 '해당' 또는 '확인 필요'일 때 true — 기존 화면이 확인 필요 항목을 '비해당'으로 보이지 않게 한다.
//
// 주의(출력 경계): 질문 문장·근거(reasons)·동 이름 등 모든 문자열은 건축물대장·데이터 원문(dongNm, criteria …)을
// 그대로 담은 평문이다. 화면에 넣을 때는 반드시 이스케이프해야 한다(엔진은 HTML 을 만들지 않는다).

import { SCHEMA_VERSION } from './schema.js';
import { resolvePolicy } from './policy.js';
import { buildUseIndex, useName } from './uses.js';
import { buildQuestion, inputDefsFrom } from './questions.js';
import { normalizeYmd, resolveDateInfo, todayYmd } from './dates.js';
import { F, T, U, UNKNOWN, makeDep } from './logic.js';
import { VERDICT, evaluateDong } from './evaluate.js';
import { mergeDongs, siteLinkCandidate } from './facts.js';

export const ENGINE_VERSION = '2.0.0-p0';
export { resolveDateInfo };

// 시설 id → 이름 (시설 마스터 → 데이터 파일 → inputs.json 의 installed 대상 순)
export function facilityNames(facilitiesJson, dataFiles = {}, inputsJson) {
  const names = new Map();
  for (const f of facilitiesJson?.facilities || []) names.set(f.id, f.name);
  for (const file of Object.values(dataFiles)) for (const f of file?.fire_facilities || []) if (!names.has(f.facility_id)) names.set(f.facility_id, f.facility_name);
  const installed = (inputsJson?.inputs || []).find((d) => d.id === 'installed');
  for (const t of installed?.targets || []) if (!names.has(t.id)) names.set(t.id, t.name);
  return names;
}

// 평가에 필요한 데이터 파일(type_code) — 호출자가 이것만 불러오면 된다 (연결 가능 대지는 합친 동의 파일 포함)
export function requiredTypeCodes(building, { useIndex, vocabulary, policy } = {}) {
  const codes = building.dongs.flatMap((d) => d.typeCodes);
  if (siteLinkCandidate(building) && (useIndex || vocabulary)) codes.push(...mergeDongs(building.dongs, { useIndex, vocabulary, policy }).typeCodes);
  return [...new Set(codes)].sort();
}

const RANK = { F: 0, U: 1, T: 2 };

// 동별 결과 → 시설별 결합. 판정·근거·범위·질문·경계·가정 등은 모두 가장 강한 판정(T > U > F, 같으면 앞 동)의
// 한 동에서 가져와 서로 어긋나지 않게 하고, dongs(동별 판정)와 규정 행 합집합(v1 모달용)만 모은다
function aggregate(dongs) {
  const byId = new Map();
  for (const d of dongs) {
    for (const f of d.facilities) {
      let e = byId.get(f.id);
      if (!e) byId.set(f.id, (e = { best: f, bestDong: d.id, dongs: {}, regulations: [], allRegulations: [] }));
      e.dongs[d.id] = f.verdict;
      if (RANK[f.value] > RANK[e.best.value]) Object.assign(e, { best: f, bestDong: d.id });
      for (const r of f.regulations) if (!e.regulations.includes(r)) e.regulations.push(r);
      for (const r of f.allRegulations) if (!e.allRegulations.includes(r)) e.allRegulations.push(r);
    }
  }
  return [...byId.values()].map((e) => ({ ...e.best, dong: e.bestDong, dongs: e.dongs, regulations: e.regulations, allRegulations: e.allRegulations }));
}

const lo = (iv) => (iv && Number.isFinite(iv.lo) && iv.lo === iv.hi ? iv.lo : 0);

const tally = (facilities) => ({
  applicable: facilities.filter((f) => f.value === T).length,
  check: facilities.filter((f) => f.value === U).length,
  notApplicable: facilities.filter((f) => f.value === F).length,
});

// 연결된 동(CP1 Q11) — 지하층만 있는 동·주차 전용 동이 있는 여러 동 대지는 지하주차장 등으로 이어져
// 하나의 소방대상물일 수 있다. 검수 전에는 보수적으로: 모든 동을 합친 가상 동도 평가해서, 동별로 비해당인데 합치면
// 비해당이 아닌 시설은 '확인 필요(동 연결 여부)'로 둔다. 답이 '예'면 합친 판정을, '아니오'면 동별 판정을 쓴다.
function applySiteLink(building, dongs, bctx) {
  if (!siteLinkCandidate(building)) return null;
  const merged = mergeDongs(building.dongs, { useIndex: bctx.index, policy: bctx.policy });
  const site = evaluateDong(merged, bctx);
  const connected = bctx.answers.site_connected;
  const members = building.dongs.map((d) => d.id);
  const question = buildQuestion(makeDep('site_connected', UNKNOWN, {}), { inputDefs: bctx.inputDefs, index: bctx.index, names: bctx.names });
  for (const d of dongs) {
    if (d.status !== 'v2' && d.status !== 'partial') continue;
    d.facilities = d.facilities.map((f) => {
      if (f.value !== F || connected === false) return f;
      const mf = site.facilities.find((x) => x.id === f.id);
      if (!mf || mf.value === F) return f;
      if (connected === true) {
        const reason = `대지 전체(${members.join('·')})를 하나의 소방대상물로 판정 — ${mf.verdict}`;
        return { ...mf, reason, reasons: [reason, ...mf.reasons], siteLink: { merged: true } };
      }
      const reason = `동별로는 비해당이지만, 대지의 동들(${members.join('·')})이 연결되어 하나의 소방대상물이면 ${mf.verdict} — 연결 여부 확인 필요(CP1 검수 전 보수적 처리)`;
      return { ...f, value: U, verdict: VERDICT.U, required: true, reason, reasons: [reason, ...f.reasons], questions: [question], jointQuestions: false, siteLink: { mergedVerdict: mf.verdict } };
    });
    d.questions = [];
    for (const q of d.facilities.flatMap((f) => f.questions)) if (!d.questions.some((x) => x.key === q.key)) d.questions.push(q);
    d.counts = tally(d.facilities);
  }
  return { id: merged.id, members, status: site.status, typeCodes: site.typeCodes, files: site.files, counts: site.counts, connected: connected ?? null, facilities: site.facilities };
}

export function evaluateBuilding({ building, dataFiles = {}, vocabulary, useIndex, inputs, facilities, exemptions, answers = {}, policy, today } = {}) {
  if (!building || !Array.isArray(building.dongs)) throw new Error('building(normalizeRegistry·normalizeManual 결과)이 필요함');
  const pol = resolvePolicy(policy);
  const day = normalizeYmd(today) || todayYmd();
  const index = useIndex || buildUseIndex(vocabulary);
  const dateInfo = resolveDateInfo(building.dates, answers, pol, day);
  const bctx = {
    dataFiles,
    index,
    inputDefs: inputDefsFrom(inputs),
    names: facilityNames(facilities, dataFiles, inputs),
    exemptions,
    answers,
    policy: pol,
    today: day,
    dates: building.dates || {},
  };
  const dongs = building.dongs.map((d) => evaluateDong(d, bctx));
  const site = applySiteLink(building, dongs, bctx);
  const merged = aggregate(dongs);
  // v2 = 모든 동을 v2 로 평가 · partial = 일부만 · v1 = 평가한 동 없음(기존 판정으로 대체) · unmapped = 용도 미분류뿐
  const evaluated = dongs.some((d) => d.status === 'v2' || d.status === 'partial');
  const status = !dongs.length || dongs.every((d) => d.status === 'unmapped')
    ? 'unmapped'
    : dongs.every((d) => d.status === 'v2') ? 'v2' : evaluated ? 'partial' : 'v1';
  const primary = [...building.dongs].sort((a, b) => lo(b.metrics.total_area) - lo(a.metrics.total_area))[0];
  const questions = [];
  for (const q of dongs.flatMap((d) => d.questions)) if (!questions.some((x) => x.key === q.key)) questions.push(q);
  return {
    engine: { version: ENGINE_VERSION, schemaVersion: SCHEMA_VERSION, policy: { ...pol } },
    status,
    // v1 호환
    permitDate: dateInfo.refDate,
    usedApprovalDate: dateInfo.source === 'approval',
    buildingType: primary?.mainGroup ? useName(primary.mainGroup, index) : null,
    facilities: merged,
    summary: {
      totalArea: building.dongs.reduce((s, d) => s + lo(d.metrics.total_area), 0),
      groundFloors: Math.max(0, ...building.dongs.map((d) => lo(d.metrics.ground_floors))),
      undergroundFloors: Math.max(0, ...building.dongs.map((d) => lo(d.metrics.basement_floors))),
      height: Math.max(0, ...building.dongs.map((d) => lo(d.metrics.height))),
    },
    // v2
    dateInfo,
    counts: tally(merged),
    dongs,
    site,
    questions,
    notEvaluated: [
      ...dongs.flatMap((d) =>
        d.status === 'unmapped'
          ? [{ dong: d.id, type_code: null, status: 'unmapped', message: '용도 미분류 — v2 미평가' }]
          : d.files.filter((f) => f.status !== 'v2').map((f) => ({ dong: d.id, ...f })),
      ),
      // 대지 전체(합친 동)가 쓰는 파일 중 v2 가 아닌 것 — v2 로 평가한 동이 있고 동이 연결되지 않았다고 답하기 전까지는
      // 합친 판정(연결 여부 질문의 근거)에 빠진 기준이다
      ...(site && site.connected !== false && evaluated ? (site.files || []).filter((f) => f.status !== 'v2').map((f) => ({ dong: site.id, ...f })) : []),
    ],
    // 정규화 경고(대장끼리 불일치 등) + 평가 경고(답변한 면적이 연면적과 모순 등)
    warnings: [...(building.warnings || []), ...dongs.flatMap((d) => d.warnings || [])],
    verdictLabels: VERDICT,
  };
}
