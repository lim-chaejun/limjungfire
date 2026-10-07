// 공통 페이지 틀 — 머리(메타·OG·트위터·JSON-LD), 공통 헤더·푸터(js/components.js), 본문 조각 도우미
//
// 헤더는 인라인 onclick 이 들어 있어 정적 HTML 에 넣지 않고 components.js 가 실행 중에 채운다.
// 푸터는 이벤트 핸들러가 없으므로 components.js 의 getFooterHTML() 결과를 미리 넣어 둔다(스크립트 없이도 링크가 보이게).

import { getFooterHTML } from '../../../js/components.js';
import { SITE_URL, SITE_NAME, GENERATED_MARKER, esc, link, jsonLdScript, fmtKo } from './util.mjs';

const OG_IMAGE = `${SITE_URL}/og-image.jpg`;
const LOGO = `${SITE_URL}/assets/icons/icon-512.png`;

// 기존 가이드 페이지와 같은 문자열(CSP 해시를 쓰게 되어도 같은 값이 되도록 바꾸지 않는다)
const HEAD_SCRIPTS = `  <!-- 다크모드 깜빡임 방지 -->
  <script>(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark')})();</script>
  <!-- Microsoft Clarity -->
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "v48dmfyli0");
  </script>`;

export const absUrl = (p) => `${SITE_URL}${p}`;

export const ORGANIZATION = { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` };
export const PUBLISHER = { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/`, logo: { '@type': 'ImageObject', url: LOGO } };

/** Article / NewsArticle JSON-LD */
export function articleSchema({ type = 'Article', path, title, description, published, modified, keywords }) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': type,
    headline: title,
    description,
    inLanguage: 'ko',
    datePublished: published,
    dateModified: modified,
    author: ORGANIZATION,
    publisher: PUBLISHER,
    image: OG_IMAGE,
    mainEntityOfPage: absUrl(path),
  };
  if (keywords && keywords.length) obj.keywords = keywords.join(', ');
  return obj;
}

export function collectionSchema({ path, title, description }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    inLanguage: 'ko',
    url: absUrl(path),
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
  };
}

/** 화면에 보이는 FAQ 가 있을 때만 호출한다 */
export function faqSchema(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

function breadcrumbSchema(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => {
      const item = { '@type': 'ListItem', position: i + 1, name: c.name };
      if (c.path && i < crumbs.length - 1) item.item = absUrl(c.path);
      return item;
    }),
  };
}

function breadcrumbNav(crumbs) {
  const items = crumbs
    .map((c, i) =>
      i < crumbs.length - 1 && c.path
        ? `<li><a href="${esc(c.path)}">${esc(c.name)}</a></li>`
        : `<li aria-current="page">${esc(c.name)}</li>`,
    )
    .join('');
  return `<nav class="ce-breadcrumb" aria-label="현재 위치"><ol>${items}</ol></nav>`;
}

/** 완성된 HTML 문서 */
export function renderPage(page) {
  const { path, title, description, ogType = 'article', noindex = false, breadcrumbs, schema = [], published, modified, feed, body } = page;
  const url = absUrl(path);
  const head = [
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    HEAD_SCRIPTS,
    `  <title>${esc(title)} | ${SITE_NAME}</title>`,
    `  <meta name="description" content="${esc(description)}">`,
    noindex ? '  <meta name="robots" content="noindex, follow">' : null,
    `  <link rel="canonical" href="${esc(url)}">`,
    '  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">',
    feed ? `  <link rel="alternate" type="application/rss+xml" title="${esc(feed.title)}" href="${esc(feed.href)}">` : null,
    `  <meta property="og:type" content="${ogType}">`,
    `  <meta property="og:site_name" content="${SITE_NAME}">`,
    '  <meta property="og:locale" content="ko_KR">',
    `  <meta property="og:title" content="${esc(title)}">`,
    `  <meta property="og:description" content="${esc(description)}">`,
    `  <meta property="og:url" content="${esc(url)}">`,
    `  <meta property="og:image" content="${OG_IMAGE}">`,
    ogType === 'article' && published ? `  <meta property="article:published_time" content="${esc(published)}">` : null,
    ogType === 'article' && modified ? `  <meta property="article:modified_time" content="${esc(modified)}">` : null,
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${esc(title)}">`,
    `  <meta name="twitter:description" content="${esc(description)}">`,
    `  <meta name="twitter:image" content="${OG_IMAGE}">`,
    '  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>',
    '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" integrity="sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j" crossorigin="anonymous">',
    '  <link rel="stylesheet" href="/css/style.css">',
    '  <link rel="stylesheet" href="/css/content.css">',
    ...[...schema, breadcrumbSchema(breadcrumbs)].map((s) => indent(jsonLdScript(s), 2)),
  ].filter((l) => l !== null);

  return `<!doctype html>
${GENERATED_MARKER} — 직접 수정하지 마세요. content/ 나 data/ 를 고친 뒤 node scripts/content/build.mjs -->
<html lang="ko">
<head>
${head.join('\n')}
</head>
<body>
  <div class="container ce-page">
    <div id="header-container"></div>
    ${breadcrumbNav(breadcrumbs)}
    <main class="ce-main" id="main">
${body}
    </main>
    <div id="footer-container">${getFooterHTML()}</div>
  </div>
  <script type="module" src="/js/components.js"></script>
</body>
</html>
`;
}

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

// ── 본문 조각 ─────────────────────────────────────────────────────────

/** 제목 영역: 분류, h1, 요약, 날짜·검수 표시 */
export function pageHeader({ kicker, title, lede, meta = [], tags = [] }) {
  const metaHtml = meta.length ? `<p class="ce-meta">${meta.join('<span class="ce-dot" aria-hidden="true">·</span>')}</p>` : '';
  const tagHtml = tags.length ? `<ul class="ce-tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  return `<div class="ce-header">
  ${kicker ? `<p class="ce-kicker">${esc(kicker)}</p>` : ''}
  <h1 class="ce-title">${esc(title)}</h1>
  ${lede ? `<p class="ce-lede">${esc(lede)}</p>` : ''}
  ${metaHtml}
  ${tagHtml}
</div>`;
}

export const timeKo = (iso) => `<time datetime="${esc(iso)}">${esc(fmtKo(iso))}</time>`;

export function metaModified(iso) {
  return `최종 수정일 ${timeKo(iso)}`;
}

/** 카드형 절 */
export function section({ id, title, body, className = '' }) {
  const h = id ? ` id="${esc(id)}"` : '';
  return `<section class="ce-section${className ? ` ${className}` : ''}"${h}>
<h2 class="ce-section-title">${esc(title)}</h2>
<div class="ce-section-body">
${body}
</div>
</section>`;
}

/** 조회 도구로 보내는 안내. hint 는 HTML 로 그대로 들어간다 — 데이터 글자는 호출하는 쪽에서 esc() 할 것 */
export function ctaBox({ hint } = {}) {
  return `<section class="ce-cta" aria-labelledby="ce-cta-title">
<h2 id="ce-cta-title" class="ce-cta-title">내 건물에 적용되는 기준 확인하기</h2>
<p>주소를 검색하면 건축물대장의 허가일·연면적·층수로 그 건물에 해당하는 소방시설 기준을 골라 보여줍니다.</p>
<p><a class="ce-cta-btn" href="/">주소로 기준 조회하기</a></p>
${hint ? `<p class="ce-cta-hint">${hint}</p>` : ''}
</section>`;
}

/**
 * 출처 목록: [{label, url, note?}] — label·note 는 이스케이프, url 이 안전하지 않으면 글자만.
 * intro 는 HTML 로 그대로 들어간다 — 고정 문구만 넘길 것
 */
export function sourcesSection(sources, { intro } = {}) {
  const items = sources.map((s) => `<li>${link(s.url, s.label)}${s.note ? ` <span class="ce-note">${esc(s.note)}</span>` : ''}</li>`).join('\n');
  return `<section class="ce-sources" aria-labelledby="ce-sources-title">
<h2 id="ce-sources-title">출처</h2>
${intro ? `<p class="ce-note">${intro}</p>` : ''}
<ol>
${items}
</ol>
</section>`;
}

/** 관련 페이지: [{title, path}] */
export function relatedSection(links, title = '관련 페이지') {
  if (!links.length) return '';
  return `<nav class="ce-related" aria-label="${esc(title)}">
<h2>${esc(title)}</h2>
<ul>
${links.map((l) => `<li><a href="${esc(l.path)}">${esc(l.title)}</a></li>`).join('\n')}
</ul>
</nav>`;
}

export const DISCLAIMER =
  '<p class="ce-disclaimer">이 페이지는 법령 원문을 요약한 참고 자료이며 법적 효력이 없습니다. 개별 건물에 적용되는 기준은 출처의 원문과 관할 소방서에서 확인하세요.</p>';
