// Cloudflare Pages Function: 건축물대장·건축인허가 API 프록시
//   GET /api/building/:op?sigunguCd=11680&bjdongCd=10300&platGbCd=0&bun=0012&ji=0000
//
// - 공공데이터포털 서비스키는 Cloudflare Pages 환경변수 DATA_GO_KR_KEY 에만 둔다
//   (클라이언트 코드·저장소에 두지 않음). 미설정이면 503을 돌려주고, 클라이언트는 기존 직접 호출로 폴백한다.
// - 허용된 4개 오퍼레이션만 중계하고, 파라미터는 숫자 형식을 검증한다.
// - 정상 응답(resultCode 00)만 엣지 캐시에 24시간 보관해 같은 지번 반복 조회 시 호출량을 줄인다.

const OPERATIONS = {
  title: 'BldRgstHubService/getBrTitleInfo',
  floor: 'BldRgstHubService/getBrFlrOulnInfo',
  recap: 'BldRgstHubService/getBrRecapTitleInfo',
  permit: 'ArchPmsHubService/getApBasisOulnInfo'
};

const UPSTREAM_BASE = 'https://apis.data.go.kr/1613000/';
const CACHE_TTL_SECONDS = 60 * 60 * 24;
const UPSTREAM_TIMEOUT_MS = 14000;

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequestGet(context) {
  const { request, params, env } = context;

  const op = String(params.op || '');
  if (!Object.prototype.hasOwnProperty.call(OPERATIONS, op)) {
    return jsonError(404, 'unknown operation');
  }
  if (!env.DATA_GO_KR_KEY) {
    return jsonError(503, 'proxy not configured');
  }

  const url = new URL(request.url);
  const q = url.searchParams;
  const sigunguCd = q.get('sigunguCd') || '';
  const bjdongCd = q.get('bjdongCd') || '';
  const platGbCd = q.get('platGbCd') || '0';
  const bun = q.get('bun') || '';
  const ji = q.get('ji') || '';
  if (!/^\d{5}$/.test(sigunguCd) || !/^\d{5}$/.test(bjdongCd) || !/^[0-2]$/.test(platGbCd) ||
      !/^\d{0,4}$/.test(bun) || !/^\d{0,4}$/.test(ji)) {
    return jsonError(400, 'invalid parameters');
  }

  // 캐시 키: 정규화된 공개 파라미터만 사용 (서비스키 미포함)
  const cacheUrl = new URL(`/api/building/${op}`, url.origin);
  cacheUrl.searchParams.set('sigunguCd', sigunguCd);
  cacheUrl.searchParams.set('bjdongCd', bjdongCd);
  cacheUrl.searchParams.set('platGbCd', platGbCd);
  cacheUrl.searchParams.set('bun', bun);
  cacheUrl.searchParams.set('ji', ji);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = new URL(UPSTREAM_BASE + OPERATIONS[op]);
  upstream.searchParams.set('serviceKey', env.DATA_GO_KR_KEY);
  upstream.searchParams.set('sigunguCd', sigunguCd);
  upstream.searchParams.set('bjdongCd', bjdongCd);
  upstream.searchParams.set('platGbCd', platGbCd);
  if (bun) upstream.searchParams.set('bun', bun.padStart(4, '0'));
  if (ji) upstream.searchParams.set('ji', ji.padStart(4, '0'));
  upstream.searchParams.set('numOfRows', '100');
  upstream.searchParams.set('pageNo', '1');
  upstream.searchParams.set('_type', 'json');

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream.toString(), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    console.error('building proxy: upstream fetch failed', e && e.name, e && e.message);
    return jsonError(504, 'upstream unreachable');
  }
  // 인증·할당량 문제는 503(프록시 사용 불가)으로 알려 클라이언트가 직접 호출로 폴백하게 한다
  if (upstreamRes.status === 401 || upstreamRes.status === 403 || upstreamRes.status === 429) {
    return jsonError(503, `upstream key or quota error (${upstreamRes.status})`);
  }
  if (!upstreamRes.ok) {
    return jsonError(502, `upstream status ${upstreamRes.status}`);
  }

  const body = await upstreamRes.text();
  let resultCode;
  try {
    resultCode = JSON.parse(body)?.response?.header?.resultCode;
  } catch {
    console.error('building proxy: upstream returned non-JSON', body.slice(0, 200));
    // 서비스키 미등록·미활성·일일 한도 초과 등은 XML 오류로 응답한다 → 503(프록시 사용 불가)
    if (/SERVICE_KEY|SERVICE_ACCESS_DENIED|LIMITED_NUMBER_OF_SERVICE_REQUESTS|UNREGISTERED_IP/.test(body)) {
      return jsonError(503, 'upstream key or quota error');
    }
    // 빈 응답 등 일시 오류 → 502(이번 요청만 재시도)
    return jsonError(502, 'upstream returned an invalid body');
  }
  // 20·22·30·31·32: 서비스 접근 거부·요청 한도 초과·미등록 키·기한 만료 키·미등록 IP
  if (['20', '22', '30', '31', '32'].includes(String(resultCode))) {
    return jsonError(503, `upstream key or quota error (resultCode ${resultCode})`);
  }
  const ok = resultCode === '00';

  const response = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ok ? `public, max-age=${CACHE_TTL_SECONDS}` : 'no-store'
    }
  });
  if (ok) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}
