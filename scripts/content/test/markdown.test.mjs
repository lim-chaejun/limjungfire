import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline } from '../lib/markdown.mjs';
import { htmlProblems } from './helpers.mjs';

const md = (s) => renderMarkdown(s);

test('제목: # 은 h2 로 내리고 ## ~ ###### 는 그대로, 닫는 # 은 버린다', () => {
  assert.equal(md('# 큰 제목'), '<h2>큰 제목</h2>');
  assert.equal(md('## 둘 ##'), '<h2>둘</h2>');
  assert.equal(md('### 셋'), '<h3>셋</h3>');
  assert.equal(md('###### 여섯'), '<h6>여섯</h6>');
  assert.equal(md('#태그처럼 붙여 쓴 것'), '<p>#태그처럼 붙여 쓴 것</p>');
  assert.equal(md('## C#'), '<h2>C#</h2>');
});

test('문단: 빈 줄로 나누고 줄은 이어 붙인다', () => {
  assert.equal(md('첫 줄\n둘째 줄\n\n새 문단'), '<p>첫 줄\n둘째 줄</p>\n<p>새 문단</p>');
});

test('굵게·기울임·인라인 코드', () => {
  assert.equal(renderInline('**굵게** 와 *기울임*'), '<strong>굵게</strong> 와 <em>기울임</em>');
  assert.equal(renderInline('`<b>코드</b>`'), '<code>&lt;b&gt;코드&lt;/b&gt;</code>');
  assert.equal(renderInline('``코드 ` 안 백틱``'), '<code>코드 ` 안 백틱</code>');
  assert.equal(renderInline('** 공백 **'), '** 공백 **');
  assert.equal(renderInline('snake_case_이름'), 'snake_case_이름', '밑줄 강조는 지원하지 않는다');
  assert.equal(renderInline('닫히지 않은 `백틱'), '닫히지 않은 `백틱');
});

test('강조가 겹쳐도 태그는 항상 올바르게 닫힌다', () => {
  for (const s of ['***x***', '**a *b** c*', '*a **b* c**', '**[링크](/a)** *`코드`*', '****', '*/*']) {
    const html = renderInline(s);
    assert.deepEqual(htmlProblems(`<p>${html}</p>`), [], `${s} → ${html}`);
  }
});

test('링크: 외부는 새 창 + rel="noopener", 내부는 그대로', () => {
  assert.equal(
    renderInline('[원문](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911&a=1)'),
    '<a href="https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911&amp;a=1" target="_blank" rel="noopener">원문</a>',
  );
  assert.equal(renderInline('[기준](/standards/use/retail)'), '<a href="/standards/use/retail">기준</a>');
  assert.equal(renderInline('[앵커](#faq)'), '<a href="#faq">앵커</a>');
  assert.equal(renderInline('[사이트](https://sobangcheck.com/guide/)'), '<a href="https://sobangcheck.com/guide/">사이트</a>');
  assert.equal(renderInline('[**굵은** 링크](/a)'), '<a href="/a"><strong>굵은</strong> 링크</a>');
  assert.equal(renderInline('[괄호](https://ko.wikipedia.org/wiki/A_(B))'), '<a href="https://ko.wikipedia.org/wiki/A_(B)" target="_blank" rel="noopener">괄호</a>');
});

test('XSS: 위험한 링크 주소는 링크로 만들지 않고 글자로 둔다', () => {
  const bad = [
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](vbscript:msgbox)',
    '[x](//evil.example/path)',
    '[x](/\\evil.example)',
    '[x](<javascript:alert(1)>)',
    '[x](file:///etc/passwd)',
    '[x](relative/path)',
  ];
  for (const s of bad) {
    const html = renderInline(s);
    assert.ok(!/<a\s/.test(html), `${s} → ${html}`);
  }
  const html = renderInline('[x](https://a.example/"onmouseover="alert(1))');
  assert.ok(!/"onmouseover=/.test(html), html);
  assert.ok(html.includes('&quot;onmouseover=&quot;'), html);
});

test('XSS: HTML 태그·속성·엔티티는 모두 이스케이프된다', () => {
  const html = md('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n&lt;이미 이스케이프&gt; & "따옴표" \'작은\'');
  assert.ok(!html.includes('<script'), html);
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&amp;lt;이미 이스케이프&amp;gt; &amp; &quot;따옴표&quot; &#39;작은&#39;'));
  const heading = md('## <b onclick="x()">제목</b>');
  assert.equal(heading, '<h2>&lt;b onclick=&quot;x()&quot;&gt;제목&lt;/b&gt;</h2>');
});

test('XSS: 자리표시자 문자를 넣어도 토큰을 주입할 수 없다', () => {
  const open = String.fromCharCode(0xe000);
  const close = String.fromCharCode(0xe001);
  const html = renderInline(`${open}0${close} \`<i>\` ${open}1${close}`);
  assert.equal(html, '0 <code>&lt;i&gt;</code> 1');
});

test('역슬래시 이스케이프', () => {
  assert.equal(renderInline('\\*별표\\* \\[대괄호\\] \\`'), '*별표* [대괄호] `');
  assert.equal(renderInline('C:\\경로'), 'C:\\경로');
});

test('목록: 순서 없음·순서 있음(시작 번호)·중첩·이어지는 줄', () => {
  assert.equal(md('- 하나\n- 둘'), '<ul>\n<li>하나</li>\n<li>둘</li>\n</ul>');
  assert.equal(md('* 별\n+ 더하기'), '<ul>\n<li>별</li>\n</ul>\n<ul>\n<li>더하기</li>\n</ul>');
  assert.equal(md('3. 셋\n4. 넷'), '<ol start="3">\n<li>셋</li>\n<li>넷</li>\n</ol>');
  assert.equal(md('1) 괄호'), '<ol>\n<li>괄호</li>\n</ol>');
  assert.equal(
    md('- 부모\n  - 자식 A\n  - 자식 B\n- 다음'),
    '<ul>\n<li>부모\n<ul>\n<li>자식 A</li>\n<li>자식 B</li>\n</ul></li>\n<li>다음</li>\n</ul>',
  );
  assert.equal(md('- 항목\n이어지는 줄'), '<ul>\n<li>항목\n이어지는 줄</li>\n</ul>');
  assert.equal(md('- 첫 문단\n\n  둘째 문단'), '<ul>\n<li><p>첫 문단</p>\n<p>둘째 문단</p></li>\n</ul>');
});

test('날짜로 시작하는 줄은 목록이 아니다 (번호는 1~3자리만)', () => {
  assert.equal(md('2024. 12. 31. 시행'), '<p>2024. 12. 31. 시행</p>');
  assert.equal(md('문단\n2. 문단 중간의 2 는 목록을 시작하지 않는다'), '<p>문단\n2. 문단 중간의 2 는 목록을 시작하지 않는다</p>');
  assert.equal(md('문단\n1. 하지만 1 은 시작한다'), '<p>문단</p>\n<ol>\n<li>하지만 1 은 시작한다</li>\n</ol>');
});

test('표: 정렬, 이스케이프된 파이프, 칸 수 맞춤, 인라인 문법', () => {
  const html = md('| 구분 | 기준 | 비고 |\n|:---|:---:|---:|\n| A \\| B | **굵게** | [링크](/a) |\n| 짧은 행 |\n| 1 | 2 | 3 | 넘치는 칸 |');
  assert.equal(
    html,
    [
      '<div class="ce-table-wrap"><table class="ce-md-table">',
      '<thead><tr><th scope="col">구분</th><th scope="col" class="ce-al-c">기준</th><th scope="col" class="ce-al-r">비고</th></tr></thead>',
      '<tbody>',
      '<tr><td>A | B</td><td class="ce-al-c"><strong>굵게</strong></td><td class="ce-al-r"><a href="/a">링크</a></td></tr>',
      '<tr><td>짧은 행</td><td class="ce-al-c"></td><td class="ce-al-r"></td></tr>',
      '<tr><td>1</td><td class="ce-al-c">2</td><td class="ce-al-r">3</td></tr>',
      '</tbody>',
      '</table></div>',
    ].join('\n'),
  );
  assert.equal(md('| 머리 | 둘 |\n|---|\n| a | b |').includes('<table'), false, '구분 줄의 칸 수가 다르면 표가 아니다');
});

test('인용·가로줄', () => {
  assert.equal(md('> 인용 **강조**\n> - 목록'), '<blockquote>\n<p>인용 <strong>강조</strong></p>\n<ul>\n<li>목록</li>\n</ul>\n</blockquote>');
  assert.equal(md('앞\n\n---\n\n뒤'), '<p>앞</p>\n<hr>\n<p>뒤</p>');
  assert.equal(md('* * *'), '<hr>');
  assert.equal(md('앞 문단\n---'), '<p>앞 문단</p>\n<hr>', 'setext 제목은 지원하지 않는다');
});

test('모르는 문법은 이스케이프된 글자로 남는다', () => {
  assert.equal(md('![그림](/a.png)'), '<p>![그림](/a.png)</p>');
  assert.equal(md('<!-- 주석 -->'), '<p>&lt;!-- 주석 --&gt;</p>');
  assert.equal(md('[^1]: 각주'), '<p>[^1]: 각주</p>');
  assert.equal(md('제목\n===').includes('<h1'), false);
  const fenced = md('```\n<b>코드</b>\n```');
  assert.ok(!fenced.includes('<b>'), fenced);
  assert.deepEqual(htmlProblems(fenced), []);
});

test('줄바꿈 형식(CRLF·BOM·탭)에 상관없이 같은 결과', () => {
  const lf = md('## 제목\n\n- 하나\n  - 둘\n');
  assert.equal(md('\uFEFF## 제목\r\n\r\n- 하나\r\n\t- 둘\r\n'), lf);
});
