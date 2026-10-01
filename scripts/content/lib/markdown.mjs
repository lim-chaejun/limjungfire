// Markdown 부분집합 렌더러 (의존성 없음)
//
// 지원: ATX 제목(# ~ ######, # 은 h2 로 내림), 문단, **굵게**, *기울임*, `코드`, [글자](주소),
//       순서 없는 목록(- * +)·순서 있는 목록(1. ~ 999.), 중첩 목록, 표(GFM 파이프 표), 인용(>), 가로줄(---).
// 원칙: 모든 글자는 이스케이프한다. HTML 태그는 통과시키지 않는다. 모르는 문법(코드 블록, 이미지,
//       밑줄 강조, setext 제목, 각주 등)은 이스케이프된 글자 그대로 보인다.
// 링크 주소는 util.safeHref 규칙(https?://, /경로, #앵커)만 허용하고, 그 밖이면 링크 없이 원문 글자로 둔다.

import { esc, safeHref, isExternal } from './util.mjs';

// 인라인 토큰 자리표시자 — 사용자 입력의 같은 문자는 미리 지운다
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';
const PH_RE = /\uE000(\d+)\uE001/g;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/** 인라인 문법만 렌더링 (제목·문단·표 칸·목록 항목 안) */
export function renderInline(src, { allowLinks = true } = {}) {
  const text = String(src ?? '').replace(/[\uE000\uE001]/g, '');
  const tokens = [];
  const hold = (html) => {
    tokens.push(html);
    return `${PH_OPEN}${tokens.length - 1}${PH_CLOSE}`;
  };

  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // 역슬래시 이스케이프: \* \[ \| 등
    if (ch === '\\' && i + 1 < text.length && ASCII_PUNCT.test(text[i + 1])) {
      out += hold(esc(text[i + 1]));
      i += 2;
      continue;
    }

    // 인라인 코드: 같은 길이의 백틱 묶음으로 닫는다
    if (ch === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      const close = findBacktickClose(text, i + n, n);
      if (close === -1) {
        out += hold(esc('`'.repeat(n)));
        i += n;
        continue;
      }
      let code = text.slice(i + n, close).replace(/\n/g, ' ');
      if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      out += hold(`<code>${esc(code)}</code>`);
      i = close + n;
      continue;
    }

    // 이미지 ![alt](src) 는 지원하지 않는다 → 원문 글자 그대로
    if (ch === '!' && text[i + 1] === '[') {
      const parsed = parseLink(text, i + 1);
      if (parsed) {
        out += hold(esc(text.slice(i, parsed.end)));
        i = parsed.end;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '[' && allowLinks) {
      const parsed = parseLink(text, i);
      if (parsed) {
        const href = safeHref(parsed.url);
        if (href) {
          const ext = isExternal(href) ? ' target="_blank" rel="noopener"' : '';
          out += hold(`<a href="${esc(href)}"${ext}>${renderInline(parsed.label, { allowLinks: false })}</a>`);
        } else {
          out += hold(esc(text.slice(i, parsed.end))); // 허용하지 않는 주소 → 글자 그대로
        }
        i = parsed.end;
        continue;
      }
    }

    out += ch;
    i++;
  }

  // 자리표시자는 사용 영역 문자와 숫자뿐이라 이스케이프에 영향받지 않는다
  let html = esc(out);
  // **굵게** 먼저, 그다음 *기울임* (기울임은 태그를 넘지 않아 항상 올바르게 닫힌다)
  html = html.replace(/\*\*(?![\s*])([\s\S]*?[^\s*])\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(?![\s*])([^*<>]*?[^\s*<>])\*/g, '<em>$1</em>');
  return html.replace(PH_RE, (_, n) => tokens[Number(n)]);
}

function findBacktickClose(text, from, n) {
  let j = from;
  while (j < text.length) {
    const k = text.indexOf('`', j);
    if (k === -1) return -1;
    let m = 0;
    while (text[k + m] === '`') m++;
    if (m === n) return k;
    j = k + m;
  }
  return -1;
}

/** [label](url) 을 start 위치에서 읽는다. 실패하면 null */
function parseLink(text, start) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') return null; // 중첩 대괄호는 지원하지 않는다
    if (c === ']') break;
    i++;
  }
  if (text[i] !== ']' || text[i + 1] !== '(') return null;
  const label = text.slice(start + 1, i);
  if (!label.trim()) return null;

  let j = i + 2;
  let url;
  if (text[j] === '<') {
    const k = text.indexOf('>', j);
    if (k === -1) return null;
    url = text.slice(j + 1, k);
    if (/[\n<]/.test(url)) return null;
    j = k + 1;
  } else {
    const s = j;
    let depth = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === '\\' && j + 1 < text.length) {
        j += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    url = text.slice(s, j).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  }
  if (text[j] !== ')') return null;
  return { label, url, end: j + 1 };
}

// ── 블록 ─────────────────────────────────────────────────────────────

const RE_BLANK = /^\s*$/;
const RE_HR = /^ {0,3}(?:(?:-[ ]*){3,}|(?:\*[ ]*){3,}|(?:_[ ]*){3,})$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ ]+(.*?))?(?:[ ]+#+)?[ ]*$/;
const RE_QUOTE = /^ {0,3}>[ ]?(.*)$/;

function listMarker(line) {
  let m = /^( {0,3})([-*+])( +|$)(.*)$/.exec(line);
  if (m) {
    const spaces = m[3].length;
    const offset = m[1].length + 1 + (spaces === 0 || spaces > 4 ? 1 : spaces);
    return { ordered: false, bullet: m[2], indent: m[1].length, offset, text: spaces > 4 ? m[3].slice(1) + m[4] : m[4] };
  }
  // 1~3자리 번호만 목록으로 본다 — "2024. 12. 31." 같은 날짜 줄이 목록이 되지 않게
  m = /^( {0,3})(\d{1,3})([.)])( +|$)(.*)$/.exec(line);
  if (m) {
    const spaces = m[4].length;
    const markerLen = m[2].length + 1;
    const offset = m[1].length + markerLen + (spaces === 0 || spaces > 4 ? 1 : spaces);
    return { ordered: true, bullet: m[3], start: Number(m[2]), indent: m[1].length, offset, text: spaces > 4 ? m[4].slice(1) + m[5] : m[5] };
  }
  return null;
}

/** 이스케이프되지 않은 | 로 칸을 나눈다 (양 끝의 | 는 버림) */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function tableAlign(line) {
  if (!line || !line.includes('-')) return null;
  const cells = splitRow(line);
  const align = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    align.push(c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : '');
  }
  return align;
}

function isTableStart(line, next) {
  if (!line || !line.includes('|') || next === undefined) return false;
  const align = tableAlign(next);
  return !!align && align.length === splitRow(line).length;
}

function interruptsParagraph(line, next) {
  if (RE_HEADING.test(line) || RE_HR.test(line) || RE_QUOTE.test(line)) return true;
  const mk = listMarker(line);
  if (mk && mk.text.trim() && (!mk.ordered || mk.start === 1)) return true;
  return isTableStart(line, next);
}

const leading = (line) => line.length - line.trimStart().length;

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (RE_BLANK.test(line)) {
      i++;
      continue;
    }
    if (RE_HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    const h = RE_HEADING.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: Math.max(2, h[1].length), text: h[2] ?? '' });
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        inner.push(RE_QUOTE.exec(lines[i])[1]);
        i++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner) });
      continue;
    }
    if (listMarker(line)) {
      const res = parseList(lines, i);
      blocks.push(res.block);
      i = res.next;
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      const head = splitRow(line);
      const align = tableAlign(lines[i + 1]);
      const rows = [];
      i += 2;
      while (i < lines.length && !RE_BLANK.test(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]).slice(0, head.length);
        while (cells.length < head.length) cells.push('');
        rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', head, align, rows });
      continue;
    }
    const buf = [line.trim()];
    i++;
    while (i < lines.length && !RE_BLANK.test(lines[i]) && !interruptsParagraph(lines[i], lines[i + 1])) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'para', text: buf.join('\n') });
  }
  return blocks;
}

function parseList(lines, i) {
  const first = listMarker(lines[i]);
  const items = [];
  while (i < lines.length) {
    const mk = listMarker(lines[i]);
    if (!mk || mk.ordered !== first.ordered || mk.bullet !== first.bullet || mk.indent >= first.offset) break;
    const itemLines = [mk.text];
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const line = lines[i];
      if (RE_BLANK.test(line)) {
        itemLines.push('');
        sawBlank = true;
        i++;
        continue;
      }
      if (leading(line) >= mk.offset) {
        itemLines.push(line.slice(mk.offset));
        sawBlank = false;
        i++;
        continue;
      }
      if (sawBlank || listMarker(line) || interruptsParagraph(line, lines[i + 1])) break;
      itemLines.push(line.trim()); // 문단 이어쓰기(들여쓰지 않은 다음 줄)
      i++;
    }
    while (itemLines.length && RE_BLANK.test(itemLines.at(-1))) itemLines.pop();
    items.push(parseBlocks(itemLines));
  }
  return { block: { type: 'list', ordered: first.ordered, start: first.start ?? 1, items }, next: i };
}

function renderBlocks(blocks) {
  return blocks.map(renderBlock).join('\n');
}

function renderListItem(children) {
  // 항목 첫 블록이 문단 하나뿐이면 <p> 없이 (촘촘한 목록)
  const paras = children.filter((b) => b.type === 'para').length;
  return children
    .map((b) => (b.type === 'para' && paras === 1 ? renderInline(b.text) : renderBlock(b)))
    .join('\n');
}

function renderBlock(b) {
  switch (b.type) {
    case 'hr':
      return '<hr>';
    case 'heading':
      return `<h${b.level}>${renderInline(b.text)}</h${b.level}>`;
    case 'para':
      return `<p>${renderInline(b.text)}</p>`;
    case 'quote':
      return `<blockquote>\n${renderBlocks(b.children)}\n</blockquote>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const items = b.items.map((children) => `<li>${renderListItem(children)}</li>`).join('\n');
      return `<${tag}${start}>\n${items}\n</${tag}>`;
    }
    case 'table': {
      const cls = (a) => (a === 'c' ? ' class="ce-al-c"' : a === 'r' ? ' class="ce-al-r"' : '');
      const head = b.head.map((c, k) => `<th scope="col"${cls(b.align[k])}>${renderInline(c)}</th>`).join('');
      const body = b.rows
        .map((r) => `<tr>${r.map((c, k) => `<td${cls(b.align[k])}>${renderInline(c)}</td>`).join('')}</tr>`)
        .join('\n');
      return `<div class="ce-table-wrap"><table class="ce-md-table">\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`;
    }
    default:
      return '';
  }
}

/** Markdown 본문 → HTML */
export function renderMarkdown(src) {
  const lines = String(src ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n');
  return renderBlocks(parseBlocks(lines));
}
