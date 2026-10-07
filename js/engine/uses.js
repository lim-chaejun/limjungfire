// 용도 어휘(data/schema/use_vocabulary.json) 색인과 건축물대장 용도 문자열 분류
//
// 용도 표현(term)은 두 가지다.
//   { use: 'midwifery_clinic' } — 세부 용도가 확인됨
//   { group: '02' }             — 용도군만 확인됨(그 군의 어떤 세부 용도든 가능 = 와일드카드)
// 층의 한 부분(part)은 term 목록을 가진다. 둘 이상이면 면적 배분을 모른다(용도 혼재).

const GROUP_CODE_RE = /^\d{2}$/;
export const isGroupCode = (s) => typeof s === 'string' && GROUP_CODE_RE.test(s);

// 비교용 정규화: 공백·점·가운뎃점 제거
export function normalizeUseText(s) {
  return String(s ?? '').normalize('NFC').replace(/[\s.·ㆍ]/g, '');
}

const push = (map, key, value) => {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
};

export function buildUseIndex(vocabulary) {
  if (!vocabulary || !Array.isArray(vocabulary.groups)) throw new Error('용도 어휘(use_vocabulary.json)가 필요함');
  const groups = new Map();
  const uses = new Map();
  const groupNames = new Map();
  const aliases = new Map();
  const notCovered = new Map();
  const contextAliases = new Map(); // 동의 주용도 군 → (별칭 → 세부 용도): 그 군의 건물 안에서는 뜻이 달라지는 말
  for (const g of vocabulary.groups) {
    groups.set(g.type_code, g);
    if (g.context_aliases) {
      contextAliases.set(g.type_code, new Map(Object.entries(g.context_aliases).map(([a, id]) => [normalizeUseText(a), id])));
    }
    for (const n of [g.name, ...(g.registry_names || [])]) groupNames.set(normalizeUseText(n), g.type_code);
    for (const u of g.uses || []) {
      uses.set(u.id, { ...u, group: g.type_code });
      for (const a of [u.name, ...(u.aliases || [])]) push(aliases, normalizeUseText(a), u.id);
    }
  }
  for (const u of vocabulary.auxiliary || []) {
    uses.set(u.id, { ...u, group: null, ancillary: true });
    for (const a of [u.name, ...(u.aliases || [])]) push(aliases, normalizeUseText(a), u.id);
  }
  for (const nc of vocabulary.not_covered || []) notCovered.set(normalizeUseText(nc.name), nc);
  // 부분 일치용 사전 — 긴 말부터 (예: '지하주차장'이 '주차장'보다 먼저)
  const containsList = [...new Set([...groupNames.keys(), ...aliases.keys(), ...notCovered.keys()])]
    .filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);
  return { groups, uses, groupNames, aliases, notCovered, containsList, contextAliases };
}

// 쉼표·괄호 등으로 먼저 나누고, 통째로 사전에 없으면 가운뎃점·'및'으로 한 번 더 나눈다
function segments(text) {
  return String(text ?? '')
    .split(/[,，、/()[\]{}]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function lookup(n, index) {
  if (index.notCovered.has(n)) return { notCovered: index.notCovered.get(n) };
  if (index.groupNames.has(n)) return { group: index.groupNames.get(n) };
  if (index.aliases.has(n)) return { uses: index.aliases.get(n), alias: n };
  return null;
}

// 토큰 하나 → 사전 항목들 (통째 → 분할 → 부분 일치 순)
function matchSegment(seg, index) {
  const whole = lookup(normalizeUseText(seg), index);
  if (whole) return { hits: [whole], rest: [] };
  const hits = [];
  const rest = [];
  for (const sub of seg.split(/[·ㆍ]|\s+및\s+|\s+/).map((s) => s.trim()).filter(Boolean)) {
    const hit = lookup(normalizeUseText(sub), index);
    if (hit) {
      hits.push(hit);
      continue;
    }
    let n = normalizeUseText(sub);
    let matched = false;
    for (const key of index.containsList) {
      if (n.replace(/\s/g, '').length < 2) break;
      if (!n.includes(key)) continue;
      hits.push(lookup(key, index));
      n = n.replace(key, ' ');
      matched = true;
    }
    if (!matched) rest.push(sub);
  }
  return { hits, rest };
}

// 건축물대장 주용도명 + 기타용도 → { terms, mainGroup, groups, notCovered, unmatched }
// 기타용도에서 세부 용도가 나오면 그것을 믿고 주용도 와일드카드는 붙이지 않는다
// (층별개요의 주용도코드는 분류 코드이고, 실제 용도는 기타용도에 적힌 경우가 대부분이다).
// contextGroup: 이 항목이 속한 동의 주용도 군(표제부). 그 군의 context_aliases 가 별칭 해석을 바꾼다
// (예: 자동차관련시설 동의 주차장 = 주차용 건축물, 다른 동의 주차장 = 건축물 내부 주차장). 없으면 이 항목의 주용도 군.
export function classifyUses(mainName, etcText, index, contextGroup = null) {
  const mainNorm = normalizeUseText(mainName);
  const mainGroup = index.groupNames.get(mainNorm) ?? null;
  const texts = mainGroup ? [etcText] : [mainName, etcText];
  const named = new Set();
  const useCandidates = [];
  const notCovered = [];
  const unmatched = [];
  for (const text of texts) {
    for (const seg of segments(text)) {
      const { hits, rest } = matchSegment(seg, index);
      unmatched.push(...rest);
      for (const h of hits) {
        if (h.group) named.add(h.group);
        else if (h.uses) useCandidates.push(h);
        else if (h.notCovered) notCovered.push(h.notCovered);
      }
    }
  }
  const prefer = [mainGroup, ...named].filter(Boolean);
  const context = index.contextAliases?.get(contextGroup ?? mainGroup);
  const detail = [];
  for (const { uses: ids, alias } of useCandidates) {
    const pick = context?.get(alias) ?? (prefer.map((g) => ids.find((id) => index.uses.get(id).group === g)).find(Boolean) || ids[0]);
    if (!detail.includes(pick)) detail.push(pick);
  }
  const terms = detail.map((id) => ({ use: id }));
  const detailGroups = new Set(detail.map((id) => index.uses.get(id).group).filter(Boolean));
  const wild = detail.length ? [...named] : [...new Set([mainGroup, ...named].filter(Boolean))];
  for (const g of wild) if (!detailGroups.has(g)) terms.push({ group: g });
  return { terms, mainGroup, groups: termGroups(terms, index), notCovered, unmatched };
}

export function termGroups(terms, index) {
  const out = [];
  for (const t of terms) {
    const g = t.group ?? index.uses.get(t.use)?.group;
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

// term 이 부수 용도(ancillary)인가 — 와일드카드는 부수 용도가 아니다
export const isAncillaryTerm = (term, index) => Boolean(term.use && index.uses.get(term.use)?.ancillary);

// 대상 용도에 보조 용도(용도군 없음 — 전기실·기계실 등)가 있으면, 층별개요가 그 용도를 적지 않은 부분이라도
// 그 방이 있을 수 있으므로 'maybe'. (그런 기준은 use 보다 지표 electrical_room_area 로 쓰는 것을 권장)
const hasAuxiliary = (targets, index) => targets.some((t) => !isGroupCode(t) && index.uses.get(t) && !index.uses.get(t).group);

function termCoverage(term, targets, index) {
  if (term.use) {
    const u = index.uses.get(term.use);
    if (targets.some((t) => t === term.use || (u?.group && t === u.group))) return 'yes';
    return hasAuxiliary(targets, index) ? 'maybe' : 'no';
  }
  let maybe = false;
  for (const t of targets) {
    if (t === term.group) return 'yes';
    const tu = index.uses.get(t);
    if (tu && (tu.group === term.group || !tu.group)) maybe = true; // 같은 군의 세부 용도 또는 보조 용도(전기실 등)
  }
  return maybe ? 'maybe' : 'no';
}

// 부분의 용도 목록이 대상 용도(세부 용도 id 또는 용도군 코드)를 덮는 정도
//   'all' 전부 대상 용도(면적 확정) · 'some' 대상 용도가 섞여 있음 · 'maybe' 있을 수 있음 · 'none' 없음
export function coverage(terms, targets, index) {
  if (!terms || !terms.length) return 'maybe';
  let yes = 0;
  let maybe = 0;
  for (const term of terms) {
    const c = termCoverage(term, targets, index);
    if (c === 'yes') yes++;
    else if (c === 'maybe') maybe++;
  }
  if (yes === terms.length) return 'all';
  if (yes) return 'some';
  return maybe ? 'maybe' : 'none';
}

export function useName(id, index) {
  if (isGroupCode(id)) return index.groups.get(id)?.name ?? id;
  return index.uses.get(id)?.name ?? id;
}

export const describeUses = (ids, index) => (ids || []).map((id) => useName(id, index)).join('·');

export function describeTerms(terms, index) {
  return (terms || []).map((t) => (t.use ? useName(t.use, index) : `${useName(t.group, index)}(세부 용도 미상)`)).join('·');
}
