// 건물 사실 정규화 — 건축물대장 항목(표제부·층별개요·총괄표제부·인허가) 또는 수동 입력 → 동별 사실
//
// Building = { source, dongs: Dong[], dates: { permit, approval }, warnings }
// Dong = {
//   id, name, mainGroup, groups, fileGroups, typeCodes, mixedUseCandidate, notCovered,
//   floors: Floor[]            // 층별개요에 있는 층(옥탑 포함). 빠진 층은 평가 시 층수로 보충(effectiveFloors)
//   synthTerms                 // 보충하는 층의 용도(표제부 용도)
//   metrics: { total_area, ground_floors, basement_floors, height, households, building_area }  // 구간
//   flags: { elevator? }       // 3값
//   notes: []
// }
// Floor = { key: 'B1'|'2F'|'R1', kind: basement|ground|rooftop, level, label, area, parts: [{ terms, area, raw }], synthesized }
//
// 해석 선택(옥탑·지하층의 층수 산입, 수동 입력 빈칸 등)은 policy.js 의 이름 있는 옵션으로만 정한다.

import { resolvePolicy } from './policy.js';
import { buildUseIndex, classifyUses, isAncillaryTerm, termGroups } from './uses.js';
import { ASSUMED, CONFIRMED, UNKNOWN, addInterval, exact, interval, makeDep } from './logic.js';
import { normalizeYmd } from './dates.js';

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const posNum = (v) => (num(v) > 0 ? num(v) : null);
const nonNegInt = (v) => (Number.isInteger(num(v)) && num(v) >= 0 ? num(v) : null);

export const FLOOR_KIND_LABEL = Object.freeze({ basement: '지하', ground: '', rooftop: '옥탑' });

export function floorKey(kind, level) {
  return kind === 'basement' ? `B${level}` : kind === 'rooftop' ? `R${level}` : `${level}F`;
}

export function floorLabel(kind, level) {
  return `${FLOOR_KIND_LABEL[kind]}${level}층`;
}

const KIND_ORDER = { basement: 0, ground: 1, rooftop: 2 };
export function sortFloors(floors) {
  return floors.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.kind === 'basement' ? b.level - a.level : a.level - b.level));
}

// 층별개요 항목의 층 구분: flrGbCd 10 지하 · 20 지상 · 30 옥탑 (없으면 이름으로 추정)
function floorKind(item) {
  const cd = String(item.flrGbCd ?? '').trim();
  const nm = String(item.flrGbCdNm ?? '').trim();
  if (cd === '10' || nm === '지하') return 'basement';
  if (cd === '30' || nm.includes('옥탑')) return 'rooftop';
  if (cd === '20' || nm === '지상') return 'ground';
  const name = String(item.flrNoNm ?? '').trim();
  if (/^(지하?|B)\s*\d/i.test(name)) return 'basement';
  if (/^(옥탑|PH|R)/i.test(name)) return 'rooftop';
  if (/^\d+\s*층?$/.test(name)) return 'ground';
  return null;
}

function floorLevel(item, kind) {
  const n = num(item.flrNo);
  if (Number.isInteger(n) && n > 0) return n;
  const m = /(\d+)/.exec(String(item.flrNoNm ?? ''));
  if (m) return Number(m[1]);
  return kind === 'rooftop' ? 1 : null;
}

const dongIdOf = (t) => String(t?.dongNm ?? '').trim();

function registryDep(input, dong, floor, source = 'registry') {
  return makeDep(input, CONFIRMED, { dong, floor, source });
}

function unknownMetric(input, dong) {
  return interval(0, Infinity, { open: [makeDep(input, UNKNOWN, { dong })] });
}

// 층의 알 수 없는 바닥면적: [0, 동 연면적 상한]
export function unknownFloorArea(dongId, key, totalArea, label) {
  const range = [0, totalArea.hi];
  const info = label ? { floorLabel: label } : undefined;
  return interval(0, totalArea.hi, { hiDeps: totalArea.hiDeps, open: [makeDep('floor_area', UNKNOWN, { dong: dongId, floor: key, range, info })] });
}

function partArea(item, dongId, key, totalArea, label) {
  const a = posNum(item.area);
  return a !== null ? exact(a, [registryDep('floor_area', dongId, key)]) : unknownFloorArea(dongId, key, totalArea, label);
}

// 층별개요 항목들 → 층 목록 (같은 층의 여러 행은 부분(part)으로)
function buildFloors(items, dongId, index, totalArea, fallbackTerms, warnings) {
  const byKey = new Map();
  for (const item of items) {
    const kind = floorKind(item);
    const level = kind ? floorLevel(item, kind) : null;
    if (!kind || !level) {
      warnings.push({ code: 'FLOOR_ITEM_UNPARSED', dong: dongId, message: `층 구분을 알 수 없는 층별개요 항목: ${item.flrNoNm ?? item.flrNo ?? '?'}` });
      continue;
    }
    const key = floorKey(kind, level);
    if (!byKey.has(key)) byKey.set(key, { key, kind, level, label: floorLabel(kind, level), parts: [], synthesized: false });
    const cls = classifyUses(item.mainPurpsCdNm, item.etcPurps, index);
    byKey.get(key).parts.push({
      terms: cls.terms.length ? cls.terms : fallbackTerms,
      area: partArea(item, dongId, key, totalArea, floorLabel(kind, level)),
      raw: { mainPurpsCdNm: item.mainPurpsCdNm ?? '', etcPurps: item.etcPurps ?? '' },
    });
  }
  const floors = [...byKey.values()];
  for (const f of floors) f.area = f.parts.map((p) => p.area).reduce(addInterval);
  return floors;
}

// 옥탑을 층으로 보는 정책이면 지상 최상층 위의 지상층으로 바꾼다
function applyRooftopPolicy(floors, groundTop, policy) {
  if (!policy.rooftopCountsAsFloor) return 0;
  const roofs = floors.filter((f) => f.kind === 'rooftop').sort((a, b) => a.level - b.level);
  roofs.forEach((f, i) => {
    f.kind = 'ground';
    f.level = groundTop + i + 1;
    f.key = floorKey('ground', f.level);
    f.label = `${floorLabel('ground', f.level)}(옥탑)`;
  });
  return roofs.length;
}

// 동 용도군 → 평가할 파일(type_code) 목록과 복합건축물 후보 여부
function fileSelection(allTerms, groups, index, policy) {
  let fileGroups = groups;
  if (policy.mixedUseIgnoreAncillary) {
    const main = termGroups(allTerms.filter((t) => !isAncillaryTerm(t, index)), index);
    fileGroups = main.length ? groups.filter((g) => main.includes(g)) : groups;
  }
  fileGroups = fileGroups.filter((g) => g !== '30');
  const mixedUseCandidate = fileGroups.length >= 2;
  return { fileGroups, mixedUseCandidate, typeCodes: mixedUseCandidate ? [...fileGroups, '30'] : [...fileGroups] };
}

function buildDong(t, id, floorItems, index, policy, warnings) {
  const notes = [];
  const titleCls = classifyUses(t.mainPurpsCdNm, t.etcPurps, index);
  const total = posNum(t.totArea);
  let totalArea = total !== null ? exact(total, [registryDep('total_area', id)]) : unknownMetric('total_area', id);

  const floors = buildFloors(floorItems, id, index, totalArea, titleCls.terms, warnings);
  const groundItemsTop = Math.max(0, ...floors.filter((f) => f.kind === 'ground').map((f) => f.level));
  const basementItemsTop = Math.max(0, ...floors.filter((f) => f.kind === 'basement').map((f) => f.level));

  // 층수(지상). 표제부 0층은 지하층만 있는 동(지하주차장 등)일 때만 확정 0으로 본다(그 밖의 0은 빈 값)
  const undergroundOnly = nonNegInt(t.grndFlrCnt) === 0 && (num(t.ugrndFlrCnt) > 0 || basementItemsTop > 0) && !groundItemsTop;
  const titleGround = undergroundOnly ? 0 : posNum(t.grndFlrCnt);
  let ground = policy.groundFloorsFrom === 'title' ? titleGround ?? (groundItemsTop || null) : groundItemsTop || titleGround;
  if (titleGround && groundItemsTop && titleGround !== groundItemsTop) notes.push('FLOOR_COUNT_MISMATCH');
  const groundSource = ground === titleGround ? 'registry' : 'floor_items';
  const roofCount = applyRooftopPolicy(floors, ground ?? groundItemsTop, policy);
  if (ground !== null && roofCount) ground += roofCount;
  const groundFloors = ground !== null ? exact(ground, [registryDep('ground_floors', id, undefined, groundSource)]) : unknownMetric('ground_floors', id);

  // 지하층수
  const titleBasement = nonNegInt(t.ugrndFlrCnt);
  const basement = titleBasement ?? (basementItemsTop || null);
  if (titleBasement !== null && basementItemsTop && titleBasement !== basementItemsTop) notes.push('BASEMENT_COUNT_MISMATCH');
  const basementFloors = basement !== null ? exact(basement, [registryDep('basement_floors', id)]) : unknownMetric('basement_floors', id);

  // 연면적이 표제부에 없으면 층별 면적 합계(모든 층이 확정일 때만)
  if (total === null && floors.length && floors.every((f) => f.area.open.length === 0) && ground !== null) {
    const sum = floors.reduce((s, f) => s + f.area.lo, 0);
    totalArea = exact(sum, [registryDep('total_area', id, undefined, 'floor_items')]);
  }

  const height = posNum(t.heit);
  const hh = nonNegInt(t.hhldCnt);
  const allTerms = [...titleCls.terms, ...floors.flatMap((f) => f.parts.flatMap((p) => p.terms))];
  const groups = [...new Set([titleCls.mainGroup, ...termGroups(allTerms, index)].filter(Boolean))];
  const residential = groups.includes('01') || groups.includes('00');
  const metrics = {
    total_area: totalArea,
    ground_floors: groundFloors,
    basement_floors: basementFloors,
    height: height !== null ? exact(height, [registryDep('height', id)]) : unknownMetric('height', id),
    households: hh !== null && (hh > 0 || !residential) ? exact(hh, [registryDep('households', id)]) : unknownMetric('households', id),
  };
  const archArea = posNum(t.archArea);
  if (archArea !== null) metrics.building_area = exact(archArea, [registryDep('building_area', id)]);

  const flags = {};
  const ride = num(t.rideUseElvtCnt);
  const emg = num(t.emgenUseElvtCnt);
  if (ride > 0 || emg > 0) flags.elevator = { v: 'T', deps: [registryDep('elevator', id)], why: [`승강기 ${(ride || 0) + (emg || 0)}대`] };
  else if (Number.isFinite(ride) && Number.isFinite(emg)) flags.elevator = { v: 'F', deps: [registryDep('elevator', id)], why: ['승강기 없음'] };

  return {
    id,
    name: id,
    source: 'registry',
    mainGroup: titleCls.mainGroup,
    groups,
    ...fileSelection(allTerms, groups, index, policy),
    notCovered: titleCls.notCovered,
    floors: sortFloors(floors),
    synthTerms: titleCls.terms,
    metrics,
    flags,
    notes,
  };
}

// 인허가 API(신축 우선) → 총괄표제부 → 표제부 순으로 허가일, 총괄표제부 → 표제부 순으로 사용승인일
function registryDates({ title, recap, permit }, warnings) {
  const valid = permit.filter((p) => normalizeYmd(p.archPmsDay));
  const newBuild = valid.filter((p) => String(p.archGbCdNm ?? '').includes('신축'));
  const candidates = [...new Set((newBuild.length ? newBuild : valid).map((p) => normalizeYmd(p.archPmsDay)))].sort();
  let permitDate = null;
  if (candidates.length) {
    permitDate = { value: candidates[0], source: 'permit_api', status: candidates.length > 1 ? ASSUMED : CONFIRMED, candidates };
    if (candidates.length > 1) warnings.push({ code: 'MULTIPLE_PERMITS', message: `허가일 후보 ${candidates.length}개: ${candidates.join(', ')}` });
  } else {
    const fromRecap = recap.map((r) => normalizeYmd(r.pmsDay)).filter(Boolean);
    const fromTitle = [...new Set(title.map((r) => normalizeYmd(r.pmsDay)).filter(Boolean))].sort();
    if (fromRecap.length) permitDate = { value: fromRecap[0], source: 'recap', status: CONFIRMED, candidates: [fromRecap[0]] };
    else if (fromTitle.length) {
      permitDate = { value: fromTitle[0], source: 'title', status: fromTitle.length > 1 ? ASSUMED : CONFIRMED, candidates: fromTitle };
    }
  }
  const recapApproval = recap.map((r) => normalizeYmd(r.useAprDay)).filter(Boolean);
  const titleApproval = title.map((r) => normalizeYmd(r.useAprDay)).filter(Boolean).sort();
  let approval = null;
  if (recapApproval.length) approval = { value: recapApproval[0], source: 'recap' };
  else if (titleApproval.length) approval = { value: titleApproval[0], source: 'title' };
  return { permit: permitDate, approval };
}

// 건축물대장 → Building
export function normalizeRegistry(items = {}, opts = {}) {
  const policy = resolvePolicy(opts.policy);
  const index = opts.useIndex || buildUseIndex(opts.vocabulary);
  const title = asArray(items.title);
  const floorItems = asArray(items.floors);
  const recap = asArray(items.recap);
  const permit = asArray(items.permit);
  const warnings = [];
  const titles = title.length ? title : recap.slice(0, 1);
  if (!title.length && recap.length) warnings.push({ code: 'RECAP_ONLY', message: '표제부 없이 총괄표제부로 평가' });
  const used = new Set();
  const dongs = titles.map((t, i) => {
    let id = dongIdOf(t) || (titles.length === 1 ? '본동' : `${i + 1}번째 동`);
    if (used.has(id)) id = `${id}#${i + 1}`;
    used.add(id);
    const own = titles.length === 1 ? floorItems : floorItems.filter((f) => dongIdOf(f) === dongIdOf(t));
    return buildDong(t, id, own, index, policy, warnings);
  });
  if (titles.length > 1) {
    const names = new Set(titles.map(dongIdOf));
    const orphan = floorItems.filter((f) => !names.has(dongIdOf(f)));
    if (orphan.length) warnings.push({ code: 'FLOOR_ITEMS_UNMATCHED', message: `표제부 동과 맞지 않는 층별개요 ${orphan.length}건` });
  }
  return { source: 'registry', dongs, dates: registryDates({ title, recap, permit }, warnings), warnings };
}

// 수동 입력(main.js submitManualInput 의 객체) → Building
// 선택 필드: enteredFields(사용자가 실제로 입력한 필드명 배열), permitDateIsDefault(허가일 빈칸이라 오늘로 채움)
export function normalizeManual(input = {}, opts = {}) {
  const policy = resolvePolicy(opts.policy);
  const index = opts.useIndex || buildUseIndex(opts.vocabulary);
  const id = opts.dongId || '직접입력';
  const entered = new Set(asArray(input.enteredFields));
  const user = (name) => [makeDep(name, CONFIRMED, { dong: id, source: 'user' })];
  const purpose = input.mainPurpose || input.mainPurpsCdNm || '';
  const cls = classifyUses(purpose, '', index);

  const area = posNum(input.totArea);
  const ground = posNum(input.grndFlrCnt);
  const basement = nonNegInt(input.ugrndFlrCnt) ?? 0;
  let basementFloors;
  if (basement > 0 || entered.has('ugrndFlrCnt')) basementFloors = exact(basement, user('basement_floors'));
  else if (policy.manualBlankBasement === 'assume_zero') basementFloors = exact(0, [makeDep('basement_floors', ASSUMED, { dong: id, source: 'policy' })]);
  else basementFloors = unknownMetric('basement_floors', id);

  const metrics = {
    total_area: area !== null ? exact(area, user('total_area')) : unknownMetric('total_area', id),
    ground_floors: ground !== null ? exact(Math.round(ground), user('ground_floors')) : unknownMetric('ground_floors', id),
    basement_floors: basementFloors,
    height: posNum(input.heit) !== null ? exact(posNum(input.heit), user('height')) : unknownMetric('height', id),
    households: posNum(input.hhldCnt) !== null ? exact(posNum(input.hhldCnt), user('households')) : unknownMetric('households', id),
  };
  const groups = cls.groups;
  const dong = {
    id,
    name: id,
    source: 'manual',
    mainGroup: cls.mainGroup ?? groups[0] ?? null,
    groups,
    ...fileSelection(cls.terms, groups, index, policy),
    notCovered: cls.notCovered,
    floors: [],
    synthTerms: cls.terms,
    metrics,
    flags: {},
    notes: [],
  };
  const pms = normalizeYmd(input.pmsDay ?? input.archPmsDay);
  const permitDate = pms && !input.permitDateIsDefault ? { value: pms, source: 'manual', status: CONFIRMED, candidates: [pms] } : null;
  return { source: 'manual', dongs: [dong], dates: { permit: permitDate, approval: null }, warnings: [] };
}

// 평가에 쓰는 층 목록: 층별개요의 층 + 층수(답변 반영)만큼 빠진 층 보충. 층수를 모르면 complete=false
export function effectiveFloors(dong, groundCount, basementCount) {
  const floors = [...dong.floors];
  const have = new Set(floors.map((f) => f.key));
  const addMissing = (kind, count) => {
    for (let level = 1; level <= count; level++) {
      const key = floorKey(kind, level);
      if (have.has(key)) continue;
      const area = unknownFloorArea(dong.id, key, dong.metrics.total_area, floorLabel(kind, level));
      floors.push({ key, kind, level, label: floorLabel(kind, level), area, parts: [{ terms: dong.synthTerms, area, raw: null }], synthesized: true });
    }
  };
  if (Number.isInteger(groundCount)) addMissing('ground', groundCount);
  if (Number.isInteger(basementCount)) addMissing('basement', basementCount);
  return { floors: sortFloors(floors), complete: Number.isInteger(groundCount) && Number.isInteger(basementCount) };
}
