// 사이트 데이터(data/*.json)와 생성기 설정(content/config.json) 읽기·검사
//
// 용도 파일은 data/NN_*.json 을 모두 읽는다(00_house.json 처럼 다른 PR 에만 있는 파일은 있으면 쓰고 없으면 건너뜀).

import fs from 'node:fs';
import path from 'node:path';
import { BuildError, isValidYmd, isValidIsoDate, isoToYmd, useSlugFromFile, SLUG_RE } from './util.mjs';

const USE_FILE_RE = /^\d{2}_[a-z0-9_]+\.json$/;

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new BuildError(`파일을 읽을 수 없습니다: ${file} (${e.code || e.message})`);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new BuildError(`JSON 형식 오류: ${file} (${e.message})`);
  }
}

/** content/config.json — 데이터 기준일 등 */
export function loadConfig(root) {
  const file = path.join(root, 'content', 'config.json');
  const cfg = readJson(file);
  for (const key of ['dataVerified', 'standardsPublished']) {
    if (!isValidIsoDate(cfg[key])) throw new BuildError(`${file}: ${key} 는 YYYY-MM-DD 날짜여야 합니다`);
  }
  return { dataVerified: cfg.dataVerified, standardsPublished: cfg.standardsPublished };
}

/** content/static-pages.json — 손으로 쓴 페이지의 사이트맵 설정 */
export function loadStaticPageSettings(root) {
  const file = path.join(root, 'content', 'static-pages.json');
  if (!fs.existsSync(file)) return [];
  const json = readJson(file);
  const pages = Array.isArray(json.pages) ? json.pages : [];
  const seen = new Set();
  for (const p of pages) {
    if (typeof p.path !== 'string' || !p.path.startsWith('/')) throw new BuildError(`${file}: path 는 / 로 시작해야 합니다`);
    if (seen.has(p.path)) throw new BuildError(`${file}: 같은 path 가 두 번 있습니다: ${p.path}`);
    seen.add(p.path);
    if (p.lastmod !== undefined && !isValidIsoDate(p.lastmod)) throw new BuildError(`${file}: ${p.path} lastmod 는 YYYY-MM-DD`);
  }
  return pages;
}

function checkRow(r, where) {
  for (const k of ['start_date', 'end_date']) {
    if (r[k] !== null && r[k] !== undefined && !isValidYmd(r[k])) throw new BuildError(`${where}: ${k} 가 YYYYMMDD 가 아닙니다 (${r[k]})`);
  }
  if (r.start_date && r.end_date && r.start_date > r.end_date) throw new BuildError(`${where}: start_date 가 end_date 보다 늦습니다`);
  if (typeof r.criteria !== 'string' || !r.criteria.trim()) throw new BuildError(`${where}: criteria 가 비어 있습니다`);
}

/** data/ 전체 읽기 */
export function loadSiteData(root, config) {
  const dataDir = path.join(root, 'data');
  const master = readJson(path.join(dataDir, 'facilities.json')).facilities;
  if (!Array.isArray(master)) throw new BuildError('data/facilities.json: facilities 배열이 없습니다');
  const facilityById = new Map(master.map((f) => [f.id, f]));

  const uses = [];
  const slugs = new Set();
  for (const file of fs.readdirSync(dataDir).filter((f) => USE_FILE_RE.test(f)).sort()) {
    const json = readJson(path.join(dataDir, file));
    const where = `data/${file}`;
    if (typeof json.building_type !== 'string' || !Array.isArray(json.fire_facilities)) {
      throw new BuildError(`${where}: building_type·fire_facilities 가 없습니다`);
    }
    const slug = useSlugFromFile(file);
    if (!SLUG_RE.test(slug) || slugs.has(slug)) throw new BuildError(`${where}: 슬러그를 만들 수 없거나 중복입니다 (${slug})`);
    slugs.add(slug);
    for (const fac of json.fire_facilities) {
      if (!facilityById.has(fac.facility_id)) throw new BuildError(`${where}: facilities.json 에 없는 facility_id ${fac.facility_id}`);
      if (!Array.isArray(fac.regulations)) throw new BuildError(`${where}: ${fac.facility_id} regulations 가 배열이 아닙니다`);
      fac.regulations.forEach((r, k) => checkRow(r, `${where} ${fac.facility_id}[${k}]`));
    }
    uses.push({ file, slug, name: json.building_type, json });
  }

  const law = {
    act: readJson(path.join(dataDir, 'law_history_act.json')),
    decree: readJson(path.join(dataDir, 'law_history_decree.json')),
    rules: readJson(path.join(dataDir, 'law_history_rules.json')),
  };
  const nfsc = readJson(path.join(dataDir, 'nfsc_history.json'));

  // 기준일 검사: 기준일 뒤에 공포된 연혁이 있으면 데이터가 바뀌었는데 기준일을 올리지 않은 것
  const asOf = isoToYmd(config.dataVerified);
  let latest = null;
  const consider = (r, where) => {
    if (!isValidYmd(r.effective_date) || !isValidYmd(r.promulgation_date)) throw new BuildError(`${where}: 연혁 날짜 형식 오류 (${r.law_no || r.notice_no})`);
    if (!latest || r.promulgation_date > latest.date) latest = { date: r.promulgation_date, where, no: r.law_no || r.notice_no };
  };
  for (const [kind, list] of Object.entries(law)) list.forEach((r) => consider(r, `law_history_${kind}`));
  for (const [key, list] of Object.entries(nfsc)) list.forEach((r) => consider(r, `nfsc_history ${key}`));
  if (latest && latest.date > asOf) {
    throw new BuildError(
      `content/config.json 의 dataVerified(${config.dataVerified}) 가 ${latest.where} ${latest.no} 공포일(${latest.date})보다 이릅니다. ` +
        '데이터를 법령 원문과 대조한 날로 dataVerified 를 올리세요.',
    );
  }

  return { uses, facilities: master, facilityById, law, nfsc, asOf };
}

// ── 법령 연혁 도우미 ──────────────────────────────────────────────────

const LAW_KIND_LABEL = { act: '소방시설법', decree: '소방시설법 시행령', rules: '소방시설법 시행규칙' };

/** 연혁 행 표시 이름: "소방시설법 시행령(대통령령 제35151호)" */
export function lawTitle(kind, entry) {
  const no = kind === 'decree' && /^제/.test(entry.law_no) ? `대통령령 ${entry.law_no}` : entry.law_no;
  return `${LAW_KIND_LABEL[kind]}(${no})`;
}

/** 연혁 목록 정렬: 시행일 ↓, 공포일 ↓, no ↑ */
function byRecent(a, b) {
  return (
    b.effective_date.localeCompare(a.effective_date) ||
    b.promulgation_date.localeCompare(a.promulgation_date) ||
    (a.no ?? 0) - (b.no ?? 0)
  );
}

/** 기준일에 시행 중인 판(시행일이 기준일 이하인 것 중 가장 최근). 없으면 가장 오래된 판 */
export function versionAt(list, asOf) {
  const sorted = [...list].sort(byRecent);
  return sorted.find((r) => r.effective_date <= asOf) || sorted.at(-1) || null;
}

export function sortedRecent(list) {
  return [...list].sort(byRecent);
}

/** 모든 법령 연혁을 한 목록으로: [{kind, title, entry}] */
export function allLawEntries(law) {
  const out = [];
  for (const kind of ['act', 'decree', 'rules']) for (const entry of law[kind]) out.push({ kind, title: lawTitle(kind, entry), entry });
  return out;
}

/** 비고(note)에 인용된 법령 번호 → 연혁 행 (예: "대통령령 제35151호") */
export function citedLawEntries(text, law) {
  const found = [];
  const seen = new Set();
  const re = /(대통령령|법률|행정안전부령|총리령|내무부령|행정자치부령)\s*제(\d+)호/g;
  let m;
  while ((m = re.exec(text))) {
    const [, prefix, num] = m;
    const kind = prefix === '대통령령' ? 'decree' : prefix === '법률' ? 'act' : 'rules';
    const candidates = law[kind].filter((e) => e.law_no.replace(/\s/g, '').endsWith(`제${num}호`));
    const entry = sortedRecent(candidates).at(-1); // 같은 번호가 여러 시행일로 나뉘면 가장 이른 행(공포 링크는 같다)
    if (entry && !seen.has(entry.link)) {
      seen.add(entry.link);
      found.push({ kind, title: lawTitle(kind, entry), entry });
    }
  }
  return found;
}
