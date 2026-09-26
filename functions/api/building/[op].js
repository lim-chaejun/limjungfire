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
  } catch {
    return jsonError(504, 'upstream timeout');
  }
  if (!upstreamRes.ok) {
    return jsonError(502, `upstream status ${upstreamRes.status}`);
  }

  const body = await upstreamRes.text();
  let ok;
  try {
    ok = JSON.parse(body)?.response?.header?.resultCode === '00';
  } catch {
    // 서비스키 오류 등은 XML로 응답하는 경우가 있다
    return jsonError(502, 'upstream returned non-JSON');
  }

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
