// 공통 컴포넌트 - 헤더, 프로필 메뉴, 모달, 푸터
// 모든 페이지에서 동일하게 사용

// 현재 로그인된 사용자 (내부 추적용)
let _currentUser = null;

// 로고 SVG
const logoSvg = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2L2 7V10C2 16.5 6.84 22.74 12 24C17.16 22.74 22 16.5 22 10V7L12 2Z" fill="currentColor" opacity="0.2"/>
  <path d="M12 2L2 7V10C2 16.5 6.84 22.74 12 24C17.16 22.74 22 16.5 22 10V7L12 2ZM12 22C7.94 20.84 4 15.36 4 10.5V8.3L12 4.26L20 8.3V10.5C20 15.36 16.06 20.84 12 22Z" fill="currentColor"/>
  <path d="M12 7C10.34 7 9 8.34 9 10V11H8V17H16V11H15V10C15 8.34 13.66 7 12 7ZM13 11H11V10C11 9.45 11.45 9 12 9C12.55 9 13 9.45 13 10V11Z" fill="currentColor"/>
</svg>`;

// Google 로그인 아이콘 SVG
const googleIconSvg = `
<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
</svg>`;

// 헤더 HTML 생성
export function getHeaderHTML() {
  return `
    <div class="top-bar">
      <a href="/" class="home-btn" aria-label="홈으로">
        ${logoSvg}
      </a>
      <div id="authSection" class="auth-section">
        <div id="loginBtn" class="auth-btn" onclick="handleGoogleLogin()">
          ${googleIconSvg}
          <span>로그인</span>
        </div>
        <div id="userInfo" class="user-info" style="display: none;">
          <div class="profile-dropdown" onclick="toggleProfileMenu()">
            <img id="userPhoto" class="user-photo" src="" alt="프로필">
            <span id="userName" class="user-name"></span>
            <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
          <div id="profileMenu" class="profile-menu">
            <div class="profile-menu-header">
              <img id="menuUserPhoto" class="menu-user-photo" src="" alt="프로필">
              <div class="menu-user-info">
                <span id="menuUserName" class="menu-user-name"></span>
                <span id="menuUserEmail" class="menu-user-email"></span>
                <span id="menuUserRole" class="user-role-badge"></span>
              </div>
            </div>
            <div class="profile-menu-divider"></div>
            <button id="adminMenuItem" class="profile-menu-item" onclick="goToAdminPage()" style="display: none;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              회원 관리
            </button>
            <button id="adAdminMenuItem" class="profile-menu-item" onclick="goToAdAdminPage()" style="display: none;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
              </svg>
              광고 관리
            </button>
            <button class="profile-menu-item" onclick="showMyInfo()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
              </svg>
              내 정보
            </button>
            <button class="profile-menu-item" onclick="showSettings()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              설정
            </button>
            <div class="profile-menu-divider"></div>
            <button class="profile-menu-item logout" onclick="handleLogout()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
              로그아웃
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// 공유 모달 HTML 생성 (인증, 내 정보, 설정)
function getModalsHTML() {
  return `
    <div id="authModal" class="modal" style="display: none;">
      <div class="auth-modal-content">
        <button class="auth-modal-close" onclick="closeAuthModal()" aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <h2 class="auth-modal-title">시작하기</h2>
        <div class="auth-modal-buttons">
          <button class="auth-modal-btn login-btn" onclick="handleLogin()">
            ${googleIconSvg}
            로그인
          </button>
          <button class="auth-modal-btn signup-btn" onclick="handleSignup()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6"/>
            </svg>
            회원가입
          </button>
        </div>
        <p class="auth-modal-hint">로그인 또는 회원가입을 선택하세요</p>
        <p class="auth-modal-terms"><a href="/pages/terms.html">이용약관</a> · <a href="/pages/privacy.html">개인정보처리방침</a></p>
      </div>
    </div>
    <div id="myInfoModal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>내 정보</h2>
          <button class="modal-close" onclick="closeMyInfoModal()" aria-label="닫기">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="my-info-content">
            <div class="my-info-avatar">
              <img id="myInfoPhoto" src="" alt="프로필">
            </div>
            <div class="my-info-details">
              <div class="my-info-row">
                <span class="my-info-label">이름</span>
                <span id="myInfoName" class="my-info-value">-</span>
              </div>
              <div class="my-info-row">
                <span class="my-info-label">이메일</span>
                <span id="myInfoEmail" class="my-info-value">-</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="settingsModal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>설정</h2>
          <button class="modal-close" onclick="closeSettingsModal()" aria-label="닫기">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="settings-section">
            <div class="settings-section-title">화면 테마</div>
            <div class="theme-options">
              <button class="theme-option" data-theme="light" onclick="setTheme('light')">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                <span>라이트</span>
              </button>
              <button class="theme-option" data-theme="dark" onclick="setTheme('dark')">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
                <span>다크</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// 푸터 HTML 생성
export function getFooterHTML() {
  return `
    <footer>
      <div class="footer-links">
        <a href="/guide/">시설가이드</a>
        <span class="footer-divider">·</span>
        <a href="/pages/timeline.html">법령연혁</a>
        <span class="footer-divider">·</span>
        <a href="/pages/checklist.html">용도체크</a>
        <span class="footer-divider">·</span>
        <a href="/pages/reference.html">자료실</a>
      </div>
      <div class="footer-links" style="margin-top: 8px;">
        <a href="/pages/about.html">서비스 소개</a>
        <span class="footer-divider">·</span>
        <a href="/pages/terms.html">이용약관</a>
        <span class="footer-divider">·</span>
        <a href="/pages/privacy.html">개인정보처리방침</a>
      </div>
      <p>&copy; 2025 소방체크. 소방시설 설치기준 확인 서비스</p>
    </footer>`;
}

// ==================== 렌더링 ====================

// 헤더 렌더링
export function renderHeader(containerId = 'header-container') {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = getHeaderHTML();
  } else {
    // container가 없으면 body 첫번째 .container 안에 삽입
    const mainContainer = document.querySelector('.container');
    if (mainContainer) {
      mainContainer.insertAdjacentHTML('afterbegin', getHeaderHTML());
    }
  }

  // 모달이 아직 없으면 body에 삽입
  if (!document.getElementById('authModal')) {
    document.body.insertAdjacentHTML('beforeend', getModalsHTML());
  }
}

// 푸터 렌더링
export function renderFooter(containerId = 'footer-container') {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = getFooterHTML();
  }
}

// ==================== Firebase ====================

// Firebase 동적 로드
let firebaseModule = null;
async function loadFirebase() {
  if (firebaseModule) return firebaseModule;
  try {
    firebaseModule = await import('/js/firebase.js');
    return firebaseModule;
  } catch (error) {
    console.error('Firebase 로드 실패:', error);
    return null;
  }
}

// ==================== 인증 UI ====================

// 인증 UI 업데이트
export async function updateAuthUI(user) {
  _currentUser = user;

  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const userPhoto = document.getElementById('userPhoto');
  const userName = document.getElementById('userName');
  const menuUserPhoto = document.getElementById('menuUserPhoto');
  const menuUserName = document.getElementById('menuUserName');
  const menuUserEmail = document.getElementById('menuUserEmail');
  const menuUserRole = document.getElementById('menuUserRole');
  const adminMenuItem = document.getElementById('adminMenuItem');
  const adAdminMenuItem = document.getElementById('adAdminMenuItem');
  const authSection = document.getElementById('authSection');

  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userInfo) userInfo.style.display = 'flex';
    if (userPhoto) userPhoto.src = user.photoURL || '';
    if (userName) userName.textContent = user.displayName || user.email;
    if (menuUserPhoto) menuUserPhoto.src = user.photoURL || '';
    if (menuUserName) menuUserName.textContent = user.displayName || '';
    if (menuUserEmail) menuUserEmail.textContent = user.email || '';

    // 사용자 등급 정보 가져오기
    const fb = await loadFirebase();
    if (fb && fb.getCurrentUserInfo) {
      const userInfoData = await fb.getCurrentUserInfo();
      const role = userInfoData?.role || 'free';
      const roleLabel = fb.ROLE_LABELS?.[role] || '무료이용자';
      const isAdminOrManager = role === 'admin' || role === 'manager';

      if (menuUserRole) {
        menuUserRole.textContent = roleLabel;
        menuUserRole.className = 'user-role-badge role-' + role;
      }

      // 관리자 메뉴 표시/숨김
      if (adminMenuItem) {
        adminMenuItem.style.display = isAdminOrManager ? 'flex' : 'none';
      }
      if (adAdminMenuItem) {
        adAdminMenuItem.style.display = isAdminOrManager ? 'flex' : 'none';
      }
    }
  } else {
    if (loginBtn) loginBtn.style.display = 'flex';
    if (userInfo) userInfo.style.display = 'none';
    closeProfileMenu();
    if (menuUserRole) menuUserRole.textContent = '';
    if (adminMenuItem) adminMenuItem.style.display = 'none';
    if (adAdminMenuItem) adAdminMenuItem.style.display = 'none';
  }

  if (authSection) {
    authSection.classList.add('auth-ready');
  }
}

// ==================== 프로필 메뉴 ====================

// 프로필 메뉴 토글
export function toggleProfileMenu() {
  const menu = document.getElementById('profileMenu');
  if (menu) menu.classList.toggle('show');
}

// 프로필 메뉴 닫기
export function closeProfileMenu() {
  const menu = document.getElementById('profileMenu');
  if (menu) menu.classList.remove('show');
}

// ==================== 페이지 이동 ====================

// 관리자 페이지로 이동
export function goToAdminPage() {
  closeProfileMenu();
  window.location.href = '/pages/admin.html';
}

// 광고 관리 페이지로 이동
export function goToAdAdminPage() {
  closeProfileMenu();
  window.location.href = '/pages/ad-admin.html';
}

// ==================== 인증 모달 ====================

// 로그인/회원가입 모달 열기
export function handleGoogleLogin() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'flex';
}

// 인증 모달 닫기
export function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
}

// 로그인 처리
export async function handleLogin() {
  closeAuthModal();
  const fb = await loadFirebase();
  if (!fb) {
    alert('Firebase를 로드할 수 없습니다.');
    return;
  }
  try {
    const user = await fb.signInWithGoogle();
    if (user && fb.saveUserInfo) {
      await fb.saveUserInfo(user);
    }
  } catch (error) {
    if (error.code === 'auth/popup-closed-by-user') return;
    alert('로그인에 실패했습니다: ' + error.message);
  }
}

// 회원가입 처리
export async function handleSignup() {
  closeAuthModal();
  const fb = await loadFirebase();
  if (!fb) {
    alert('Firebase를 로드할 수 없습니다.');
    return;
  }
  try {
    const signUp = fb.signUpWithGoogle || fb.signInWithGoogle;
    const user = await signUp();
    if (user && fb.saveUserInfo) {
      await fb.saveUserInfo(user);
    }
  } catch (error) {
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
    alert('회원가입에 실패했습니다: ' + error.message);
  }
}

// 로그아웃 처리
export async function handleLogout() {
  const fb = await loadFirebase();
  if (!fb) return;
  try {
    await fb.logout();
    closeProfileMenu();
  } catch (error) {
    alert('로그아웃에 실패했습니다: ' + error.message);
  }
}

// ==================== 내 정보 모달 ====================

// 내 정보 보기
export function showMyInfo() {
  closeProfileMenu();
  if (!_currentUser) return;

  const photo = document.getElementById('myInfoPhoto');
  const name = document.getElementById('myInfoName');
  const email = document.getElementById('myInfoEmail');
  const modal = document.getElementById('myInfoModal');

  if (photo) photo.src = _currentUser.photoURL || '';
  if (name) name.textContent = _currentUser.displayName || '-';
  if (email) email.textContent = _currentUser.email || '-';
  if (modal) modal.style.display = 'flex';
}

// 내 정보 모달 닫기
export function closeMyInfoModal() {
  const modal = document.getElementById('myInfoModal');
  if (modal) modal.style.display = 'none';
}

// ==================== 설정 모달 ====================

// 테마 옵션 UI 업데이트
function updateThemeOptions() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });
}

// 설정 보기
export function showSettings() {
  closeProfileMenu();
  updateThemeOptions();
  const modal = document.getElementById('settingsModal');
  if (modal) modal.style.display = 'flex';
}

// 설정 모달 닫기
export function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.style.display = 'none';
}

// 테마 설정
export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeOptions();
}

// ==================== 이벤트 핸들러 ====================

// 외부 클릭 시 메뉴 닫기 이벤트 등록
function setupClickOutside() {
  document.addEventListener('click', function(e) {
    const profileDropdown = document.querySelector('.profile-dropdown');
    const profileMenu = document.getElementById('profileMenu');
    if (profileDropdown && profileMenu && !profileDropdown.contains(e.target) && !profileMenu.contains(e.target)) {
      closeProfileMenu();
    }
  });
}

// ESC 키로 공유 모달 닫기
function setupEscHandler() {
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const modalCloseMap = [
      ['myInfoModal', closeMyInfoModal],
      ['settingsModal', closeSettingsModal],
      ['authModal', closeAuthModal],
    ];
    for (const [id, fn] of modalCloseMap) {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none' && el.style.display !== '') {
        fn();
        return;
      }
    }
  });
}

// ==================== 초기화 ====================

// 컴포넌트 초기화 (헤더 + 인증 상태 감지)
let _initialized = false;
export async function initComponents() {
  if (_initialized) return;
  _initialized = true;

  // 이벤트 설정
  setupClickOutside();
  setupEscHandler();

  // 전역 함수로 등록
  window.toggleProfileMenu = toggleProfileMenu;
  window.closeProfileMenu = closeProfileMenu;
  window.goToAdminPage = goToAdminPage;
  window.goToAdAdminPage = goToAdAdminPage;
  window.handleGoogleLogin = handleGoogleLogin;
  window.handleLogin = handleLogin;
  window.handleSignup = handleSignup;
  window.closeAuthModal = closeAuthModal;
  window.handleLogout = handleLogout;
  window.showMyInfo = showMyInfo;
  window.closeMyInfoModal = closeMyInfoModal;
  window.showSettings = showSettings;
  window.closeSettingsModal = closeSettingsModal;
  window.setTheme = setTheme;

  // Firebase 인증 상태 감지
  const fb = await loadFirebase();
  if (fb && fb.onAuthChange) {
    fb.onAuthChange(async (user) => {
      updateAuthUI(user);
      // 로그인된 사용자 정보를 Firestore에 저장 (누락 방지)
      if (user && fb.saveUserInfo) {
        try {
          await fb.saveUserInfo(user);
        } catch (e) {
          console.error('사용자 정보 저장 실패:', e);
        }
      }
    });
  }
}

// 자동 초기화 (DOMContentLoaded)
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // header-container가 있으면 자동으로 헤더 렌더링
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
      renderHeader('header-container');
      initComponents();
    }

    // footer-container가 있으면 자동으로 푸터 렌더링
    const footerContainer = document.getElementById('footer-container');
    if (footerContainer) {
      renderFooter('footer-container');
    }
  });
}
