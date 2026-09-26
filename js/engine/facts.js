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
// Floor = { key: 'B1'|'2F'|'R1', kind: basement|ground|rooftop, level, label, area, parts: [{ terms, area, raw, n }], synthesized }
//
// 해석 선택(옥탑·지하층의 층수 산입, 층수 불일치, 수동 입력 빈칸 등)은 policy.js 의 이름 있는 옵션으로만 정한다.
// 대장끼리 맞지 않거나 빠진 값은 확정값으로 만들지 않고 구간(모름)으로 남겨, 결정적이면 질문한다.

import { resolvePolicy } from './policy.js';
import { buildUseIndex, classifyUses, isAncillaryTerm, termGroups } from './uses.js';
import { ASSUMED, CONFIRMED, UNKNOWN, addInterval, any, exact, interval, makeDep, mergeDeps } from './logic.js';
import { formatYmd, normalizeYmd } from './dates.js';

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const posNum = (v) => (num(v) > 0 ? num(v) : null);
const nonNegInt = (v) => (Number.isInteger(num(v)) && num(v) >= 0 ? num(v) : null);

export const FLOOR_KIND_LABEL = Object.freeze({ basement: '지하', ground: '', rooftop: '옥탑' });
export const SITE_DONG_ID = '대지 전체';
const PARKING_USES = new Set(['parking_structure', 'indoor_parking', 'garage', 'garage_apron']);

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

// 층·부분의 알 수 없는 바닥면적: [0, 동 연면적 상한]. 한 부분짜리 층은 층 면적 질문(floor_area),
// 여러 부분 층의 빈 칸은 그 부분 면적 질문(part_area[n]) — 층 면적만 답해서는 부분 배분이 정해지지 않기 때문
export function unknownFloorArea(dongId, key, totalArea, label, part) {
  const range = [0, totalArea.hi];
  const open = part
    ? makeDep('part_area', UNKNOWN, { dong: dongId, floor: key, sig: String(part.n), range, info: { floorLabel: label, partLabel: part.label } })
    : makeDep('floor_area', UNKNOWN, { dong: dongId, floor: key, range, info: label ? { floorLabel: label } : undefined });
  return interval(0, totalArea.hi, { hiDeps: totalArea.hiDeps, open: [open] });
}

const partLabelOf = (raw) => String(raw?.etcPurps || raw?.mainPurpsCdNm || '').trim() || '용도 미상';

// 층별개요 항목들 → 층 목록 (같은 층의 여러 행은 부분(part)으로)
function buildFloors(items, dongId, index, contextGroup, cap, fallbackTerms, warnings) {
  const byKey = new Map();
  for (const item of items) {
    const kind = floorKind(item);
    const level = kind ? floorLevel(item, kind) : null;
    if (!kind || !level) {
      warnings.push({ code: 'FLOOR_ITEM_UNPARSED', dong: dongId, message: `층 구분을 알 수 없는 층별개요 항목: ${item.flrNoNm ?? item.flrNo ?? '?'}` });
      continue;
    }
    const key = floorKey(kind, level);
    if (!byKey.has(key)) byKey.set(key, { key, kind, level, label: floorLabel(kind, level), items: [] });
    byKey.get(key).items.push(item);
  }
  const floors = [];
  for (const f of byKey.values()) {
    const multi = f.items.length > 1;
    const parts = f.items.map((item, i) => {
      const cls = classifyUses(item.mainPurpsCdNm, item.etcPurps, index, contextGroup);
      const raw = { mainPurpsCdNm: item.mainPurpsCdNm ?? '', etcPurps: item.etcPurps ?? '' };
      const a = posNum(item.area);
      const area =
        a !== null
          ? exact(a, [registryDep(multi ? 'part_area' : 'floor_area', dongId, f.key)])
          : unknownFloorArea(dongId, f.key, cap, f.label, multi ? { n: i + 1, label: partLabelOf(raw) } : null);
      return { terms: cls.terms.length ? cls.terms : fallbackTerms, area, raw, n: i + 1 };
    });
    floors.push({ key: f.key, kind: f.kind, level: f.level, label: f.label, parts, area: parts.map((p) => p.area).reduce(addInterval), synthesized: false });
  }
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

// 층수: 층별개요가 표제부 층수보다 더 높은(깊은) 층을 보이면 충돌 — 정책(floorCountConflict)에 따라 한쪽을 쓰거나
// 두 값 사이 구간(모름)으로 두고 경고한다. 층별개요가 더 적은 층만 보이면 목록이 덜 적힌 것으로 보고 표제부를 따른다
// (빠진 층은 평가 때 면적 미상으로 보충). 표제부 층수가 없으면 층별개요의 최고층은 하한일 뿐이다(목록이 덜 적혔을 수 있음).
function floorCount(input, id, fromTitle, fromItems, policy, warnings, what) {
  if (fromTitle === null && fromItems !== null) return { lo: fromItems, hi: Infinity, source: 'floor_items' };
  if (fromTitle !== null && fromItems !== null && fromItems > fromTitle) {
    const message = `${id}: 표제부 ${what} ${fromTitle}층 ↔ 층별개요 ${what} ${fromItems}층`;
    warnings.push({ code: input === 'ground_floors' ? 'FLOOR_COUNT_MISMATCH' : 'BASEMENT_COUNT_MISMATCH', dong: id, message });
    if (policy.floorCountConflict === 'title') return { lo: fromTitle, hi: fromTitle, source: 'registry' };
    if (policy.floorCountConflict === 'floor_items') return { lo: fromItems, hi: fromItems, source: 'floor_items' };
    return { lo: fromTitle, hi: fromItems, conflict: message };
  }
  if (fromTitle !== null && fromItems !== null && fromItems < fromTitle) {
    warnings.push({ code: 'FLOOR_ITEMS_PARTIAL', dong: id, message: `${id}: 층별개요가 ${what} ${fromTitle}층 중 ${fromItems}층까지만 있음 — 빠진 층은 면적 미상` });
  }
  const v = fromTitle ?? fromItems;
  return v === null ? null : { lo: v, hi: v, source: fromTitle !== null ? 'registry' : 'floor_items' };
}

function countMetric(input, id, c) {
  if (!c) return unknownMetric(input, id);
  const dep = registryDep(input, id, undefined, c.source ?? 'registry');
  if (c.lo === c.hi) return exact(c.lo, [dep]);
  return interval(c.lo, c.hi, {
    loDeps: [dep],
    hiDeps: Number.isFinite(c.hi) ? [dep] : [],
    open: [makeDep(input, UNKNOWN, { dong: id, range: [c.lo, c.hi], info: { conflict: c.conflict } })],
  });
}

// 연면적이 표제부에 없으면: 층별개요가 층수만큼의 모든 층(지상·지하)을 면적과 함께 덮을 때만 그 합을 쓰고,
// 아니면 [알려진 층 면적 합, ∞) 구간(모름). 옥탑 면적은 바닥면적 산입 여부가 갈리므로(건축법 시행령 제119조) 구간으로 둔다.
function derivedTotal(id, floors, ground, basement) {
  const body = floors.filter((f) => f.kind !== 'rooftop');
  const roofs = floors.filter((f) => f.kind === 'rooftop');
  const known = body.reduce((s, f) => s + f.area.lo, 0);
  const roofHi = roofs.reduce((s, f) => s + f.area.hi, 0);
  const exactCount = (c) => (c && c.lo === c.hi ? c.lo : null);
  const g = exactCount(ground);
  const b = exactCount(basement);
  const have = new Set(body.map((f) => f.key));
  const covers = g !== null && b !== null && body.length > 0
    && Array.from({ length: g }, (_, i) => floorKey('ground', i + 1)).every((k) => have.has(k))
    && Array.from({ length: b }, (_, i) => floorKey('basement', i + 1)).every((k) => have.has(k))
    && floors.every((f) => !f.area.open.length);
  const dep = [registryDep('total_area', id, undefined, 'floor_items')];
  const open = [makeDep('total_area', UNKNOWN, { dong: id })];
  if (covers && !roofs.length) return exact(known, dep);
  if (covers) return interval(known, known + roofHi, { loDeps: dep, hiDeps: dep, open });
  return interval(known, Infinity, { loDeps: known > 0 ? dep : [], open });
}

function buildDong(t, id, floorItems, index, policy, warnings) {
  const notes = [];
  const titleCls = classifyUses(t.mainPurpsCdNm, t.etcPurps, index);
  const contextGroup = titleCls.mainGroup ?? titleCls.groups[0] ?? null;
  const total = posNum(t.totArea);
  const cap = total !== null ? exact(total, [registryDep('total_area', id)]) : interval(0, Infinity);

  const floors = buildFloors(floorItems, id, index, contextGroup, cap, titleCls.terms, warnings);
  const groundItemsTop = Math.max(0, ...floors.filter((f) => f.kind === 'ground').map((f) => f.level));
  const basementItemsTop = Math.max(0, ...floors.filter((f) => f.kind === 'basement').map((f) => f.level));

  // 층수(지상). 표제부 0층은 지하층만 있는 동(지하주차장 등)일 때만 확정 0으로 본다(그 밖의 0은 빈 값)
  const undergroundOnly = nonNegInt(t.grndFlrCnt) === 0 && (num(t.ugrndFlrCnt) > 0 || basementItemsTop > 0) && !groundItemsTop;
  const titleGround = undergroundOnly ? 0 : posNum(t.grndFlrCnt);
  const ground = floorCount('ground_floors', id, titleGround, groundItemsTop || null, policy, warnings, '지상');
  const roofCount = applyRooftopPolicy(floors, Number.isFinite(ground?.hi) ? ground.hi : groundItemsTop, policy);
  if (ground && roofCount) Object.assign(ground, { lo: ground.lo + roofCount, hi: ground.hi + roofCount });
  if (ground?.conflict) notes.push('FLOOR_COUNT_MISMATCH');

  const titleBasement = nonNegInt(t.ugrndFlrCnt);
  const basement = floorCount('basement_floors', id, titleBasement, basementItemsTop || null, policy, warnings, '지하');
  if (basement?.conflict) notes.push('BASEMENT_COUNT_MISMATCH');

  const totalArea = total !== null ? cap : derivedTotal(id, floors, ground, basement);

  const height = posNum(t.heit);
  const hh = nonNegInt(t.hhldCnt);
  const allTerms = [...titleCls.terms, ...floors.flatMap((f) => f.parts.flatMap((p) => p.terms))];
  const groups = [...new Set([titleCls.mainGroup, ...termGroups(allTerms, index)].filter(Boolean))];
  const residential = groups.includes('01') || groups.includes('00');
  const metrics = {
    total_area: totalArea,
    ground_floors: countMetric('ground_floors', id, ground),
    basement_floors: countMetric('basement_floors', id, basement),
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

// 허가일: 인허가 API → 총괄표제부 → 표제부. 인허가가 여러 건(신축·증축·개축·재축·용도변경·대수선 등)이면
// 모두 후보로 남기고(가장 이른 신축을 기준일로, 상태는 가정) 경고한다 — 어느 허가가 판정 기준인지는 엔진이 묻는다.
function registryDates({ title, recap, permit }, warnings) {
  const permits = permit
    .map((p) => ({ date: normalizeYmd(p.archPmsDay), kind: String(p.archGbCdNm ?? '').trim() || '구분 없음' }))
    .filter((p) => p.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let permitDate = null;
  if (permits.length) {
    const candidates = [...new Set(permits.map((p) => p.date))];
    const newBuild = permits.filter((p) => p.kind.includes('신축'));
    const value = (newBuild.length ? newBuild : permits)[0].date;
    permitDate = { value, source: 'permit_api', status: candidates.length > 1 ? ASSUMED : CONFIRMED, candidates, permits };
    if (candidates.length > 1) {
      const list = permits.map((p) => `${formatYmd(p.date)} ${p.kind}`).join(', ');
      warnings.push({ code: 'MULTIPLE_PERMITS', message: `건축 인허가 ${permits.length}건(${list}) — 판정 기준이 되는 허가일 확인 필요` });
    }
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

// 층수 구간 → effectiveFloors 인자: 확정 정수, { lo, hi }(유한 구간) 또는 null(모름)
export function countOf(iv) {
  if (!iv) return null;
  if (iv.lo === iv.hi && !iv.open.length && Number.isInteger(iv.lo)) return iv.lo;
  return Number.isFinite(iv.hi) ? { lo: iv.lo, hi: iv.hi } : null;
}

const FLOORS_CACHE = new WeakMap(); // dong → (층수 조합 → 결과). 층 객체는 답변과 무관하므로 재사용한다

// 평가에 쓰는 층 목록과 구분별 완전성: 층별개요의 층 + 층수(확정일 때)만큼 빠진 층 보충.
// 층수가 구간이면 층별개요가 그 상한까지 모든 층을 덮을 때만 완전(상위집합), 모르면 불완전.
// 옥탑은 층수 자료가 없어 층별개요에 있는 것만 본다(완전으로 취급).
export function effectiveFloors(dong, groundCount, basementCount) {
  const cacheKey = `${JSON.stringify(groundCount)}|${JSON.stringify(basementCount)}`;
  let byDong = FLOORS_CACHE.get(dong);
  if (!byDong) FLOORS_CACHE.set(dong, (byDong = new Map()));
  if (byDong.has(cacheKey)) return byDong.get(cacheKey);
  const floors = [...dong.floors];
  const have = new Set(floors.map((f) => f.key));
  const complete = { ground: false, basement: false, rooftop: true };
  const fill = (kind, count) => {
    if (Number.isInteger(count)) {
      for (let level = 1; level <= count; level++) {
        const key = floorKey(kind, level);
        if (have.has(key)) continue;
        const area = unknownFloorArea(dong.id, key, dong.metrics.total_area, floorLabel(kind, level));
        floors.push({ key, kind, level, label: floorLabel(kind, level), area, parts: [{ terms: dong.synthTerms, area, raw: null, n: 1 }], synthesized: true });
      }
      complete[kind] = true;
    } else if (count && Number.isFinite(count.hi)) {
      complete[kind] = Array.from({ length: count.hi }, (_, i) => floorKey(kind, i + 1)).every((k) => have.has(k));
    }
  };
  fill('ground', groundCount);
  fill('basement', basementCount);
  const out = { floors: sortFloors(floors), complete };
  byDong.set(cacheKey, out);
  return out;
}

const isUndergroundOnly = (d) => d.metrics.ground_floors.hi === 0 && d.metrics.basement_floors.lo > 0;
const isParkingOnly = (d) => {
  const terms = [...d.synthTerms, ...d.floors.flatMap((f) => f.parts.flatMap((p) => p.terms))];
  return d.fileGroups.length === 1 && d.fileGroups[0] === '18' && terms.length > 0 && terms.every((t) => t.use && PARKING_USES.has(t.use));
};

// 여러 동이 지하주차장 등으로 연결되어 하나의 소방대상물일 수 있는 대지인가 (CP1 검수 전 보수적 처리의 대상)
export function siteLinkCandidate(building) {
  return building.dongs.length >= 2 && building.dongs.some((d) => isUndergroundOnly(d) || isParkingOnly(d));
}

const maxInterval = (a, b) => interval(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi), {
  loDeps: mergeDeps(a.loDeps, b.loDeps),
  hiDeps: mergeDeps(a.hiDeps, b.hiDeps),
  open: mergeDeps(a.open, b.open),
});

// 대지의 모든 동을 하나의 소방대상물로 합친 가상 동 — 연결된 동을 하나로 볼 때의 판정 확인용
// (연면적·세대수 합, 층수 최댓값, 같은 층은 부분을 합침. 합친 동의 질문 키는 이 동 이름으로 만든다)
export function mergeDongs(dongs, { useIndex, vocabulary, policy } = {}, id = SITE_DONG_ID) {
  const index = useIndex || buildUseIndex(vocabulary);
  const pol = resolvePolicy(policy);
  const byKey = new Map();
  for (const d of dongs) {
    const { floors } = effectiveFloors(d, countOf(d.metrics.ground_floors), countOf(d.metrics.basement_floors));
    for (const f of floors) {
      if (!byKey.has(f.key)) byKey.set(f.key, { key: f.key, kind: f.kind, level: f.level, label: f.label, parts: [], synthesized: false });
      byKey.get(f.key).parts.push(...f.parts.map((p) => ({ ...p, n: byKey.get(f.key).parts.length + 1 })));
    }
  }
  const floors = [...byKey.values()];
  for (const f of floors) f.area = f.parts.map((p) => p.area).reduce(addInterval);
  const sum = (k) => dongs.map((d) => d.metrics[k]).reduce(addInterval);
  const max = (k) => dongs.map((d) => d.metrics[k]).reduce(maxInterval);
  const synthTerms = [];
  for (const t of dongs.flatMap((d) => d.synthTerms)) if (!synthTerms.some((x) => x.use === t.use && x.group === t.group)) synthTerms.push(t);
  const allTerms = [...synthTerms, ...floors.flatMap((f) => f.parts.flatMap((p) => p.terms))];
  const groups = [...new Set([...dongs.flatMap((d) => d.groups), ...termGroups(allTerms, index)])];
  const elevators = dongs.map((d) => d.flags?.elevator).filter(Boolean);
  const metrics = { total_area: sum('total_area'), ground_floors: max('ground_floors'), basement_floors: max('basement_floors'), height: max('height'), households: sum('households') };
  return {
    id,
    name: id,
    source: 'site',
    mainGroup: dongs[0]?.mainGroup ?? null,
    groups,
    ...fileSelection(allTerms, groups, index, pol),
    notCovered: [],
    floors: sortFloors(floors),
    synthTerms,
    metrics,
    flags: elevators.length ? { elevator: any(elevators) } : {},
    notes: ['SITE_MERGED'],
    members: dongs.map((d) => d.id),
  };
}
