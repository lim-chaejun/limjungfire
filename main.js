// 전역 변수
let selectedAddressData = null;
let currentUser = null;
const API_KEY = '07887a9d4f6b1509b530798e1b5b86a1e1b6e4f5aacc26994fd1fd73cbcebefb';

// 테마 관리
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else if (prefersDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

// 테마 토글
window.toggleTheme = function() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
};

// 시스템 테마 변경 감지
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('theme')) {
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  }
});

// 초기 테마 설정
initTheme();

// Firebase 함수들 (동적 로드)
let firebaseModule = null;

// Firebase 동적 로드
async function loadFirebase() {
  if (firebaseModule) return firebaseModule;
  try {
    firebaseModule = await import('./firebase.js');
    console.log('Firebase 로드 성공');
    return firebaseModule;
  } catch (error) {
    console.error('Firebase 로드 실패:', error);
    return null;
  }
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

// 초기화
(async function init() {
  const fb = await loadFirebase();
  if (fb) {
    fb.onAuthChange((user) => {
      currentUser = user;
      updateAuthUI(user);
      // 인증 상태 확인 후 스플래시 화면 숨기기
      hideSplashScreen();
    });
  } else {
    // Firebase 로드 실패해도 스플래시 숨기기
    hideSplashScreen();
  }
})();

// 로그인/회원가입 모달 열기
window.handleGoogleLogin = function() {
  document.getElementById('authModal').style.display = 'flex';
};

// 모달 닫기
window.closeAuthModal = function() {
  document.getElementById('authModal').style.display = 'none';
};

// 로그인 처리
window.handleLogin = async function() {
  closeAuthModal();
  const fb = await loadFirebase();
  if (!fb) {
    alert('Firebase를 로드할 수 없습니다.');
    return;
  }
  try {
    await fb.signInWithGoogle();
  } catch (error) {
    alert('로그인에 실패했습니다: ' + error.message);
  }
};

// 회원가입 처리 (Google 로그인 후 Firestore에 사용자 정보 저장)
window.handleSignup = async function() {
  closeAuthModal();
  const fb = await loadFirebase();
  if (!fb) {
    alert('Firebase를 로드할 수 없습니다.');
    return;
  }
  try {
    const user = await fb.signInWithGoogle();
    // Firestore에 사용자 정보 저장
    if (user && fb.saveUserInfo) {
      await fb.saveUserInfo(user);
    }
    alert('회원가입이 완료되었습니다!');
  } catch (error) {
    alert('회원가입에 실패했습니다: ' + error.message);
  }
};

// 로그아웃 처리
window.handleLogout = async function() {
  const fb = await loadFirebase();
  if (!fb) return;
  try {
    await fb.logout();
  } catch (error) {
    alert('로그아웃에 실패했습니다: ' + error.message);
  }
};

// 인증 UI 업데이트
function updateAuthUI(user) {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const userPhoto = document.getElementById('userPhoto');
  const userName = document.getElementById('userName');
  const menuUserPhoto = document.getElementById('menuUserPhoto');
  const menuUserName = document.getElementById('menuUserName');
  const menuUserEmail = document.getElementById('menuUserEmail');

  if (user) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    userPhoto.src = user.photoURL || '';
    userName.textContent = user.displayName || user.email;
    // 드롭다운 메뉴 정보
    if (menuUserPhoto) menuUserPhoto.src = user.photoURL || '';
    if (menuUserName) menuUserName.textContent = user.displayName || '';
    if (menuUserEmail) menuUserEmail.textContent = user.email || '';
  } else {
    loginBtn.style.display = 'flex';
    userInfo.style.display = 'none';
    closeProfileMenu();
  }
  // 검색 기록 버튼 표시/숨김
  const historyBtn = document.getElementById('historyBtn');
  if (historyBtn) {
    historyBtn.style.display = user ? 'inline-flex' : 'none';
  }
}

// 프로필 메뉴 토글
window.toggleProfileMenu = function() {
  const menu = document.getElementById('profileMenu');
  menu.classList.toggle('show');
};

// 프로필 메뉴 닫기
function closeProfileMenu() {
  const menu = document.getElementById('profileMenu');
  if (menu) menu.classList.remove('show');
}

// 외부 클릭 시 메뉴 닫기
document.addEventListener('click', function(e) {
  const profileDropdown = document.querySelector('.profile-dropdown');
  const profileMenu = document.getElementById('profileMenu');
  if (profileDropdown && profileMenu && !profileDropdown.contains(e.target) && !profileMenu.contains(e.target)) {
    closeProfileMenu();
  }
});

// 내 정보 보기
window.showMyInfo = function() {
  closeProfileMenu();
  if (!currentUser) return;

  alert(`이름: ${currentUser.displayName || '-'}\n이메일: ${currentUser.email || '-'}`);
};

// 검색기록 모달 상태
let historyModalState = {
  activeTab: 'recent', // 'recent' or 'favorites'
  favorites: []
};

// 검색 기록 보기
window.showSearchHistory = async function() {
  if (!currentUser) {
    alert('로그인이 필요합니다.');
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
function renderHistoryItem(item, isFavorite, type) {
  const starClass = isFavorite ? 'active' : '';
  const deleteBtn = type === 'history'
    ? `<button class="history-delete" onclick="deleteHistory('${item.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>`
    : `<button class="history-delete" onclick="deleteFavorite('${item.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>`;

  return `
    <div class="history-item" data-id="${item.id}" data-address="${item.address}">
      <button class="history-favorite ${starClass}" onclick="toggleFavorite('${item.address}', this)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </button>
      <div class="history-content" onclick="loadHistoryItem('${item.id}', '${type}')">
        <div class="history-address">${item.address}</div>
        <div class="history-date">${formatTimestamp(item.createdAt)}</div>
      </div>
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
      // 즐겨찾기 추가 - 해당 주소의 buildingData 찾기
      const historyItem = document.querySelector(`.history-item[data-address="${address}"]`);
      const docId = historyItem?.dataset.id;

      // 검색기록에서 buildingData 가져오기
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

// 주소 검색 (카카오 우편번호 서비스)
window.searchAddress = function() {
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
    }
  }).open();
}

// 건축물대장 조회 (4가지 동시 조회)
window.searchBuilding = async function() {
  if (!selectedAddressData) {
    alert('주소를 먼저 검색해주세요.');
    return;
  }

  showLoading(true);
  clearResult();

  try {
    const bcode = selectedAddressData.bcode;
    const sigunguCd = bcode.substring(0, 5);
    const bjdongCd = bcode.substring(5, 10);
    const jibunInfo = extractJibun(selectedAddressData.jibunAddress);

    // 4가지 API 동시 호출
    const [titleResult, floorResult, generalResult, permitResult] = await Promise.all([
      fetchBrTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo),
      fetchBrFlrOulnInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo),
      fetchBrRecapTitleInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo),
      fetchApBasisOulnInfo(API_KEY, sigunguCd, bjdongCd, jibunInfo)
    ]);

    displayAllResults(titleResult, floorResult, generalResult, permitResult);

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

// 표제부 조회 API
async function fetchBrTitleInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
}

// 층별 조회 API
async function fetchBrFlrOulnInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
}

// 총괄표제부 조회 API
async function fetchBrRecapTitleInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
}

// 건축인허가 기본개요 조회 API (허가일 정보)
async function fetchApBasisOulnInfo(apiKey, sigunguCd, bjdongCd, jibunInfo) {
  const url = new URL('https://apis.data.go.kr/1613000/ArchPmsHubService/getApBasisOulnInfo');
  url.searchParams.append('serviceKey', apiKey);
  url.searchParams.append('sigunguCd', sigunguCd);
  url.searchParams.append('bjdongCd', bjdongCd);
  url.searchParams.append('platGbCd', '0');
  if (jibunInfo.bun) url.searchParams.append('bun', jibunInfo.bun.padStart(4, '0'));
  if (jibunInfo.ji) url.searchParams.append('ji', jibunInfo.ji.padStart(4, '0'));
  url.searchParams.append('numOfRows', '100');
  url.searchParams.append('pageNo', '1');
  url.searchParams.append('_type', 'json');

  const response = await fetch(url);
  return await response.json();
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

  renderBuildingView();
}

// 건물 뷰 렌더링 (선택된 건물만 표시)
function renderBuildingView() {
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

  // 여러 건물이 있을 경우 건물 선택 탭 표시 (클릭 시 동별표제부 모달 열기)
  if (buildingCount > 1) {
    html += `
      <div class="building-selector-wrapper">
        <button class="scroll-btn scroll-left" onclick="scrollBuildingSelector(-1)" aria-label="왼쪽">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div class="building-selector" id="buildingSelector">
    `;
    sortedIndices.forEach((originalIndex, sortedIdx) => {
      const item = titleItems[originalIndex];
      const buildingName = item.dongNm || item.bldNm || `건물 ${sortedIdx + 1}`;
      const area = item.totArea ? Number(item.totArea).toLocaleString() : '-';
      html += `
          <button class="building-tab" onclick="showTitleModal(${originalIndex})">
            <span class="tab-name">${buildingName}</span>
            <span class="tab-area">${area}㎡</span>
            ${sortedIdx === 0 ? '<span class="tab-badge">메인</span>' : ''}
          </button>
      `;
    });
    html += `
        </div>
        <button class="scroll-btn scroll-right" onclick="scrollBuildingSelector(1)" aria-label="오른쪽">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
    `;
  }

  // 총괄 요약 카드 표시 (총괄표제부 기준)
  html += renderSummaryCard(generalInfo, permitInfo, titleItems);

  resultDiv.innerHTML = html;
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
function renderSummaryCard(generalInfo, permitInfo, titleItems) {
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
  const fmtDate = (d) => d ? `${d.substring(0,4)}.${d.substring(4,6)}.${d.substring(6,8)}` : '-';
  const fmtArea = (a) => a ? Number(a).toLocaleString('ko-KR', {minimumFractionDigits: 0, maximumFractionDigits: 2}) : '-';
  const fmtHeight = (h) => h ? Number(h).toFixed(2) + 'm' : '-';

  return `
    <div class="summary-card">
      <div class="summary-header">
        <div class="summary-building-name">${buildingName}</div>
      </div>
      <div class="summary-grid">
        <div class="summary-grid-item">
          <span class="summary-grid-label">주용도</span>
          <span class="summary-grid-value">${mainPurpose}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">기타용도</span>
          <span class="summary-grid-value">${etcPurpose}</span>
        </div>
        <div class="summary-grid-item full-width">
          <span class="summary-grid-label">주소</span>
          <span class="summary-grid-value">${address}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">건축허가일</span>
          <span class="summary-grid-value">${fmtDate(permitDate)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">사용승인일</span>
          <span class="summary-grid-value">${fmtDate(approvalDate)}</span>
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
          <span class="summary-grid-value">${households || '-'}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지상층수</span>
          <span class="summary-grid-value">${groundFloors || '-'}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지하층수</span>
          <span class="summary-grid-value">${undergroundFloors || '-'}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">높이</span>
          <span class="summary-grid-value">${fmtHeight(height)}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">건축물구조</span>
          <span class="summary-grid-value">${structure}</span>
        </div>
        <div class="summary-grid-item">
          <span class="summary-grid-label">지붕구조</span>
          <span class="summary-grid-value">${roofStructure}</span>
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
  currentTitleData.selectedIndex = index;
  const html = renderDetailTitleCard(currentTitleData.items, index, currentTitleData.pmsDay);
  document.getElementById('detailModalBody').innerHTML = html;
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
  const fmtDate = (d) => d ? `${d.substring(0,4)}.${d.substring(4,6)}.${d.substring(6,8)}` : '-';
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
            ${name}
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
      <span class="info-chip primary">${item.mainPurpsCdNm || '-'}</span>
      <span class="info-chip">${item.strctCdNm || '-'}</span>
      <span class="info-chip">지상${item.grndFlrCnt || '-'}층 / 지하${item.ugrndFlrCnt || '-'}층</span>
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
          <span class="detail-info-value">${item.grndFlrCnt || '-'}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지하층수</span>
          <span class="detail-info-value">${item.ugrndFlrCnt || '-'}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">세대수</span>
          <span class="detail-info-value">${item.hhldCnt || '-'}세대</span>
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
          <span class="detail-info-value">${item.mainPurpsCdNm || '-'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">기타용도</span>
          <span class="detail-info-value">${item.etcPurps || '-'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">구조</span>
          <span class="detail-info-value">${item.strctCdNm || '-'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지붕구조</span>
          <span class="detail-info-value">${item.roofCdNm || '-'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">승용승강기</span>
          <span class="detail-info-value">${item.rideUseElvtCnt || '0'}대</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">비상승강기</span>
          <span class="detail-info-value">${item.emgenUseElvtCnt || '0'}대</span>
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

  // 7. 적용 소방법령
  if (pmsDay) {
    html += renderLawInfoCard(pmsDay);
  }

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
        <button class="floor-sort-btn ${sortMode === 'usage' ? 'active' : ''}" onclick="changeFloorSortMode('usage')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M3 12h12M3 18h6"/>
          </svg>
          용도별
        </button>
      </div>
    </div>`;

  // 2. 층별 리스트 (검색결과)
  html += `<div class="detail-section floor-section-large">`;

  // 정렬 모드에 따른 렌더링
  if (sortMode === 'usage') {
    // 용도별 그룹화
    const usageGroups = {};
    items.forEach(item => {
      const use = item.mainPurpsCdNm || '기타';
      if (!usageGroups[use]) usageGroups[use] = [];
      usageGroups[use].push(item);
    });

    Object.entries(usageGroups).forEach(([use, floors]) => {
      html += `<div class="floor-group-header">${use}</div>`;
      html += `<div class="detail-floor-list">`;
      floors.sort((a, b) => {
        const aVal = a.flrGbCdNm === '지하' ? -Number(a.flrNo) : Number(a.flrNo);
        const bVal = b.flrGbCdNm === '지하' ? -Number(b.flrNo) : Number(b.flrNo);
        return bVal - aVal;
      }).forEach(item => {
        const floorLabel = item.flrGbCdNm === '지하' ? `B${item.flrNo}` : `${item.flrNo}F`;
        const etcPurps = item.etcPurps ? `<span class="floor-etc">${item.etcPurps}</span>` : '';
        html += `
          <div class="detail-floor-item">
            <span class="floor-num">${floorLabel}</span>
            <span class="floor-use">${item.mainPurpsCdNm || '-'}</span>
            ${etcPurps}
            <span class="floor-area">${item.area ? Number(item.area).toLocaleString() : '-'}㎡</span>
          </div>`;
      });
      html += `</div>`;
    });
  } else {
    // 층수 기준 정렬 (지상/지하 분리)
    const isDesc = sortMode === 'floor-desc';
    const groundFloors = items.filter(f => f.flrGbCdNm !== '지하')
      .sort((a, b) => isDesc ? Number(b.flrNo) - Number(a.flrNo) : Number(a.flrNo) - Number(b.flrNo));
    const undergroundFloors = items.filter(f => f.flrGbCdNm === '지하')
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
          const etcPurps = item.etcPurps ? `<span class="floor-etc">${item.etcPurps}</span>` : '';
          html += `
            <div class="detail-floor-item">
              <span class="floor-num">${floorLabel}</span>
              <span class="floor-use">${item.mainPurpsCdNm || '-'}</span>
              ${etcPurps}
              <span class="floor-area">${item.area ? Number(item.area).toLocaleString() : '-'}㎡</span>
            </div>`;
        });
        html += `</div>`;
      }
    });
  }

  html += `</div>`;

  // 3. 용도별 면적 합계
  const usageSummary = {};
  items.forEach(item => {
    const use = item.mainPurpsCdNm || '기타';
    usageSummary[use] = (usageSummary[use] || 0) + (Number(item.area) || 0);
  });

  html += `<div class="usage-summary">`;
  Object.entries(usageSummary).forEach(([use, area]) => {
    html += `<span class="usage-chip">${use}: ${area.toLocaleString()}㎡</span>`;
  });
  html += `</div>`;

  // 4. 적용 소방법령 (최하단)
  if (pmsDay) {
    html += renderLawInfoCard(pmsDay);
  }

  return html;
}

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
      <span class="info-chip primary">${item.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-'}</span>
      <span class="info-chip">${structure}</span>
      <span class="info-chip">지상${grndFlrCnt || '-'}층 / 지하${ugrndFlrCnt || '-'}층</span>
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
          <span class="detail-info-value">${grndFlrCnt || '-'}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지하층수</span>
          <span class="detail-info-value">${ugrndFlrCnt || '-'}층</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">세대수</span>
          <span class="detail-info-value">${item.hhldCnt || '-'}세대</span>
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
          <span class="detail-info-value">${item.vlRat || '-'}%</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">건폐율</span>
          <span class="detail-info-value">${item.bcRat || '-'}%</span>
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
          <span class="detail-info-value">${item.mainPurpsCdNm || mainTitle.mainPurpsCdNm || '-'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">기타용도</span>
          <span class="detail-info-value">${item.etcPurps || mainTitle.etcPurps || '-'}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">구조</span>
          <span class="detail-info-value">${structure}</span>
        </div>
        <div class="detail-info-item">
          <span class="detail-info-label">지붕구조</span>
          <span class="detail-info-value">${roofStructure}</span>
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

  // 6. 적용 소방법령
  if (permitDate) {
    html += renderLawInfoCard(permitDate);
  }

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
  if (!dateStr || dateStr.length !== 8) return '-';
  return `${dateStr.substring(0, 4)}.${dateStr.substring(4, 6)}.${dateStr.substring(6, 8)}`;
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
  document.getElementById('result').innerHTML = `<div class="error-message">${message}</div>`;
}

