/**
 * js/ads.js — 소방체크 광고 / 제휴 슬롯 통합 모듈
 * =====================================================================
 * 핵심 원칙: 아래 CONFIG의 ID/링크가 비어 있으면 "아무것도" 렌더링하지 않습니다.
 *           (빈 공간·레이아웃 깨짐·콘솔 오류 없음 → 라이브 사이트에 즉시 배포해도 안전)
 *           ID/링크를 채워 넣는 순간부터 광고가 자동으로 노출됩니다.
 *
 * 활성화 방법 (계정 발급 후 이 파일만 수정):
 *   1) 카카오 애드핏(AdFit)  https://adfit.kakao.com
 *      → 매체(사이트: sobangcheck.com) 등록 → 광고단위 생성
 *      → 발급된 'DAN-XXXXXXXXXXXXXXXX' 코드를 아래 ADFIT.units[*].id 에 붙여넣기
 *   2) 쿠팡 파트너스        https://partners.coupang.com
 *      → 상품 링크 생성 → 아래 COUPANG.products[슬롯이름] 배열에 추가
 * =====================================================================
 */

// ===================== ▼▼▼ 여기만 수정하세요 ▼▼▼ =====================

const ADFIT = {
  enabled: true,
  // 슬롯별 PC/모바일 광고단위. id가 빈 문자열이면 해당 슬롯은 노출되지 않습니다.
  units: {
    // 검색 결과 하단 (index.html)
    result: { pc: { id: '', w: 728, h: 90 }, mo: { id: '', w: 320, h: 100 } },
    // 시설가이드 본문 중간 (guide/*.html)
    guide:  { pc: { id: '', w: 728, h: 90 }, mo: { id: '', w: 300, h: 250 } },
    // 모바일 하단 고정 앵커
    anchor: { pc: { id: '', w: 728, h: 90 }, mo: { id: '', w: 320, h: 50 } },
  },
};

const COUPANG = {
  enabled: true,
  // 공정거래위원회 표기 의무 문구 (수정 금지 권장)
  disclosure: '쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  // 슬롯 이름별 상품 목록. url 은 쿠팡 파트너스에서 발급한 "본인" 추천 링크로 교체하세요.
  // 예: { name: 'ABC 분말소화기 3.3kg', img: 'https://...', url: 'https://link.coupang.com/...', price: '13,900원' }
  products: {
    'fire-extinguisher': [],
    'escape-equipment': [],
    'emergency-light': [],
  },
};

// ===================== ▲▲▲ 여기까지 ▲▲▲ =====================


const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

let adfitScriptLoaded = false;
function loadAdfitScript() {
  if (adfitScriptLoaded) return;
  adfitScriptLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.type = 'text/javascript';
  s.src = 'https://t1.daumcdn.net/kas/static/ba.min.js';
  document.body.appendChild(s);
}

function renderAdfitSlots() {
  if (!ADFIT.enabled) return;
  let activated = false;
  document.querySelectorAll('[data-ad-slot]').forEach((el) => {
    if (el.dataset.adRendered) return;
    const unit = ADFIT.units[el.getAttribute('data-ad-slot')];
    if (!unit) return;
    const conf = isMobile() ? unit.mo : unit.pc;
    if (!conf || !conf.id) return; // 미설정 → 빈 슬롯 유지 (노출 안 함)

    el.dataset.adRendered = '1';
    const ins = document.createElement('ins');
    ins.className = 'kakao_ad_area';
    ins.style.display = 'none';
    ins.setAttribute('data-ad-unit', conf.id);
    ins.setAttribute('data-ad-width', String(conf.w));
    ins.setAttribute('data-ad-height', String(conf.h));
    el.appendChild(ins);
    el.classList.add('sbc-ad--active');

    // 앵커 슬롯에는 닫기 버튼 제공
    if (el.classList.contains('sbc-ad--anchor')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'sbc-ad__close';
      close.setAttribute('aria-label', '광고 닫기');
      close.textContent = '✕';
      close.addEventListener('click', () => { el.style.display = 'none'; });
      el.appendChild(close);
    }
    activated = true;
  });
  if (activated) loadAdfitScript();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderCoupangSlots() {
  if (!COUPANG.enabled) return;
  document.querySelectorAll('[data-coupang-slot]').forEach((el) => {
    if (el.dataset.coupangRendered) return;
    const items = COUPANG.products[el.getAttribute('data-coupang-slot')] || [];
    if (!items.length) return; // 미설정 → 숨김

    el.dataset.coupangRendered = '1';
    const cards = items.map((p) => `
      <a class="sbc-coupang__card" href="${escapeHtml(p.url)}" target="_blank" rel="nofollow sponsored noopener">
        ${p.img ? `<div class="sbc-coupang__img"><img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.name)}" loading="lazy"></div>` : ''}
        <div class="sbc-coupang__name">${escapeHtml(p.name)}</div>
        ${p.price ? `<div class="sbc-coupang__price">${escapeHtml(p.price)}</div>` : ''}
      </a>`).join('');

    el.innerHTML = `
      <div class="sbc-coupang">
        <div class="sbc-coupang__head">관련 안전용품</div>
        <div class="sbc-coupang__grid">${cards}</div>
        <p class="sbc-coupang__disc">${escapeHtml(COUPANG.disclosure)}</p>
      </div>`;
    el.classList.add('sbc-coupang--active');
  });
}

function injectStyles() {
  if (document.getElementById('sbc-ads-style')) return;
  const style = document.createElement('style');
  style.id = 'sbc-ads-style';
  style.textContent = `
    .sbc-ad { display: none; }
    .sbc-ad.sbc-ad--active { display: flex; justify-content: center; margin: 16px 0; min-height: 0; }
    .sbc-ad--anchor.sbc-ad--active {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 900;
      background: var(--bg-secondary, #fff); padding: 4px 0;
      border-top: 1px solid var(--border-color, #e5e7eb);
      box-shadow: 0 -2px 8px rgba(0,0,0,0.06);
    }
    .sbc-ad__close {
      position: absolute; top: -22px; right: 8px; width: 22px; height: 22px;
      border: none; border-radius: 11px 11px 0 0; background: var(--bg-secondary, #fff);
      color: var(--text-tertiary, #888); font-size: 12px; line-height: 1; cursor: pointer;
      box-shadow: 0 -1px 4px rgba(0,0,0,0.08);
    }
    @media (min-width: 769px) { .sbc-ad--anchor.sbc-ad--active { padding: 8px 0; } }

    .sbc-coupang { margin: 16px 0; background: var(--bg-secondary, #fafafa);
      border: 1px solid var(--border-color, #e5e7eb); border-radius: var(--radius-lg, 12px); overflow: hidden; }
    .sbc-coupang__head { padding: 12px 16px; font-size: 14px; font-weight: 700;
      color: var(--text-primary, #222); background: var(--bg-tertiary, #f3f4f6);
      border-bottom: 1px solid var(--border-light, #eee); }
    .sbc-coupang__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px; padding: 16px; }
    .sbc-coupang__card { display: flex; flex-direction: column; gap: 6px; text-decoration: none;
      color: var(--text-secondary, #444); border: 1px solid var(--border-light, #eee);
      border-radius: var(--radius-md, 8px); padding: 10px; transition: border-color .15s; }
    .sbc-coupang__card:hover { border-color: var(--color-primary, #3182f6); }
    .sbc-coupang__img { aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .sbc-coupang__img img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .sbc-coupang__name { font-size: 13px; line-height: 1.4; }
    .sbc-coupang__price { font-size: 13px; font-weight: 700; color: var(--color-primary, #3182f6); }
    .sbc-coupang__disc { margin: 0; padding: 8px 16px 12px; font-size: 11px; color: var(--text-tertiary, #999); }
  `;
  document.head.appendChild(style);
}

function init() {
  injectStyles();
  renderCoupangSlots();
  renderAdfitSlots();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
