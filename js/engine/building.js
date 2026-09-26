// 건물 판정 — 기준일 결정, 동별 평가, v1 호환 결과 조립
//
// 결과는 main.js getRequiredFireFacilities 의 모양(facilities[].required·regulations·allRegulations, permitDate,
// usedApprovalDate, summary, buildingType)을 유지하고 v2 필드(verdict·scope·questions·dongs…)를 더한다.
// required 는 '해당' 또는 '확인 필요'일 때 true — 기존 화면이 확인 필요 항목을 '비해당'으로 보이지 않게 한다.

import { SCHEMA_VERSION } from './schema.js';
import { resolvePolicy } from './policy.js';
import { buildUseIndex, useName } from './uses.js';
import { inputDefsFrom } from './questions.js';
import { addDays, normalizeYmd, todayYmd } from './dates.js';
import { ASSUMED, CONFIRMED, F, T, U } from './logic.js';
import { VERDICT, evaluateDong } from './evaluate.js';

export const ENGINE_VERSION = '2.0.0-p0';

// 기준일(refDate)과 개정 경계 검사 구간(window)
//   허가 신청일 답변 → 신청일(정책 applicationDateSelectsRows)
//   허가일 → [허가일 − 신청 구간, 허가일], 질문 '허가 신청일' (허가일 후보가 여럿이면 전 후보를 덮고 질문 '허가일')
//   사용승인일만 → [승인일 − (추정 구간 + 신청 구간), 승인일], 질문 '허가일', 기준일은 가정
//   날짜 없음 → 오늘(가정), 질문 '허가일'
export function resolveDateInfo(dates = {}, answers = {}, policy = resolvePolicy(), today = todayYmd()) {
  const W = policy.applicationWindowDays;
  const application = normalizeYmd(answers.application_date);
  const permitAnswer = normalizeYmd(answers.permit_date);
  const permit = permitAnswer ? { value: permitAnswer, source: 'user', status: CONFIRMED, candidates: [permitAnswer] } : dates.permit || null;
  const approval = dates.approval?.value ? dates.approval : null;
  const base = { permit: permit?.value ?? null, approval: approval?.value ?? null, today };
  if (application && (policy.applicationDateSelectsRows || !permit?.value)) {
    return { ...base, refDate: application, source: 'application', status: CONFIRMED, window: null };
  }
  if (permit?.value) {
    const cands = permit.candidates?.length ? permit.candidates : [permit.value];
    const multiple = cands.length > 1;
    const span = application ? null : { from: addDays(cands[0], -W), to: cands[cands.length - 1], question: multiple ? 'permit_date' : 'application_date' };
    return { ...base, refDate: permit.value, source: 'permit', permitSource: permit.source, status: permit.status, window: span && span.from < span.to ? span : null };
  }
  if (approval) {
    const from = addDays(approval.value, -(policy.approvalOnlyLookbackDays + W));
    return { ...base, refDate: approval.value, source: 'approval', status: ASSUMED, window: from < approval.value ? { from, to: approval.value, question: 'permit_date' } : null };
  }
  return { ...base, refDate: today, source: 'today', status: ASSUMED, window: W > 0 ? { from: addDays(today, -W), to: today, question: 'permit_date' } : null };
}

// 시설 id → 이름 (시설 마스터 → 데이터 파일 → inputs.json 의 installed 대상 순)
export function facilityNames(facilitiesJson, dataFiles = {}, inputsJson) {
  const names = new Map();
  for (const f of facilitiesJson?.facilities || []) names.set(f.id, f.name);
  for (const file of Object.values(dataFiles)) for (const f of file?.fire_facilities || []) if (!names.has(f.facility_id)) names.set(f.facility_id, f.facility_name);
  const installed = (inputsJson?.inputs || []).find((d) => d.id === 'installed');
  for (const t of installed?.targets || []) if (!names.has(t.id)) names.set(t.id, t.name);
  return names;
}

// 평가에 필요한 데이터 파일(type_code) — 호출자가 이것만 불러오면 된다
export function requiredTypeCodes(building) {
  return [...new Set(building.dongs.flatMap((d) => d.typeCodes))].sort();
}

const RANK = { F: 0, U: 1, T: 2 };

// 동별 결과 → 시설별 결합(가장 강한 판정). v1 화면은 이 목록 하나만 본다
function aggregate(dongs) {
  const byId = new Map();
  for (const d of dongs) {
    for (const f of d.facilities) {
      const cur = byId.get(f.id);
      if (!cur) {
        byId.set(f.id, { ...f, dongs: { [d.id]: f.verdict }, questions: [...f.questions], regulations: [...f.regulations], allRegulations: [...f.allRegulations] });
        continue;
      }
      cur.dongs[d.id] = f.verdict;
      for (const q of f.questions) if (!cur.questions.some((x) => x.key === q.key)) cur.questions.push(q);
      for (const r of f.regulations) if (!cur.regulations.includes(r)) cur.regulations.push(r);
      for (const r of f.allRegulations) if (!cur.allRegulations.includes(r)) cur.allRegulations.push(r);
      if (RANK[f.value] > RANK[cur.value]) {
        Object.assign(cur, { value: f.value, verdict: f.verdict, required: f.required, reason: f.reason, reasons: f.reasons, scope: f.scope, exemption: f.exemption });
      }
    }
  }
  return [...byId.values()];
}

const lo = (iv) => (iv && Number.isFinite(iv.lo) && iv.lo === iv.hi ? iv.lo : 0);

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
    dateInfo,
  };
  const dongs = building.dongs.map((d) => evaluateDong(d, bctx));
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
    counts: {
      applicable: merged.filter((f) => f.value === T).length,
      check: merged.filter((f) => f.value === U).length,
      notApplicable: merged.filter((f) => f.value === F).length,
    },
    dongs,
    questions,
    notEvaluated: dongs.flatMap((d) =>
      d.status === 'unmapped'
        ? [{ dong: d.id, type_code: null, status: 'unmapped', message: '용도 미분류 — v2 미평가' }]
        : d.files.filter((f) => f.status !== 'v2').map((f) => ({ dong: d.id, ...f })),
    ),
    warnings: building.warnings || [],
    verdictLabels: VERDICT,
  };
}
