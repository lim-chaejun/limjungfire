import { escapeHtml as esc, safeHttpUrl } from './lib/html.js';

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

// 건물 유형 → 파일명 매핑
const BUILDING_TYPE_TO_FILE = {
  '공동주택': '01_residential_complex',
  '근린생활시설': '02_neighborhood_facilities',
  '문화및집회시설': '03_cultural_assembly',
  '종교시설': '04_religious',
  '판매시설': '05_retail',
  '운수시설': '06_transportation',
  '의료시설': '07_medical',
  '교육연구시설': '08_education_research',
  '노유자시설': '09_elderly_childcare',
  '수련시설': '10_training',
  '운동시설': '11_sports',
  '업무시설': '12_office',
  '숙박시설': '13_accommodation',
  '위락시설': '14_entertainment',
  '공장': '15_factory',
  '창고시설': '16_warehouse',
  '위험물저장및처리시설': '17_hazardous_materials',
  '항공기및자동차관련시설': '18_aviation_automotive',
  '동물및식물관련시설': '19_animal_plant',
  '자원순환관련시설': '20_resource_recycling',
  '교정및군사시설': '21_correctional_military',
  '방송통신시설': '22_broadcasting',
  '발전시설': '23_power_generation',
  '묘지관련시설': '24_cemetery',
  '관광휴게시설': '25_tourism_leisure',
  '장례시설': '26_funeral',
  '지하상가': '27_underground_mall',
  '지하연결통로': '28_underground_passage',
  '문화재': '29_national_heritage'
};

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
  const fileName = BUILDING_TYPE_TO_FILE[buildingType];
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

  if (!sigunguCd || !bjdongCd) return;

  const params = new URLSearchParams();
  params.set('sigungu', sigunguCd);
  params.set('bjdong', bjdongCd);
  if (bun) params.set('bun', bun);
  if (ji) params.set('ji', ji);

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
          ji: shareData.ji || ''
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
      ji: params.get('ji') || ''
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
    const jibunInfo = { bun: codes.bun, ji: codes.ji };

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
    displayAllResults(
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.title } } } },
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.floor } } } },
      { response: { header: { resultCode: '00' }, body: { items: { item: item.buildingData.general } } } }
    );

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

// 지번 주소에서 번지 추출
function extractJibun(jibunAddress) {
  if (!jibunAddress) return { bun: '', ji: '' };
  const match = jibunAddress.match(/(\d+)(?:-(\d+))?(?:\s|$)/);
  if (match) {
    return {
      bun: match[1] || '',
      ji: match[2] || ''
    };
  }
  return { bun: '', ji: '' };
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
      // 프록시가 없거나(404·405) 서비스키가 설정되지 않은(503) 경우 → 직접 호출로 폴백
      if (isProxy && [404, 405, 503].includes(response.status)) err.proxyUnavailable = true;
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

// 오퍼레이션 호출: 1순위 자체 프록시(서비스키 비노출), 프록시가 없을 때만 공공데이터포털 직접 호출
async function fetchBuildingOp(op, sigunguCd, bjdongCd, jibunInfo) {
  const params = new URLSearchParams({ sigunguCd, bjdongCd, platGbCd: '0' });
  if (jibunInfo.bun) params.set('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) params.set('ji', jibunInfo.ji.padStart(4, '0'));

  if (buildingProxyAvailable !== false) {
    try {
      const data = await fetchBuildingApi(`/api/building/${op}?${params.toString()}`, { isProxy: true });
      buildingProxyAvailable = true;
      return data;
    } catch (e) {
      if (!e.proxyUnavailable) throw e;
      buildingProxyAvailable = false;
    }
  }

  // 폴백: 직접 호출 (프록시 배포·서비스키 재발급 완료 후 이 경로와 API_KEY를 제거한다)
  const url = new URL(`https://apis.data.go.kr/1613000/${BUILDING_OPS[op]}`);
  url.searchParams.append('serviceKey', API_KEY);
  params.forEach((value, key) => url.searchParams.append(key, value));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
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

// 건물 뷰 렌더링 (선택된 건물만 표시)
async function renderBuildingView() {
  const resultDiv = document.getElementById('result');
  const { titleItems, generalItems, permitItems, sortedIndices } = currentBuildingData;
  const buildingCount = titleItems.length;
  const generalInfo = generalItems[0] || {};
  const permitInfo = permitItems[0] || {};

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
  html += await renderSummaryCard(generalInfo, permitInfo, titleItems);

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
async function renderSummaryCard(generalInfo, permitInfo, titleItems) {
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
  const permitDate = permitInfo?.archPmsDay || generalInfo.pmsDay || '';
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
    useAprDay: approvalDate,
    totArea: totalArea,
    grndFlrCnt: groundFloors,
    ugrndFlrCnt: undergroundFloors,
    mainPurpose: mainPurpose,
    heit: height
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
  const { titleItems, generalItems, permitItems } = currentBuildingData;

  // 허가일 가져오기
  const permitInfo = permitItems[0] || {};
  const generalInfo = generalItems[0] || {};
  const pmsDay = permitInfo.archPmsDay || generalInfo.pmsDay;

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
  const { titleItems, floorItems, generalItems, permitItems } = currentBuildingData;
  const titleItem = buildingIndex >= 0 ? titleItems[buildingIndex] : null;
  const buildingName = titleItem ? (titleItem.dongNm || titleItem.bldNm || '건물') : '전체';

  // 허가일 가져오기
  const permitInfo = permitItems[0] || {};
  const generalInfo = generalItems[0] || {};
  const pmsDay = permitInfo.archPmsDay || generalInfo.pmsDay;

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
  const { generalItems, permitItems, titleItems } = currentBuildingData;
  const permitInfo = permitItems[0] || {};

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

// 상세보기 모달 표시 (기존 - 호환성 유지)
window.showDetailModal = function(buildingIndex) {
  const { titleItems, floorItems, generalItems, permitItems } = currentBuildingData;
  const generalInfo = generalItems[0] || {};
  const permitInfo = permitItems[0] || {};
  const titleItem = buildingIndex >= 0 ? titleItems[buildingIndex] : null;
  const buildingName = titleItem ? (titleItem.dongNm || titleItem.bldNm || '건물') : '전체';

  // 해당 건물의 층별 정보 필터링
  const buildingFloors = buildingIndex >= 0
    ? floorItems.filter(f => f.dongNm === titleItem.dongNm || (!f.dongNm && !titleItem.dongNm))
    : floorItems;

  let html = '';

  // 1. 허가일 기준 적용 소방법령 (건축인허가정보 API의 archPmsDay 우선)
  const pmsDay = permitInfo.archPmsDay || generalInfo.pmsDay;
  if (pmsDay) {
    html += renderLawInfoCard(pmsDay);
  }

  // 2. 표제부 (동별) 상세 테이블
  if (titleItem) {
    html += renderDetailTitleCard([titleItem]);
  } else if (titleItems.length > 0) {
    html += renderDetailTitleCard(titleItems);
  }

  // 3. 층별 개요 상세 테이블
  if (buildingFloors.length > 0) {
    html += renderDetailFloorCard(buildingFloors);
  }

  // 4. 총괄표제부 상세 테이블
  if (generalItems.length > 0) {
    html += renderDetailGeneralCard(generalItems, permitInfo, titleItems);
  }

  document.getElementById('detailModalTitle').textContent = `${buildingName} 상세 정보`;
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

// 허가일 기준 적용 소방법령 판단
function getFireLawInfo(pmsDay) {
  if (!pmsDay || pmsDay.length !== 8) {
    return null;
  }

  const date = parseInt(pmsDay);

  // 소방법령 주요 변경 시점
  const lawPeriods = [
    {
      start: 0,
      end: 19750831,
      name: '소방법',
      period: '~ 1975.08.31',
      description: '소방법 시행 초기',
      keyPoints: ['소방시설 기준 초기 단계']
    },
    {
      start: 19750901,
      end: 19920730,
      name: '소방법',
      period: '1975.09.01 ~ 1992.07.30',
      description: '소방법 시행령 적용',
      keyPoints: ['스프링클러: 11층 이상 또는 연면적 3만㎡ 이상', '자동화재탐지설비 기준 적용']
    },
    {
      start: 19920731,
      end: 20030528,
      name: '소방법',
      period: '1992.07.31 ~ 2003.05.28',
      description: '소방법 시행령 개정',
      keyPoints: ['스프링클러 설치대상 확대', '6층 이상 건축물 스프링클러 적용', '특정소방대상물 분류 체계 정비']
    },
    {
      start: 20030529,
      end: 20111124,
      name: '소방시설설치유지및안전관리에관한법률',
      period: '2003.05.29 ~ 2011.11.24',
      description: '소방법 분법 (소방기본법, 소방시설법 분리)',
      keyPoints: ['소방시설 설치·유지 기준 강화', '소방안전관리자 제도 정비', '소방시설 자체점검 제도 도입']
    },
    {
      start: 20111125,
      end: 20151127,
      name: '화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률',
      period: '2011.11.25 ~ 2015.11.27',
      description: '법률 명칭 변경',
      keyPoints: ['성능위주설계 제도 도입', '소방시설관리사 제도 시행', '특정소방대상물 분류 개편']
    },
    {
      start: 20151128,
      end: 20170127,
      name: '화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률',
      period: '2015.11.28 ~ 2017.01.27',
      description: '화재안전기준 개정',
      keyPoints: ['피난기구 설치기준 변경', '노유자시설 스프링클러 설치 확대']
    },
    {
      start: 20170128,
      end: 20191007,
      name: '화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률',
      period: '2017.01.28 ~ 2019.10.07',
      description: '스프링클러 설치 대상 확대',
      keyPoints: ['모든 층 스프링클러 설치 기준 강화', '지하층·무창층 기준 강화', '간이스프링클러 설치대상 확대']
    },
    {
      start: 20191008,
      end: 20211130,
      name: '화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률',
      period: '2019.10.08 ~ 2021.11.30',
      description: '화재안전기준 전면 개정',
      keyPoints: ['소방시설 설치 기준 강화', '특정소방대상물 분류 체계 정비', '소방안전관리 대상 확대']
    },
    {
      start: 20211201,
      end: 20221130,
      name: '화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률',
      period: '2021.12.01 ~ 2022.11.30',
      description: '전면 개정 법률 시행',
      keyPoints: ['다중이용업소 안전관리 강화', '소방시설 성능유지 의무 강화']
    },
    {
      start: 20221201,
      end: 99999999,
      name: '소방시설 설치 및 관리에 관한 법률',
      period: '2022.12.01 ~ 현재',
      description: '소방시설법, 화재예방법 분리 시행',
      keyPoints: ['소방시설 설치 및 관리에 관한 법률', '화재의 예방 및 안전관리에 관한 법률', '성능위주설계 기준 강화', '소방시설 하자보수 책임 강화']
    }
  ];

  for (const period of lawPeriods) {
    if (date >= period.start && date <= period.end) {
      return period;
    }
  }

  return null;
}

// 소방법령 안내 카드 렌더링
function renderLawInfoCard(pmsDay) {
  const lawInfo = getFireLawInfo(pmsDay);

  if (!lawInfo) {
    return '';
  }

  let keyPointsHtml = lawInfo.keyPoints.map(point =>
    `<li>${point}</li>`
  ).join('');

  return `
    <div class="detail-section law-section">
      <div class="detail-section-header law-header">
        <h4>적용 소방법령</h4>
      </div>
      <div class="law-content">
        <div class="law-name-compact">${lawInfo.name}</div>
        <div class="law-period-compact">${lawInfo.period}</div>
        <ul class="law-points-compact">
          ${keyPointsHtml}
        </ul>
      </div>
    </div>`;
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

  const { titleItems, floorItems, generalItems, permitItems } = currentBuildingData;
  const generalInfo = generalItems[0] || {};
  const permitInfo = permitItems[0] || {};
  const mainTitle = titleItems[0] || {};

  const buildingName = mainTitle.bldNm || generalInfo.bldNm || selectedAddressData?.buildingName || '건축물';
  const address = generalInfo.platPlc || mainTitle.platPlc || selectedAddressData?.jibunAddress || '';
  const mainPurpose = generalInfo.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-';
  const etcPurpose = generalInfo.etcPurps || mainTitle.etcPurps || '-';
  const permitDate = permitInfo.archPmsDay || generalInfo.pmsDay || '';
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
    const pDate = facResult.permitDate;

    if (required.length > 0) {
      facilitiesHtml += `<h2>필수 소방시설 (${required.length}개)</h2><table>
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
      facilitiesHtml += `<h2>비해당 시설 (${optional.length}개)</h2>
        <p class="optional-list">${optional.map(f => esc(f.name)).join(', ')}</p>`;
    }
  }

  // --- 적용 법령 ---
  const lawInfo = getFireLawInfo(permitDate);
  let lawHtml = '';
  if (lawInfo) {
    lawHtml = `<h2>적용 소방법령</h2><table>
      <tr><th>법률명</th><td>${esc(lawInfo.name)}</td></tr>
      <tr><th>적용 기간</th><td>${esc(lawInfo.period)}</td></tr>
      <tr><th>주요 내용</th><td>${lawInfo.keyPoints.map(esc).join('<br>')}</td></tr>
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

// 주용도 → 특정소방대상물 분류 매핑
function getFireTargetClassification(mainPurpose) {
  const classificationMap = {
    // 공동주택
    '공동주택': { class: '공동주택', category: '일반' },
    '아파트': { class: '공동주택', category: '아파트' },
    '연립주택': { class: '공동주택', category: '연립주택' },
    '다세대주택': { class: '공동주택', category: '다세대주택' },
    '기숙사': { class: '공동주택', category: '기숙사' },

    // 근린생활시설
    '제1종근린생활시설': { class: '근린생활시설', category: '제1종' },
    '제2종근린생활시설': { class: '근린생활시설', category: '제2종' },
    '근린생활시설': { class: '근린생활시설', category: '일반' },

    // 문화 및 집회시설
    '문화및집회시설': { class: '문화 및 집회시설', category: '일반' },
    '공연장': { class: '문화 및 집회시설', category: '공연장' },
    '집회장': { class: '문화 및 집회시설', category: '집회장' },
    '관람장': { class: '문화 및 집회시설', category: '관람장' },
    '전시장': { class: '문화 및 집회시설', category: '전시장' },

    // 종교시설
    '종교시설': { class: '종교시설', category: '일반' },

    // 판매시설
    '판매시설': { class: '판매시설', category: '일반' },
    '도매시장': { class: '판매시설', category: '도매시장' },
    '소매시장': { class: '판매시설', category: '소매시장' },
    '상점': { class: '판매시설', category: '상점' },

    // 운수시설
    '운수시설': { class: '운수시설', category: '일반' },

    // 의료시설
    '의료시설': { class: '의료시설', category: '일반' },
    '병원': { class: '의료시설', category: '병원' },
    '격리병원': { class: '의료시설', category: '격리병원' },

    // 교육연구시설
    '교육연구시설': { class: '교육연구시설', category: '일반' },
    '학교': { class: '교육연구시설', category: '학교' },
    '학원': { class: '교육연구시설', category: '학원' },
    '도서관': { class: '교육연구시설', category: '도서관' },

    // 노유자시설
    '노유자시설': { class: '노유자시설', category: '일반' },
    '아동관련시설': { class: '노유자시설', category: '아동관련시설' },
    '노인복지시설': { class: '노유자시설', category: '노인복지시설' },

    // 수련시설
    '수련시설': { class: '수련시설', category: '일반' },
    '유스호스텔': { class: '수련시설', category: '유스호스텔' },

    // 운동시설
    '운동시설': { class: '운동시설', category: '일반' },
    '체육관': { class: '운동시설', category: '체육관' },

    // 업무시설
    '업무시설': { class: '업무시설', category: '일반' },
    '오피스텔': { class: '업무시설', category: '오피스텔' },
    '사무소': { class: '업무시설', category: '사무소' },

    // 숙박시설
    '숙박시설': { class: '숙박시설', category: '일반' },
    '일반숙박시설': { class: '숙박시설', category: '일반숙박시설' },
    '관광숙박시설': { class: '숙박시설', category: '관광숙박시설' },
    '호텔': { class: '숙박시설', category: '호텔' },
    '모텔': { class: '숙박시설', category: '모텔' },

    // 위락시설
    '위락시설': { class: '위락시설', category: '일반' },

    // 공장
    '공장': { class: '공장', category: '일반' },

    // 창고시설
    '창고시설': { class: '창고시설', category: '일반' },
    '창고': { class: '창고시설', category: '창고' },

    // 위험물 저장 및 처리 시설
    '위험물저장및처리시설': { class: '위험물 저장 및 처리 시설', category: '일반' },

    // 자동차 관련 시설
    '자동차관련시설': { class: '자동차 관련 시설', category: '일반' },
    '주차장': { class: '자동차 관련 시설', category: '주차장' },

    // 방송통신시설
    '방송통신시설': { class: '방송통신시설', category: '일반' },

    // 발전시설
    '발전시설': { class: '발전시설', category: '일반' },

    // 관광휴게시설
    '관광휴게시설': { class: '관광휴게시설', category: '일반' },

    // 단독주택
    '단독주택': { class: '단독주택', category: '단독주택' },
    '다중주택': { class: '단독주택', category: '다중주택' },
    '다가구주택': { class: '단독주택', category: '다가구주택' },
  };

  if (!mainPurpose) return null;

  // 정확한 매칭 먼저 시도
  if (classificationMap[mainPurpose]) {
    return classificationMap[mainPurpose];
  }

  // 부분 매칭 시도
  for (const [key, value] of Object.entries(classificationMap)) {
    if (mainPurpose.includes(key) || key.includes(mainPurpose)) {
      return value;
    }
  }

  return { class: '기타시설', category: mainPurpose };
}

// 주용도 → JSON building_type 매핑
function mapPurposeToFireDataType(mainPurpose) {
  if (!mainPurpose) return null;

  // 정확한 매핑 테이블
  const mappingTable = {
    // 공동주택
    '아파트': '공동주택',
    '연립주택': '공동주택',
    '다세대주택': '공동주택',
    '기숙사': '공동주택',
    '공동주택': '공동주택',
    '공동주택(아파트)': '공동주택',

    // 단독주택 (소방시설 기준 데이터 없음 - 근린생활시설 기준 참고)
    '단독주택': '근린생활시설',

    // 근린생활시설
    '제1종근린생활시설': '근린생활시설',
    '제2종근린생활시설': '근린생활시설',
    '근린생활시설': '근린생활시설',

    // 문화 및 집회시설
    '문화및집회시설': '문화및집회시설',
    '공연장': '문화및집회시설',
    '집회장': '문화및집회시설',
    '관람장': '문화및집회시설',
    '전시장': '문화및집회시설',

    // 종교시설
    '종교시설': '종교시설',

    // 판매시설
    '판매시설': '판매시설',
    '도매시장': '판매시설',
    '소매시장': '판매시설',
    '상점': '판매시설',

    // 운수시설
    '운수시설': '운수시설',
    '여객자동차터미널': '운수시설',
    '철도역사': '운수시설',
    '공항시설': '운수시설',

    // 의료시설
    '의료시설': '의료시설',
    '병원': '의료시설',
    '격리병원': '의료시설',
    '장례식장': '장례시설',

    // 교육연구시설
    '교육연구시설': '교육연구시설',
    '학교': '교육연구시설',
    '학원': '교육연구시설',
    '도서관': '교육연구시설',
    '연구소': '교육연구시설',

    // 노유자시설
    '노유자시설': '노유자시설',
    '아동관련시설': '노유자시설',
    '노인복지시설': '노유자시설',
    '어린이집': '노유자시설',
    '유치원': '노유자시설',

    // 수련시설
    '수련시설': '수련시설',
    '유스호스텔': '수련시설',
    '청소년수련관': '수련시설',

    // 운동시설
    '운동시설': '운동시설',
    '체육관': '운동시설',
    '수영장': '운동시설',
    '볼링장': '운동시설',

    // 업무시설
    '업무시설': '업무시설',
    '오피스텔': '업무시설',
    '사무소': '업무시설',

    // 숙박시설
    '숙박시설': '숙박시설',
    '일반숙박시설': '숙박시설',
    '관광숙박시설': '숙박시설',
    '호텔': '숙박시설',
    '모텔': '숙박시설',
    '여관': '숙박시설',

    // 위락시설
    '위락시설': '위락시설',
    '유흥주점': '위락시설',
    '단란주점': '위락시설',

    // 공장
    '공장': '공장',

    // 창고시설
    '창고시설': '창고시설',
    '창고': '창고시설',
    '물류창고': '창고시설',

    // 위험물 저장 및 처리 시설
    '위험물저장및처리시설': '위험물저장및처리시설',
    '주유소': '위험물저장및처리시설',
    '석유판매소': '위험물저장및처리시설',
    '가스충전소': '위험물저장및처리시설',

    // 항공기및자동차관련시설
    '자동차관련시설': '항공기및자동차관련시설',
    '주차장': '항공기및자동차관련시설',
    '세차장': '항공기및자동차관련시설',
    '정비공장': '항공기및자동차관련시설',

    // 동물및식물관련시설
    '동물및식물관련시설': '동물및식물관련시설',
    '축사': '동물및식물관련시설',
    '온실': '동물및식물관련시설',

    // 자원순환관련시설
    '자원순환관련시설': '자원순환관련시설',
    '분뇨처리시설': '자원순환관련시설',
    '폐기물처리시설': '자원순환관련시설',

    // 교정및군사시설
    '교정및군사시설': '교정및군사시설',

    // 방송통신시설
    '방송통신시설': '방송통신시설',
    '방송국': '방송통신시설',
    '통신시설': '방송통신시설',

    // 발전시설
    '발전시설': '발전시설',

    // 묘지관련시설
    '묘지관련시설': '묘지관련시설',
    '납골당': '묘지관련시설',
    '화장시설': '묘지관련시설',

    // 관광휴게시설
    '관광휴게시설': '관광휴게시설',
    '야외음악당': '관광휴게시설',
    '야외극장': '관광휴게시설',
    '휴게소': '관광휴게시설',

    // 장례시설
    '장례시설': '장례시설',

    // 지하상가/터널
    '지하상가': '지하상가터널',

    // 지하구
    '지하구': '지하구',

    // 국가유산
    '국가유산': '국가유산',
    '문화재': '국가유산'
  };

  // 정확한 매칭
  if (mappingTable[mainPurpose]) {
    return mappingTable[mainPurpose];
  }

  // 부분 매칭
  for (const [key, value] of Object.entries(mappingTable)) {
    if (mainPurpose.includes(key) || key.includes(mainPurpose)) {
      return value;
    }
  }

  return null;
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
  const hasPermitDate = pmsDay && pmsDay.length === 8;
  const effectiveDate = hasPermitDate ? pmsDay : (useAprDay || '');
  const usedApprovalDate = !hasPermitDate && useAprDay; // 사용승인일 사용 여부

  const permitDate = parseInt(effectiveDate) || 0;
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
  } else {
    // JSON 데이터가 없으면 기본 시설만 표시
    facilities.push({
      name: '소화기구',
      category: '소화설비',
      required: totalArea >= 33,
      regulations: [],
      allRegulations: [],
      reason: totalArea >= 33 ? '연면적 33㎡ 이상' : '해당없음',
      icon: getFacilityIcon('소화기구')
    });
  }

  return {
    classification,
    buildingType,
    facilities,
    permitDate: effectiveDate,  // 실제 사용된 날짜 (허가일 우선, 없으면 사용승인일)
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

async function renderFireFacilitiesCard(buildingInfo) {
  const result = await getRequiredFireFacilities(buildingInfo);
  const { classification, facilities, permitDate, usedApprovalDate, effectiveDate } = result;

  // 소방법 이전 건축물이면 안내 모달 표시
  if (permitDate && parseInt(permitDate) <= 19750831) {
    await showPreLawModal();
  }

  // 모달에서 사용할 수 있도록 저장
  currentFacilitiesResult = result;

  const requiredFacilities = facilities.filter(f => f.required);
  const notRequiredFacilities = facilities.filter(f => !f.required);

  const lawInfo = getFireLawInfo(permitDate);
  const lawPeriod = lawInfo ? lawInfo.period : '-';

  let html = `
    <div class="fire-facilities-card">
      <div class="fire-facilities-header">
        <div class="classification-badge">
          <span class="classification-class">${esc(classification?.class || '미분류')}</span>
          ${classification?.category && classification.category !== '일반' ?
            `<span class="classification-category">${esc(classification.category)}</span>` : ''}
        </div>
        <div class="law-period-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          건축허가일: ${formatPermitDate(permitDate)}
        </div>
      </div>

      ${usedApprovalDate ? `
        <div class="approval-date-warning">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>허가일이 조회되지 않아 <strong>사용승인일(${effectiveDate ? effectiveDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3') : '-'})</strong> 기준으로 판단했습니다. 재확인이 필요합니다.</span>
        </div>
      ` : ''}

      <div class="facilities-section">
        <div class="facilities-title required">
          <span>필수 소방시설</span>
          <span class="facilities-count">${requiredFacilities.length}개</span>
        </div>
        <div class="facilities-list">
          ${requiredFacilities.map((f, idx) => `
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
            <span>비해당 시설</span>
            <span class="facilities-count">${notRequiredFacilities.length}개</span>
            <svg class="toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
          <div class="facilities-list optional-list">
            ${notRequiredFacilities.map((f, idx) => `
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
        <div class="law-reference-label">${formatPermitDate(permitDate)} 기준 소방시설법</div>
        <div class="law-reference-buttons">
          <button class="law-ref-btn" data-type="act" onclick="openLawLink('act')">법령</button>
          <button class="law-ref-btn" data-type="decree" onclick="openLawLink('decree')">시행령</button>
          <button class="law-ref-btn" data-type="rules" onclick="openLawLink('rules')">시행규칙</button>
        </div>
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

  // 카드 렌더 후 비동기로 법령 링크 바인딩
  setTimeout(async () => {
    try {
      const [actData, decreeData, rulesData] = await Promise.all([
        getLawHistoryData('act'),
        getLawHistoryData('decree'),
        getLawHistoryData('rules')
      ]);
      const lawLinks = {
        act: findApplicableLaw(actData, permitDate),
        decree: findApplicableLaw(decreeData, permitDate),
        rules: findApplicableLaw(rulesData, permitDate)
      };
      document.querySelectorAll('#lawRefSection .law-ref-btn').forEach(btn => {
        const type = btn.dataset.type;
        if (lawLinks[type] && lawLinks[type].link) {
          btn.dataset.link = lawLinks[type].link;
        }
      });
    } catch (e) { /* 법령 데이터 로드 실패 시 무시 */ }
  }, 0);

  return html;
}

// 비해당 시설 토글
window.toggleOptionalFacilities = function() {
  const section = document.getElementById('optionalFacilities');
  if (section) {
    section.classList.toggle('collapsed');
  }
};

// 허가일 기준 법령 링크 생성
function getLawLinksHtml(permitDate) {
  const date = parseInt(permitDate) || 0;

  // 법령명 (2022.12.01 기준 변경)
  let lawName, lawNameShort;
  if (date >= 20221201) {
    lawName = '소방시설설치및관리에관한법률';
    lawNameShort = '소방시설법';
  } else {
    lawName = '소방시설설치유지및안전관리에관한법률';
    lawNameShort = '소방시설법';
  }

  // 날짜 포맷 (YYYYMMDD)
  const dateStr = permitDate || '';
  const dateParam = dateStr ? `/(${dateStr})` : '';

  const linkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>`;

  return `
    <a href="https://www.law.go.kr/법령/${lawName}${dateParam}" target="_blank" class="law-link">
      ${linkIcon}
      ${lawNameShort}
    </a>
    <a href="https://www.law.go.kr/법령/${lawName}시행령${dateParam}" target="_blank" class="law-link">
      ${linkIcon}
      시행령
    </a>
    <a href="https://www.law.go.kr/법령/${lawName}시행규칙${dateParam}" target="_blank" class="law-link">
      ${linkIcon}
      시행규칙
    </a>
    <div class="law-date-info">허가일(${formatPermitDate(permitDate)}) 기준</div>
  `;
}

// 허가일 포맷
function formatPermitDate(dateStr) {
  const v = String(dateStr || '');
  if (!/^\d{8}$/.test(v)) return '-';
  return `${v.substring(0,4)}.${v.substring(4,6)}.${v.substring(6,8)}`;
}

// ==================== 소방기준 모달 ====================

// 법령 연혁 데이터 캐시
let lawHistoryCache = { act: null, decree: null, rules: null };

async function getLawHistoryData(type) {
  if (lawHistoryCache[type]) return lawHistoryCache[type];
  const fileMap = { act: 'law_history_act', decree: 'law_history_decree', rules: 'law_history_rules' };
  const res = await fetch(`data/${fileMap[type]}.json`);
  lawHistoryCache[type] = await res.json();
  return lawHistoryCache[type];
}

// 허가일 기준 해당 법령 버전 찾기
function findApplicableLaw(history, permitDate) {
  const permit = parseInt(permitDate) || 0;
  const sorted = [...history].sort((a, b) => parseInt(b.effective_date) - parseInt(a.effective_date));
  return sorted.find(item => parseInt(item.effective_date) <= permit) || sorted[sorted.length - 1];
}

// NFSC 연혁 데이터 로드
let nfscHistoryCache = null;

async function getNfscHistoryData() {
  if (nfscHistoryCache) return nfscHistoryCache;
  const res = await fetch('data/nfsc_history.json');
  nfscHistoryCache = await res.json();
  return nfscHistoryCache;
}

// 허가일 기준 해당 NFSC 버전 찾기
function findApplicableNfsc(nfscList, permitDate) {
  const permit = parseInt(permitDate) || 0;
  const sorted = [...nfscList].sort((a, b) => parseInt(b.effective_date) - parseInt(a.effective_date));
  return sorted.find(item => parseInt(item.effective_date) <= permit) || sorted[sorted.length - 1];
}

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

// 소방기준 모달 표시
window.showFireStandardsModal = async function(purpose, permitDate, buildingInfo) {
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

  const html = renderFireStandardsModalContent(data, permitDate, buildingInfo);

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
  const permitDate = currentFacilitiesResult.permitDate;

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
        ${facility.required ? '필수' : '비해당'}
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
            '별표5': '[별표5] 특정소방대상물의 소방시설 설치의 면제기준(제16조 관련)',
            '별표6': '[별표6] 특정소방대상물의 소방시설 설치의 면제기준(제16조 관련)'
          }[rule.source] || esc(rule.source)}</div>` : ''}
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // NFSC 링크 추가
  const nfscKey = getFacilityNfscKey(facility.name);
  if (nfscKey) {
    const nfscData = await getNfscHistoryData();
    const nfscList = nfscData[nfscKey];
    if (nfscList) {
      const matched = findApplicableNfsc(nfscList, permitDate);
      if (matched) {
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
      <p>건축허가일: ${formatPermitDate(permitDate) || '-'}</p>
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

// 시설 상세 콘텐츠 렌더링 (아코디언 방식)
function renderFacilityDetailContent(facility, permitDate) {
  // 적용되는 규정만 필터링
  const allRegs = facility.allRegulations || facility.regulations || [];
  const applicableRegs = getApplicableRegulations(allRegs, permitDate);

  // 적용 기간 포맷 (간결하게)
  const formatPeriod = (reg) => {
    const start = reg.start_date ? formatPermitDate(reg.start_date) : '';
    const end = reg.end_date ? formatPermitDate(reg.end_date) : '';
    if (!reg.start_date && !reg.end_date) return '상시 적용';
    if (!reg.end_date) return `${start} ~ 현재`;
    return `${start} ~ ${end}`;
  };

  // 아코디언 아이템 렌더링
  let html = `
    <div class="accordion-item${facility.required ? ' required' : ''}">
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <div class="accordion-title">
          <span class="accordion-icon">${facility.icon}</span>
          <span class="accordion-name">${facility.name}</span>
        </div>
        <span class="accordion-badge ${facility.required ? 'required' : 'optional'}">
          ${facility.required ? '필수' : '비해당'}
        </span>
        <svg class="accordion-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="accordion-content">
  `;

  if (applicableRegs.length > 0) {
    applicableRegs.forEach(reg => {
      html += `
        <div class="reg-summary">
          <span class="reg-period">${formatPeriod(reg)}</span>
          <p class="reg-criteria">${reg.criteria}</p>
          ${reg.applicable_to ? `<span class="reg-target">${reg.applicable_to}</span>` : ''}
        </div>
      `;
    });
  } else {
    html += `
      <div class="reg-summary empty">
        <p class="reg-criteria">적용되는 설치 기준이 없습니다.</p>
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

// 규정 적용 기간 포맷
function formatRegulationPeriod(startDate, endDate) {
  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    return dateStr; // YYYYMMDD 형식 그대로 사용
  };

  const start = formatDate(startDate);
  const end = formatDate(endDate);

  if (!start && !end) {
    return '상시 적용';
  } else if (!start) {
    return `~ ${end}`;
  } else if (!end) {
    return `${start} ~`;
  } else {
    return `${start} ~ ${end}`;
  }
}

// 소방시설 카드에서 호출 (currentBuildingData 사용)
window.showFireStandardsModalFromCard = function() {
  if (!currentBuildingData) {
    showToast('건물 데이터가 없습니다.');
    return;
  }

  const { generalItems, permitItems, titleItems } = currentBuildingData;
  const generalInfo = generalItems[0] || {};
  const permitInfo = permitItems[0] || {};
  const mainTitle = titleItems && titleItems.length > 0 ? titleItems[0] : {};

  const mainPurpose = generalInfo.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-';
  const permitDate = permitInfo.archPmsDay || generalInfo.pmsDay || '';

  showFireStandardsModal(mainPurpose, permitDate, null);
};

// 소방기준 모달 콘텐츠 렌더링
function renderFireStandardsModalContent(data, permitDate, buildingInfo) {
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
      ${permitDate ? `<span class="permit-date-badge">허가일: ${formatPermitDate(permitDate)}</span>` : ''}
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
      <p>※ 위 기준은 허가일(${formatPermitDate(permitDate) || '-'}) 당시 적용되는 법령을 기준으로 합니다.</p>
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
    isManualInput: true
  };

  // 결과 영역에 표시
  displayManualResult(buildingInfo, permitDate);
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
  document.querySelector('header').classList.add('hidden');

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

  let shareUrl;

  try {
    // Firebase에 공유 링크 생성 (짧은 URL)
    const fb = await loadFirebase();
    if (fb && sigunguCd && bjdongCd) {
      const shortId = await fb.createShareLink({ sigunguCd, bjdongCd, bun, ji });
      shareUrl = `${window.location.origin}${window.location.pathname}?s=${shortId}`;
    } else {
      // 폴백: 기존 파라미터 방식
      const params = new URLSearchParams();
      if (sigunguCd) params.set('sigungu', sigunguCd);
      if (bjdongCd) params.set('bjdong', bjdongCd);
      if (bun) params.set('bun', bun);
      if (ji) params.set('ji', ji);
      shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    }
  } catch (error) {
    console.error('짧은 링크 생성 실패, 기존 방식 사용:', error);
    // 폴백: 기존 파라미터 방식
    const params = new URLSearchParams();
    if (sigunguCd) params.set('sigungu', sigunguCd);
    if (bjdongCd) params.set('bjdong', bjdongCd);
    if (bun) params.set('bun', bun);
    if (ji) params.set('ji', ji);
    shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
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

