// HTML 출력 안전 유틸
// innerHTML·템플릿 문자열에 외부 데이터(건축물대장 API, 주소 검색, Firestore 사용자 데이터 등)를
// 넣을 때 반드시 거친다. DOM에 의존하지 않으므로 브라우저와 node:test 양쪽에서 사용 가능.

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
};

// 텍스트·속성값 이스케이프 (null/undefined는 빈 문자열)
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => ESCAPE_MAP[c]);
}

// http(s) 절대 URL만 통과시킨다. javascript:, data:, 상대경로 등은 빈 문자열.
// 반환값은 정규화된 href이며, HTML 속성에 넣을 때는 escapeHtml을 한 번 더 거친다.
export function safeHttpUrl(value, { httpsOnly = false } = {}) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return '';
  }
  if (url.protocol === 'https:') return url.href;
  if (url.protocol === 'http:' && !httpsOnly) return url.href;
  return '';
}
