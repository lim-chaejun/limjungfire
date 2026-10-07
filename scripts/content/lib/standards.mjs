// 기준 페이지 — /standards/ 허브, /standards/use/<slug>, /standards/facility/<slug>
//
// 데이터에 있는 것만 보여준다. 기준 문구는 '원문 요약'으로 표시하고, 판단 시점은 데이터 기준일(content/config.json)이다.
// 행 수가 MIN_INDEXABLE_ROWS 미만이면 noindex + 사이트맵 제외.

import {
  MIN_INDEXABLE_ROWS,
  RECENT_EVENTS_USE,
  HISTORY_EVENTS_FACILITY,
  NFSC_REVISIONS_SHOWN,
  HUB_LAW_EVENTS,
  CATEGORY_ORDER,
  GUIDE_BY_FACILITY,
  MANUAL_PURPOSE_BY_TYPE,
} from './config.mjs';
import { esc, link, fmtDot, ymdToIso, addDays, facilitySlug, josa, maxIso } from './util.mjs';
import { versionAt, sortedRecent, allLawEntries, citedLawEntries, lawTitle } from './data.mjs';
import {
  renderPage,
  pageHeader,
  section,
  ctaBox,
  sourcesSection,
  relatedSection,
  articleSchema,
  collectionSchema,
  metaModified,
  timeKo,
  DISCLAIMER,
} from './template.mjs';

export const HUB_PATH = '/standards/';
export const usePath = (slug) => `/standards/use/${slug}`;
export const facilityPath = (id) => `/standards/facility/${facilitySlug(id)}`;

/**
 * 기준 페이지의 최종 수정일(사이트맵 lastmod·dateModified) = 데이터 기준일.
 * 단 처음 게시한 날보다 앞설 수는 없다 (dateModified < datePublished 방지).
 */
export const pageLastmod = (config) => maxIso(config.dataVerified, config.standardsPublished);

const START_MIN = '00000000';
const END_MAX = '99999999';

/** 기준일 기준 행 상태: current | ended | future */
export function rowStatus(r, asOf) {
  if (r.start_date && r.start_date > asOf) return 'future';
  if (r.end_date && r.end_date < asOf) return 'ended';
  return 'current';
}

/** 적용 기간 표기 (조회 화면과 같은 표현) */
export function periodText(r, asOf) {
  const s = r.start_date;
  const e = r.end_date;
  if (!s && !e) return '상시 적용';
  if (s && !e) return rowStatus(r, asOf) === 'future' ? `${fmtDot(s)} ~` : `${fmtDot(s)} ~ 현재`;
  if (!s) return `~ ${fmtDot(e)}`;
  return `${fmtDot(s)} ~ ${fmtDot(e)}`;
}

const STATUS_BADGE = {
  current: '<span class="ce-badge ce-badge--ok">현행</span>',
  ended: '<span class="ce-badge ce-badge--muted">종료</span>',
  future: '<span class="ce-badge ce-badge--info">시행 예정</span>',
};

const byPeriod = (a, b) =>
  (a.row.start_date || START_MIN).localeCompare(b.row.start_date || START_MIN) ||
  (a.row.end_date || END_MAX).localeCompare(b.row.end_date || END_MAX) ||
  a.index - b.index;

function sortRows(regs) {
  return regs.map((row, index) => ({ row, index })).sort(byPeriod).map((x) => x.row);
}

function categoryRank(cat) {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** 인용 뒤 조사 (받침 따라 이/가, 은/는). 한글로 끝나지 않으면 병기 */
const particle = (text, first, second) => josa(text, first, second).slice(String(text).length);

const td = (label, html, cls = '') => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ''}>${html}</td>`;
const tdText = (label, text) => (text ? td(label, esc(text)) : td(label, '—', 'ce-empty'));

/** 용도 페이지의 시설별 기준표 */
function criteriaTable(regs, asOf, facilityNote) {
  const rows = sortRows(regs)
    .map((r) => {
      const st = rowStatus(r, asOf);
      return `<tr class="ce-row--${st}">${td('적용 기간', `<span class="ce-period">${esc(periodText(r, asOf))}</span> ${STATUS_BADGE[st]}`)}${td(
        '기준 (원문 요약)',
        esc(r.criteria),
      )}${tdText('대상', r.applicable_to)}${tdText('비고·근거', r.note)}</tr>`;
    })
    .join('\n');
  const note = facilityNote ? `<p class="ce-note">시설 주석: ${esc(facilityNote)}</p>` : '';
  return `${note}<div class="ce-table-wrap"><table class="ce-table ce-table--periods">
<thead><tr><th scope="col">적용 기간</th><th scope="col">기준 (원문 요약)</th><th scope="col">대상</th><th scope="col">비고·근거</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

// ── 변경 이벤트 (시행·종료) ───────────────────────────────────────────

/**
 * 행 목록 → 변경 이벤트. 시작일이 있으면 '시행', 종료일이 있고 다음 날 시작하는 후속 행이 없으면 '종료'.
 * items: [{row, facilityId, facilityName, useSlug?, useName?}]
 */
function changeEvents(items) {
  const events = [];
  for (const it of items) {
    if (it.row.start_date) events.push({ ...it, kind: 'start', date: it.row.start_date, changeDate: it.row.start_date });
    if (it.row.end_date) {
      const next = addDays(it.row.end_date, 1);
      const hasSuccessor = items.some(
        (o) => o.facilityId === it.facilityId && o.useSlug === it.useSlug && o.row.start_date === next,
      );
      if (!hasSuccessor) events.push({ ...it, kind: 'end', date: it.row.end_date, changeDate: next });
    }
  }
  return events.sort(
    (a, b) =>
      b.changeDate.localeCompare(a.changeDate) ||
      (a.useSlug || '').localeCompare(b.useSlug || '') ||
      a.facilityId.localeCompare(b.facilityId) ||
      a.row.criteria.localeCompare(b.row.criteria),
  );
}

/** 같은 날 시행된 법령·화재안전기준 (연관 추정이 아니라 '같은 날'이라는 사실만 표시) */
function sameDayRevisions(site, ymd, nfscKeys = []) {
  const out = [];
  for (const { kind, entry } of allLawEntries(site.law)) {
    if (entry.effective_date === ymd) out.push({ title: lawTitle(kind, entry), url: entry.link });
  }
  for (const key of nfscKeys) {
    for (const entry of site.nfsc[key] || []) {
      if (entry.effective_date === ymd) out.push({ title: `${entry.name} ${entry.notice_no}`, url: entry.link });
    }
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.url + x.title) ? false : seen.add(x.url + x.title)));
}

function eventList(site, events, { showUse, showFacility, nfscKeyOf }) {
  const items = events
    .map((ev) => {
      const what = ev.kind === 'start' ? ' 시행' : '까지 적용 후 종료';
      const dateHtml = `<time datetime="${ymdToIso(ev.date)}">${esc(fmtDot(ev.date))}</time>`;
      const future = ev.kind === 'start' && ev.date > site.asOf ? ' <span class="ce-badge ce-badge--info">시행 예정</span>' : '';
      const who = [
        showUse ? `<a href="${usePath(ev.useSlug)}">${esc(ev.useName)}</a>` : null,
        showFacility ? `<a href="${facilityPath(ev.facilityId)}">${esc(ev.facilityName)}</a>` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const same = sameDayRevisions(site, ev.changeDate, nfscKeyOf ? [nfscKeyOf(ev.facilityId)].filter(Boolean) : []);
      const sameHtml = same.length
        ? `<br><span class="ce-note">같은 날 시행된 개정: ${same.map((s) => link(s.url, s.title)).join(', ')}</span>`
        : '';
      return `<li><span class="ce-event-date">${dateHtml}${what}</span>${future} ${who}<br>${esc(ev.row.criteria)}${sameHtml}</li>`;
    })
    .join('\n');
  return `<ul class="ce-events">\n${items}\n</ul>`;
}

// ── 공통 조각 ────────────────────────────────────────────────────────

function metaForStandards(config, lastmod) {
  return [
    metaModified(lastmod),
    `데이터 기준일 ${timeKo(config.dataVerified)}`,
    '<span class="ce-badge ce-badge--muted">소방체크 기준 데이터로 생성</span>',
  ];
}

function baseSources(site) {
  const decree = versionAt(site.law.decree, site.asOf);
  const act = versionAt(site.law.act, site.asOf);
  const out = [];
  if (decree) {
    out.push({
      label: `${lawTitle('decree', decree)} (${fmtDot(decree.effective_date)} 시행판)`,
      url: decree.link,
      note: '특정소방대상물(별표 2)·소방시설 설치대상(별표 4)',
    });
  }
  if (act) out.push({ label: `${lawTitle('act', act)} (${fmtDot(act.effective_date)} 시행판)`, url: act.link });
  return out;
}

function nfscRowsFor(site, facilityIds) {
  // nfsc_key 별로 묶기: 같은 기준(예: NFSC 101)을 쓰는 시설을 한 줄에
  const byKey = new Map();
  for (const id of facilityIds) {
    const fac = site.facilityById.get(id);
    if (!fac || !fac.nfsc_key || !site.nfsc[fac.nfsc_key]) continue;
    if (!byKey.has(fac.nfsc_key)) byKey.set(fac.nfsc_key, []);
    byKey.get(fac.nfsc_key).push(fac);
  }
  return [...byKey].map(([key, facs]) => ({ key, facs, current: versionAt(site.nfsc[key], site.asOf) }));
}

// ── 용도 페이지 ──────────────────────────────────────────────────────

function useDefinition(json) {
  const parts = [];
  if (Array.isArray(json.definition)) {
    parts.push(`<ul class="ce-list">\n${json.definition.map((d) => `<li>${esc(d)}</li>`).join('\n')}\n</ul>`);
  } else if (typeof json.definition === 'string' && json.definition.trim()) {
    parts.push(`<p>${esc(json.definition)}</p>`);
  }
  if (Array.isArray(json.sub_types) && json.sub_types.length) {
    const rows = json.sub_types
      .map(
        (s) =>
          `<tr>${td('구분', esc(s.name))}${td('정의 (원문 요약)', esc(s.definition || ''))}${
            s.effective_date ? td('시행', esc(fmtDot(s.effective_date))) : td('시행', '—', 'ce-empty')
          }</tr>`,
      )
      .join('\n');
    parts.push(`<div class="ce-table-wrap"><table class="ce-table ce-table--compact">
<thead><tr><th scope="col">구분</th><th scope="col">정의 (원문 요약)</th><th scope="col">시행</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`);
  }
  if (typeof json.note === 'string' && json.note.trim()) parts.push(`<p class="ce-note">데이터 주석: ${esc(json.note)}</p>`);
  return parts.join('\n');
}

function transitionExample(use, site) {
  // 같은 시설에서 A 행이 끝난 다음 날 B 행이 시작하는 쌍 중 가장 최근 것
  let best = null;
  for (const fac of use.json.fire_facilities) {
    for (const a of fac.regulations) {
      if (!a.end_date) continue;
      const next = addDays(a.end_date, 1);
      for (const b of fac.regulations) {
        if (b.start_date === next && (!best || next > best.next)) best = { fac, a, b, next };
      }
    }
  }
  if (best) {
    return `<p>예를 들어 이 용도의 <a href="${facilityPath(best.fac.facility_id)}">${esc(best.fac.facility_name)}</a> 기준은 ${esc(
      fmtDot(best.a.end_date),
    )}까지 허가된 건물에는 “${esc(best.a.criteria)}”, ${esc(fmtDot(best.next))}부터 허가된 건물에는 “${esc(best.b.criteria)}”${particle(
      best.b.criteria,
      '이',
      '가',
    )} 적용됩니다.</p>`;
  }
  let latest = null;
  for (const fac of use.json.fire_facilities) {
    for (const r of fac.regulations) {
      if (r.start_date && r.start_date <= site.asOf && (!latest || r.start_date > latest.r.start_date)) latest = { fac, r };
    }
  }
  if (!latest) return '';
  return `<p>예를 들어 이 용도의 <a href="${facilityPath(latest.fac.facility_id)}">${esc(latest.fac.facility_name)}</a> 기준 “${esc(
    latest.r.criteria,
  )}”${particle(latest.r.criteria, '은', '는')} ${esc(fmtDot(latest.r.start_date))}부터 허가된 건물에 적용됩니다.</p>`;
}

function permitExplainer(exampleHtml) {
  return `<p>소방시설 설치기준은 법령이 바뀔 때마다 달라집니다. 소방체크는 건축물대장의 <strong>허가일</strong>이 속한 적용 기간의 기준을 골라 보여 주며, 아래 표의 ‘적용 기간’이 그 범위입니다.</p>
<ul class="ce-list">
<li><strong>상시 적용</strong> — 데이터에 시기 구분이 없는 기준입니다.</li>
<li><strong>2019.08.06 ~ 현재</strong>처럼 끝이 열린 기간 — 그날 이후 허가된 건물에 지금도 적용됩니다.</li>
<li><strong>2019.08.06 ~ 2024.12.30</strong>처럼 끝이 있는 기간 — 그 기간에 허가된 건물에만 적용되고, 이후에는 다른 기준으로 바뀌었습니다.</li>
</ul>
${exampleHtml}
<p class="ce-note">개정 부칙의 적용례는 허가일이 아니라 허가·협의 등을 <em>신청(신고)한 날</em>을 기준으로 정하는 경우가 있습니다. 시행일 전후에 허가·신청된 건물은 표의 ‘비고·근거’와 법령 원문의 부칙을 함께 확인하세요.</p>`;
}

function manualHint(useName) {
  const opts = MANUAL_PURPOSE_BY_TYPE[useName];
  if (!opts) return '';
  const names = opts.map((o) => `<strong>${esc(o)}</strong>`).join(' 또는 ');
  const particle = josa(opts.at(-1), '을', '를').slice(opts.at(-1).length);
  return `건축물대장이 없거나 주소 검색이 어렵다면 조회 화면의 ‘건축물대장 없이 직접 입력하기’에서 용도 ${names}${particle} 고르고 허가일·연면적·층수를 입력하세요.`;
}

/** "2026.03.01 — 비상경보설비 외 3건" (같은 날 변경이 여러 건이면 묶어서) */
function recentLine(pastEvents, byUse = false) {
  const first = pastEvents[0];
  const sameDay = pastEvents.filter((e) => e.changeDate === first.changeDate);
  const name = byUse ? first.useName : first.facilityName;
  return `${esc(fmtDot(first.changeDate))} — ${esc(name)}${sameDay.length > 1 ? ` 외 ${sameDay.length - 1}건` : ''}`;
}

function buildUsePage(use, site, config, ctx) {
  const json = use.json;
  const asOf = site.asOf;
  const facilities = [...json.fire_facilities].sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  const rowCount = facilities.reduce((n, f) => n + f.regulations.length, 0);
  const currentCount = facilities.reduce((n, f) => n + f.regulations.filter((r) => rowStatus(r, asOf) === 'current').length, 0);
  const indexable = rowCount >= MIN_INDEXABLE_ROWS;
  const lastmod = pageLastmod(config);
  const path = usePath(use.slug);
  const title = `${use.name} 소방시설 설치기준 — 시설별·허가일별 정리`;
  const exampleNames = facilities
    .filter((f) => f.regulations.some((r) => rowStatus(r, asOf) === 'current'))
    .slice(0, 3)
    .map((f) => f.facility_name);
  const description = `${use.name}에 적용되는 소방시설 ${facilities.length}종의 설치기준 ${rowCount}건을 적용 기간(허가일)별로 정리했습니다. ${
    exampleNames.length ? `${exampleNames.join('·')} 등 ` : ''
  }현행 기준과 개정 이력, 법령 원문 링크를 확인하세요.`;

  // 핵심 요약
  const byCat = new Map();
  for (const f of facilities) byCat.set(f.category, (byCat.get(f.category) || 0) + 1);
  const events = changeEvents(
    facilities.flatMap((f) => f.regulations.map((row) => ({ row, facilityId: f.facility_id, facilityName: f.facility_name }))),
  );
  const pastEvents = events.filter((e) => e.changeDate <= asOf);
  const futureEvents = events.filter((e) => e.changeDate > asOf);
  const summary = [
    `<li>소방시설 ${facilities.length}종: ${[...byCat].map(([c, n]) => `${esc(c)} ${n}종`).join(', ')}</li>`,
    `<li>설치기준 ${rowCount}건 중 데이터 기준일(${esc(config.dataVerified)}) 현재 적용 중인 기준 ${currentCount}건</li>`,
    pastEvents.length ? `<li>가장 최근 변경: ${recentLine(pastEvents)}</li>` : null,
    futureEvents.length ? `<li>시행 예정 기준 ${futureEvents.length}건 (가장 이른 날 ${esc(fmtDot(futureEvents.at(-1).changeDate))})</li>` : null,
    '<li>같은 용도라도 건축허가일에 따라 적용되는 기준이 다릅니다.</li>',
  ].filter(Boolean);

  // 시설별 표 (분류별로 묶음)
  const blocks = [];
  let currentCat = null;
  for (const f of facilities) {
    if (f.category !== currentCat) {
      currentCat = f.category;
      blocks.push(`<h3 class="ce-cat-title">${esc(currentCat)}</h3>`);
    }
    blocks.push(`<div class="ce-facility" id="f-${esc(facilitySlug(f.facility_id))}">
<h4><a href="${facilityPath(f.facility_id)}">${esc(f.facility_name)}</a> <span class="ce-count">${f.regulations.length}건</span></h4>
${criteriaTable(f.regulations, asOf, f.note)}
</div>`);
  }
  if (json.modular_classroom && Array.isArray(json.modular_classroom.fire_facilities)) {
    const mc = json.modular_classroom;
    const rows = mc.fire_facilities.map((x) => `<tr>${td('시설', esc(x.facility_name))}${td('기준 (원문 요약)', esc(x.criteria))}</tr>`).join('\n');
    blocks.push(`<h3 class="ce-cat-title">모듈러 교실 (별도 기준)</h3>
<div class="ce-facility" id="modular-classroom">
<h4>모듈러 교실${mc.effective_date ? ` <span class="ce-count">${esc(fmtDot(mc.effective_date))}부터</span>` : ''}</h4>
${mc.definition ? `<p class="ce-note">${esc(mc.definition)}</p>` : ''}
<div class="ce-table-wrap"><table class="ce-table ce-table--compact">
<thead><tr><th scope="col">시설</th><th scope="col">기준 (원문 요약)</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
</div>`);
  }

  // 관련 화재안전기준
  const nfscRows = nfscRowsFor(site, facilities.map((f) => f.facility_id));
  const nfscHtml = nfscRows.length
    ? `<div class="ce-table-wrap"><table class="ce-table ce-table--compact">
<thead><tr><th scope="col">현행 기준 (기준일 현재)</th><th scope="col">해당 시설</th><th scope="col">고시·시행일</th></tr></thead>
<tbody>
${nfscRows
  .map(
    (n) =>
      `<tr>${td('현행 기준 (기준일 현재)', link(n.current.link, n.current.name))}${td(
        '해당 시설',
        n.facs.map((f) => `<a href="${facilityPath(f.id)}">${esc(f.name)}</a>`).join(', '),
      )}${td('고시·시행일', `${esc(n.current.notice_no)} · ${esc(fmtDot(n.current.effective_date))}`)}</tr>`,
  )
  .join('\n')}
</tbody>
</table></div>`
    : '<p>이 용도의 시설에 연결된 화재안전기준이 데이터에 없습니다.</p>';

  // 출처: 현행 시행령·법 + 비고에 인용된 개정 법령 + 화재안전기준
  const cited = new Map();
  for (const f of facilities) for (const r of f.regulations) for (const c of citedLawEntries(`${r.note || ''}`, site.law)) cited.set(c.entry.link + c.title, c);
  if (json.note) for (const c of citedLawEntries(json.note, site.law)) cited.set(c.entry.link + c.title, c);
  const sources = [
    ...baseSources(site),
    ...[...cited.values()]
      .sort((a, b) => a.entry.promulgation_date.localeCompare(b.entry.promulgation_date))
      .map((c) => ({ label: `${c.title} (${fmtDot(c.entry.promulgation_date)} 공포)`, url: c.entry.link, note: '비고에 인용된 개정' })),
    ...nfscRows.map((n) => ({ label: `${n.current.name} ${n.current.notice_no}`, url: n.current.link })),
  ];

  const facilityLinks = facilities.map((f) => ({ title: `${f.facility_name} 설치대상 (용도별)`, path: facilityPath(f.facility_id) }));
  const idx = ctx.uses.findIndex((u) => u.slug === use.slug);
  const neighbors = [ctx.uses[idx - 1], ctx.uses[idx + 1]].filter(Boolean).map((u) => ({ title: `${u.name} 소방시설 설치기준`, path: usePath(u.slug) }));

  const body = `<article class="ce-article">
${pageHeader({ kicker: '용도별 소방시설 기준', title: `${use.name} 소방시설 설치기준`, lede: description, meta: metaForStandards(config, lastmod) })}
<div class="geo-summary-box"><p><strong>핵심 요약</strong></p><ul>
${summary.join('\n')}
</ul></div>
${section({ id: 'definition', title: `${use.name}의 범위 (원문 요약)`, body: useDefinition(json) || '<p>데이터에 용도 정의가 없습니다.</p>' })}
${section({ id: 'permit-date', title: '허가일에 따라 기준이 다릅니다', body: permitExplainer(transitionExample(use, site)) })}
${section({
  id: 'criteria',
  title: '시설별 설치기준',
  body: `<p class="ce-note">기준 문구는 법령 원문을 요약한 것입니다. 정확한 문구·예외·면제 조건은 출처의 원문을 확인하세요. 상태 표시는 데이터 기준일(${esc(
    config.dataVerified,
  )}) 기준입니다.</p>
${blocks.join('\n')}`,
})}
${section({
  id: 'recent',
  title: '최근 개정·변경',
  body: events.length
    ? `${eventList(site, events.slice(0, RECENT_EVENTS_USE), { showFacility: true, nfscKeyOf: (id) => site.facilityById.get(id)?.nfsc_key })}
<p class="ce-note">‘같은 날 시행된 개정’은 시행일이 같은 법령·고시를 나란히 보여 줄 뿐, 그 개정이 이 기준의 근거라는 뜻은 아닙니다. 근거는 표의 ‘비고·근거’를 보세요.</p>`
    : '<p>데이터에 날짜가 있는 변경 기록이 없습니다.</p>',
})}
${section({ id: 'nfsc', title: '관련 화재안전기준 (NFPC·NFSC)', body: nfscHtml })}
${ctaBox({ hint: manualHint(use.name) })}
${sourcesSection(sources, { intro: '법령·고시 링크는 국가법령정보센터(law.go.kr) 원문입니다.' })}
${relatedSection(facilityLinks, '이 용도의 시설별 기준')}
${relatedSection(
  [
    ...neighbors,
    { title: '소방시설 설치기준 찾기 (전체 목록)', path: HUB_PATH },
    { title: '소방법령 변경 타임라인', path: '/pages/timeline' },
    { title: '건물 용도별 소방시설 체크리스트', path: '/pages/checklist' },
  ],
  '다른 기준 보기',
)}
${DISCLAIMER}
</article>`;

  return {
    kind: 'standards-use',
    path,
    file: `standards/use/${use.slug}.html`,
    title,
    indexable,
    lastmod,
    rows: rowCount,
    html: renderPage({
      path,
      title,
      description,
      noindex: !indexable,
      breadcrumbs: [{ name: '홈', path: '/' }, { name: '기준 찾기', path: HUB_PATH }, { name: use.name }],
      schema: [articleSchema({ path, title, description, published: config.standardsPublished, modified: lastmod, keywords: [use.name, '소방시설 설치기준'] })],
      published: config.standardsPublished,
      modified: lastmod,
      body,
    }),
  };
}

// ── 시설 페이지 ──────────────────────────────────────────────────────

function buildFacilityPage(fac, entries, site, config, siblings) {
  const asOf = site.asOf;
  const path = facilityPath(fac.id);
  const rowCount = entries.reduce((n, e) => n + e.facility.regulations.length, 0);
  const indexable = rowCount >= MIN_INDEXABLE_ROWS;
  const lastmod = pageLastmod(config);
  const title = `${fac.name} 설치대상 — 용도별 설치기준 정리`;

  const flat = entries.flatMap((e) =>
    sortRows(e.facility.regulations).map((row) => ({ row, facilityId: fac.id, facilityName: fac.name, useSlug: e.use.slug, useName: e.use.name, facNote: e.facility.note })),
  );
  const current = flat.filter((x) => rowStatus(x.row, asOf) === 'current');
  const future = flat.filter((x) => rowStatus(x.row, asOf) === 'future');
  const events = changeEvents(flat);
  const nfscList = fac.nfsc_key ? site.nfsc[fac.nfsc_key] || [] : [];
  const nfscNow = nfscList.length ? versionAt(nfscList, asOf) : null;

  const description = `${fac.name}의 설치기준을 ${entries.length}개 용도별로 정리했습니다. 데이터 기준일(${config.dataVerified}) 현재 적용 기준 ${current.length}건과 개정 이력${
    nfscNow ? `, ${nfscNow.name}` : ''
  } 원문 링크를 확인하세요.`;

  const noteOf = (x) => [x.row.note, x.facNote ? `시설 주석: ${x.facNote}` : null].filter(Boolean).join(' / ');
  // 표 안에서 같은 비고가 되풀이되면 표 아래 주석으로 한 번만 싣는다
  const table = (list, prefix) => {
    const counts = new Map();
    for (const x of list) if (noteOf(x)) counts.set(noteOf(x), (counts.get(noteOf(x)) || 0) + 1);
    const shared = [...counts].filter(([, n]) => n > 1).map(([t]) => t);
    const noteCell = (x) => {
      const t = noteOf(x);
      if (!t) return td('비고·근거', '—', 'ce-empty');
      const k = shared.indexOf(t);
      return k === -1 ? td('비고·근거', esc(t)) : td('비고·근거', `<a href="#${prefix}-n${k + 1}">주석 ${k + 1}</a>`);
    };
    const rows = list
      .map(
        (x) =>
          `<tr>${td('용도', `<a href="${usePath(x.useSlug)}">${esc(x.useName)}</a>`)}${td('적용 기간', esc(periodText(x.row, asOf)))}${td(
            '기준 (원문 요약)',
            esc(x.row.criteria),
          )}${tdText('대상', x.row.applicable_to)}${noteCell(x)}</tr>`,
      )
      .join('\n');
    const notes = shared.length
      ? `\n<ol class="ce-footnotes">\n${shared.map((t, k) => `<li id="${prefix}-n${k + 1}">주석 ${k + 1}. ${esc(t)}</li>`).join('\n')}\n</ol>`
      : '';
    return `<div class="ce-table-wrap"><table class="ce-table ce-table--by-use">
<thead><tr><th scope="col">용도</th><th scope="col">적용 기간</th><th scope="col">기준 (원문 요약)</th><th scope="col">대상</th><th scope="col">비고·근거</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>${notes}`;
  };

  const summary = [
    `<li>분류: ${esc(fac.category)}</li>`,
    `<li>데이터에 기준이 있는 용도 ${entries.length}개, 기준 ${rowCount}건 (기준일 현재 적용 ${current.length}건${future.length ? `, 시행 예정 ${future.length}건` : ''})</li>`,
    events.some((e) => e.changeDate <= asOf) ? `<li>가장 최근 변경: ${recentLine(events.filter((e) => e.changeDate <= asOf), true)}</li>` : null,
    nfscNow ? `<li>화재안전기준: ${esc(nfscNow.name)} (${esc(fmtDot(nfscNow.effective_date))} 시행판)</li>` : null,
  ].filter(Boolean);

  const nfscSorted = sortedRecent(nfscList);
  const nfscHtml = nfscNow
    ? `<p>기준일 현재: ${link(nfscNow.link, nfscNow.name)} — ${esc(nfscNow.notice_no)}, ${esc(fmtDot(nfscNow.effective_date))} 시행. 데이터에 개정 기록 ${nfscList.length}건(${esc(
        fmtDot(nfscSorted.at(-1).effective_date),
      )}부터)이 있습니다.</p>
<div class="ce-table-wrap"><table class="ce-table ce-table--compact">
<thead><tr><th scope="col">시행일</th><th scope="col">기준 이름</th><th scope="col">고시</th><th scope="col">구분</th></tr></thead>
<tbody>
${nfscSorted
  .slice(0, NFSC_REVISIONS_SHOWN)
  .map(
    (r) =>
      `<tr>${td('시행일', `${esc(fmtDot(r.effective_date))}${r.effective_date > asOf ? ` ${STATUS_BADGE.future}` : ''}`)}${td('기준 이름', link(r.link, r.name))}${td(
        '고시',
        esc(r.notice_no),
      )}${td('구분', esc(r.revision_type))}</tr>`,
  )
  .join('\n')}
</tbody>
</table></div>
<p class="ce-note">전체 개정 흐름은 <a href="/pages/timeline">소방법령 변경 타임라인</a>에서 볼 수 있습니다.</p>`
    : '<p>소방체크 데이터에서 이 시설에 연결된 화재안전기준(NFPC·NFSC)이 없습니다.</p>';

  const guideSlug = GUIDE_BY_FACILITY[fac.id];
  const guideHtml = guideSlug
    ? section({
        id: 'guide',
        title: '관련 가이드',
        body: `<p><a href="/guide/${guideSlug}">${esc(fac.name)} 설치기준 가이드</a>에서 시설의 개요와 주의사항을 함께 볼 수 있습니다.</p>`,
      })
    : '';

  const sources = [...baseSources(site)];
  const cited = new Map();
  for (const x of flat) for (const c of citedLawEntries(x.row.note || '', site.law)) cited.set(c.entry.link + c.title, c);
  for (const c of [...cited.values()].sort((a, b) => a.entry.promulgation_date.localeCompare(b.entry.promulgation_date))) {
    sources.push({ label: `${c.title} (${fmtDot(c.entry.promulgation_date)} 공포)`, url: c.entry.link, note: '비고에 인용된 개정' });
  }
  if (nfscNow) sources.push({ label: `${nfscNow.name} ${nfscNow.notice_no}`, url: nfscNow.link });

  const sameCategory = siblings
    .filter((f) => f.category === fac.category && f.id !== fac.id)
    .map((f) => ({ title: `${f.name} 설치대상 (용도별)`, path: facilityPath(f.id) }));
  const body = `<article class="ce-article">
${pageHeader({ kicker: '시설별 소방시설 기준', title: `${fac.name} 설치대상 (용도별)`, lede: description, meta: metaForStandards(config, lastmod) })}
<div class="geo-summary-box"><p><strong>핵심 요약</strong></p><ul>
${summary.join('\n')}
<li>같은 용도라도 건축허가일에 따라 적용되는 기준이 다릅니다.</li>
</ul></div>
${section({
  id: 'current',
  title: `용도별 현행 기준 (${config.dataVerified} 현재)`,
  body: current.length
    ? `<p class="ce-note">데이터 기준일에 적용 중인 기준만 모았습니다. 기준 문구는 원문 요약이며, 예전에 허가된 건물은 아래 변경 이력과 용도별 페이지의 전체 기간 표를 보세요.</p>\n${table(current, 'cur')}`
    : '<p>데이터 기준일 현재 적용 중인 기준이 없습니다.</p>',
})}
${future.length ? section({ id: 'future', title: '시행 예정 기준', body: table(future, 'fut') }) : ''}
${section({
  id: 'history',
  title: '기준 변경 이력',
  body: events.length
    ? `${eventList(site, events.slice(0, HISTORY_EVENTS_FACILITY), { showUse: true, nfscKeyOf: () => fac.nfsc_key })}${
        events.length > HISTORY_EVENTS_FACILITY ? `<p class="ce-note">최근 ${HISTORY_EVENTS_FACILITY}건만 보여 줍니다 (전체 ${events.length}건).</p>` : ''
      }
<p class="ce-note">‘같은 날 시행된 개정’은 시행일이 같은 법령·고시를 나란히 보여 줄 뿐, 그 개정이 이 기준의 근거라는 뜻은 아닙니다.</p>`
    : '<p>데이터에 날짜가 있는 변경 기록이 없습니다 (모든 기준이 상시 적용).</p>',
})}
${section({ id: 'nfsc', title: '화재안전기준 (NFPC·NFSC)', body: nfscHtml })}
${guideHtml}
${ctaBox({ hint: '주소 검색이 어렵다면 조회 화면의 ‘건축물대장 없이 직접 입력하기’로 용도·허가일을 넣어 확인할 수 있습니다.' })}
${sourcesSection(sources, { intro: '법령·고시 링크는 국가법령정보센터(law.go.kr) 원문입니다.' })}
${relatedSection(entries.map((e) => ({ title: `${e.use.name} 소방시설 설치기준`, path: usePath(e.use.slug) })), '이 시설 기준이 있는 용도')}
${relatedSection([...sameCategory, { title: '소방시설 설치기준 찾기 (전체 목록)', path: HUB_PATH }, { title: '소방법령 변경 타임라인', path: '/pages/timeline' }], '다른 기준 보기')}
${DISCLAIMER}
</article>`;

  return {
    kind: 'standards-facility',
    path,
    file: `standards/facility/${facilitySlug(fac.id)}.html`,
    title,
    indexable,
    lastmod,
    rows: rowCount,
    html: renderPage({
      path,
      title,
      description,
      noindex: !indexable,
      breadcrumbs: [{ name: '홈', path: '/' }, { name: '기준 찾기', path: HUB_PATH }, { name: fac.name }],
      schema: [articleSchema({ path, title, description, published: config.standardsPublished, modified: lastmod, keywords: [fac.name, '설치기준', '설치대상'] })],
      published: config.standardsPublished,
      modified: lastmod,
      body,
    }),
  };
}

// ── 허브 ─────────────────────────────────────────────────────────────

function buildHub(site, config, usePages, facilityPages, ctx) {
  const asOf = site.asOf;
  const path = HUB_PATH;
  const title = '소방시설 설치기준 찾기 — 용도별·시설별 정리';
  const description = `건물 용도 ${usePages.length}종과 소방시설 ${facilityPages.length}종의 설치기준을 허가일(적용 기간)별로 정리했습니다. 현행 기준과 개정 이력, 법령 원문 링크를 한곳에서 확인하세요.`;

  const useCards = ctx.uses
    .map((u) => {
      const p = usePages.find((x) => x.path === usePath(u.slug));
      return `<li><a class="ce-card-link" href="${p.path}"><span class="ce-card-title">${esc(u.name)}</span><span class="ce-card-sub">시설 ${u.json.fire_facilities.length}종 · 기준 ${p.rows}건</span></a></li>`;
    })
    .join('\n');

  const facByCat = new Map();
  for (const p of facilityPages) {
    const fac = site.facilityById.get(p.facilityId);
    if (!facByCat.has(fac.category)) facByCat.set(fac.category, []);
    facByCat.get(fac.category).push({ fac, p });
  }
  const facHtml = [...facByCat]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
    .map(
      ([cat, list]) => `<h3 class="ce-cat-title">${esc(cat)}</h3>
<ul class="ce-chips">
${list.map(({ fac, p }) => `<li><a href="${p.path}">${esc(fac.name)}</a> <span class="ce-count">${p.useCount}개 용도</span></li>`).join('\n')}
</ul>`,
    )
    .join('\n');

  // 최근 법령·기준 개정 (시행일 순, 시행 예정 포함)
  const lawEvents = [
    ...allLawEntries(site.law).map(({ title: t, entry }) => ({ date: entry.effective_date, title: t, type: entry.revision_type, url: entry.link, promulgated: entry.promulgation_date })),
    ...Object.values(site.nfsc).flatMap((list) =>
      list.map((entry) => ({ date: entry.effective_date, title: `${entry.name} ${entry.notice_no}`, type: entry.revision_type, url: entry.link, promulgated: entry.promulgation_date })),
    ),
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || b.promulgated.localeCompare(a.promulgated) || a.title.localeCompare(b.title))
    .filter((e, i, arr) => arr.findIndex((o) => o.date === e.date && o.title === e.title) === i)
    .slice(0, HUB_LAW_EVENTS);
  const lawHtml = `<ul class="ce-events">
${lawEvents
  .map(
    (e) =>
      `<li><span class="ce-event-date"><time datetime="${ymdToIso(e.date)}">${esc(fmtDot(e.date))}</time> 시행</span>${
        e.date > asOf ? ` ${STATUS_BADGE.future}` : ''
      } ${link(e.url, e.title)} <span class="ce-note">${esc(e.type)} · ${esc(fmtDot(e.promulgated))} 공포</span></li>`,
  )
  .join('\n')}
</ul>`;

  const postsHtml = ctx.latestPosts.length
    ? section({
        id: 'posts',
        title: '새 글',
        body: `<ul class="ce-post-list">
${ctx.latestPosts.map((p) => `<li><a href="${p.url}">${esc(p.data.title)}</a> <span class="ce-note">${esc(p.typeLabel)} · ${timeKo(p.data.updated || p.data.date)}</span></li>`).join('\n')}
</ul>`,
      })
    : '';

  const noindexCount = [...usePages, ...facilityPages].filter((p) => !p.indexable).length;
  const body = `<article class="ce-article">
${pageHeader({ kicker: '기준 찾기', title: '소방시설 설치기준 찾기', lede: description, meta: metaForStandards(config, pageLastmod(config)) })}
<div class="geo-summary-box"><p><strong>이렇게 보세요</strong></p><ul>
<li>건물 용도를 알면 <a href="#uses">용도별 기준</a>에서, 특정 시설이 궁금하면 <a href="#facilities">시설별 기준</a>에서 찾으세요.</li>
<li>기준은 건축허가일에 따라 다릅니다. 표의 ‘적용 기간’에 허가일이 들어가는 행이 그 건물의 기준입니다.</li>
<li>실제 건물은 <a href="/">주소 조회</a>로 허가일·면적·층수에 맞는 기준을 바로 확인할 수 있습니다.</li>
</ul></div>
${section({ id: 'uses', title: '용도별 기준', body: `<ul class="ce-grid">\n${useCards}\n</ul>` })}
${section({
  id: 'facilities',
  title: '시설별 기준',
  body: `${facHtml}${noindexCount ? `\n<p class="ce-note">기준이 ${MIN_INDEXABLE_ROWS}건 미만인 페이지는 검색 노출 대상에서 뺐습니다.</p>` : ''}`,
})}
${section({ id: 'law-changes', title: '최근 법령·화재안전기준 개정', body: `${lawHtml}\n<p class="ce-note">시행일 기준 최근 ${HUB_LAW_EVENTS}건입니다. 전체 흐름은 <a href="/pages/timeline">소방법령 변경 타임라인</a>을 보세요.</p>` })}
${postsHtml}
${ctaBox()}
${sourcesSection(baseSources(site), { intro: '법령 링크는 국가법령정보센터(law.go.kr) 원문입니다.' })}
${DISCLAIMER}
</article>`;

  return {
    kind: 'standards-hub',
    path,
    file: 'standards/index.html',
    title,
    indexable: true,
    lastmod: pageLastmod(config),
    html: renderPage({
      path,
      title,
      description,
      ogType: 'website',
      breadcrumbs: [{ name: '홈', path: '/' }, { name: '기준 찾기' }],
      schema: [collectionSchema({ path, title, description })],
      body,
    }),
  };
}

/** 기준 페이지 전체 */
export function buildStandards(site, config, { latestPosts = [] } = {}) {
  const ctx = { uses: site.uses, latestPosts };
  const usePages = site.uses.map((u) => buildUsePage(u, site, config, ctx));

  // 시설 → 그 시설 기준이 있는 용도들 (facilities.json 순서). 기준 행이 하나도 없으면 페이지를 만들지 않는다.
  const withRows = site.facilities
    .map((fac) => ({
      fac,
      entries: site.uses
        .map((use) => ({ use, facility: use.json.fire_facilities.find((x) => x.facility_id === fac.id) }))
        .filter((e) => e.facility && e.facility.regulations.length),
    }))
    .filter((x) => x.entries.length);
  const siblings = withRows.map((x) => x.fac);
  const facilityPages = [];
  for (const { fac, entries } of withRows) {
    const page = buildFacilityPage(fac, entries, site, config, siblings);
    page.facilityId = fac.id;
    page.useCount = entries.length;
    facilityPages.push(page);
  }

  const hub = buildHub(site, config, usePages, facilityPages, ctx);
  return [hub, ...usePages, ...facilityPages];
}
