import { escapeHtml as esc, safeHttpUrl } from './lib/html.js';
import { mapPurposeToFireType, getFireDataFile, classifyPurpose } from './lib/building-types.js';
import {
  findApplicableVersion, getActNameAt, findCriteriaBoundaries, selectPrimaryPermit, toYmd, FIRE_ACT_START,
  APPLICATION_WINDOW_DAYS, EARLIEST_YMD, addDays, parseYmdInput
} from './lib/law-versions.js';

// 사용자가 입력한 허가 신청일 (YYYYMMDD, 없으면 '').
// 부칙 적용례는 대개 허가 신청일 기준인데 건축물대장에는 허가일만 있으므로, 입력하면 신청일로 기준을 다시 고른다.
// 판정 엔진 v2 의 질문 키 application_date 와 같은 값이다. 주소 조회는 URL 파라미터 applied 로 유지한다.
let currentAppliedDay = '';
// 직접 입력 결과를 신청일 변경 후 다시 그리기 위한 마지막 입력값
let lastManualBuildingInfo = null;
// 신청일을 바꿔 같은 건물을 다시 그릴 때 구 소방법 안내 모달을 또 띄우지 않기 위한 표시 (새 건물을 열 때 비운다)
let preLawModalShownFor = '';

// 인앱 브라우저 처리
if (window.__inAppBrowser) {
  document.addEventListener('DOMContentLoaded', function() {
    const guide = document.getElementById('inAppGuide');
    const splash = document.getElementById('splashScreen');
    if (guide) {
      guide.style.display = 'flex';
      if (splash) splash.style.display = 'none';
      // 플랫폼별 안내 표시
      const isIOS = /iPhone|iPad/.test(navigator.userAgent);
      const androidGuide = document.getElementById('androidGuide');
      const iosGuide = document.getElementById('iosGuide');
      if (isIOS && iosGuide) {
        iosGuide.style.display = 'block';
      } else if (androidGuide) {
        androidGuide.style.display = 'block';
      }
    }
  });
}

// URL 복사 함수 (인앱 브라우저용)
window.copyUrl = function() {
  navigator.clipboard.writeText(location.href).then(function() {
    // 토스트 메시지 표시
    const toast = document.createElement('div');
    toast.className = 'inapp-toast success';
    toast.textContent = '주소가 복사되었습니다!';
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.remove();
    }, 2500);
  }).catch(function() {
    // 클립보드 API 실패 시 fallback
    const textArea = document.createElement('textarea');
    textArea.value = location.href;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      const toast = document.createElement('div');
      toast.className = 'inapp-toast success';
      toast.textContent = '주소가 복사되었습니다!';
      document.body.appendChild(toast);
      setTimeout(function() {
        toast.remove();
      }, 2500);
    } catch (err) {
      alert('주소 복사에 실패했습니다. 직접 주소창에서 복사해주세요.');
    }
    document.body.removeChild(textArea);
  });
};

// ESC 키로 최상위 모달 닫기
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  // 닫기 우선순위: 가장 위에 떠있는 모달부터 닫기
  // myInfoModal, settingsModal, authModal은 components.js에서 처리
  const modalCloseMap = [
    ['facilityDetailModal', 'closeFacilityDetailModal'],
    ['fireStandardsModal', 'closeFireStandardsModal'],
    ['mapModal', 'closeMapModal'],
    ['detailModal', 'closeDetailModal'],
    ['addressModal', 'closeAddressModal'],
    ['manualInputModal', 'closeManualInputModal'],
    ['historyModal', 'closeHistoryModal'],
    ['adBlockModal', 'closeAdBlockModal'],
  ];
  for (const [id, fn] of modalCloseMap) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none' && el.style.display !== '') {
      if (typeof window[fn] === 'function') window[fn]();
      return;
    }
  }
});

// 전역 변수
let selectedAddressData = null;
let currentUser = null;
let fireFacilitiesCache = {}; // 지연 로딩 캐시 (건물유형별)
let exemptionCriteriaData = null; // 면제기준 데이터 (지연 로딩)
let facilitiesMasterData = null; // 시설 마스터 데이터 (지연 로딩)
let adSettings = null; // 광고 설정
const API_KEY = '07887a9d4f6b1509b530798e1b5b86a1e1b6e4f5aacc26994fd1fd73cbcebefb';

// 로그인 유도 관리
const loginPromptManager = {
  getSearchCount() {
    return parseInt(sessionStorage.getItem('searchCount') || '0', 10);
  },
  incrementSearchCount() {
    const count = this.getSearchCount() + 1;
    sessionStorage.setItem('searchCount', count.toString());
    return count;
  },
  isResultBannerDismissed() {
    return sessionStorage.getItem('resultBannerDismissed') === 'true';
  },
  dismissResultBanner() {
    sessionStorage.setItem('resultBannerDismissed', 'true');
  },
  isLoginBannerDismissed() {
    const dismissed = localStorage.getItem('loginBannerDismissed');
    if (!dismissed) return false;
    const daysSince = (Date.now() - parseInt(dismissed, 10)) / (1000 * 60 * 60 * 24);
    return daysSince < 3;
  },
  dismissLoginBanner() {
    localStorage.setItem('loginBannerDismissed', Date.now().toString());
  },
  _isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  },
  shouldShowResultBanner() {
    return !currentUser && !this.isResultBannerDismissed() && !this._isStandalone();
  },
  shouldShowLoginBanner() {
    return !currentUser && this.getSearchCount() >= 2 && !this.isLoginBannerDismissed() && !this._isStandalone();
  },
  showLoginBannerIfNeeded() {
    const banner = document.getElementById('loginPromptBanner');
    if (!banner) return;
    const pwaBanner = document.getElementById('pwaInstallBanner');
    const pwaVisible = pwaBanner && pwaBanner.classList.contains('show');
    if (this.shouldShowLoginBanner() && !pwaVisible) {
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  },
  hideLoginBanner() {
    const banner = document.getElementById('loginPromptBanner');
    if (banner) banner.classList.remove('show');
  }
};

// 용도 → 데이터 파일 매핑은 js/lib/building-types.js (data/NN_*.json 의 building_type 과 동일)

// 테마 관리
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
}

// 테마 토글
window.toggleTheme = function() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
};

// 초기 테마 설정
initTheme();

// 광고 차단 감지
async function detectAdBlock() {
  // 광고 차단기가 숨기는 전형적인 요소 테스트
  const testAd = document.createElement('div');
  testAd.innerHTML = '&nbsp;';
  testAd.className = 'adsbox ad-test';
  testAd.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;background:transparent;';
  document.body.appendChild(testAd);

  // 광고 차단기가 요소를 처리할 시간을 줌
  await new Promise(r => setTimeout(r, 100));

  // 요소가 숨겨졌는지 확인
  const style = window.getComputedStyle(testAd);
  const blocked = testAd.offsetHeight === 0 ||
                  testAd.offsetParent === null ||
                  style.display === 'none' ||
                  style.visibility === 'hidden';

  testAd.remove();
  return blocked;
}

// 광고 차단 모달 표시
function showAdBlockModal() {
  const modal = document.getElementById('adBlockModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

// 광고 차단 모달 닫기
window.closeAdBlockModal = function() {
  const modal = document.getElementById('adBlockModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
};

// Firebase 함수들 (동적 로드)
let firebaseModule = null;

// Firebase 동적 로드
async function loadFirebase() {
  if (firebaseModule) return firebaseModule;
  try {
    firebaseModule = await import('./firebase.js');
    // Firebase 로드 성공
    return firebaseModule;
  } catch (error) {
    console.error('Firebase 로드 실패:', error);
    return null;
  }
}

// 소방시설 법규 데이터 지연 로드 (건물 유형별)
async function getFireFacilityData(buildingType) {
  // 캐시 확인
  if (fireFacilitiesCache[buildingType]) {
    return fireFacilitiesCache[buildingType];
  }

  // 파일명 매핑
  const fileName = getFireDataFile(buildingType);
  if (!fileName) {
    console.warn(`알 수 없는 건물 유형: ${buildingType}`);
    return null;
  }

  try {
    const res = await fetch(`/data/${fileName}.json`);
    if (res.ok) {
      const data = await res.json();
      fireFacilitiesCache[buildingType] = data;
      // 소방시설 데이터 로드 완료
      return data;
    }
  } catch (e) {
    console.warn(`소방시설 데이터 로드 실패: ${buildingType}`, e);
  }
  return null;
}

// 면제기준 데이터 지연 로드
async function getExemptionCriteriaData() {
  // 캐시 확인
  if (exemptionCriteriaData) {
    return exemptionCriteriaData;
  }

  try {
    const res = await fetch('/data/exemption_criteria.json');
    if (res.ok) {
      exemptionCriteriaData = await res.json();
      // 면제기준 데이터 로드 완료
      return exemptionCriteriaData;
    }
  } catch (e) {
    console.warn('면제기준 데이터 로드 실패:', e);
  }
  return null;
}

// 시설 마스터 데이터 지연 로드
async function getFacilitiesMasterData() {
  if (facilitiesMasterData) return facilitiesMasterData;
  try {
    const res = await fetch('/data/facilities.json');
    if (res.ok) {
      const data = await res.json();
      // name→facility, alias→facility 인덱스 구축
      const byName = {};
      const byId = {};
      const byAlias = {};
      for (const fac of data.facilities) {
        byName[fac.name] = fac;
        byId[fac.id] = fac;
        for (const alias of (fac.aliases || [])) {
          byAlias[alias] = fac;
        }
      }
      facilitiesMasterData = { list: data.facilities, byName, byId, byAlias };
      // 시설 마스터 데이터 로드 완료
      return facilitiesMasterData;
    }
  } catch (e) {
    console.warn('시설 마스터 데이터 로드 실패:', e);
  }
  return null;
}

// 시설 마스터에서 아이콘 조회
function getFacilityIcon(facilityName) {
  if (!facilitiesMasterData) return '📋';
  const fac = facilitiesMasterData.byName[facilityName] || facilitiesMasterData.byAlias[facilityName];
  return (fac && fac.icon) || '📋';
}

// 시설 마스터에서 NFSC 키 조회
function getFacilityNfscKey(facilityName) {
  if (!facilitiesMasterData) return null;
  const fac = facilitiesMasterData.byName[facilityName] || facilitiesMasterData.byAlias[facilityName];
  return fac ? fac.nfsc_key : null;
}

// 시설 마스터에서 정규화된 이름 조회
function normalizeFacilityName(facilityName) {
  if (!facilitiesMasterData) return facilityName;
  const fac = facilitiesMasterData.byAlias[facilityName];
  return fac ? fac.name : facilityName;
}

// 스플래시 화면 숨기기
function hideSplashScreen() {
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.add('hidden');
    // 애니메이션 후 DOM에서 제거
    setTimeout(() => splash.remove(), 300);
  }
}

// URL 파라미터로 주소 정보 업데이트 (currentBuildingData에서 코드 추출)
function updateUrlWithAddress() {
  if (!currentBuildingData) return;

  const { generalItems, titleItems } = currentBuildingData;
  const general = generalItems?.[0] || {};
  const title = titleItems?.[0] || {};

  // API 응답에서 코드 직접 추출
  const sigunguCd = general.sigunguCd || title.sigunguCd;
  const bjdongCd = general.bjdongCd || title.bjdongCd;
  const bun = general.bun || title.bun;
  const ji = general.ji || title.ji;
  const platGbCd = normalizePlatGbCd(general.platGbCd || title.platGbCd);

  if (!sigunguCd || !bjdongCd) return;

  const params = new URLSearchParams();
  params.set('sigungu', sigunguCd);
  params.set('bjdong', bjdongCd);
  if (bun) params.set('bun', bun);
  if (ji) params.set('ji', ji);
  if (platGbCd !== '0') params.set('plat', platGbCd);
  if (toYmd(currentAppliedDay)) params.set('applied', currentAppliedDay);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState(null, '', newUrl);
}

// URL 파라미터에서 코드 정보 읽기 (새 형식: sigungu, bjdong, bun, ji 또는 s=shortId)
async function getCodesFromUrl() {
  const params = new URLSearchParams(window.location.search);

  // 짧은 링크 형식 (?s=xxx)
  const shortId = params.get('s');
  if (shortId) {
    const fb = await loadFirebase();
    if (fb) {
      const shareData = await fb.getShareLink(shortId);
      if (shareData) {
        return {
          sigunguCd: shareData.sigunguCd,
          bjdongCd: shareData.bjdongCd,
          bun: shareData.bun || '',
          ji: shareData.ji || '',
          platGbCd: normalizePlatGbCd(shareData.platGbCd),
          // 신청일은 공유 문서가 아니라 짧은 링크 뒤 파라미터로 붙는다 (?s=xxx&applied=YYYYMMDD)
          appliedDay: parseYmdInput(params.get('applied'))
        };
      }
    }
    return null;
  }

  // 기존 형식 (?sigungu=xxx&bjdong=xxx)
  const sigunguCd = params.get('sigungu');
  const bjdongCd = params.get('bjdong');

  if (sigunguCd && bjdongCd) {
    return {
      sigunguCd,
      bjdongCd,
      bun: params.get('bun') || '',
      ji: params.get('ji') || '',
      platGbCd: normalizePlatGbCd(params.get('plat')),
      appliedDay: parseYmdInput(params.get('applied'))
    };
  }
  return null;
}

// URL 파라미터 기반 자동 검색
async function searchFromUrl() {
  const codes = await getCodesFromUrl();
  if (!codes) return;

  showLoading(true);

  try {
    // jibunInfo 형식으로 변환 (bun, ji는 이미 패딩된 상태로 URL에 저장됨)
    const jibunInfo = { bun: codes.bun, ji: codes.ji, platGbCd: codes.platGbCd };
    // 공유 링크·새로고침: URL의 허가 신청일을 이어 받는다 (실제 날짜가 아닌 값은 주소창에서도 지운다)
    currentAppliedDay = codes.appliedDay || '';
    if (!currentAppliedDay) removeAppliedFromUrl();
    preLawModalShownFor = '';

    // 4가지 API 동시 호출 (표제부 외에는 실패해도 부분 결과 표시)
    const { titleResult, floorResult, generalResult, permitResult, failed } =
      await fetchAllBuildingData(codes.sigunguCd, codes.bjdongCd, jibunInfo);

    displayAllResults(titleResult, floorResult, generalResult, permitResult);
    notifyPartialFailure(failed);

    // 결과에서 주소 정보 추출하여 UI 업데이트
    const titleItems = extractItems(titleResult);
    const generalItems = extractItems(generalResult);
    const firstTitle = titleItems[0] || {};
    const firstGeneral = generalItems[0] || {};
    const address = firstGeneral.platPlc || firstTitle.platPlc || '';

    if (address) {
      document.getElementById('addressInput').value = address;
      document.getElementById('searchBtn').disabled = false;
    }
  } catch (error) {
    console.error('URL 기반 검색 오류:', error);
    showError('조회 중 오류가 발생했습니다: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// ticker: step-based scroll, long items scroll slowly before advancing
(function initTicker() {
  var track = document.querySelector('.tips-ticker-track');
  var ticker = document.getElementById('tipsTicker');
  var viewport = document.querySelector('.tips-ticker-viewport');
  if (!track || !ticker || !viewport) return;

  var itemCount = track.querySelectorAll('.tips-ticker-item').length;
  if (itemCount === 0) return;

  // duplicate for seamless loop
  track.innerHTML += track.innerHTML;
  var allItems = track.querySelectorAll('.tips-ticker-item');

  // each item at least viewport width so short tips fill the view
  function sizeItems() {
    var w = viewport.offsetWidth;
    for (var i = 0; i < allItems.length; i++) {
      allItems[i].style.minWidth = w + 'px';
    }
  }
  sizeItems();

  var currentIndex = 0;
  var paused = false;
  var timer = null;

  function show(index, onDone) {
    var vpWidth = viewport.offsetWidth;
    var item = allItems[index];
    var itemLeft = item.offsetLeft;
    var itemWidth = item.offsetWidth;

    // slide to item's left edge
    track.style.transition = 'transform 0.5s ease';
    track.style.transform = 'translateX(-' + itemLeft + 'px)';

    clearTimeout(timer);

    if (itemWidth > vpWidth) {
      // long item: after slide-in, slowly scroll to reveal the rest
      var overflow = itemWidth - vpWidth;
      var dur = overflow / 40; // 40px per second
      timer = setTimeout(function doScroll() {
        if (paused) { timer = setTimeout(doScroll, 300); return; }
        track.style.transition = 'transform ' + dur + 's linear';
        track.style.transform = 'translateX(-' + (itemLeft + overflow) + 'px)';
        timer = setTimeout(function afterScroll() {
          if (paused) { timer = setTimeout(afterScroll, 300); return; }
          onDone();
        }, dur * 1000 + 1500);
      }, 1500);
    } else {
      // short item: wait 4s then advance
      timer = setTimeout(function afterWait() {
        if (paused) { timer = setTimeout(afterWait, 300); return; }
        onDone();
      }, 4000);
    }
  }

  function next() {
    currentIndex++;
    if (currentIndex >= itemCount) {
      // show duplicate of first item (smooth transition from last)
      show(currentIndex, function() {
        // jump back to real first item position
        track.style.transition = 'none';
        currentIndex = 0;
        track.style.transform = 'translateX(-' + allItems[0].offsetLeft + 'px)';
        void track.offsetWidth;
        next();
      });
      return;
    }
    show(currentIndex, next);
  }

  // start with first item
  show(0, next);

  ticker.addEventListener('mouseenter', function() { paused = true; });
  ticker.addEventListener('mouseleave', function() { paused = false; });

  window.addEventListener('resize', function() {
    sizeItems();
    track.style.transition = 'none';
    track.style.transform = 'translateX(-' + allItems[currentIndex].offsetLeft + 'px)';
  });
})();

// 초기화
(async function init() {
  // 스플래시 화면 최대 표시 시간 (Firebase 느릴 때 대비)
  const splashTimeout = setTimeout(hideSplashScreen, 2000);

  // 광고 차단 모달은 실제 광고 단위가 게재된 이후에만 의미가 있습니다.
  // 현재는 애드핏 ID 설정 전이므로 비활성화 (광고가 없는데 차단 안내를 띄우는 것은 UX 저해).
  // 애드핏 광고를 실제로 게재한 뒤 아래 주석을 해제하세요.
  // const adBlockDetected = await detectAdBlock();
  // if (adBlockDetected) {
  //   showAdBlockModal();
  // }

  // Firebase만 초기화 (소방시설/면제기준 데이터는 필요할 때 지연 로드)
  const fb = await loadFirebase();

  if (fb) {
    // 광고 설정 로드
    loadAdSettings();

    // 인증 UI 업데이트와 saveUserInfo는 components.js가 처리
    // 여기서는 index.html 전용 로직만 처리
    fb.onAuthChange((user) => {
      currentUser = user;
      // index 전용: 스플래시 화면 숨기기
      clearTimeout(splashTimeout);
      hideSplashScreen();
      // index 전용: URL 파라미터 자동 검색
      if (!window.__urlSearched) {
        window.__urlSearched = true;
        searchFromUrl();
      }
      // index 전용: 검색 기록 버튼 표시
      const historyBtn = document.getElementById('historyBtn');
      if (historyBtn) historyBtn.style.display = 'inline-flex';
      // index 전용: 로그인 시 배너/뱃지 정리
      if (user) {
        loginPromptManager.hideLoginBanner();
        const resultBanner = document.getElementById('resultLoginBanner');
        if (resultBanner) resultBanner.remove();
        const pdfBadge = document.querySelector('.pdf-login-badge');
        if (pdfBadge) pdfBadge.remove();
      }
    });
  } else {
    // Firebase 로드 실패해도 스플래시 숨기기
    clearTimeout(splashTimeout);
    hideSplashScreen();
    // URL 파라미터 검색
    if (!window.__urlSearched) {
      window.__urlSearched = true;
      searchFromUrl();
    }
  }
})();

// 광고 설정 로드
async function loadAdSettings() {
  try {
    const fb = await loadFirebase();
    if (fb && fb.getAdSettings) {
      adSettings = await fb.getAdSettings();
    }
  } catch (error) {
    console.error('광고 설정 로드 실패:', error);
  }
}

// 광고 배너 렌더링
function renderAdBanner() {
  // 광고 설정이 없거나 비활성화된 경우 기본 배너 표시
  if (!adSettings || !adSettings.isActive || !adSettings.imageUrl) {
    return `
      <div class="ad-banner">
        <span>광고주님을 찾습니다</span>
      </div>
    `;
  }

  // URL 검증: 프로토콜뿐 아니라 전체 URL을 파싱하고, 속성에 넣을 때 이스케이프한다
  // (접두어만 검사하면 따옴표로 속성을 탈출해 모든 방문자 화면에 스크립트를 주입할 수 있음)
  const safeImageUrl = safeHttpUrl(adSettings.imageUrl, { httpsOnly: true });
  const safeLinkUrl = safeHttpUrl(adSettings.linkUrl || '');
  if (!safeImageUrl) {
    return `
      <div class="ad-banner">
        <span>광고주님을 찾습니다</span>
      </div>
    `;
  }

  const imgHtml = `<img src="${esc(safeImageUrl)}" alt="광고" class="ad-banner-image" onerror="this.onerror=null;this.style.display='none';this.parentElement.insertAdjacentText('beforeend','광고주님을 찾습니다');">`;
  if (safeLinkUrl) {
    return `
      <a href="${esc(safeLinkUrl)}" target="_blank" rel="noopener noreferrer sponsored" class="ad-banner ad-banner-link">
        ${imgHtml}
      </a>
    `;
  }
  return `
      <div class="ad-banner">
        ${imgHtml}
      </div>
    `;
}

// 헤더, 프로필 메뉴, 인증, 모달 관련 함수는 components.js에서 처리

// 홈으로 이동 (index.html 전용 - 검색 상태 초기화)
window.goHome = function() {
  // 검색 결과 초기화
  document.getElementById('result').innerHTML = '';
  document.getElementById('addressInput').value = '';
  document.getElementById('searchBtn').disabled = true;

  // 헤더 다시 표시
  document.getElementById('mainHeader').classList.remove('hidden');

  // 직접 입력 링크 다시 표시
  const manualLink = document.querySelector('.manual-search-link');
  if (manualLink) manualLink.style.display = '';
};

// index.html 전용: 홈 버튼을 goHome()으로 오버라이드
document.addEventListener('DOMContentLoaded', () => {
  // components.js가 헤더를 렌더링한 후 홈 버튼 동작 변경
  setTimeout(() => {
    const homeBtn = document.querySelector('.home-btn');
    if (homeBtn) {
      homeBtn.removeAttribute('href');
      homeBtn.style.cursor = 'pointer';
      homeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        goHome();
      });
    }
  }, 0);
});

// 검색기록 모달 상태
let historyModalState = {
  activeTab: 'recent', // 'recent' or 'favorites'
  favorites: []
};

// 검색 기록 보기
window.showSearchHistory = async function() {
  if (!currentUser) {
    showLoginRequiredToast('검색 기록을 보려면 로그인이 필요합니다');
    return;
  }

  const historyModal = document.getElementById('historyModal');
  const historyList = document.getElementById('historyList');

  // 탭 UI 추가
  historyModalState.activeTab = 'recent';
  renderHistoryTabs();

  historyList.innerHTML = '<div class="loading-small">불러오는 중...</div>';
  historyModal.style.display = 'flex';

  await loadHistoryTab('recent');
};

// 탭 UI 렌더링
function renderHistoryTabs() {
  const modalBody = document.querySelector('#historyModal .modal-body');
  const existingTabs = modalBody.querySelector('.history-tabs');

  if (!existingTabs) {
    const tabsHtml = `
      <div class="history-tabs">
        <button class="history-tab-btn ${historyModalState.activeTab === 'recent' ? 'active' : ''}" onclick="switchHistoryTab('recent')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          최근 검색
        </button>
        <button class="history-tab-btn ${historyModalState.activeTab === 'favorites' ? 'active' : ''}" onclick="switchHistoryTab('favorites')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          즐겨찾기
        </button>
      </div>
    `;
    modalBody.insertAdjacentHTML('afterbegin', tabsHtml);
  } else {
    // 탭 활성화 상태 업데이트
    existingTabs.querySelectorAll('.history-tab-btn').forEach((btn, index) => {
      const isActive = (index === 0 && historyModalState.activeTab === 'recent') ||
                       (index === 1 && historyModalState.activeTab === 'favorites');
      btn.classList.toggle('active', isActive);
    });
  }
}

// 탭 전환
window.switchHistoryTab = async function(tab) {
  historyModalState.activeTab = tab;
  renderHistoryTabs();
  await loadHistoryTab(tab);
};

// 탭별 데이터 로드
async function loadHistoryTab(tab) {
  const historyList = document.getElementById('historyList');
  historyList.innerHTML = '<div class="loading-small">불러오는 중...</div>';

  const fb = await loadFirebase();
  if (!fb) return;

  try {
    if (tab === 'recent') {
      const history = await fb.getMySearchHistory(20);
      historyModalState.favorites = await fb.getMyFavorites(50);

      if (history.length === 0) {
        historyList.innerHTML = '<div class="no-history">검색 기록이 없습니다.</div>';
        return;
      }

      historyList.innerHTML = history.map(item => {
        const isFavorite = historyModalState.favorites.some(f => f.address === item.address);
        return renderHistoryItem(item, isFavorite, 'history');
      }).join('');
    } else {
      const favorites = await fb.getMyFavorites(50);
      historyModalState.favorites = favorites;

      if (favorites.length === 0) {
        historyList.innerHTML = '<div class="no-history">즐겨찾기가 없습니다.</div>';
        return;
      }

      historyList.innerHTML = favorites.map(item => renderHistoryItem(item, true, 'favorite')).join('');
    }
  } catch (error) {
    historyList.innerHTML = '<div class="error-small">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 기록 아이템 렌더링
// 동적 값(문서 ID·주소·메모)은 data-* 속성에만 넣고, 핸들러는 closest('.history-item').dataset에서 읽는다.
// (인라인 JS 문자열에 사용자 데이터를 끼워 넣으면 따옴표·역슬래시로 스크립트 주입이 가능했음)
function renderHistoryItem(item, isFavorite, type) {
  const starClass = isFavorite ? 'active' : '';
  const itemRef = "this.closest('.history-item').dataset";

  const deleteBtn = type === 'history'
    ? `<button class="history-delete" onclick="deleteHistory(${itemRef}.id)" aria-label="기록 삭제">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>`
    : `<button class="history-delete" onclick="deleteFavorite(${itemRef}.id)" aria-label="즐겨찾기 삭제">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>`;

  // 즐겨찾기 탭에서만 메모 표시
  const memoHtml = type === 'favorite' ? `
    <div class="history-memo">
      ${item.memo ? `<span class="memo-preview">${esc(item.memo)}</span>` : '<span class="memo-placeholder">메모 추가</span>'}
      <button class="memo-btn" onclick="event.stopPropagation(); showMemoEditor(${itemRef}.id, ${itemRef}.memo)" title="메모 편집">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>
  ` : '';

  // 지도 버튼
  const mapBtn = `
    <button class="history-map" onclick="event.stopPropagation(); showMapModal(${itemRef}.address)" title="지도">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </button>
  `;

  return `
    <div class="history-item" data-id="${esc(item.id)}" data-address="${esc(item.address || '')}" data-memo="${esc(item.memo || '')}" data-type="${type === 'favorite' ? 'favorite' : 'history'}">
      <button class="history-favorite ${starClass}" onclick="toggleFavorite(${itemRef}.address, this)" aria-label="즐겨찾기">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </button>
      <div class="history-content" onclick="loadHistoryItem(${itemRef}.id, ${itemRef}.type)">
        <div class="history-address">${esc(item.address || '')}</div>
        <div class="history-date">${esc(formatTimestamp(item.createdAt))}</div>
        ${memoHtml}
      </div>
      ${mapBtn}
      ${deleteBtn}
    </div>
  `;
}

// 즐겨찾기 토글
window.toggleFavorite = async function(address, btnElement) {
  const fb = await loadFirebase();
  if (!fb) return;

  const isCurrentlyFavorite = btnElement.classList.contains('active');

  try {
    if (isCurrentlyFavorite) {
      // 즐겨찾기 삭제
      const favorite = historyModalState.favorites.find(f => f.address === address);
      if (favorite) {
        await fb.removeFavorite(favorite.id);
        historyModalState.favorites = historyModalState.favorites.filter(f => f.id !== favorite.id);
      }
      btnElement.classList.remove('active');
      btnElement.querySelector('svg').setAttribute('fill', 'none');

      // 즐겨찾기 탭에서 삭제한 경우 아이템 제거
      if (historyModalState.activeTab === 'favorites') {
        btnElement.closest('.history-item').remove();
        if (document.querySelectorAll('.history-item').length === 0) {
          document.getElementById('historyList').innerHTML = '<div class="no-history">즐겨찾기가 없습니다.</div>';
        }
      }
    } else {
      // 즐겨찾기 추가 - 검색기록에서 buildingData 가져오기
      const history = await fb.getMySearchHistory(50);
      const historyData = history.find(h => h.address === address);

      if (historyData && historyData.buildingData) {
        const favoriteId = await fb.addFavorite(
          { address: historyData.address, jibunAddress: historyData.jibunAddress, roadAddress: historyData.roadAddress, bcode: historyData.bcode },
          historyData.buildingData
        );
        historyModalState.favorites.push({ id: favoriteId, address: address });
      }

      btnElement.classList.add('active');
      btnElement.querySelector('svg').setAttribute('fill', 'currentColor');
    }
  } catch (error) {
    console.error('즐겨찾기 처리 실패:', error);
    alert('즐겨찾기 처리에 실패했습니다.');
  }
};

// 즐겨찾기 삭제
window.deleteFavorite = async function(docId) {
  if (!confirm('즐겨찾기에서 삭제하시겠습니까?')) return;

  const fb = await loadFirebase();
  if (!fb) return;

  try {
    await fb.removeFavorite(docId);
    // UI에서 제거
    const item = document.querySelector(`.history-item[data-id="${docId}"]`);
    if (item) item.remove();

    // 상태에서도 제거
    historyModalState.favorites = historyModalState.favorites.filter(f => f.id !== docId);

    // 남은 즐겨찾기가 없으면 메시지 표시
    const historyList = document.getElementById('historyList');
    if (historyList.querySelectorAll('.history-item').length === 0) {
      historyList.innerHTML = '<div class="no-history">즐겨찾기가 없습니다.</div>';
    }
  } catch (error) {
    alert('삭제에 실패했습니다.');
  }
};

// 타임스탬프 포맷팅
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 검색 기록 항목 불러오기 (저장된 데이터 표시)
window.loadHistoryItem = async function(docId, type = 'history') {
  const fb = await loadFirebase();
  if (!fb) return;

  let item = null;

  if (type === 'favorite') {
    const favorites = await fb.getMyFavorites(50);
    item = favorites.find(f => f.id === docId);
  } else {
    const history = await fb.getMySearchHistory(50);
    item = history.find(h => h.id === docId);
  }

  if (item && item.buildingData) {
    closeHistoryModal();
    currentAppliedDay = ''; // 기록에는 신청일을 저장하지 않으므로 허가일 기준으로 연다
    preLawModalShownFor = '';
    displayAllResults(
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.title } } } },
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.floor } } } },
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.general } } } },
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.permit || [] } } } }
    );
    // 주소창을 연 건물로 맞춘다 (이전 조회의 주소·신청일이 남아 새로고침 때 엉뚱한 건물이 열리지 않도록).
    // 기록에 지역 코드가 없어 주소를 못 맞추더라도 신청일 파라미터는 지운다.
    removeAppliedFromUrl();
    updateUrlWithAddress();

    // 주소 정보 표시
    document.getElementById('addressInput').value = item.address;
    document.getElementById('searchBtn').disabled = false;
  }
};

// 검색 기록 삭제
window.deleteHistory = async function(docId) {
  if (!confirm('이 기록을 삭제하시겠습니까?')) return;

  const fb = await loadFirebase();
  if (!fb) return;

  try {
    await fb.deleteSearchHistory(docId);
    // UI에서 제거
    const item = document.querySelector(`.history-item[data-id="${docId}"]`);
    if (item) item.remove();

    // 남은 기록이 없으면 메시지 표시
    const historyList = document.getElementById('historyList');
    if (historyList.children.length === 0) {
      historyList.innerHTML = '<div class="no-history">검색 기록이 없습니다.</div>';
    }
  } catch (error) {
    alert('삭제에 실패했습니다.');
  }
};

// 모달 닫기
window.closeHistoryModal = function() {
  document.getElementById('historyModal').style.display = 'none';
  // 탭 UI 제거 (다음에 열 때 다시 생성)
  const tabs = document.querySelector('#historyModal .history-tabs');
  if (tabs) tabs.remove();
};

// 카카오 우편번호 서비스 지연 로딩
let daumPostcodeLoaded = false;
function loadDaumPostcode() {
  return new Promise((resolve, reject) => {
    if (daumPostcodeLoaded || (window.daum && window.daum.Postcode)) {
      daumPostcodeLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.onload = () => { daumPostcodeLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('주소 검색 서비스 로드 실패'));
    document.head.appendChild(script);
  });
}

// 주소 검색 (카카오 우편번호 서비스) - embed 방식 (모바일 호환성 개선)
window.searchAddress = async function() {
  const modal = document.getElementById('addressModal');
  const embedLayer = document.getElementById('addressEmbedLayer');

  // 모달 표시
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // 로딩 표시
  embedLayer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);"><div class="spinner"></div><span style="margin-left:12px;">주소 검색 준비 중...</span></div>';

  try {
    await loadDaumPostcode();
  } catch (e) {
    embedLayer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-error);">주소 검색 서비스를 불러올 수 없습니다.</div>';
    return;
  }

  // 기존 내용 초기화
  embedLayer.innerHTML = '';

  // 모달이 렌더링된 후 embed 호출 (모바일 호환성)
  setTimeout(function() {
    new daum.Postcode({
      oncomplete: function(data) {
        // 선택한 주소 정보 저장
        selectedAddressData = {
          address: data.address,
          jibunAddress: data.jibunAddress || data.autoJibunAddress,
          roadAddress: data.roadAddress,
          bcode: data.bcode,
          sigunguCode: data.sigunguCode,
          bname: data.bname,
          buildingName: data.buildingName
        };

        // 주소 표시
        document.getElementById('addressInput').value = data.address;

        // 조회 버튼 활성화
        document.getElementById('searchBtn').disabled = false;

        // 모달 닫기
        closeAddressModal();
      },
      width: '100%',
      height: '100%'
    }).embed(embedLayer);
  }, 100);
};

// 주소 검색 모달 닫기
window.closeAddressModal = function() {
  const modal = document.getElementById('addressModal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('addressEmbedLayer').innerHTML = '';
};

// 건축물대장 조회 (4가지 동시 조회)
window.searchBuilding = async function() {
  if (!selectedAddressData) {
    alert('주소를 먼저 검색해주세요.');
    return;
  }

  // 검색 카운트 증가 및 로그인 배너 트리거
  if (!currentUser) {
    loginPromptManager.incrementSearchCount();
  }

  showLoading(true);
  clearResult();
  currentAppliedDay = ''; // 새 건물 조회 — 이전 건물의 허가 신청일은 버린다
  preLawModalShownFor = '';

  try {
    const bcode = selectedAddressData.bcode;
    const sigunguCd = bcode.substring(0, 5);
    const bjdongCd = bcode.substring(5, 10);
    const jibunInfo = extractJibun(selectedAddressData.jibunAddress);

    // 4가지 API 동시 호출 (표제부 외에는 실패해도 부분 결과 표시)
    const { titleResult, floorResult, generalResult, permitResult, failed } =
      await fetchAllBuildingData(sigunguCd, bjdongCd, jibunInfo);

    displayAllResults(titleResult, floorResult, generalResult, permitResult);
    notifyPartialFailure(failed);

    // URL 업데이트 (공유 링크용)
    updateUrlWithAddress();

    // 비로그인 시 하단 로그인 배너 트리거
    if (!currentUser) {
      loginPromptManager.showLoginBannerIfNeeded();
    }

    // 로그인된 사용자면 검색 기록 저장
    if (currentUser) {
      const fb = await loadFirebase();
      if (fb) {
        const buildingData = {
          title: extractItems(titleResult),
          floor: extractItems(floorResult),
          general: extractItems(generalResult),
          permit: extractItems(permitResult)
        };
        await fb.saveSearchHistory(selectedAddressData, buildingData);
      }
    }
  } catch (error) {
    console.error('API 호출 오류:', error);
    showError('조회 중 오류가 발생했습니다: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// 지번 주소에서 번지·대지구분 추출
// 지번은 주소 끝에 온다: "… 역삼동 737", "… 부암동 산 2-1"(산번지 → platGbCd 1)
function extractJibun(jibunAddress) {
  const empty = { bun: '', ji: '', platGbCd: '0' };
  if (!jibunAddress) return empty;
  const text = String(jibunAddress).trim();
  const match = text.match(/(?:^|\s)(산\s*)?(\d+)(?:-(\d+))?$/);
  if (match) {
    return { bun: match[2] || '', ji: match[3] || '', platGbCd: match[1] ? '1' : '0' };
  }
  // 예외 형식: 첫 번째 '숫자[-숫자]'
  const legacy = text.match(/(\d+)(?:-(\d+))?(?:\s|$)/);
  return legacy ? { bun: legacy[1] || '', ji: legacy[2] || '', platGbCd: '0' } : empty;
}

// 대지구분 코드 정규화 (0: 대지, 1: 산, 2: 블록)
function normalizePlatGbCd(value) {
  return /^[0-2]$/.test(String(value ?? '').trim()) ? String(value).trim() : '0';
}

// 건축물대장 API 오퍼레이션 (functions/api/building/[op].js 와 동일한 목록)
const BUILDING_OPS = {
  title: 'BldRgstHubService/getBrTitleInfo',        // 표제부
  floor: 'BldRgstHubService/getBrFlrOulnInfo',      // 층별개요
  recap: 'BldRgstHubService/getBrRecapTitleInfo',   // 총괄표제부
  permit: 'ArchPmsHubService/getApBasisOulnInfo'    // 건축인허가 기본개요 (허가일)
};

// 자체 프록시 사용 가능 여부 (null: 미확인, false: 미배포·미설정으로 확인됨)
let buildingProxyAvailable = null;

// 건축물대장 API 공통 fetch 함수 (15초 타임아웃)
async function fetchBuildingApi(url, { isProxy = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = new Error(`API 요청 실패 (${response.status})`);
      if (isProxy) {
        // 프록시 미배포(404·405)·키 미설정/인증·한도 오류(503) → 이번 세션은 직접 호출
        if ([404, 405, 503].includes(response.status)) err.proxyUnavailable = true;
        // 그 밖의 일시 오류(5xx·429) → 이번 요청만 직접 호출로 재시도
        else if (response.status >= 500 || response.status === 429) err.proxyRetryDirect = true;
      }
      throw err;
    }
    const data = await response.json();
    // 공공데이터 API 에러 응답 체크
    if (data?.response?.header?.resultCode && data.response.header.resultCode !== '00') {
      throw new Error(`API 오류: ${data.response.header.resultMsg || '알 수 없는 오류'}`);
    }
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new Error('API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
    }
    if (isProxy && e instanceof SyntaxError) {
      // 프록시 경로가 HTML(정적 404 등)을 돌려준 경우
      e.proxyUnavailable = true;
    }
    throw e;
  }
}

// 한 번에 받는 행 수와 최대 페이지 (대단지 층별개요는 수천 행이 될 수 있다)
const BUILDING_PAGE_SIZE = 100;
const BUILDING_MAX_PAGES = 30;
const BUILDING_PAGE_CONCURRENCY = 4;

// 응답의 items.item 을 배열로 (1건이면 객체, 0건이면 빈 문자열로 온다)
function responseItemList(data) {
  const item = data?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

// 오퍼레이션 호출: totalCount 가 한 페이지를 넘으면 나머지 페이지까지 받아 한 응답으로 합친다.
// 뒤 페이지가 실패하면 받은 행만 돌려주고 body._incomplete 에 {fetched, total} 을 남긴다(화면에서 '일부' 안내).
async function fetchBuildingOp(op, sigunguCd, bjdongCd, jibunInfo) {
  const first = await fetchBuildingOpPage(op, sigunguCd, bjdongCd, jibunInfo, 1);
  const body = first?.response?.body;
  const total = Number(body?.totalCount) || 0;
  const items = responseItemList(first);
  if (!body || total <= items.length) return first;

  const lastPage = Math.min(Math.ceil(total / BUILDING_PAGE_SIZE), BUILDING_MAX_PAGES);
  const pages = [];
  for (let pageNo = 2; pageNo <= lastPage; pageNo++) pages.push(pageNo);
  const results = new Map();
  let failedPage = null;
  const worker = async () => {
    while (pages.length && failedPage === null) {
      const pageNo = pages.shift();
      try {
        results.set(pageNo, responseItemList(await fetchBuildingOpPage(op, sigunguCd, bjdongCd, jibunInfo, pageNo)));
      } catch (e) {
        console.warn(`${op} ${pageNo}페이지 조회 실패:`, e);
        failedPage = failedPage === null ? pageNo : Math.min(failedPage, pageNo);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUILDING_PAGE_CONCURRENCY, pages.length) }, worker));

  // 실패한 페이지 앞까지만 순서대로 이어 붙인다 (중간이 빈 목록을 만들지 않도록)
  for (let pageNo = 2; pageNo <= lastPage; pageNo++) {
    if (!results.has(pageNo) || (failedPage !== null && pageNo >= failedPage)) break;
    items.push(...results.get(pageNo));
  }
  body.items = { item: items };
  if (items.length < total) body._incomplete = { fetched: items.length, total };
  return first;
}

// 오퍼레이션 한 페이지 호출: 1순위 자체 프록시(서비스키 비노출), 프록시가 없을 때만 공공데이터포털 직접 호출
async function fetchBuildingOpPage(op, sigunguCd, bjdongCd, jibunInfo, pageNo) {
  const params = new URLSearchParams({ sigunguCd, bjdongCd, platGbCd: normalizePlatGbCd(jibunInfo.platGbCd) });
  if (jibunInfo.bun) params.set('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) params.set('ji', jibunInfo.ji.padStart(4, '0'));
  params.set('pageNo', String(pageNo));

  if (buildingProxyAvailable !== false) {
    try {
      const data = await fetchBuildingApi(`/api/building/${op}?${params.toString()}`, { isProxy: true });
      buildingProxyAvailable = true;
      return data;
    } catch (e) {
      if (!e.proxyUnavailable && !e.proxyRetryDirect) throw e;
      if (e.proxyUnavailable) buildingProxyAvailable = false;
    }
  }

  // 폴백: 직접 호출 (프록시 배포·서비스키 재발급 완료 후 이 경로와 API_KEY를 제거한다)
  const url = new URL(`https://apis.data.go.kr/1613000/${BUILDING_OPS[op]}`);
  url.searchParams.append('serviceKey', API_KEY);
  params.forEach((value, key) => url.searchParams.append(key, value));
  url.searchParams.append('numOfRows', String(BUILDING_PAGE_SIZE));
  url.searchParams.append('_type', 'json');
  return await fetchBuildingApi(url);
}

// 4가지 조회를 동시에 실행한다. 표제부는 필수이고, 층별개요·총괄표제부·건축인허가는
// 공공데이터 API가 일시적으로 실패(빈 응답·503 등)해도 나머지 결과로 화면을 그린다.
async function fetchAllBuildingData(sigunguCd, bjdongCd, jibunInfo) {
  const failed = [];
  const optional = (label, promise) => promise.catch((e) => {
    console.warn(`${label} 조회 실패:`, e);
    failed.push(label);
    return null;
  });
  const [titleResult, floorResult, generalResult, permitResult] = await Promise.all([
    fetchBrTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo),
    optional('층별개요', fetchBrFlrOulnInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo)),
    optional('총괄표제부', fetchBrRecapTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo)),
    optional('건축인허가(허가일)', fetchApBasisOulnInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo))
  ]);
  // 여러 페이지 중 일부만 받은 결과도 안내한다 (예: 층별개요 200/250행)
  [['표제부', titleResult], ['층별개요', floorResult], ['총괄표제부', generalResult], ['건축인허가(허가일)', permitResult]]
    .forEach(([label, result]) => {
      const partial = result?.response?.body?._incomplete;
      if (partial) failed.push(`${label} 일부(${partial.fetched}/${partial.total}행)`);
    });
  return { titleResult, floorResult, generalResult, permitResult, failed };
}

// 일부 조회 실패 안내 (허가일을 못 받으면 적용 기준일이 달라질 수 있으므로 명시)
function notifyPartialFailure(failed) {
  if (!failed || failed.length === 0) return;
  showToast(`일부 정보를 불러오지 못했습니다: ${failed.join(', ')} — 잠시 후 다시 조회해 주세요`);
}

// 표제부 조회 API
async function fetchBrTitleInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  return fetchBuildingOp('title', sigunguCd, bjdongCd, jibunInfo);
}

// 층별 조회 API
async function fetchBrFlrOulnInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  return fetchBuildingOp('floor', sigunguCd, bjdongCd, jibunInfo);
}

// 총괄표제부 조회 API
async function fetchBrRecapTitleInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  return fetchBuildingOp('recap', sigunguCd, bjdongCd, jibunInfo);
}

// 건축인허가 기본개요 조회 API (허가일 정보)
async function fetchApBasisOulnInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  return fetchBuildingOp('permit', sigunguCd, bjdongCd, jibunInfo);
}

// 전역 변수로 상세보기용 데이터 저장
let currentBuildingData = {
  titleItems: [],
  floorItems: [],
  generalItems: [],
  permitItems: [],
  sortedIndices: [] // 정렬된 인덱스 배열
};

// 모든 결과 표시 (요약 카드 형식)
function displayAllResults(titleData, floorData, generalData, permitData) {
  const resultDiv = document.getElementById('result');

  // 데이터 추출
  const titleItems = extractItems(titleData);
  const floorItems = extractItems(floorData);
  const generalItems = extractItems(generalData);
  const permitItems = permitData ? extractItems(permitData) : [];

  // 건축면적(totArea) 기준 내림차순 정렬된 인덱스 배열 생성
  const sortedIndices = titleItems
    .map((item, index) => ({ index, area: Number(item.totArea) || 0 }))
    .sort((a, b) => b.area - a.area)
    .map(item => item.index);

  // 상세보기용 데이터 저장
  currentBuildingData = { titleItems, floorItems, generalItems, permitItems, sortedIndices };

  const buildingCount = titleItems.length;

  if (buildingCount === 0 && generalItems.length === 0) {
    resultDiv.innerHTML = '<div class="no-result">조회 결과가 없습니다.</div>';
    return;
  }

  // 헤더 숨기기
  const header = document.getElementById('mainHeader');
  if (header) header.classList.add('hidden');

  // 직접 입력 링크 숨기기
  const manualLink = document.querySelector('.manual-search-link');
  if (manualLink) manualLink.style.display = 'none';

  renderBuildingView();
}

// 대표 인허가와 판단 기준 허가일
// 건축인허가 API는 신축·증축·대수선·용도변경 이력을 순서 없이 여러 건 돌려주므로 '신축' 중 가장 이른 허가를 쓴다.
// (첫 번째 항목을 쓰면 2001년 준공 건물에 2023년 대수선 허가일이 적용되는 등 기준 법령이 수십 년 어긋남)
function getPrimaryPermitInfo() {
  const { permitItems = [], generalItems = [] } = currentBuildingData || {};
  const selection = selectPrimaryPermit(permitItems);
  const generalInfo = generalItems[0] || {};
  const permitDate = toYmd(selection.item?.archPmsDay) || toYmd(generalInfo.pmsDay) || '';
  return { ...selection, permitInfo: selection.item || {}, permitDate };
}

// 건물 뷰 렌더링 (선택된 건물만 표시)
async function renderBuildingView() {
  const resultDiv = document.getElementById('result');
  const { titleItems, generalItems, permitItems, sortedIndices } = currentBuildingData;
  const buildingCount = titleItems.length;
  const generalInfo = generalItems[0] || {};
  const permitSelection = getPrimaryPermitInfo();

  let html = '';

  // 건축물 수 표시
  html += `
    <div class="building-count-header">
      <div class="count-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 21V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V21M19 21H5M19 21H21M5 21H3M9 7H10M9 11H10M14 7H15M14 11H15M9 21V16C9 15.4477 9.44772 15 10 15H14C14.5523 15 15 15.4477 15 16V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span>해당 주소에 포함된 건축물 수: <strong>${buildingCount || 1}개</strong></span>
    </div>
  `;

  // 광고 배너 표시
  html += renderAdBanner();

  // 총괄 요약 카드 표시 (총괄표제부 기준) - 지연 로드
  html += await renderSummaryCard(generalInfo, permitSelection, titleItems);

  // 비로그인 인라인 배너 (결과 저장 유도)
  if (loginPromptManager.shouldShowResultBanner()) {
    html += `
      <div class="result-login-banner" id="resultLoginBanner">
        <div class="result-login-banner-content">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          <span>로그인하면 이 결과를 저장할 수 있어요</span>
        </div>
        <div class="result-login-banner-actions">
          <button class="result-login-btn" onclick="handleGoogleLogin()">로그인</button>
          <button class="result-login-dismiss" onclick="dismissResultBanner()">닫기</button>
        </div>
      </div>
    `;
  }

  // PDF 다운로드 버튼
  html += `
    <button class="pdf-download-btn" onclick="handlePdfDownload()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/>
        <polyline points="9 15 12 18 15 15"/>
      </svg>
      소방시설 설치기준 PDF 다운로드
      ${!currentUser ? '<span class="pdf-login-badge">로그인 필요</span>' : (() => {
        const { count } = readPdfUsage();
        return `<span class="pdf-remain-badge">${Math.max(0, PDF_DAILY_LIMIT - count)}/${PDF_DAILY_LIMIT}</span>`;
      })()}
    </button>
  `;

  resultDiv.innerHTML = html;

  // 즐겨찾기 상태 비동기 체크 (로그인 상태일 때)
  if (currentUser) {
    checkQuickBookmarkState();
  }
}

// 즐겨찾기 상태 확인하여 별 아이콘 업데이트
async function checkQuickBookmarkState() {
  const btn = document.getElementById('quickBookmarkBtn');
  if (!btn) return;
  const fb = await loadFirebase();
  if (!fb) return;
  const favorites = await fb.getMyFavorites(50);
  const address = currentBuildingData.generalItems?.[0]?.platPlc ||
                  currentBuildingData.titleItems?.[0]?.platPlc ||
                  selectedAddressData?.jibunAddress ||
                  selectedAddressData?.address || '';
  const isFav = favorites.some(f => f.address === address);
  if (isFav) {
    btn.classList.add('active');
    btn.querySelector('svg').setAttribute('fill', 'currentColor');
  }
}

// 건물 선택기 스크롤
window.scrollBuildingSelector = function(direction) {
  const selector = document.getElementById('buildingSelector');
  if (selector) {
    const scrollAmount = 150;
    selector.scrollBy({
      left: direction * scrollAmount,
      behavior: 'smooth'
    });
  }
}

// 요약 카드 렌더링 (총괄표제부 + 표제부 통합)
async function renderSummaryCard(generalInfo, permitSelection, titleItems) {
  // 건물명: 첫 번째 표제부 또는 총괄표제부에서 가져오기
  const mainTitle = titleItems && titleItems.length > 0 ? titleItems[0] : {};
  const buildingName = mainTitle.bldNm || generalInfo.bldNm || selectedAddressData?.buildingName || '건축물 정보';

  // 주용도, 기타용도 (모든 건물의 용도 수집)
  const allPurposes = titleItems && titleItems.length > 0
    ? [...new Set(titleItems.map(t => t.mainPurpsCdNm).filter(Boolean))].join(',')
    : '';
  const mainPurpose = generalInfo.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-';
  const etcPurpose = generalInfo.etcPurps || mainTitle.etcPurps || allPurposes || '-';

  // 주소
  const address = generalInfo.platPlc || mainTitle.platPlc || selectedAddressData?.jibunAddress || selectedAddressData?.address || '-';

  // 허가일, 승인일
  const permitDate = permitSelection.permitDate;
  // 인허가 이력이 여러 건이면 어떤 허가를 기준으로 했는지 표시
  const permitNote = permitSelection.total > 1
    ? `인허가 ${permitSelection.total}건 중 ${permitSelection.reason === 'new' ? '신축' : '가장 이른'} 허가 기준`
    : '';
  const approvalDate = generalInfo.useAprDay || mainTitle.useAprDay || '';

  // 면적 - 총괄표제부 우선, 없으면 표제부 합계
  let totalArea = generalInfo.totArea || '';
  let buildingArea = generalInfo.archArea || '';
  if (!totalArea && titleItems && titleItems.length > 0) {
    totalArea = titleItems.reduce((sum, t) => sum + (Number(t.totArea) || 0), 0);
  }
  if (!buildingArea && titleItems && titleItems.length > 0) {
    buildingArea = titleItems.reduce((sum, t) => sum + (Number(t.archArea) || 0), 0);
  }

  // 세대수 - 총괄표제부 우선, 없으면 표제부 합계
  let households = generalInfo.hhldCnt || '';
  if (!households && titleItems && titleItems.length > 0) {
    households = titleItems.reduce((sum, t) => sum + (Number(t.hhldCnt) || 0), 0);
  }

  // 층수 - 모든 건물 중 최대값
  let groundFloors = generalInfo.grndFlrCnt || '';
  let undergroundFloors = generalInfo.ugrndFlrCnt || '';
  if (titleItems && titleItems.length > 0) {
    const maxGround = Math.max(...titleItems.map(t => Number(t.grndFlrCnt) || 0));
    const maxUnder = Math.max(...titleItems.map(t => Number(t.ugrndFlrCnt) || 0));
    if (!groundFloors || maxGround > Number(groundFloors)) groundFloors = maxGround;
    if (!undergroundFloors || maxUnder > Number(undergroundFloors)) undergroundFloors = maxUnder;
  }

  // 높이 - 모든 건물 중 최대값
  let height = generalInfo.heit || '';
  if (titleItems && titleItems.length > 0) {
    const maxHeight = Math.max(...titleItems.map(t => Number(t.heit) || 0));
    if (!height || maxHeight > Number(height)) height = maxHeight;
  }

  // 구조
  const structure = generalInfo.strctCdNm || mainTitle.strctCdNm || '-';
  const roofStructure = generalInfo.roofCdNm || mainTitle.roofCdNm || '-';

  // 승강기 - 모든 건물 합계
  let passengerElevator = Number(generalInfo.rideUseElvtCnt) || 0;
  let emergencyElevator = Number(generalInfo.emgenUseElvtCnt) || 0;
  if (titleItems && titleItems.length > 0) {
    const sumPassenger = titleItems.reduce((sum, t) => sum + (Number(t.rideUseElvtCnt) || 0), 0);
    const sumEmergency = titleItems.reduce((sum, t) => sum + (Number(t.emgenUseElvtCnt) || 0), 0);
    if (sumPassenger > passengerElevator) passengerElevator = sumPassenger;
    if (sumEmergency > emergencyElevator) emergencyElevator = sumEmergency;
  }

  // 포맷팅
  const fmtDate = (d) => { const v = String(d || ''); return /^\d{8}$/.test(v) ? `${v.substring(0,4)}.${v.substring(4,6)}.${v.substring(6,8)}` : '-'; };
  const fmtArea = (a) => a ? Number(a).toLocaleString('ko-KR', {minimumFractionDigits: 0, maximumFractionDigits: 2}) : '-';
  const fmtHeight = (h) => h ? Number(h).toFixed(2) + 'm' : '-';

  // 주소는 data-address 속성에만 넣고 핸들러는 this.dataset에서 읽는다 (인라인 JS 문자열 삽입 금지)
  let html = `
    <div class="summary-card">
      <div class="summary-header">
        <div class="summary-header-left">
          <div class="summary-building-name">${esc(buildingName)}</div>
          <span class="summary-purpose-badge">${esc(mainPurpose)}</span>
        </div>
        <div class="summary-actions">
          <button class="action-btn" data-address="${esc(address)}" onclick="showMapModal(this.dataset.address)" title="지도">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </button>
          <button class="action-btn" onclick="shareBuilding()" title="공유">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
          <button class="action-btn bookmark-btn" id="quickBookmarkBtn" data-address="${esc(address)}" onclick="handleQuickBookmark(this.dataset.address)" title="즐겨찾기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-grid-item full-width">
          <span class="summary-grid-label">기타용도</span>
          <span class="summary-grid-value">${esc(etcPurpose || '-')}</span>
        </div>
        <div class="summary-grid-item full-width">
          <span class="summary-grid-label">주소</span>
          <span class="summary-grid-value">${esc(address)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">건축허가일</span>
          <span class="summary-grid-value">${esc(fmtDate(permitDate))}</span>
          ${permitNote ? `<span class="summary-grid-note">${esc(permitNote)}</span>` : ''}
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">사용승인일</span>
          <span class="summary-grid-value">${esc(fmtDate(approvalDate))}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">연면적(㎡)</span>
          <span class="summary-grid-value">${fmtArea(totalArea)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">건축면적(㎡)</span>
          <span class="summary-grid-value">${fmtArea(buildingArea)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">세대수</span>
          <span class="summary-grid-value">${esc(households || '-')}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">높이</span>
          <span class="summary-grid-value">${fmtHeight(height)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지상층수</span>
          <span class="summary-grid-value">${esc(groundFloors || '-')}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지하층수</span>
          <span class="summary-grid-value">${esc(undergroundFloors || '-')}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">건축물구조</span>
          <span class="summary-grid-value">${esc(structure)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지붕구조</span>
          <span class="summary-grid-value">${esc(roofStructure)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">승용승강기(대)</span>
          <span class="summary-grid-value">${passengerElevator}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">비상승강기(대)</span>
          <span class="summary-grid-value">${emergencyElevator}</span>
        </div>
      </div>
      <div class="summary-footer">
        <button class="btn-detail-sm" onclick="showGeneralModal()">총괄표제부</button>
        <button class="btn-detail-sm" onclick="showFloorModal(-1)">층별</button>
        <button class="btn-detail-sm" onclick="showTitleModal(-1)">표제부</button>
      </div>
    </div>
  `;

  // 소방시설 카드 지연 로드
  const fireCard = await renderFireFacilitiesCard({
    pmsDay: permitDate,
    appliedDay: currentAppliedDay,
    useAprDay: approvalDate,
    totArea: totalArea,
    grndFlrCnt: groundFloors,
    ugrndFlrCnt: undergroundFloors,
    mainPurpose: mainPurpose,
    heit: height,
    floorItems: currentBuildingData.floorItems
  });

  return html + fireCard;
}


// 표제부 모달 상태 관리
let currentTitleData = {
  items: [],
  selectedIndex: 0,
  pmsDay: null
};

// 표제부 모달 표시
window.showTitleModal = function(buildingIndex) {
  const { titleItems } = currentBuildingData;

  // 허가일 (신축 허가 우선)
  const pmsDay = getPrimaryPermitInfo().permitDate;

  // 상태 저장
  currentTitleData = {
    items: titleItems,
    selectedIndex: buildingIndex >= 0 ? buildingIndex : 0,
    pmsDay: pmsDay
  };

  const html = renderDetailTitleCard(titleItems, currentTitleData.selectedIndex, pmsDay);

  document.getElementById('detailModalTitle').textContent = '표제부 (동별)';
  document.getElementById('detailModalBody').innerHTML = html;
  document.getElementById('detailModal').style.display = 'flex';
};

// 표제부 동 선택 변경
window.changeTitleBuilding = function(index) {
  // 스크롤 위치 저장
  const container = document.getElementById('buildingTabs');
  const scrollLeft = container ? container.scrollLeft : 0;

  currentTitleData.selectedIndex = index;
  const html = renderDetailTitleCard(currentTitleData.items, index, currentTitleData.pmsDay);
  document.getElementById('detailModalBody').innerHTML = html;

  // 스크롤 위치 복원
  const newContainer = document.getElementById('buildingTabs');
  if (newContainer) {
    newContainer.scrollLeft = scrollLeft;
  }
};

// 표제부 동 탭 스크롤
window.scrollBuildingTabs = function(direction) {
  const container = document.getElementById('buildingTabs');
  if (container) {
    const scrollAmount = 120;
    container.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
  }
};

// 층별 모달 상태 관리
let currentFloorData = {
  items: [],
  pmsDay: null,
  sortMode: 'floor-desc' // 'floor-desc', 'floor-asc', 'usage'
};

// 층별 모달 표시
window.showFloorModal = function(buildingIndex) {
  const { titleItems, floorItems } = currentBuildingData;
  const titleItem = buildingIndex >= 0 ? titleItems[buildingIndex] : null;
  const buildingName = titleItem ? (titleItem.dongNm || titleItem.bldNm || '건물') : '전체';

  // 허가일 (신축 허가 우선)
  const pmsDay = getPrimaryPermitInfo().permitDate;

  // 해당 건물의 층별 정보 필터링
  const buildingFloors = buildingIndex >= 0
    ? floorItems.filter(f => f.dongNm === titleItem.dongNm || (!f.dongNm && !titleItem.dongNm))
    : floorItems;

  // 상태 저장
  currentFloorData = {
    items: buildingFloors,
    pmsDay: pmsDay,
    sortMode: 'floor-desc'
  };

  let html = '';

  if (buildingFloors.length > 0) {
    html += renderDetailFloorCard(buildingFloors, pmsDay, 'floor-desc');
  } else {
    html = '<div class="no-result">층별 정보가 없습니다.</div>';
  }

  document.getElementById('detailModalTitle').textContent = `${buildingName} - 층별 개요`;
  document.getElementById('detailModalBody').innerHTML = html;
  document.getElementById('detailModal').style.display = 'flex';
};

// 층별 정렬 모드 변경
window.changeFloorSortMode = function(mode) {
  currentFloorData.sortMode = mode;
  const html = renderDetailFloorCard(currentFloorData.items, currentFloorData.pmsDay, mode);
  document.getElementById('detailModalBody').innerHTML = html;
};

// 총괄표제부 모달 표시
window.showGeneralModal = function() {
  const { generalItems, titleItems } = currentBuildingData;
  const permitInfo = getPrimaryPermitInfo().permitInfo;

  let html = '';

  if (generalItems.length > 0) {
    html += renderDetailGeneralCard(generalItems, permitInfo, titleItems);
  } else {
    html = '<div class="no-result">총괄표제부 정보가 없습니다.</div>';
  }

  document.getElementById('detailModalTitle').textContent = '총괄표제부';
  document.getElementById('detailModalBody').innerHTML = html;
  document.getElementById('detailModal').style.display = 'flex';
};

// 상세보기 모달 닫기
window.closeDetailModal = function() {
  document.getElementById('detailModal').style.display = 'none';
};

// 상세 표제부 카드 렌더링
function renderDetailTitleCard(items, selectedIndex = 0, pmsDay = null) {
  const fmtDate = (d) => { const v = String(d || ''); return /^\d{8}$/.test(v) ? `${v.substring(0,4)}.${v.substring(4,6)}.${v.substring(6,8)}` : '-'; };
  const fmtArea = (a) => a ? Number(a).toLocaleString() : '-';
  const fmtHeight = (h) => h ? Number(h).toFixed(2) + 'm' : '-';

  let html = '';

  // 1. 동 선택 탭 (여러 동이 있을 경우)
  if (items.length > 1) {
    html += `
      <div class="building-tabs-wrapper">
        <button class="scroll-btn" onclick="scrollBuildingTabs(-1)" aria-label="왼쪽">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div class="building-tabs" id="buildingTabs">`;
    items.forEach((item, index) => {
      const name = item.dongNm || item.bldNm || `동 ${index + 1}`;
      html += `
          <button class="building-tab-btn ${index === selectedIndex ? 'active' : ''}"
                  onclick="changeTitleBuilding(${index})">
            ${esc(name)}
          </button>`;
    });
    html += `
        </div>
        <button class="scroll-btn" onclick="scrollBuildingTabs(1)" aria-label="오른쪽">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>`;
  }

  // 선택된 동 정보
  const item = items[selectedIndex] || items[0];
  if (!item) {
    return '<div class="no-result">표제부 정보가 없습니다.</div>';
  }

  // 2. 주요 정보 요약 칩
  html += `
    <div class="info-summary-chips">
      <span class="info-chip primary">${esc(item.mainPurpsCdNm || '-')}</span>
      <span class="info-chip">${esc(item.strctCdNm || '-')}</span>
      <span class="info-chip">지상${esc(item.grndFlrCnt || '-')}층 / 지하${esc(item.ugrndFlrCnt || '-')}층</span>
    </div>`;

  // 3. 규모 정보
  html += `
    <div class="detail-section">
      <div class="floor-group-header">규모 정보</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">높이</span>
          <span class="detail-info-value">${fmtHeight(item.heit)}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지상층수</span>
          <span class="detail-info-value">${esc(item.grndFlrCnt || '-')}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지하층수</span>
          <span class="detail-info-value">${esc(item.ugrndFlrCnt || '-')}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">세대수</span>
          <span class="detail-info-value">${esc(item.hhldCnt || '-')}세대</span>
        </div>
      </div>
    </div>`;

  // 4. 면적 정보
  html += `
    <div class="detail-section">
      <div class="floor-group-header">면적 정보</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">건축면적</span>
          <span class="detail-info-value">${fmtArea(item.archArea)}㎡</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">연면적</span>
          <span class="detail-info-value highlight">${fmtArea(item.totArea)}㎡</span>
        </div>
      </div>
    </div>`;

  // 5. 구조 및 설비
  html += `
    <div class="detail-section">
      <div class="floor-group-header">구조 및 설비</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">주용도</span>
          <span class="detail-info-value">${esc(item.mainPurpsCdNm || '-')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">기타용도</span>
          <span class="detail-info-value">${esc(item.etcPurps || '-')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">구조</span>
          <span class="detail-info-value">${esc(item.strctCdNm || '-')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지붕구조</span>
          <span class="detail-info-value">${esc(item.roofCdNm || '-')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">승용승강기</span>
          <span class="detail-info-value">${esc(item.rideUseElvtCnt || '0')}대</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">비상승강기</span>
          <span class="detail-info-value">${esc(item.emgenUseElvtCnt || '0')}대</span>
        </div>
      </div>
    </div>`;

  // 6. 인허가 정보
  html += `
    <div class="detail-section">
      <div class="floor-group-header">인허가 정보</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">사용승인일</span>
          <span class="detail-info-value">${fmtDate(item.useAprDay)}</span>
        </div>
      </div>
    </div>`;

  return html;
}

// 상세 층별 카드 렌더링
function renderDetailFloorCard(items, pmsDay, sortMode = 'floor-desc') {
  let html = '';

  // 1. 정렬 옵션 버튼 (최상단)
  html += `
    <div class="floor-sort-bar">
      <span class="floor-sort-label">정렬</span>
      <div class="floor-sort-buttons">
        <button class="floor-sort-btn ${sortMode === 'floor-desc' ? 'active' : ''}" onclick="changeFloorSortMode('floor-desc')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12l7 7 7-7"/>
          </svg>
          높은층
        </button>
        <button class="floor-sort-btn ${sortMode === 'floor-asc' ? 'active' : ''}" onclick="changeFloorSortMode('floor-asc')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
          낮은층
        </button>
      </div>
    </div>`;

  // 동별 그룹화
  const dongGroups = {};
  items.forEach(item => {
    const dongName = item.dongNm || '본동';
    if (!dongGroups[dongName]) dongGroups[dongName] = [];
    dongGroups[dongName].push(item);
  });

  // 동 이름 정렬: 숫자 동(6501동, 6502동...) 먼저, 그 다음 부대시설
  const dongNames = Object.keys(dongGroups).sort((a, b) => {
    const aMatch = a.match(/^(\d+)동$/);
    const bMatch = b.match(/^(\d+)동$/);

    // 둘 다 숫자동이면 숫자 순서로
    if (aMatch && bMatch) {
      return Number(aMatch[1]) - Number(bMatch[1]);
    }
    // 숫자동이 먼저
    if (aMatch) return -1;
    if (bMatch) return 1;
    // 둘 다 부대시설이면 가나다 순
    return a.localeCompare(b, 'ko');
  });

  const hasMultipleDongs = dongNames.length > 1;

  // 2. 층별 리스트 (동별 아코디언 또는 단일 동)
  if (hasMultipleDongs) {
    // 여러 동이 있으면 아코디언으로 표시
    html += `<div class="dong-accordion-container">`;

    dongNames.forEach((dongName, index) => {
      const dongFloors = dongGroups[dongName];
      const isFirstDong = index === 0;
      const dongId = `dong-${index}`;

      // 층수 요약 계산
      const groundFloors = dongFloors.filter(f => f.flrGbCdNm !== '지하');
      const undergroundFloors = dongFloors.filter(f => f.flrGbCdNm === '지하');
      const maxGround = groundFloors.length > 0 ? Math.max(...groundFloors.map(f => Number(f.flrNo))) : 0;
      const minGround = groundFloors.length > 0 ? Math.min(...groundFloors.map(f => Number(f.flrNo))) : 0;
      const maxUnderground = undergroundFloors.length > 0 ? Math.max(...undergroundFloors.map(f => Number(f.flrNo))) : 0;

      let floorSummary = '';
      if (maxGround > 0) {
        floorSummary += `${maxGround}F`;
        if (minGround !== maxGround) floorSummary += `~${minGround}F`;
      }
      if (maxUnderground > 0) {
        if (floorSummary) floorSummary += ', ';
        floorSummary += `B${maxUnderground}`;
        if (undergroundFloors.length > 1) {
          const minUnderground = Math.min(...undergroundFloors.map(f => Number(f.flrNo)));
          if (minUnderground !== maxUnderground) floorSummary += `~B${minUnderground}`;
        }
      }

      html += `
        <div class="dong-accordion-item ${isFirstDong ? 'expanded' : ''}" data-dong-id="${dongId}">
          <div class="dong-accordion-header" onclick="toggleDongAccordion('${dongId}')">
            <div class="dong-header-info">
              <span class="dong-name">${esc(dongName)}</span>
              <span class="dong-floor-summary">(${floorSummary || '-'})</span>
            </div>
            <svg class="dong-accordion-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
          <div class="dong-accordion-content">
            ${renderFloorListByMode(dongFloors, sortMode)}
          </div>
        </div>`;
    });

    html += `</div>`;
  } else {
    // 단일 동이면 기존처럼 표시
    html += `<div class="detail-section floor-section-large">`;
    html += renderFloorListByMode(items, sortMode);
    html += `</div>`;
  }

  // 3. 용도별 면적 합계
  const usageSummary = {};
  items.forEach(item => {
    const use = item.mainPurpsCdNm || '기타';
    usageSummary[use] = (usageSummary[use] || 0) + (Number(item.area) || 0);
  });

  html += `<div class="usage-summary">`;
  Object.entries(usageSummary).forEach(([use, area]) => {
    html += `<span class="usage-chip">${esc(use)}: ${area.toLocaleString()}㎡</span>`;
  });
  html += `</div>`;

  return html;
}

// 층별 리스트 렌더링 (동별 내부용)
function renderFloorListByMode(floors, sortMode) {
  let html = '';

  // 층수 기준 정렬 (지상/지하 분리)
  const isDesc = sortMode === 'floor-desc';
  const groundFloors = floors.filter(f => f.flrGbCdNm !== '지하')
    .sort((a, b) => isDesc ? Number(b.flrNo) - Number(a.flrNo) : Number(a.flrNo) - Number(b.flrNo));
  const undergroundFloors = floors.filter(f => f.flrGbCdNm === '지하')
    .sort((a, b) => isDesc ? Number(a.flrNo) - Number(b.flrNo) : Number(b.flrNo) - Number(a.flrNo));

  // 내림차순: 지상 먼저, 오름차순: 지하 먼저
  const sections = isDesc
    ? [{ name: '지상층', floors: groundFloors }, { name: '지하층', floors: undergroundFloors }]
    : [{ name: '지하층', floors: undergroundFloors }, { name: '지상층', floors: groundFloors }];

  sections.forEach(section => {
    if (section.floors.length > 0) {
      html += `<div class="floor-group-header">${section.name}</div>`;
      html += `<div class="detail-floor-list">`;
      section.floors.forEach(item => {
        const floorLabel = item.flrGbCdNm === '지하' ? `B${item.flrNo}` : `${item.flrNo}F`;
        const etcPurps = item.etcPurps ? `<span class="floor-etc">${esc(item.etcPurps)}</span>` : '';
        html += `
          <div class="detail-floor-item">
            <span class="floor-num">${esc(floorLabel)}</span>
            <span class="floor-use">${esc(item.mainPurpsCdNm || '-')}</span>
            ${etcPurps}
            <span class="floor-area">${item.area ? Number(item.area).toLocaleString() : '-'}㎡</span>
          </div>`;
      });
      html += `</div>`;
    }
  });

  return html;
}

// 동별 아코디언 토글 함수
window.toggleDongAccordion = function(dongId) {
  const accordionItem = document.querySelector(`.dong-accordion-item[data-dong-id="${dongId}"]`);
  if (accordionItem) {
    accordionItem.classList.toggle('expanded');
  }
};

// 상세 총괄표제부 카드 렌더링
function renderDetailGeneralCard(items, permitInfo, titleItems = []) {
  const item = items[0];
  const mainTitle = titleItems && titleItems.length > 0 ? titleItems[0] : {};

  // 허가일: 건축인허가정보 API의 archPmsDay 우선, 없으면 총괄표제부의 pmsDay 사용
  const permitDate = permitInfo?.archPmsDay || item.pmsDay;
  const fmtHeight = (h) => h ? Number(h).toFixed(2) + 'm' : '-';
  const fmtArea = (a) => a ? Number(a).toLocaleString() : '-';

  // 표제부 데이터를 fallback으로 사용 (총괄표제부에 없는 경우)
  const structure = item.strctCdNm || mainTitle.strctCdNm || '-';
  const roofStructure = item.roofCdNm || mainTitle.roofCdNm || '-';

  // 층수 - 총괄표제부 우선, 없으면 표제부 최대값
  let grndFlrCnt = item.grndFlrCnt || '';
  let ugrndFlrCnt = item.ugrndFlrCnt || '';
  if (titleItems && titleItems.length > 0) {
    if (!grndFlrCnt) grndFlrCnt = Math.max(...titleItems.map(t => Number(t.grndFlrCnt) || 0));
    if (!ugrndFlrCnt) ugrndFlrCnt = Math.max(...titleItems.map(t => Number(t.ugrndFlrCnt) || 0));
  }

  // 높이 - 총괄표제부 우선, 없으면 표제부 최대값
  let height = item.heit || '';
  if (!height && titleItems && titleItems.length > 0) {
    height = Math.max(...titleItems.map(t => Number(t.heit) || 0));
    if (height === 0) height = '';
  }

  // 승강기 - 총괄표제부 우선, 없으면 표제부 합계
  let rideElvt = Number(item.rideUseElvtCnt) || 0;
  let emgenElvt = Number(item.emgenUseElvtCnt) || 0;
  if (titleItems && titleItems.length > 0) {
    const sumRide = titleItems.reduce((sum, t) => sum + (Number(t.rideUseElvtCnt) || 0), 0);
    const sumEmgen = titleItems.reduce((sum, t) => sum + (Number(t.emgenUseElvtCnt) || 0), 0);
    if (sumRide > rideElvt) rideElvt = sumRide;
    if (sumEmgen > emgenElvt) emgenElvt = sumEmgen;
  }

  let html = '';

  // 1. 주요 정보 요약 칩
  html += `
    <div class="info-summary-chips">
      <span class="info-chip primary">${esc(item.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-')}</span>
      <span class="info-chip">${esc(structure)}</span>
      <span class="info-chip">지상${esc(grndFlrCnt || '-')}층 / 지하${esc(ugrndFlrCnt || '-')}층</span>
    </div>`;

  // 2. 규모 정보
  html += `
    <div class="detail-section">
      <div class="floor-group-header">규모 정보</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">높이</span>
          <span class="detail-info-value">${fmtHeight(height)}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지상층수</span>
          <span class="detail-info-value">${esc(grndFlrCnt || '-')}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지하층수</span>
          <span class="detail-info-value">${esc(ugrndFlrCnt || '-')}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">세대수</span>
          <span class="detail-info-value">${esc(item.hhldCnt || '-')}세대</span>
        </div>
      </div>
    </div>`;

  // 3. 면적 정보
  html += `
    <div class="detail-section">
      <div class="floor-group-header">면적 정보</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">대지면적</span>
          <span class="detail-info-value">${fmtArea(item.platArea)}㎡</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">건축면적</span>
          <span class="detail-info-value">${fmtArea(item.archArea)}㎡</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">연면적</span>
          <span class="detail-info-value highlight">${fmtArea(item.totArea)}㎡</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">용적률</span>
          <span class="detail-info-value">${esc(item.vlRat || '-')}%</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">건폐율</span>
          <span class="detail-info-value">${esc(item.bcRat || '-')}%</span>
        </div>
      </div>
    </div>`;

  // 4. 구조 및 설비
  html += `
    <div class="detail-section">
      <div class="floor-group-header">구조 및 설비</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">주용도</span>
          <span class="detail-info-value">${esc(item.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">기타용도</span>
          <span class="detail-info-value">${esc(item.etcPurps || mainTitle.etcPurps || '-')}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">구조</span>
          <span class="detail-info-value">${esc(structure)}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지붕구조</span>
          <span class="detail-info-value">${esc(roofStructure)}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">승용승강기</span>
          <span class="detail-info-value">${rideElvt}대</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">비상승강기</span>
          <span class="detail-info-value">${emgenElvt}대</span>
        </div>
      </div>
    </div>`;

  // 5. 인허가 정보
  html += `
    <div class="detail-section">
      <div class="floor-group-header">인허가 정보</div>
      <div class="detail-info-list">
        <div class="detail-info-item">
          <span class="detail-info-label">허가일</span>
          <span class="detail-info-value">${formatDate(permitDate)}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">착공일</span>
          <span class="detail-info-value">${formatDate(item.stcnsDay)}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">사용승인일</span>
          <span class="detail-info-value">${formatDate(item.useAprDay)}</span>
        </div>
      </div>
    </div>`;

  return html;
}

// API 응답에서 items 추출
function extractItems(data) {
  if (!data?.response?.header || data.response.header.resultCode !== '00') {
    return [];
  }
  const body = data.response.body;
  if (!body?.items?.item) return [];
  return Array.isArray(body.items.item) ? body.items.item : [body.items.item];
}

// 날짜 포맷팅 (YYYYMMDD -> YYYY.MM.DD)
function formatDate(dateStr) {
  const v = String(dateStr || '');
  if (!/^\d{8}$/.test(v)) return '-';
  return `${v.substring(0, 4)}.${v.substring(4, 6)}.${v.substring(6, 8)}`;
}

// 로딩 표시
function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'block' : 'none';
  // 로딩 중이면 비활성화, 아니면 주소 선택 여부에 따라 결정
  document.getElementById('searchBtn').disabled = show || !selectedAddressData;
}

// 결과 초기화
function clearResult() {
  document.getElementById('result').innerHTML = '';
}

// 에러 표시
function showError(message) {
  // API 오류 메시지(resultMsg 등 외부 문자열)가 포함될 수 있으므로 이스케이프
  document.getElementById('result').innerHTML = `<div class="error-message">${esc(message)}</div>`;
}

// ==================== 로그인 유도 핸들러 ====================

// 인라인 결과 배너 닫기
window.dismissResultBanner = function() {
  loginPromptManager.dismissResultBanner();
  const banner = document.getElementById('resultLoginBanner');
  if (banner) banner.remove();
};

// 하단 고정 로그인 배너 닫기
window.dismissLoginBanner = function() {
  loginPromptManager.dismissLoginBanner();
  loginPromptManager.hideLoginBanner();
};

// 즐겨찾기 바로 추가
window.handleQuickBookmark = async function(address) {
  if (!currentUser) {
    showLoginRequiredToast('즐겨찾기를 사용하려면 로그인이 필요합니다');
    return;
  }

  const btn = document.getElementById('quickBookmarkBtn');
  if (!btn) return;

  const fb = await loadFirebase();
  if (!fb) return;

  const isActive = btn.classList.contains('active');

  try {
    if (isActive) {
      // 즐겨찾기 삭제
      const favorites = await fb.getMyFavorites(50);
      const fav = favorites.find(f => f.address === address);
      if (fav) {
        await fb.removeFavorite(fav.id);
      }
      btn.classList.remove('active');
      btn.querySelector('svg').setAttribute('fill', 'none');
      showToast('즐겨찾기에서 삭제했습니다');
    } else {
      // 즐겨찾기 추가
      const addrData = selectedAddressData || {
        address: address,
        jibunAddress: address,
        roadAddress: '',
        bcode: ''
      };
      const buildingData = {
        title: currentBuildingData.titleItems,
        floor: currentBuildingData.floorItems,
        general: currentBuildingData.generalItems,
        permit: currentBuildingData.permitItems
      };
      await fb.addFavorite(addrData, buildingData);
      btn.classList.add('active');
      btn.querySelector('svg').setAttribute('fill', 'currentColor');
      showToast('즐겨찾기에 추가했습니다');
    }
  } catch (error) {
    console.error('즐겨찾기 처리 실패:', error);
    showToast('즐겨찾기 처리에 실패했습니다');
  }
};

// PDF 일일 사용량 (localStorage, 한국시간 기준). 손상된 값·저장 불가 환경은 0회로 간주한다.
// ※ 브라우저 저장소 기반이라 강제력은 없음 — 정책 편의 기능이며 보안 경계가 아니다.
const PDF_DAILY_LIMIT = 5;
const PDF_USAGE_KEY = 'pdf_download_count';

function readPdfUsage() {
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(PDF_USAGE_KEY) || 'null');
  } catch {
    data = null;
  }
  const count = data && data.date === today ? Math.max(0, Number(data.count) || 0) : 0;
  return { today, count };
}

function writePdfUsage(today, count) {
  try {
    localStorage.setItem(PDF_USAGE_KEY, JSON.stringify({ date: today, count }));
  } catch {
    // 저장 불가(사생활 보호 모드 등) — 무시
  }
}

// PDF 다운로드 (window.print 기반)
window.handlePdfDownload = function() {
  if (!currentUser) {
    showLoginRequiredToast('PDF 다운로드는 로그인 후 이용할 수 있습니다');
    return;
  }

  // 무료사용자 일일 5회 제한 확인 (실제 차감·재확인은 _executePdfDownload에서)
  const { count: used } = readPdfUsage();
  if (used >= PDF_DAILY_LIMIT) {
    showToast(`일일 PDF 다운로드 한도(${PDF_DAILY_LIMIT}회)를 초과했습니다`);
    return;
  }

  // 이번 다운로드 후 남는 횟수
  const remaining = PDF_DAILY_LIMIT - used - 1;

  // 확인 모달 표시
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.id = 'pdfConfirmModal';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:340px;">
      <div class="modal-header">
        <h2>PDF 다운로드</h2>
        <button class="modal-close" onclick="document.getElementById('pdfConfirmModal').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body" style="text-align:center;padding:24px 20px;">
        <div style="font-size:36px;margin-bottom:12px;">📄</div>
        <div style="font-size:15px;color:var(--text-primary);font-weight:600;margin-bottom:6px;">
          오늘 ${used}회 사용 / ${PDF_DAILY_LIMIT}회 중
        </div>
        <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:20px;">
          다운로드 후 <strong>${remaining}회</strong> 남습니다
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="document.getElementById('pdfConfirmModal').remove()"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-secondary);font-size:14px;font-weight:600;cursor:pointer;">
            취소
          </button>
          <button onclick="document.getElementById('pdfConfirmModal').remove(); _executePdfDownload();"
            style="flex:1;padding:12px;border-radius:10px;border:none;background:#3182f6;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">
            다운로드
          </button>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// 실제 PDF 생성 실행
window._executePdfDownload = async function() {
  if (!currentUser) {
    showLoginRequiredToast('PDF 다운로드는 로그인 후 이용할 수 있습니다');
    return;
  }
  // 한도 확인은 확인 모달이 아니라 실제 생성 함수에서 한다 (전역 함수 직접 호출로 우회 방지)
  const { today, count } = readPdfUsage();
  if (count >= PDF_DAILY_LIMIT) {
    showToast(`일일 PDF 다운로드 한도(${PDF_DAILY_LIMIT}회)를 초과했습니다`);
    return;
  }
  // 팝업은 첫 await 이전(클릭 처리 중)에 열어야 차단되지 않는다. 차단되면 횟수를 차감하지 않음
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('팝업이 차단되어 PDF 창을 열 수 없습니다. 팝업을 허용한 뒤 다시 시도해주세요.');
    return;
  }
  writePdfUsage(today, count + 1);

  showToast('PDF 생성 중...');

  const { titleItems, floorItems, generalItems } = currentBuildingData;
  const generalInfo = generalItems[0] || {};
  const mainTitle = titleItems[0] || {};

  const buildingName = mainTitle.bldNm || generalInfo.bldNm || selectedAddressData?.buildingName || '건축물';
  const address = generalInfo.platPlc || mainTitle.platPlc || selectedAddressData?.jibunAddress || '';
  const mainPurpose = generalInfo.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-';
  const etcPurpose = generalInfo.etcPurps || mainTitle.etcPurps || '-';
  const permitDate = getPrimaryPermitInfo().permitDate;
  const approvalDate = generalInfo.useAprDay || mainTitle.useAprDay || '';
  const structure = generalInfo.strctCdNm || mainTitle.strctCdNm || '-';

  let totalArea = generalInfo.totArea || '';
  let buildingArea = generalInfo.archArea || '';
  if (!totalArea && titleItems.length > 0) totalArea = titleItems.reduce((s, t) => s + (Number(t.totArea) || 0), 0);
  if (!buildingArea && titleItems.length > 0) buildingArea = titleItems.reduce((s, t) => s + (Number(t.archArea) || 0), 0);

  let groundFloors = generalInfo.grndFlrCnt || '';
  let undergroundFloors = generalInfo.ugrndFlrCnt || '';
  if (titleItems.length > 0) {
    const maxG = Math.max(...titleItems.map(t => Number(t.grndFlrCnt) || 0));
    const maxU = Math.max(...titleItems.map(t => Number(t.ugrndFlrCnt) || 0));
    if (!groundFloors || maxG > Number(groundFloors)) groundFloors = maxG;
    if (!undergroundFloors || maxU > Number(undergroundFloors)) undergroundFloors = maxU;
  }

  let height = generalInfo.heit || '';
  if (titleItems.length > 0) {
    const maxH = Math.max(...titleItems.map(t => Number(t.heit) || 0));
    if (!height || maxH > Number(height)) height = maxH;
  }

  const fmtDate = (d) => { const v = String(d || ''); return /^\d{8}$/.test(v) ? `${v.substring(0,4)}.${v.substring(4,6)}.${v.substring(6,8)}` : '-'; };
  const fmtArea = (a) => a ? Number(a).toLocaleString('ko-KR', {minimumFractionDigits: 0, maximumFractionDigits: 2}) : '-';
  const fmtHeight = (h) => h ? Number(h).toFixed(2) + 'm' : '-';

  // --- 표제부 (동별) 요약 ---
  let titleSummaryHtml = '';
  if (titleItems.length > 0) {
    titleSummaryHtml = `<h2>표제부 (동별 요약)</h2><table>
      <thead><tr><th>동명</th><th>주용도</th><th>연면적(㎡)</th><th>지상/지하</th><th>높이</th></tr></thead><tbody>`;
    titleItems.forEach(t => {
      const name = t.dongNm || t.bldNm || '-';
      titleSummaryHtml += `<tr>
        <td>${esc(name)}</td>
        <td>${esc(t.mainPurpsCdNm || '-')}</td>
        <td>${fmtArea(t.totArea)}</td>
        <td>${esc(t.grndFlrCnt || '-')}층 / B${esc(t.ugrndFlrCnt || '-')}</td>
        <td>${fmtHeight(t.heit)}</td>
      </tr>`;
    });
    titleSummaryHtml += `</tbody></table>`;
  }

  // --- 층별 개요 ---
  let floorSummaryHtml = '';
  if (floorItems.length > 0) {
    // 동별 그룹화
    const dongGroups = {};
    floorItems.forEach(item => {
      const dong = item.dongNm || '본동';
      if (!dongGroups[dong]) dongGroups[dong] = [];
      dongGroups[dong].push(item);
    });

    floorSummaryHtml = `<h2>층별 개요</h2>`;
    for (const [dongName, floors] of Object.entries(dongGroups)) {
      const ground = floors.filter(f => f.flrGbCdNm !== '지하').sort((a, b) => Number(b.flrNo) - Number(a.flrNo));
      const underground = floors.filter(f => f.flrGbCdNm === '지하').sort((a, b) => Number(a.flrNo) - Number(b.flrNo));
      const sorted = [...ground, ...underground];

      if (Object.keys(dongGroups).length > 1) {
        floorSummaryHtml += `<h3 style="font-size:13px;color:#4e5968;margin:16px 0 6px;">${esc(dongName)}</h3>`;
      }
      floorSummaryHtml += `<table><thead><tr><th>층</th><th>용도</th><th>면적(㎡)</th></tr></thead><tbody>`;
      sorted.forEach(f => {
        const label = f.flrGbCdNm === '지하' ? `B${f.flrNo}` : `${f.flrNo}F`;
        floorSummaryHtml += `<tr><td>${esc(label)}</td><td>${esc(f.mainPurpsCdNm || '-')}${f.etcPurps ? ' / ' + esc(f.etcPurps) : ''}</td><td>${f.area ? Number(f.area).toLocaleString() : '-'}</td></tr>`;
      });
      floorSummaryHtml += `</tbody></table>`;
    }
  }

  // --- 소방시설 목록 ---
  let facilitiesHtml = '';
  const facResult = currentFacilitiesResult;
  if (facResult && facResult.facilities) {
    const required = facResult.facilities.filter(f => f.required);
    const optional = facResult.facilities.filter(f => !f.required);
    const pDate = facResult.referenceDate || facResult.permitDate;

    if (required.length > 0) {
      facilitiesHtml += `<h2>설치 검토 대상 소방시설 (${required.length}개)</h2><p class="optional-list">※ 기준일 당시 이 용도에 설치 기준이 있는 시설입니다. 연면적·층수 등 세부 조건 충족 여부는 설치 기준을 확인하세요.</p><table>
        <thead><tr><th>시설명</th><th>설치 기준</th></tr></thead><tbody>`;
      for (const f of required) {
        const allRegs = f.allRegulations || f.regulations || [];
        const applicable = getApplicableRegulations(allRegs, pDate);
        const criteria = applicable.length > 0
          ? applicable.map(r => {
              let dateInfo = '';
              if (r.start_date) {
                dateInfo = r.end_date ? ` <span class="reg-date">(${formatPermitDate(r.start_date)} ~ ${formatPermitDate(r.end_date)})</span>` : ` <span class="reg-date">(${formatPermitDate(r.start_date)}~)</span>`;
              }
              return esc(r.criteria) + dateInfo;
            }).join('<br>')
          : '-';
        facilitiesHtml += `<tr><td class="fname">${esc(f.name)}</td><td>${criteria}</td></tr>`;
      }
      facilitiesHtml += `</tbody></table>`;
    }

    // --- 면제기준 수집 ---
    let exemptionHtml = '';
    for (const f of required) {
      const rules = await getExemptionRulesForFacility(f.name, pDate);
      if (rules.length > 0) {
        const fmtRule = (rule) => {
          let info = esc(rule.criteria);
          const parts = [];
          if (rule.source) parts.push(esc(rule.source));
          if (rule.start_date) parts.push(rule.end_date ? `${formatPermitDate(rule.start_date)} ~ ${formatPermitDate(rule.end_date)}` : `${formatPermitDate(rule.start_date)}~`);
          if (parts.length > 0) info += ` <span class="reg-date">(${parts.join(', ')})</span>`;
          return info;
        };
        exemptionHtml += `<tr><td class="fname" rowspan="${rules.length}">${esc(f.name)}</td><td>${fmtRule(rules[0])}</td></tr>`;
        for (let i = 1; i < rules.length; i++) {
          exemptionHtml += `<tr><td>${fmtRule(rules[i])}</td></tr>`;
        }
      }
    }
    if (exemptionHtml) {
      facilitiesHtml += `<h2>면제 기준 (예외 조항)</h2><table>
        <thead><tr><th>시설명</th><th>면제 조건</th></tr></thead><tbody>${exemptionHtml}</tbody></table>`;
    }

    if (optional.length > 0) {
      facilitiesHtml += `<h2>해당 시기 기준 없음 (${optional.length}개)</h2>
        <p class="optional-list">${optional.map(f => esc(f.name)).join(', ')}</p>`;
    }
  }

  // --- 적용 법령 (국가법령정보센터 연혁 데이터 기준) ---
  const lawBaseDate = facResult?.referenceDate || facResult?.permitDate || permitDate;
  // 비고: 판단 기준일과 허가 신청일 경계 (결과 카드와 같은 내용)
  let lawNote = '건축허가일 기준으로 판단했습니다. 개정 부칙의 적용례는 대개 허가 신청일 기준이므로, 개정 시행일 전후 건축물은 신청일을 확인하세요.';
  if (facResult?.usedApprovalDate) {
    lawNote = '허가일이 조회되지 않아 사용승인일 기준으로 판단했습니다. 허가일이 더 이르면 결과가 달라질 수 있습니다.';
  } else if (facResult?.appliedDate) {
    lawNote = `허가 신청일 ${formatPermitDate(facResult.appliedDate)} 기준으로 판단했습니다(허가일 ${formatPermitDate(facResult.permitDate)}). 개정마다 적용 기준이 다를 수 있으니 부칙을 확인하세요.`;
  } else if (facResult?.fireData && toYmd(facResult.permitDate)) {
    const boundaries = findCriteriaBoundaries(facResult.fireData, facResult.permitDate, APPLICATION_WINDOW_DAYS);
    if (boundaries.length > 0) {
      const list = boundaries.flatMap((b) => b.facilities.map((f) => `${f.name}(${formatPermitDate(b.date)} 변경)`));
      lawNote = `건축허가일 기준으로 판단했습니다. 허가일 전 ${APPLICATION_WINDOW_DAYS}일 안에 ${list.join(', ')} 기준이 바뀌었으므로, 허가 신청일이 바뀐 날짜보다 앞서면 종전 기준이 적용될 수 있습니다.`;
    }
  }
  let lawHtml = '';
  if (toYmd(lawBaseDate)) {
    const actEra = getActNameAt(lawBaseDate);
    let versionRows = '';
    if (lawBaseDate >= FIRE_ACT_START) {
      try {
        const [actData, decreeData, rulesData] = await Promise.all([
          getLawHistoryData('act'), getLawHistoryData('decree'), getLawHistoryData('rules')
        ]);
        const fmtVersion = (label, v) => v
          ? `<tr><th>${label}</th><td>${esc(String(v.law_no).replace(/^.*?(제\s*[\d-]+호)$/, '$1'))} (${formatPermitDate(v.promulgation_date)} 공포, ${formatPermitDate(v.effective_date)} 시행)</td></tr>`
          : '';
        versionRows = fmtVersion('법률', findApplicableVersion(actData, lawBaseDate))
          + fmtVersion('시행령', findApplicableVersion(decreeData, lawBaseDate))
          + fmtVersion('시행규칙', findApplicableVersion(rulesData, lawBaseDate));
      } catch (e) {
        console.warn('법령 연혁 로드 실패:', e);
      }
    }
    lawHtml = `<h2>적용 소방법령 (기준일 ${formatPermitDate(lawBaseDate)})</h2><table>
      <tr><th>법률명</th><td>${esc(actEra.name)}</td></tr>
      ${versionRows}
      <tr><th>비고</th><td>${esc(lawNote)}</td></tr>
    </table>`;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${esc(buildingName)} - 소방시설 설치기준</title>
  <style>
    body { font-family: -apple-system, 'Noto Sans KR', sans-serif; padding: 60px 40px 40px; color: #191f28; line-height: 1.6; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 15px; margin: 28px 0 10px; color: #4e5968; border-bottom: 2px solid #3182f6; padding-bottom: 8px; }
    .subtitle { color: #8b95a1; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; }
    th, td { padding: 8px 10px; border: 1px solid #e5e8eb; text-align: left; vertical-align: top; }
    th { background: #f7f8fa; font-weight: 600; color: #4e5968; white-space: nowrap; }
    thead th { background: #3182f6; color: #fff; font-size: 12px; }
    .fname { font-weight: 600; white-space: nowrap; }
    .optional-list { font-size: 13px; color: #6b7684; line-height: 1.8; }
    .reg-date { font-size: 11px; color: #8b95a1; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e8eb; font-size: 11px; color: #8b95a1; text-align: center; }
    @media print {
      body { padding: 40px 20px 20px; }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${esc(buildingName)}</h1>
  <div class="subtitle">소방시설 설치기준 조회 결과 | ${new Date().toLocaleDateString('ko-KR')} | sobangcheck.com</div>

  <h2>건축물 개요</h2>
  <table>
    <tr><th>주소</th><td colspan="3">${esc(address)}</td></tr>
    <tr><th>주용도</th><td>${esc(mainPurpose)}</td><th>기타용도</th><td>${esc(etcPurpose)}</td></tr>
    <tr><th>건축허가일</th><td>${fmtDate(permitDate)}</td><th>사용승인일</th><td>${fmtDate(approvalDate)}</td></tr>
    ${facResult?.appliedDate ? `<tr><th>허가 신청일</th><td colspan="3">${fmtDate(facResult.appliedDate)} (입력한 날짜 — 이 날짜 기준으로 판단)</td></tr>` : ''}
    <tr><th>연면적</th><td>${fmtArea(totalArea)} ㎡</td><th>건축면적</th><td>${fmtArea(buildingArea)} ㎡</td></tr>
    <tr><th>층수</th><td>지상 ${esc(groundFloors || '-')}층 / 지하 ${esc(undergroundFloors || '-')}층</td><th>높이</th><td>${fmtHeight(height)}</td></tr>
    <tr><th>구조</th><td colspan="3">${esc(structure)}</td></tr>
  </table>

  ${titleSummaryHtml}
  ${floorSummaryHtml}
  ${lawHtml}
  ${facilitiesHtml}

  <div class="footer">
    소방체크 (sobangcheck.com) | 이 자료는 참고용이며 법적 효력이 없습니다.<br>
    실제 소방점검이나 인허가 절차에서는 관할 소방서의 공식 확인을 받으시기 바랍니다.
  </div>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 500);
};

// 로그인 필요 토스트 (로그인 버튼 포함)
function showLoginRequiredToast(message) {
  // 기존 토스트 제거
  const existing = document.querySelector('.login-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'login-toast';
  toast.innerHTML = `
    <span>${esc(message)}</span>
    <button onclick="this.parentElement.remove(); handleGoogleLogin();">로그인</button>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ==================== 특정소방대상물 분류 ====================

// 주용도 → 화면 표시용 분류 { class, category } (js/lib/building-types.js)
function getFireTargetClassification(mainPurpose) {
  return classifyPurpose(mainPurpose);
}

// 주용도 → 소방 데이터 용도 (목록에 없으면 null — 추측 매핑하지 않음)
function mapPurposeToFireDataType(mainPurpose) {
  return mapPurposeToFireType(mainPurpose);
}

// ==================== 필수 소방시설 판단 ====================

// 허가일 기준 필수 소방시설 판단 (JSON 데이터 기반)
async function getRequiredFireFacilities(buildingInfo) {
  const {
    pmsDay,           // 허가일 (YYYYMMDD)
    useAprDay,        // 사용승인일 (YYYYMMDD)
    totArea,          // 연면적 (㎡)
    grndFlrCnt,       // 지상층수
    ugrndFlrCnt,      // 지하층수
    mainPurpose,      // 주용도
    heit              // 높이 (m)
  } = buildingInfo;

  // 허가일이 없으면 사용승인일 사용
  const hasPermitDate = !!toYmd(pmsDay);
  const effectiveDate = hasPermitDate ? toYmd(pmsDay) : toYmd(useAprDay);
  const usedApprovalDate = !hasPermitDate && !!effectiveDate; // 사용승인일 사용 여부

  // 허가 신청일을 입력했으면 그 날짜로 기준 행을 고른다 (부칙 적용례는 대개 신청일 기준).
  // 실제 날짜가 아니거나 허가일보다 늦은 신청일, 허가일 없이 넣은 신청일은 쓰지 않는다.
  const candidateApplied = parseYmdInput(buildingInfo.appliedDay);
  const appliedDate = hasPermitDate && candidateApplied && candidateApplied <= effectiveDate ? candidateApplied : '';
  const referenceDate = appliedDate || effectiveDate;

  const permitDate = parseInt(referenceDate) || 0;
  const totalArea = parseFloat(totArea) || 0;
  const groundFloors = parseInt(grndFlrCnt) || 0;
  const undergroundFloors = parseInt(ugrndFlrCnt) || 0;
  const height = parseFloat(heit) || 0;

  const classification = getFireTargetClassification(mainPurpose);
  const buildingType = mapPurposeToFireDataType(mainPurpose);

  const facilities = [];

  // 시설 마스터 데이터 + 건물 유형 데이터 지연 로드
  const [fireData] = await Promise.all([
    buildingType ? getFireFacilityData(buildingType) : null,
    getFacilitiesMasterData()
  ]);

  // JSON 데이터가 있으면 해당 데이터 사용
  if (fireData) {

    fireData.fire_facilities.forEach(facility => {
      // 허가일에 맞는 규정만 필터링
      const applicableRegs = facility.regulations.filter(reg => {
        const startDate = reg.start_date ? parseInt(reg.start_date) : 0;
        const endDate = reg.end_date ? parseInt(reg.end_date) : 99999999;

        // 허가일이 있으면 범위 내 체크
        if (permitDate > 0) {
          return permitDate >= startDate && permitDate <= endDate;
        }
        // 허가일이 없으면 현재 적용 중인 규정만
        return !reg.end_date;
      });

      // 시설 정보 생성
      const facilityInfo = {
        name: facility.facility_name,
        category: facility.category,
        required: applicableRegs.length > 0,
        regulations: applicableRegs,
        allRegulations: facility.regulations, // 모든 규정 (모달 표시용)
        reason: applicableRegs.length > 0
          ? applicableRegs[0].criteria
          : '해당없음',
        icon: getFacilityIcon(facility.facility_name)
      };

      facilities.push(facilityInfo);
    });
  }
  // 기준 데이터가 없는 용도(매핑 불가)·로드 실패는 추측 결과를 만들지 않고 화면에서 안내한다

  return {
    classification,
    buildingType,
    unmapped: !buildingType,          // 주용도에 해당하는 기준 데이터 없음
    loadFailed: !!buildingType && !fireData,
    fireData,                   // 허가 신청일 경계 계산용 (용도별 기준 데이터)
    facilities,
    permitDate: effectiveDate,  // 대장의 날짜 (허가일 우선, 없으면 사용승인일)
    appliedDate,                // 입력한 허가 신청일 (쓰지 않았으면 '')
    referenceDate,              // 기준 행을 고른 날짜 = 신청일 || permitDate
    usedApprovalDate,           // 사용승인일 사용 여부
    summary: {
      totalArea,
      groundFloors,
      undergroundFloors,
      height
    }
  };
}

// 현재 시설 데이터 저장 (모달 표시용)
let currentFacilitiesResult = null;

// 소방시설 카드 렌더링
// 소방법 이전 건축물 안내 모달
function showPreLawModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:440px;">
        <div class="modal-body" style="padding:24px;">
          <div style="text-align:center;margin-bottom:16px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h3 style="text-align:center;margin:0 0 12px;font-size:17px;color:var(--text-primary);">소방법 시행령 제정 이전 건축물</h3>
          <p style="font-size:14px;line-height:1.7;color:var(--text-secondary);margin:0 0 8px;text-align:center;">
            이 건축물은 소방시설 설치에 대한 법적 기준이<br>제한적이던 시기에 허가되었습니다.
          </p>
          <div style="background:var(--bg-tertiary);border-radius:10px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.6;color:var(--text-secondary);">
            <p style="margin:0 0 8px;"><strong style="color:var(--text-primary);">안내사항</strong></p>
            <p style="margin:0;">아래 표시되는 소방시설은 허가일 당시 기준이며, 현행 법령에 따른 <strong style="color:var(--color-primary);">소급 적용 대상</strong>이 있을 수 있습니다. 정확한 설치 의무는 관할 소방서에 확인하시기 바랍니다.</p>
          </div>
          <button onclick="this.closest('.modal').remove()" style="width:100%;padding:14px;border:none;border-radius:12px;background:var(--color-primary);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">확인</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(); }
    });
    overlay.querySelector('button').addEventListener('click', () => resolve());
    document.body.appendChild(overlay);
  });
}

// 층별 용도가 둘 이상이면 복합건축물 해당 여부 안내 (부속 주차장은 제외)
function getMixedUseTypes(floorItems) {
  const types = new Set();
  for (const f of floorItems || []) {
    const t = mapPurposeToFireType(f.mainPurpsCdNm);
    if (t && t !== '항공기및자동차관련시설' && t !== '복합건축물') types.add(t);
  }
  return types.size >= 2 ? [...types] : null;
}

async function renderFireFacilitiesCard(buildingInfo) {
  const result = await getRequiredFireFacilities(buildingInfo);
  const {
    classification, facilities, permitDate, appliedDate, referenceDate, usedApprovalDate, unmapped, loadFailed, fireData
  } = result;

  // 소방법 이전 건축물이면 안내 모달 표시 (같은 건물을 다시 그릴 때는 한 번만)
  if (permitDate && parseInt(permitDate) <= 19750831 && preLawModalShownFor !== permitDate) {
    preLawModalShownFor = permitDate;
    await showPreLawModal();
  }

  // 모달에서 사용할 수 있도록 저장
  currentFacilitiesResult = result;

  // 링크로 받은 허가 신청일을 쓰지 못했으면(허가일보다 늦음·허가일 없음) 상태와 주소창에서 지운다.
  // 허가일이 없을 때는 카드의 사용승인일 경고와 조회 실패 알림이 이유를 알려 주므로 토스트로 덮지 않는다
  // (토스트는 하나만 보인다).
  if (buildingInfo.appliedDay && !appliedDate) {
    currentAppliedDay = '';
    removeAppliedFromUrl();
    if (!usedApprovalDate && permitDate) {
      showToast(`허가 신청일이 허가일(${formatPermitDate(permitDate)})보다 늦어 허가일 기준으로 표시합니다.`);
    }
  }

  const dateLabel = usedApprovalDate ? '기준일(사용승인일)' : (appliedDate ? '허가 신청일' : '건축허가일');
  const preFireAct = !!referenceDate && referenceDate < FIRE_ACT_START;
  const actName = getActNameAt(referenceDate).name;
  // 기준 데이터가 없는 용도는 신청일로 다시 고를 것이 없으므로 허가일 배지를 그대로 쓴다
  const badgeText = appliedDate && !unmapped && !loadFailed
    ? `허가 신청일: ${formatPermitDate(appliedDate)} (허가일 ${formatPermitDate(permitDate)})`
    : `${usedApprovalDate ? '기준일(사용승인일)' : '건축허가일'}: ${formatPermitDate(permitDate)}`;

  const headerHtml = `
      <div class="fire-facilities-header">
        <div class="classification-badge">
          <span class="classification-class">${esc(classification?.class || '미분류')}</span>
          ${classification?.category && classification.category !== '일반' ?
            `<span class="classification-category">${esc(classification.category)}</span>` : ''}
        </div>
        <div class="law-period-badge" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          ${badgeText}
        </div>
      </div>`;

  // 기준 데이터가 없는 용도·로드 실패: 추측 결과 대신 안내
  if (unmapped || loadFailed) {
    const message = unmapped
      ? `건축물대장 주용도 <strong>'${esc(classification?.category || '-')}'</strong>에 해당하는 소방시설 설치기준 데이터가 없습니다.<br>화면의 <strong>'직접 입력'</strong>에서 가장 가까운 용도를 선택해 확인해 주세요.`
      : '소방시설 설치기준 데이터를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.';
    return `
    <div class="fire-facilities-card">
      ${headerHtml}
      <div class="approval-date-warning"><span>${message}</span></div>
    </div>`;
  }

  // 허가 신청일 안내
  // - 신청일을 입력했으면: 신청일 기준으로 다시 고른 결과임을 알리고, 날짜 고치기·되돌리기
  // - 아니면: 허가일 직전 기간 안에 이 용도의 기준이 바뀐 시설을 보여 주고 신청일 입력을 받는다
  //   (부칙 적용례는 대개 허가 신청일 기준인데 건축물대장에는 허가일만 있다)
  // 직접 입력에서 허가일을 비워 오늘로 둔 경우는 경계를 따질 허가일이 없으므로 띄우지 않는다.
  let applicationNotice = '';
  if (appliedDate) {
    // 기간(180일)보다 더 앞선 신청일은 입력 실수일 수 있어 한 번 더 확인을 권한다 (실제로 그럴 수도 있어 막지는 않음)
    const farBefore = appliedDate < addDays(permitDate, -APPLICATION_WINDOW_DAYS);
    applicationNotice = `
      <div class="approval-date-warning application-notice">
        <div class="application-notice-body">
          <span class="application-notice-lead" tabindex="-1">허가 신청일 <strong>${formatPermitDate(appliedDate)}</strong> 기준으로 다시 고른 결과입니다 (허가일 ${formatPermitDate(permitDate)}). 개정마다 적용 기준이 다를 수 있으니(신청일·설치일·입찰공고일 등) 각 시설의 비고와 부칙을 확인하세요.</span>
          ${farBefore ? `<span class="boundary-caution">신청일이 허가일보다 ${APPLICATION_WINDOW_DAYS}일 넘게 앞섭니다. 날짜가 맞는지 확인하세요.</span>` : ''}
          ${applicationDateFormHtml(permitDate, appliedDate)}
          <button type="button" class="law-ref-btn" onclick="clearApplicationDate()">허가일 기준으로 돌아가기</button>
        </div>
      </div>`;
  } else if (!usedApprovalDate && permitDate && !buildingInfo.permitDateAssumed) {
    const boundaries = findCriteriaBoundaries(fireData, permitDate, APPLICATION_WINDOW_DAYS);
    if (boundaries.length > 0) {
      const quote = (list) => list.map((c) => `“${esc(c)}”`).join(', ');
      const describe = (f) => {
        if (f.before.length && f.after.length) return `이전: ${quote(f.before)} → 이후: ${quote(f.after)}`;
        return f.after.length ? `신설: ${quote(f.after)}` : `삭제: ${quote(f.before)}`;
      };
      const items = boundaries.flatMap((b) => b.facilities.map((f) => `
            <li><strong>${esc(f.name)}</strong> <span class="boundary-date">${formatPermitDate(b.date)} 변경</span><br>
              ${describe(f)}${f.notes.length ? `<small class="boundary-note">비고: ${esc(f.notes.join(' / '))}</small>` : ''}</li>`));
      const shown = items.slice(0, 8).join('');
      const more = items.length > 8 ? `<li>외 ${items.length - 8}건 — 각 시설을 눌러 적용 기간별 기준을 확인하세요.</li>` : '';
      applicationNotice = `
      <div class="approval-date-warning application-notice">
        <div class="application-notice-body">
          <span class="application-notice-lead" tabindex="-1">허가일(${formatPermitDate(permitDate)}) 전 ${APPLICATION_WINDOW_DAYS}일 안에 아래 기준이 바뀌었습니다. 개정 부칙은 대개 <strong>허가 신청일</strong>을 기준으로 적용하므로, 신청일이 바뀐 날짜보다 앞서면 이전 기준이 적용될 수 있습니다.</span>
          <ul class="boundary-list">${shown}${more}</ul>
          ${applicationDateFormHtml(permitDate, '', 'appliedDayHelp')}
          <small class="boundary-help" id="appliedDayHelp">신청일은 허가 서류나 세움터(건축행정시스템)의 민원 처리 이력에서 확인할 수 있습니다. 설치일·입찰공고일 등 다른 날을 기준으로 하는 개정도 있으니 각 시설의 비고와 부칙을 확인하세요.</small>
        </div>
      </div>`;
    }
  }

  // 층별 용도가 둘 이상이면 복합건축물 기준 확인 안내
  const mixedTypes = getMixedUseTypes(buildingInfo.floorItems);
  const mixedUseNotice = mixedTypes ? `
      <div class="approval-date-warning">
        <span>층별 용도가 둘 이상입니다(${esc(mixedTypes.join(', '))}). 「소방시설법 시행령」 별표 2의 <strong>복합건축물</strong>에 해당하면 더 강화된 기준이 적용될 수 있습니다.
          <button class="law-ref-btn" data-date="${esc(referenceDate)}" data-label="${esc(referenceDateLabel(result))}" onclick="showFireStandardsModal('복합건축물', this.dataset.date, null, this.dataset.label)">복합건축물 기준 보기</button>
        </span>
      </div>` : '';

  const requiredFacilities = facilities.filter(f => f.required);
  const notRequiredFacilities = facilities.filter(f => !f.required);

  const html = `
    <div class="fire-facilities-card">
      ${headerHtml}

      ${usedApprovalDate ? `
        <div class="approval-date-warning">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>허가일이 조회되지 않아 <strong>사용승인일(${formatPermitDate(permitDate)})</strong> 기준으로 판단했습니다. 허가일이 더 이르면 결과가 달라질 수 있으니 재확인이 필요합니다.</span>
        </div>
      ` : ''}
      ${applicationNotice}
      ${mixedUseNotice}

      <div class="facilities-section">
        <div class="facilities-title required">
          <span>설치 검토 대상 소방시설</span>
          <span class="facilities-count">${requiredFacilities.length}개</span>
        </div>
        <div class="facilities-note">
          ※ ${dateLabel} 당시 이 용도에 설치 기준이 있는 시설입니다. 연면적·층수 등 세부 조건의 충족 여부는 아직 자동 판정하지 않으니, 각 시설을 눌러 기준을 확인하세요.
        </div>
        <div class="facilities-list">
          ${requiredFacilities.map((f) => `
            <div class="facility-item required clickable" onclick="showFacilityDetailModal(${facilities.indexOf(f)})">
              <span class="facility-icon">${f.icon}</span>
              <div class="facility-info">
                <span class="facility-name">${esc(f.name)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${notRequiredFacilities.length > 0 ? `
        <div class="facilities-section collapsed" id="optionalFacilities">
          <div class="facilities-title optional" onclick="toggleOptionalFacilities()">
            <span>해당 시기 기준 없음</span>
            <span class="facilities-count">${notRequiredFacilities.length}개</span>
            <svg class="toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
          <div class="facilities-list optional-list">
            ${notRequiredFacilities.map((f) => `
              <div class="facility-item optional clickable" onclick="showFacilityDetailModal(${facilities.indexOf(f)})">
                <span class="facility-icon">${f.icon}</span>
                <div class="facility-info">
                  <span class="facility-name">${esc(f.name)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="facilities-note">
        ※ 시설을 클릭하면 상세 기준을 확인할 수 있습니다.
      </div>

      <div class="law-reference-section" id="lawRefSection">
        <div class="law-reference-label">${preFireAct
          ? `${formatPermitDate(referenceDate)}${appliedDate ? '(허가 신청일)' : ''} 기준: 소방시설법 시행(2004.05.30) 전 — 구 소방법 적용`
          : `${formatPermitDate(referenceDate)}${appliedDate ? '(허가 신청일)' : ''} 기준 ${esc(actName)}`}</div>
        ${preFireAct ? '' : `
        <div class="law-reference-buttons">
          <button class="law-ref-btn" data-type="act" onclick="openLawLink('act')" disabled>법률</button>
          <button class="law-ref-btn" data-type="decree" onclick="openLawLink('decree')" disabled>시행령</button>
          <button class="law-ref-btn" data-type="rules" onclick="openLawLink('rules')" disabled>시행규칙</button>
        </div>`}
      </div>

      <div class="fire-standards-btn-wrapper">
        <button class="btn-fire-standards" onclick="showFireStandardsModalFromCard()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          전체 소방기준 보기
        </button>
      </div>
    </div>
  `;

  // 카드 렌더 후 비동기로 법령 링크 바인딩 (기준일에 적용되는 가장 최근 공포 버전)
  if (!preFireAct) {
    setTimeout(async () => {
      try {
        const [actData, decreeData, rulesData] = await Promise.all([
          getLawHistoryData('act'),
          getLawHistoryData('decree'),
          getLawHistoryData('rules')
        ]);
        // 결과 카드와 같은 기준일 (허가 신청일을 입력했으면 신청일)
        const lawLinks = {
          act: findApplicableVersion(actData, referenceDate),
          decree: findApplicableVersion(decreeData, referenceDate),
          rules: findApplicableVersion(rulesData, referenceDate)
        };
        document.querySelectorAll('#lawRefSection .law-ref-btn').forEach(btn => {
          const version = lawLinks[btn.dataset.type];
          const link = version ? safeHttpUrl(version.link) : '';
          if (link) {
            btn.dataset.link = link;
            btn.disabled = false;
            btn.title = `${version.law_no} (${formatPermitDate(version.effective_date)} 시행)`;
          }
        });
      } catch (e) {
        console.warn('법령 연혁 데이터 로드 실패:', e);
      }
    }, 0);
  }

  return html;
}

// 비해당 시설 토글
window.toggleOptionalFacilities = function() {
  const section = document.getElementById('optionalFacilities');
  if (section) {
    section.classList.toggle('collapsed');
  }
};

// 허가일 포맷
function formatPermitDate(dateStr) {
  const v = String(dateStr || '');
  if (!/^\d{8}$/.test(v)) return '-';
  return `${v.substring(0,4)}.${v.substring(4,6)}.${v.substring(6,8)}`;
}

// YYYYMMDD → YYYY-MM-DD (date 입력 칸 값·한계용, 형식이 아니면 '')
function formatIsoDate(dateStr) {
  const v = String(dateStr || '');
  return /^\d{8}$/.test(v) ? `${v.substring(0,4)}-${v.substring(4,6)}-${v.substring(6,8)}` : '';
}

// ==================== 허가 신청일 ====================

// 결과의 기준일이 무슨 날인지 (모달·법령 표시용)
function referenceDateLabel(result) {
  if (result?.appliedDate) return '허가 신청일';
  if (result?.usedApprovalDate) return '사용승인일';
  return '건축허가일';
}

// 허가 신청일 입력 폼 — Enter 로도 제출. 날짜 검증은 applyApplicationDate 가 같은 안내 문구로 한다(novalidate)
function applicationDateFormHtml(permitDate, value, helpId = '') {
  return `
          <form class="boundary-form" novalidate onsubmit="applyApplicationDate(event)">
            <label for="appliedDayInput">허가 신청일</label>
            <input type="date" id="appliedDayInput" min="${formatIsoDate(EARLIEST_YMD)}" max="${formatIsoDate(permitDate)}" value="${formatIsoDate(value)}"${helpId ? ` aria-describedby="${helpId}"` : ''}>
            <button type="submit" class="law-ref-btn">신청일 기준으로 보기</button>
          </form>`;
}

// 주소창에서 신청일 파라미터만 지운다 (직접 입력·적용하지 못한 신청일·기록 열기)
function removeAppliedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('applied')) return;
  params.delete('applied');
  const query = params.toString();
  history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

// 지금 보고 있는 결과(주소 조회 또는 직접 입력)를 현재 신청일로 다시 그린다
async function rerenderWithApplicationDate() {
  if (currentBuildingData?.isManualInput && lastManualBuildingInfo) {
    await displayManualResult({ ...lastManualBuildingInfo, appliedDay: currentAppliedDay }, lastManualBuildingInfo.pmsDay);
  } else if (currentBuildingData && (currentBuildingData.titleItems?.length || currentBuildingData.generalItems?.length)) {
    updateUrlWithAddress();
    await renderBuildingView();
  }
  // 결과 전체를 다시 그려 초점이 사라지므로 안내 문장으로 옮긴다 (화면 읽기 프로그램이 바뀐 기준을 읽도록).
  // 경계 안내가 없는 허가일로 돌아왔으면 카드 머리의 기준일 배지로.
  (document.querySelector('.application-notice-lead') || document.querySelector('.fire-facilities-card .law-period-badge'))?.focus();
}

// 결과 카드의 '신청일 기준으로 보기' (입력 폼 제출)
window.applyApplicationDate = async function(event) {
  event?.preventDefault();
  const input = document.getElementById('appliedDayInput');
  const raw = String(input?.value || '').trim();
  const value = parseYmdInput(raw);
  const permitDate = toYmd(currentFacilitiesResult?.permitDate);
  if (!value) {
    showToast(raw ? '허가 신청일을 다시 확인해 주세요 (1900년 이후 날짜).' : '허가 신청일을 입력해 주세요.');
    return;
  }
  if (permitDate && value > permitDate) {
    showToast(`허가 신청일은 허가일(${formatPermitDate(permitDate)})보다 늦을 수 없습니다.`);
    return;
  }
  currentAppliedDay = value;
  await rerenderWithApplicationDate();
};

// '허가일 기준으로 돌아가기'
window.clearApplicationDate = async function() {
  currentAppliedDay = '';
  await rerenderWithApplicationDate();
};

// ==================== 소방기준 모달 ====================

// 법령 연혁 데이터 캐시
let lawHistoryCache = { act: null, decree: null, rules: null };

async function getLawHistoryData(type) {
  if (lawHistoryCache[type]) return lawHistoryCache[type];
  const fileMap = { act: 'law_history_act', decree: 'law_history_decree', rules: 'law_history_rules' };
  const res = await fetch(`/data/${fileMap[type]}.json`);
  if (!res.ok) throw new Error(`법령 연혁 로드 실패 (${res.status})`);
  lawHistoryCache[type] = await res.json();
  return lawHistoryCache[type];
}

// NFSC(화재안전기준) 연혁 데이터 로드
let nfscHistoryCache = null;

async function getNfscHistoryData() {
  if (nfscHistoryCache) return nfscHistoryCache;
  const res = await fetch('/data/nfsc_history.json');
  if (!res.ok) throw new Error(`화재안전기준 연혁 로드 실패 (${res.status})`);
  nfscHistoryCache = await res.json();
  return nfscHistoryCache;
}

// 기준일에 적용되는 법령·기준 버전 선택은 js/lib/law-versions.js 의 findApplicableVersion

// 법령 링크 열기
window.openLawLink = function(type) {
  const btn = document.querySelector(`.law-ref-btn[data-type="${type}"]`);
  if (btn && btn.dataset.link) {
    window.open(btn.dataset.link, '_blank');
  }
};

// 현재 소방기준 모달 상태
let currentFireStandardsData = {
  buildingType: null,
  permitDate: null,
  buildingInfo: null
};

// 소방기준 모달 표시 (dateLabel: 기준일이 무슨 날인지 — 건축허가일·허가 신청일·사용승인일)
window.showFireStandardsModal = async function(purpose, permitDate, buildingInfo, dateLabel) {
  // 용도를 JSON building_type으로 매핑
  const buildingType = mapPurposeToFireDataType(purpose);
  if (!buildingType) {
    showToast('해당 용도의 소방시설 기준을 찾을 수 없습니다.');
    return;
  }

  // 데이터 지연 로드
  const data = await getFireFacilityData(buildingType);
  if (!data) {
    showToast('소방시설 데이터를 불러올 수 없습니다.');
    return;
  }

  // 상태 저장
  currentFireStandardsData = {
    buildingType,
    permitDate,
    buildingInfo
  };

  const html = renderFireStandardsModalContent(data, permitDate, buildingInfo, dateLabel);

  document.getElementById('fireStandardsBody').innerHTML = html;
  document.getElementById('fireStandardsModal').style.display = 'flex';
};

// 소방기준 모달 닫기
window.closeFireStandardsModal = function() {
  document.getElementById('fireStandardsModal').style.display = 'none';
};

// 시설 상세 모달 표시 (클릭한 시설만 표시)
window.showFacilityDetailModal = async function(facilityIndex) {
  if (!currentFacilitiesResult || !currentFacilitiesResult.facilities[facilityIndex]) {
    showToast('시설 정보를 찾을 수 없습니다.');
    return;
  }

  const facility = currentFacilitiesResult.facilities[facilityIndex];
  // 결과 카드와 같은 기준일 (허가 신청일을 입력했으면 신청일)
  const permitDate = currentFacilitiesResult.referenceDate || currentFacilitiesResult.permitDate;

  // 적용되는 규정만 필터링
  const allRegs = facility.allRegulations || facility.regulations || [];
  const applicableRegs = getApplicableRegulations(allRegs, permitDate);

  // 적용 기간 포맷
  const formatPeriod = (reg) => {
    const start = reg.start_date ? formatPermitDate(reg.start_date) : '';
    const end = reg.end_date ? formatPermitDate(reg.end_date) : '';
    if (!reg.start_date && !reg.end_date) return '상시 적용';
    if (!reg.end_date) return `${start} ~ 현재`;
    return `${start} ~ ${end}`;
  };

  let html = `
    <div class="facility-detail-header">
      <span class="facility-detail-icon">${facility.icon}</span>
      <div class="facility-detail-info">
        <span class="facility-detail-name">${esc(facility.name)}</span>
        <span class="facility-detail-category">${esc(facility.category || '')}</span>
      </div>
      <span class="facility-detail-status ${facility.required ? 'required' : 'optional'}">
        ${facility.required ? '검토 대상' : '기준 없음'}
      </span>
    </div>
  `;

  if (applicableRegs.length > 0) {
    html += `<div class="facility-detail-section"><h4>설치 기준</h4><div class="regulations-list">`;
    applicableRegs.forEach(reg => {
      html += `
        <div class="regulation-item applicable">
          <div class="regulation-period">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            <span>${formatPeriod(reg)}</span>
          </div>
          <div class="regulation-criteria">${esc(reg.criteria)}</div>
          ${reg.applicable_to ? `<div class="regulation-target">대상: ${esc(reg.applicable_to)}</div>` : ''}
          ${reg.note ? `<div class="regulation-note">※ ${esc(reg.note)}</div>` : ''}
        </div>
      `;
    });
    html += `</div></div>`;
  } else {
    html += `
      <div class="facility-detail-empty">
        <p>적용되는 설치 기준이 없습니다.</p>
      </div>
    `;
  }

  // 면제기준 섹션 추가 (지연 로드)
  const exemptionRules = await getExemptionRulesForFacility(facility.name, permitDate);
  if (exemptionRules.length > 0) {
    html += `<div class="facility-detail-section exemption-section"><h4 class="exemption-title">면제 기준</h4><div class="regulations-list">`;
    exemptionRules.forEach(rule => {
      html += `
        <div class="regulation-item exemption">
          <div class="regulation-period exemption-period">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            <span>${formatPeriod(rule)}</span>
          </div>
          <div class="regulation-criteria">${esc(rule.criteria)}</div>
          ${rule.source ? `<div class="regulation-source">출처: ${{
            '별표5': '[별표5] 특정소방대상물의 소방시설 설치의 면제 기준(제14조 관련)',
            '별표6': '[별표6] 특정소방대상물의 소방시설 설치의 면제기준(제16조 관련, 2022.11.30. 이전 시행령)'
          }[rule.source] || esc(rule.source)}</div>` : ''}
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // NFSC 링크 추가
  const nfscKey = getFacilityNfscKey(facility.name);
  let nfscData = null;
  if (nfscKey) {
    try {
      nfscData = await getNfscHistoryData();
    } catch (e) {
      console.warn(e);
    }
  }
  if (nfscData) {
    const nfscList = nfscData[nfscKey];
    if (nfscList) {
      const matched = findApplicableVersion(nfscList, permitDate);
      if (matched && safeHttpUrl(matched.link)) {
        html += `
          <div class="nfsc-link-section">
            <a href="${esc(safeHttpUrl(matched.link))}" target="_blank" rel="noopener" class="nfsc-link-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              ${esc(matched.name)}
            </a>
          </div>
        `;
      }
    }
  }

  html += `
    <div class="facility-detail-footer">
      <p>${referenceDateLabel(currentFacilitiesResult)}: ${formatPermitDate(permitDate) || '-'}</p>
    </div>
  `;

  document.getElementById('facilityDetailTitle').textContent = facility.name;
  document.getElementById('facilityDetailBody').innerHTML = html;
  document.getElementById('facilityDetailModal').style.display = 'flex';
};

// 시설 상세 모달 닫기
window.closeFacilityDetailModal = function() {
  document.getElementById('facilityDetailModal').style.display = 'none';
};

// 시설명으로 면제기준 찾기 (지연 로드)
async function getExemptionRulesForFacility(facilityName, permitDate) {
  // 면제기준 데이터 지연 로드
  const data = await getExemptionCriteriaData();
  if (!data || !data.exemption_rules) {
    return [];
  }

  const permitNum = parseInt(permitDate) || 0;

  // 시설 마스터를 통해 정규화된 이름 조회
  const dataFacilityName = normalizeFacilityName(facilityName);

  // 해당 시설의 면제기준 찾기 (facility_name 또는 정규화된 이름으로 매칭)
  const facilityRule = data.exemption_rules.find(
    rule => rule.facility_name === dataFacilityName || rule.facility_name === facilityName
  );

  if (!facilityRule || !facilityRule.regulations) {
    return [];
  }

  // 허가일 기준 필터링
  return facilityRule.regulations.filter(reg => {
    const start = parseInt(reg.start_date) || 0;
    const end = parseInt(reg.end_date) || 99999999;

    if (permitNum > 0) {
      return permitNum >= start && permitNum <= end;
    }
    // 허가일이 없으면 현재 유효한 규정만
    return !reg.end_date;
  });
}

// 적용되는 규정만 필터링
function getApplicableRegulations(regulations, permitDate) {
  const permitNum = parseInt(permitDate) || 0;
  return regulations.filter(reg => {
    const start = parseInt(reg.start_date) || 0;
    const end = parseInt(reg.end_date) || 99999999;

    if (permitNum > 0) {
      return permitNum >= start && permitNum <= end;
    }
    // 허가일이 없으면 현재 유효한 규정만
    return !reg.end_date;
  });
}

// 아코디언 토글
window.toggleAccordion = function(header) {
  const item = header.closest('.accordion-item');
  item.classList.toggle('expanded');
};

// 소방시설 카드에서 호출 (currentBuildingData 사용)
window.showFireStandardsModalFromCard = function() {
  if (!currentBuildingData) {
    showToast('건물 데이터가 없습니다.');
    return;
  }

  const { generalItems, titleItems } = currentBuildingData;
  const generalInfo = generalItems[0] || {};
  const mainTitle = titleItems && titleItems.length > 0 ? titleItems[0] : {};

  const mainPurpose = generalInfo.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-';
  // 소방시설 카드와 같은 기준일(허가 신청일을 입력했으면 신청일, 아니면 허가일, 없으면 사용승인일)
  const permitDate = currentFacilitiesResult?.referenceDate || currentFacilitiesResult?.permitDate || getPrimaryPermitInfo().permitDate;
  const dateLabel = currentFacilitiesResult ? referenceDateLabel(currentFacilitiesResult) : '건축허가일';

  showFireStandardsModal(mainPurpose, permitDate, null, dateLabel);
};

// 소방기준 모달 콘텐츠 렌더링
function renderFireStandardsModalContent(data, permitDate, buildingInfo, dateLabel = '허가일') {
  const permitNum = parseInt(permitDate) || 0;

  // 카테고리별 시설 그룹핑
  const categories = {
    '소화설비': { color: '#f04452', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/></svg>', facilities: [] },
    '경보설비': { color: '#f59f00', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>', facilities: [] },
    '피난구조설비': { color: '#00c471', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M10 12h4"/><path d="M12 9l3 3-3 3"/></svg>', facilities: [] },
    '소화활동설비': { color: '#3182f6', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="10" width="20" height="10" rx="2"/><path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4"/><circle cx="7" cy="15" r="2"/><circle cx="17" cy="15" r="2"/></svg>', facilities: [] },
    '건축': { color: '#8b95a1', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>', facilities: [] }
  };

  // 시설별로 적용 가능한 규정 필터링
  data.fire_facilities.forEach(facility => {
    const category = categories[facility.category];
    if (!category) return;

    // 허가일 기준 적용 가능한 규정 필터링
    const applicableRegs = facility.regulations.filter(reg => {
      const startDate = reg.start_date ? parseInt(reg.start_date) : 0;
      const endDate = reg.end_date ? parseInt(reg.end_date) : 99999999;

      // 허가일이 규정 기간 내에 있는지 확인
      if (permitNum > 0) {
        return permitNum >= startDate && permitNum <= endDate;
      }
      // 허가일이 없으면 현재 적용 중인 규정만 (end_date가 null)
      return !reg.end_date;
    });

    if (applicableRegs.length > 0) {
      category.facilities.push({
        name: facility.facility_name,
        regulations: applicableRegs
      });
    }
  });

  // HTML 생성
  let html = `
    <div class="fire-standards-header-info">
      <span class="purpose-badge">${esc(data.building_type)}</span>
      ${permitDate ? `<span class="permit-date-badge">${esc(dateLabel)}: ${formatPermitDate(permitDate)}</span>` : ''}
    </div>
  `;

  // 카테고리별 렌더링
  Object.entries(categories).forEach(([catName, catData]) => {
    if (catData.facilities.length === 0) return;

    html += `
      <div class="standards-category" style="--category-color: ${catData.color}">
        <div class="standards-category-header">
          <span class="category-icon">${catData.icon}</span>
          <h3>${catName}</h3>
          <span class="category-count">${catData.facilities.length}개</span>
        </div>
        <div class="standards-facility-list">
    `;

    catData.facilities.forEach(facility => {
      html += `
        <div class="standards-facility-item">
          <div class="standards-facility-name">${esc(facility.name)}</div>
          <div class="standards-facility-criteria">
      `;

      facility.regulations.forEach(reg => {
        html += `
          <div class="criteria-item">
            <span class="criteria-text">${esc(reg.criteria)}</span>
            ${reg.applicable_to ? `<span class="applicable-badge">${esc(reg.applicable_to)}</span>` : ''}
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  // 참고사항
  html += `
    <div class="fire-standards-note">
      <p>※ 위 기준은 ${esc(dateLabel)}(${formatPermitDate(permitDate) || '-'}) 당시 적용되는 법령을 기준으로 합니다.</p>
      <p>※ 실제 소방시설 설치 여부는 건축물의 세부 조건에 따라 달라질 수 있습니다.</p>
    </div>
  `;

  return html;
}

// ==================== 지도 기능 ====================

let naverMap = null;
let naverPano = null;
let mapCoords = null;

// 네이버 지도 API 지연 로딩
let naverMapsLoaded = false;
function loadNaverMaps() {
  return new Promise((resolve, reject) => {
    if (naverMapsLoaded || (window.naver && window.naver.maps && window.naver.maps.Service)) {
      naverMapsLoaded = true;
      resolve();
      return;
    }
    window.navermap_authFailure = function() {
      console.error('네이버 지도 API 인증 실패');
    };
    const script = document.createElement('script');
    script.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=hakre9jin8&submodules=geocoder,panorama';
    script.onload = () => {
      const check = setInterval(() => {
        if (window.naver && naver.maps && naver.maps.Service) {
          clearInterval(check);
          naverMapsLoaded = true;
          resolve();
        }
      }, 50);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    };
    script.onerror = () => reject(new Error('네이버 지도 로드 실패'));
    document.head.appendChild(script);
  });
}

// 지도/내비 모달 표시
window.showMapModal = async function(address) {
  const mapModal = document.getElementById('mapModal');
  const mapContainer = document.getElementById('mapContainer');
  const mapAddress = document.getElementById('mapAddress');

  mapModal.style.display = 'flex';

  // 주소 바 설정
  const addressText = mapAddress.querySelector('.map-address-text');
  if (addressText) addressText.textContent = address;
  mapAddress.onclick = () => copyAddress(address);

  const encodedAddress = encodeURIComponent(address);
  const naverMapUrl = `https://map.naver.com/v5/search/${encodedAddress}`;

  // Fallback 표시 함수
  const showFallback = () => {
    const mapArea = document.getElementById('naverMapArea');
    if (mapArea) {
      mapArea.innerHTML = `
        <a href="${naverMapUrl}" target="_blank" class="map-fallback">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
          <span>지도 보기</span>
        </a>
      `;
    }
  };

  // 컨테이너 구성 (탭 + 로딩 표시)
  mapContainer.innerHTML = `
    <div class="map-tabs">
      <button class="map-tab active" data-tab="map">지도</button>
      <button class="map-tab" data-tab="roadview">로드뷰</button>
    </div>
    <div id="naverMapArea" class="map-area"><div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);"><div class="spinner"></div><span style="margin-left:12px;">지도 로딩 중...</span></div></div>
    <div id="naverPanoArea" class="map-area" style="display:none;"></div>
  `;

  // 네이버 지도 API 지연 로딩
  try {
    await loadNaverMaps();
  } catch (e) {
    console.warn('네이버 지도 API 로드 실패:', e);
  }

  const mapArea = document.getElementById('naverMapArea');
  const panoArea = document.getElementById('naverPanoArea');

  // 탭 클릭 이벤트
  document.querySelectorAll('.map-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.map-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');

      if (this.dataset.tab === 'map') {
        mapArea.style.display = 'block';
        panoArea.style.display = 'none';
        if (naverMap) setTimeout(() => naverMap.autoResize(), 100);
      } else {
        mapArea.style.display = 'none';
        panoArea.style.display = 'block';
        if (!naverPano && mapCoords) {
          initPanorama(panoArea, mapCoords.lat, mapCoords.lon);
        } else if (naverPano) {
          setTimeout(() => naverPano.setSize(new naver.maps.Size(panoArea.offsetWidth, panoArea.offsetHeight)), 100);
        }
      }
    });
  });

  // 네이버 지도 API 체크
  if (typeof naver === 'undefined' || !naver.maps || !naver.maps.Service) {
    showFallback();
    return;
  }

  // 로딩 표시 제거
  mapArea.innerHTML = '';

  // 주소 → 좌표 변환
  naver.maps.Service.geocode({ query: address }, function(status, response) {
    if (status === naver.maps.Service.Status.OK && response.v2.addresses.length > 0) {
      const result = response.v2.addresses[0];
      const lat = parseFloat(result.y);
      const lon = parseFloat(result.x);
      mapCoords = { lat, lon };

      // 지도 생성
      naverMap = new naver.maps.Map(mapArea, {
        center: new naver.maps.LatLng(lat, lon),
        zoom: 17
      });

      // 마커 추가
      new naver.maps.Marker({
        position: new naver.maps.LatLng(lat, lon),
        map: naverMap
      });

      setTimeout(() => naverMap.autoResize(), 100);
    } else {
      showFallback();
    }
  });
};

// 파노라마(로드뷰) 초기화
function initPanorama(container, lat, lon) {
  if (!naver.maps.Panorama) {
    container.innerHTML = '<div class="map-fallback"><span>로드뷰를 사용할 수 없습니다</span></div>';
    return;
  }

  naverPano = new naver.maps.Panorama(container, {
    position: new naver.maps.LatLng(lat, lon),
    pov: { pan: 0, tilt: 0, fov: 100 }
  });

  naver.maps.Event.addListener(naverPano, 'error', function() {
    container.innerHTML = '<div class="map-fallback"><span>이 위치의 로드뷰가 없습니다</span></div>';
  });
}

// 지도 모달 닫기
window.closeMapModal = function() {
  const mapModal = document.getElementById('mapModal');
  if (mapModal) {
    mapModal.style.display = 'none';
  }
  naverMap = null;
  naverPano = null;
  mapCoords = null;
};

// 주소 복사
window.copyAddress = function(address) {
  navigator.clipboard.writeText(address).then(() => {
    showToast('주소가 복사되었습니다');
  }).catch(() => {
    // fallback
    const textarea = document.createElement('textarea');
    textarea.value = address;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('주소가 복사되었습니다');
  });
};

// ==================== 수동 입력 기능 ====================

// 수동 입력 모달 표시
window.showManualInputModal = function() {
  document.getElementById('manualInputModal').style.display = 'flex';
};

// 수동 입력 모달 닫기
window.closeManualInputModal = function() {
  document.getElementById('manualInputModal').style.display = 'none';
};

// 수동 입력 제출
window.submitManualInput = function() {
  const permitDateInput = document.getElementById('manualPermitDate').value;
  const appliedDateInput = document.getElementById('manualAppliedDate')?.value || '';
  const purpose = document.getElementById('manualPurpose').value;
  const area = parseFloat(document.getElementById('manualArea').value) || 0;
  const groundFloors = parseInt(document.getElementById('manualGroundFloors').value) || 0;
  const undergroundFloors = parseInt(document.getElementById('manualUndergroundFloors').value) || 0;

  // 필수 입력 체크
  if (!purpose) {
    alert('용도를 선택해주세요.');
    return;
  }

  // 허가일 처리 (없으면 오늘 날짜)
  let permitDate;
  if (permitDateInput) {
    permitDate = permitDateInput.replace(/-/g, '');
  } else {
    const today = new Date();
    permitDate = today.getFullYear().toString() +
      (today.getMonth() + 1).toString().padStart(2, '0') +
      today.getDate().toString().padStart(2, '0');
  }

  // 허가 신청일 (선택) — 실제 날짜가 아니거나, 허가일 없이 또는 허가일보다 늦게 넣으면 받지 않는다
  const appliedDate = parseYmdInput(appliedDateInput);
  if (appliedDateInput && !appliedDate) {
    alert('허가 신청일을 다시 확인해 주세요 (1900년 이후 날짜).');
    return;
  }
  if (appliedDate && !permitDateInput) {
    alert('허가 신청일을 쓰려면 허가일도 입력해 주세요.');
    return;
  }
  if (appliedDate && appliedDate > permitDate) {
    alert('허가 신청일은 허가일보다 늦을 수 없습니다.');
    return;
  }

  // 모달 닫기
  closeManualInputModal();

  // 건물 정보 객체 생성 (getRequiredFireFacilities 함수가 기대하는 필드명 사용)
  const buildingInfo = {
    mainPurpsCdNm: purpose,
    mainPurpose: purpose,      // 소방시설 판정용
    totArea: area,
    grndFlrCnt: groundFloors,
    ugrndFlrCnt: undergroundFloors,
    pmsDay: permitDate,        // 소방시설 판정용
    archPmsDay: permitDate,
    permitDateAssumed: !permitDateInput, // 허가일을 비워 오늘로 둠 — 신청일 경계 안내를 띄우지 않는다
    isManualInput: true
  };
  // 신청일 변경 후 다시 그릴 때 쓰는 원래 입력 (신청일은 currentAppliedDay 로 따로 관리)
  lastManualBuildingInfo = buildingInfo;
  currentAppliedDay = appliedDate;
  preLawModalShownFor = '';
  // 직접 입력 결과는 주소창으로 되살릴 수 없으므로, 이전 주소 조회의 신청일 파라미터만 지운다
  removeAppliedFromUrl();

  // 결과 영역에 표시
  displayManualResult({ ...buildingInfo, appliedDay: appliedDate }, permitDate);
};

// 수동 입력 결과 표시
async function displayManualResult(buildingInfo, permitDate) {
  const resultContainer = document.getElementById('result');

  // 전역 변수에 수동 입력 데이터 저장 (전체 소방기준 보기용)
  currentBuildingData = {
    titleItems: [],
    floorItems: [],
    generalItems: [{ mainPurpsCdNm: buildingInfo.mainPurpsCdNm }],
    permitItems: [{ archPmsDay: permitDate }],
    sortedIndices: [],
    isManualInput: true
  };

  // 요약 카드 HTML
  let html = `
    <div class="summary-card">
      <div class="summary-header">
        <div class="summary-header-left">
          <span class="summary-building-name">직접 입력 건물</span>
          <span class="summary-purpose-badge">${esc(buildingInfo.mainPurpsCdNm)}</span>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-grid-item">
          <span class="summary-grid-label">허가일</span>
          <span class="summary-grid-value">${formatPermitDate(permitDate)}</span>
        </div>
        ${toYmd(buildingInfo.appliedDay) ? `
        <div class="summary-grid-item">
          <span class="summary-grid-label">허가 신청일</span>
          <span class="summary-grid-value">${formatPermitDate(buildingInfo.appliedDay)}</span>
        </div>` : ''}
        <div class="summary-grid-item">
          <span class="summary-grid-label">연면적</span>
          <span class="summary-grid-value">${buildingInfo.totArea ? Number(buildingInfo.totArea).toLocaleString() + '㎡' : '-'}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지상층수</span>
          <span class="summary-grid-value">${buildingInfo.grndFlrCnt || '-'}층</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지하층수</span>
          <span class="summary-grid-value">${buildingInfo.ugrndFlrCnt || '-'}층</span>
        </div>
      </div>
    </div>`;

  // 소방시설 카드 렌더링 - 지연 로드
  html += await renderFireFacilitiesCard(buildingInfo);

  resultContainer.innerHTML = html;

  // 헤더 숨기기
  const mainHeader = document.getElementById('mainHeader');
  if (mainHeader) mainHeader.classList.add('hidden');

  // 직접 입력 링크 숨기기
  const manualLink = document.querySelector('.manual-search-link');
  if (manualLink) manualLink.style.display = 'none';
}

// ==================== 공유 기능 ====================

// 건물 정보 공유
window.shareBuilding = async function() {
  const { generalItems, titleItems } = currentBuildingData;
  const general = generalItems[0] || {};
  const title = titleItems[0] || {};

  const buildingName = title.bldNm || general.bldNm || '건축물';
  const address = general.platPlc || title.platPlc || selectedAddressData?.address || '-';
  const mainPurpose = general.mainPurpsCdNm || title.mainPurpsCdNm || '-';
  const totalArea = general.totArea || title.totArea || '-';

  // API 응답에서 코드 직접 추출
  const sigunguCd = general.sigunguCd || title.sigunguCd;
  const bjdongCd = general.bjdongCd || title.bjdongCd;
  const bun = general.bun || title.bun;
  const ji = general.ji || title.ji;
  const platGbCd = normalizePlatGbCd(general.platGbCd || title.platGbCd);
  // 신청일 기준으로 보고 있으면 받는 사람도 같은 기준으로 열리게 링크에 붙인다
  const appliedDay = toYmd(currentAppliedDay);

  // 공유 링크 폴백용 파라미터 URL
  const buildParamUrl = () => {
    const params = new URLSearchParams();
    if (sigunguCd) params.set('sigungu', sigunguCd);
    if (bjdongCd) params.set('bjdong', bjdongCd);
    if (bun) params.set('bun', bun);
    if (ji) params.set('ji', ji);
    if (platGbCd !== '0') params.set('plat', platGbCd);
    if (appliedDay) params.set('applied', appliedDay);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  let shareUrl;

  try {
    // Firebase에 공유 링크 생성 (짧은 URL)
    const fb = await loadFirebase();
    if (fb && sigunguCd && bjdongCd) {
      const shortId = await fb.createShareLink({ sigunguCd, bjdongCd, bun, ji, platGbCd });
      shareUrl = `${window.location.origin}${window.location.pathname}?s=${shortId}${appliedDay ? `&applied=${appliedDay}` : ''}`;
    } else {
      // 폴백: 파라미터 방식
      shareUrl = buildParamUrl();
    }
  } catch (error) {
    console.error('짧은 링크 생성 실패, 파라미터 방식 사용:', error);
    shareUrl = buildParamUrl();
  }

  const shareText = `[소방용 건축물대장]
${buildingName}
주소: ${address}
주용도: ${mainPurpose}
연면적: ${totalArea !== '-' ? Number(totalArea).toLocaleString() + '㎡' : '-'}

${shareUrl}`;

  try {
    if (navigator.share) {
      // 모바일 네이티브 공유
      await navigator.share({
        title: buildingName,
        text: shareText,
        url: shareUrl
      });
    } else {
      // 클립보드 복사 (URL 포함)
      await navigator.clipboard.writeText(shareText);
      showToast('링크가 복사되었습니다.');
    }
  } catch (error) {
    console.error('공유 실패:', error);
    // 공유 취소시 에러 무시
    if (error.name !== 'AbortError') {
      showToast('공유에 실패했습니다.');
    }
  }
};

// 토스트 메시지 표시
function showToast(message) {
  // 기존 토스트 제거
  const existingToast = document.querySelector('.toast-message');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);

  // 애니메이션 후 제거
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ==================== 메모 기능 ====================

// 메모 편집기 표시
window.showMemoEditor = function(docId, currentMemo) {
  const newMemo = prompt('메모 입력 (최대 500자)', currentMemo || '');
  if (newMemo !== null) {
    saveMemo(docId, newMemo.slice(0, 500));
  }
};

// 메모 저장
async function saveMemo(docId, memo) {
  try {
    const fb = await loadFirebase();
    if (!fb) {
      alert('Firebase를 불러올 수 없습니다.');
      return;
    }

    await fb.updateFavoriteMemo(docId, memo);
    showToast('메모가 저장되었습니다.');

    // UI 업데이트
    loadHistoryTab('favorites');
  } catch (error) {
    console.error('메모 저장 실패:', error);
    alert('메모 저장에 실패했습니다.');
  }
}

