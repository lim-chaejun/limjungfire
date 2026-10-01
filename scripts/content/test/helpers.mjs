// 테스트 도우미 — 작은 가짜 사이트(fixture), XML·HTML 구조 검사

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir(prefix = 'content-engine-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

export const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const NFSC_SP = '스프링클러설비의 화재안전기준(NFSC 103)';

export const FACILITIES = [
  { id: 'fire_extinguisher', name: '소화기구', category: '소화설비', nfsc_key: null, aliases: ['소화기구'] },
  { id: 'sprinkler', name: '스프링클러설비', category: '소화설비', nfsc_key: NFSC_SP, aliases: ['스프링클러설비'] },
  { id: 'auto_fire_detection', name: '자동화재탐지설비', category: '경보설비', nfsc_key: null, aliases: ['자동화재탐지설비'] },
  { id: 'firewall', name: '방화벽', category: '소화활동설비', nfsc_key: null, aliases: ['방화벽'] },
  { id: 'fire_alarm', name: '화재알림설비', category: '경보설비', nfsc_key: null, aliases: ['화재알림설비'] },
];

export const NOTE_27810 =
  '대통령령 제27810호(2017.1.26. 공포): 별표 5 제1호라목3) 본문 "11층"→"6층". 부칙 제2조 — 그 시행일 이후 신축 등 허가·협의를 신청하거나 신고하는 경우부터 적용';

export function residential() {
  return {
    building_type: '공동주택',
    sub_types: [{ name: '아파트등', definition: '주택으로 쓰는 층수가 5층 이상인 주택' }, { name: '연립주택', definition: '4개 층 이하', effective_date: '20241201' }],
    fire_facilities: [
      {
        category: '소화설비',
        facility_name: '소화기구',
        facility_id: 'fire_extinguisher',
        regulations: [
          { start_date: null, end_date: null, criteria: '연면적 33㎡ 이상', applicable_to: '공동주택' },
          { start_date: '20270101', end_date: null, criteria: '시행 예정 기준 (가짜)' },
        ],
      },
      {
        category: '소화설비',
        facility_name: '스프링클러설비',
        facility_id: 'sprinkler',
        regulations: [
          { start_date: '20180127', end_date: null, criteria: '층수가 6층 이상인 경우 모든 층', note: NOTE_27810 },
          { start_date: '20050101', end_date: '20180126', criteria: '층수가 11층 이상일 경우 전층' },
          { start_date: '19900701', end_date: '19920727', criteria: '16층 이상인 것은 16층 이상인 층' },
        ],
      },
    ],
  };
}

export function neighborhood() {
  return {
    building_type: '근린생활시설',
    definition: ['슈퍼마켓 1,000㎡ 미만', '의원 & "치과" <병원>'],
    fire_facilities: [
      {
        category: '경보설비',
        facility_name: '자동화재탐지설비',
        facility_id: 'auto_fire_detection',
        regulations: [
          { start_date: null, end_date: null, criteria: '<script>alert(1)</script> 연면적 600㎡ 이상', note: '"따옴표" & <b>굵게</b>' },
          { start_date: '20220225', end_date: null, criteria: '노유자 생활시설' },
        ],
      },
      {
        category: '소화설비',
        facility_name: '스프링클러설비',
        facility_id: 'sprinkler',
        regulations: [{ start_date: '20180127', end_date: null, criteria: '층수가 6층 이상인 경우 모든 층', note: NOTE_27810 }],
      },
    ],
  };
}

/** 기준 행이 1건뿐인 용도 (얇은 페이지) */
export function thinUse() {
  return {
    building_type: '지하구',
    definition: '전력구 또는 통신구',
    fire_facilities: [
      { category: '소화활동설비', facility_name: '방화벽', facility_id: 'firewall', regulations: [{ start_date: null, end_date: null, criteria: '방화벽 설치' }] },
    ],
  };
}

export function house() {
  return {
    building_type: '단독주택',
    definition: '단독주택·다중주택·다가구주택·공관',
    fire_facilities: [
      {
        category: '소화설비',
        facility_name: '소화기구',
        facility_id: 'fire_extinguisher',
        regulations: [
          { start_date: null, end_date: null, criteria: '주택용 소방시설로 소화기를 설치' },
          { start_date: '20120205', end_date: null, criteria: '신축 주택부터 적용' },
        ],
      },
    ],
  };
}

const lawRow = (no, name, eff, lawNo, prom, type, seq) => ({
  no,
  name,
  effective_date: eff,
  law_no: lawNo,
  promulgation_date: prom,
  revision_type: type,
  link: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${seq}`,
});

const STATIC_HTML = (canonical, title, extra = '') => `<!doctype html>
<html lang="ko"><head>
<title>${title} | 소방체크</title>
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
${extra}
</head><body><h1>${title}</h1></body></html>
`;

export const APPROVED_NEWS = `---
title: 랙식 창고 스프링클러 기준 개정
description: 랙이 설치된 부분의 바닥면적 합계로 판단하도록 바뀌었습니다.
date: 2026-09-20
updated: 2026-09-21
status: approved
tags: [스프링클러, 창고]
related:
  - /standards/facility/sprinkler
sources:
  - label: 소방시설법 시행령(대통령령 제35860호)
    url: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911
---
## 무엇이 바뀌었나

**랙이 설치된 부분**의 바닥면적 합계로 판단합니다.
`;

export const DRAFT_NEWS = `---
title: 초안 소식
description: 아직 검수 전인 소식입니다.
date: 2026-09-25
status: draft
sources:
  - label: 원문
    url: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1
---
초안 본문
`;

export const APPROVED_QA = `---
title: 6층 이상 스프링클러는 언제부터?
description: 2018.1.27.부터 적용됩니다.
date: 2026-09-10
status: approved
related:
  - /standards/use/residential-complex
  - /guide/sprinkler
sources:
  - label: 대통령령 제27810호
    url: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=191373
faq:
  - q: 허가일이 2018.1.26.이면?
    a: 데이터상 11층 이상 기준이 적용됩니다.
  - q: 신청일 기준인가요?
    a: "부칙 제2조는 \\"신청\\" 기준입니다."
---
본문 <script>alert(1)</script>
`;

export const APPROVED_GUIDE = `---
title: 허가일로 기준 찾기
description: 적용 기간 읽는 법.
date: 2026-09-01
status: approved
sources:
  - label: 시행령
    url: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911
---
본문
`;

/** 작은 가짜 사이트. opts: { house, posts } */
export function makeFixture({ withHouse = false, posts = true } = {}) {
  const root = tmpDir();
  write(root, 'data/facilities.json', { facilities: FACILITIES });
  write(root, 'data/01_residential_complex.json', residential());
  write(root, 'data/02_neighborhood_facilities.json', neighborhood());
  write(root, 'data/28_underground_passage.json', thinUse());
  if (withHouse) write(root, 'data/00_house.json', house());
  write(root, 'data/law_history_act.json', [lawRow(1, '소방시설 설치 및 관리에 관한 법률', '20241201', '법률 제18522호', '20211130', '전부개정', 236977)]);
  write(root, 'data/law_history_decree.json', [
    lawRow(1, '소방시설 설치 및 관리에 관한 법률 시행령', '20270101', '제35151호', '20241231', '일부개정', 267669),
    lawRow(2, '소방시설 설치 및 관리에 관한 법률 시행령', '20260301', '제35860호', '20251125', '일부개정', 279911),
    lawRow(3, '화재예방, 소방시설 설치ㆍ유지 및 안전관리에...', '20170128', '제27810호', '20170126', '일부개정', 191373),
  ]);
  write(root, 'data/law_history_rules.json', [lawRow(1, '소방시설 설치 및 관리에 관한 법률 시행규칙', '20251201', '행정안전부령 제590호', '20251201', '일부개정', 280195)]);
  write(root, 'data/nfsc_history.json', {
    [NFSC_SP]: [
      {
        no: 1,
        name: '스프링클러설비의 화재안전성능기준(NFPC 103)',
        effective_date: '20260301',
        notice_no: '소방청고시 제2025-25호',
        promulgation_date: '20251224',
        revision_type: '일부개정',
        link: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000270474',
      },
      {
        no: 2,
        name: '스프링클러설비의 화재안전기준(NFSC 103)',
        effective_date: '20180127',
        notice_no: '소방청고시 제2018-1호',
        promulgation_date: '20180126',
        revision_type: '일부개정',
        link: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=1',
      },
    ],
  });
  write(root, 'content/config.json', { dataVerified: '2026-09-26', standardsPublished: '2026-09-27' });
  write(root, 'content/static-pages.json', {
    pages: [
      { path: '/', lastmod: '2026-01-21', changefreq: 'weekly', priority: '1.0' },
      { path: '/guide/sprinkler', lastmod: '2026-01-21', changefreq: 'monthly', priority: '0.6' },
      { path: '/pages/privacy', lastmod: '2026-01-21', changefreq: 'yearly', priority: '0.3' },
    ],
  });
  write(root, 'index.html', STATIC_HTML('https://sobangcheck.com/', '소방시설 설치기준 조회'));
  write(root, 'pages/about.html', STATIC_HTML('https://sobangcheck.com/pages/about', '서비스 소개'));
  write(root, 'pages/timeline.html', STATIC_HTML('https://sobangcheck.com/pages/timeline', '소방법령 변경 타임라인'));
  write(root, 'pages/checklist.html', STATIC_HTML('https://sobangcheck.com/pages/checklist', '체크리스트'));
  write(root, 'pages/privacy.html', STATIC_HTML('https://sobangcheck.com/pages/privacy', '개인정보처리방침', '<meta name="robots" content="noindex">'));
  write(root, 'pages/admin.html', STATIC_HTML(null, '관리자', '<meta name="robots" content="noindex, nofollow">'));
  write(
    root,
    'guide/sprinkler.html',
    STATIC_HTML('https://sobangcheck.com/guide/sprinkler', '스프링클러 설치기준', '<script type="application/ld+json">{"dateModified": "2026-09-26"}</script>'),
  );
  if (posts) {
    write(root, 'content/news/rack-warehouse.md', APPROVED_NEWS);
    write(root, 'content/news/draft-news.md', DRAFT_NEWS);
    write(root, 'content/qa/sprinkler-6th-floor.md', APPROVED_QA);
    write(root, 'content/guide/permit-date.md', APPROVED_GUIDE);
  }
  return root;
}

// ── 구조 검사 ─────────────────────────────────────────────────────────

/** 작은 XML 검사기: 태그 짝, 루트 하나, 텍스트 안의 < 와 맨 & 금지. 문제 목록을 돌려준다 */
export function xmlProblems(xml) {
  const problems = [];
  let s = xml;
  if (!s.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) problems.push('XML 선언이 맨 앞에 없음');
  s = s.replace(/^<\?xml[^?]*\?>/, '');
  const stack = [];
  let roots = 0;
  const re = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5]) {
      problems.push(`잘못된 < (위치 ${m.index})`);
      continue;
    }
    if (m[4] !== undefined) {
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[4])) problems.push(`이스케이프되지 않은 & : ${m[4].slice(0, 40)}`);
      if (!stack.length && m[4].trim()) problems.push(`루트 밖 텍스트: ${m[4].trim().slice(0, 40)}`);
      continue;
    }
    const name = m[1];
    if (m[0].startsWith('</')) {
      const top = stack.pop();
      if (top !== name) problems.push(`닫는 태그 불일치: </${name}> (열린 태그 ${top})`);
    } else if (m[3] === '/') {
      if (!stack.length) roots++;
    } else {
      if (!stack.length) roots++;
      stack.push(name);
    }
  }
  if (stack.length) problems.push(`닫히지 않은 태그: ${stack.join(', ')}`);
  if (roots !== 1) problems.push(`루트 요소 ${roots}개`);
  return problems;
}

const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'track']);

/** HTML 태그 짝 검사 (script·style 내용과 주석은 건너뜀) → 문제 목록 */
export function htmlProblems(html) {
  const problems = [];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[2].toLowerCase();
    if (name === '!doctype' || VOID.has(name)) continue;
    if (m[1]) {
      const top = stack.pop();
      if (top !== name) {
        problems.push(`닫는 태그 불일치: </${name}> (열린 태그 ${top})`);
        break;
      }
    } else if (!m[3]) stack.push(name);
  }
  if (stack.length) problems.push(`닫히지 않은 태그: ${stack.join(', ')}`);
  return problems;
}

/** JSON-LD 블록을 모두 파싱 */
export function jsonLd(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}

/** 생성 HTML 공통 불변식 → 문제 목록 */
export function pageInvariantProblems(html) {
  const problems = [...htmlProblems(html)];
  if (!html.startsWith('<!doctype html>')) problems.push('doctype 없음');
  if ((html.match(/<h1\b/g) || []).length !== 1) problems.push('h1 이 하나가 아님');
  if (!/<html lang="ko">/.test(html)) problems.push('lang="ko" 없음');
  if (!/<meta name="description" content="[^"]+">/.test(html)) problems.push('description 없음');
  if (!/<link rel="canonical" href="https:\/\/sobangcheck\.com\/[^".]*">/.test(html)) problems.push('확장자 없는 canonical 없음');
  if (/\son[a-z]+\s*=/i.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''))) problems.push('인라인 이벤트 핸들러');
  for (const a of html.match(/<a\s[^>]*href="https?:\/\/[^"]*"[^>]*>/g) || []) {
    if (/href="https?:\/\/(www\.)?sobangcheck\.com/.test(a)) continue;
    if (!/rel="noopener"/.test(a)) problems.push(`외부 링크에 rel="noopener" 없음: ${a}`);
  }
  try {
    jsonLd(html);
  } catch (e) {
    problems.push(`JSON-LD 파싱 실패: ${e.message}`);
  }
  // 같은 페이지 앵커는 id 가 있어야 한다
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) if (!html.includes(`id="${id}"`)) problems.push(`없는 앵커 #${id}`);
  return problems;
}
