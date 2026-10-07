// Firebase 초기화 및 인증 (CDN 방식)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHZq-GQsvzlCXajzEG5fZqo_7khF0W_yA",
  authDomain: "fire-5a8f3.firebaseapp.com",
  projectId: "fire-5a8f3",
  storageBucket: "fire-5a8f3.firebasestorage.app",
  messagingSenderId: "651331831897",
  appId: "1:651331831897:web:7e726b899abeadc7ef4948",
  measurementId: "G-VZJQW29DRB"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

// ==================== 사용자 등급 시스템 ====================

// 등급 상수
export const USER_ROLES = {
  FREE: 'free',
  FREE_BUSINESS: 'freeBusiness',
  PAID: 'paid',
  PAID_BUSINESS: 'paidBusiness',
  MANAGER: 'manager',
  ADMIN: 'admin'
};

// 등급 한글 라벨
export const ROLE_LABELS = {
  free: '무료이용자',
  freeBusiness: '무료기업회원',
  paid: '유료회원',
  paidBusiness: '유료기업회원',
  manager: '관리자',
  admin: 'Admin'
};

// 최초 관리자 이메일
const ADMIN_EMAIL = 'lcjun37@gmail.com';

// 즐겨찾기 메모 최대 길이 (firestore.rules와 동일)
const MEMO_MAX_LENGTH = 500;

// 모바일 브라우저 감지
function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

// Google OAuth Client ID (Firebase 프로젝트에서 자동 생성)
const GOOGLE_CLIENT_ID = '651331831897-2tmd717q6kmo3mhpbac6ub80q3uukbr0.apps.googleusercontent.com';

// Google Identity Services 스크립트 로드
function loadGISScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google 로그인 라이브러리 로드 실패'));
    document.head.appendChild(script);
  });
}

// GIS One Tap 로그인 (페이지 내에서 처리, 팝업/리다이렉트 없음)
function signInWithGIS() {
  return new Promise((resolve, reject) => {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        try {
          const credential = GoogleAuthProvider.credential(response.credential);
          const result = await signInWithCredential(auth, credential);
          console.log('GIS 로그인 성공:', result.user.displayName);
          resolve(result.user);
        } catch (error) {
          reject(error);
        }
      }
    });

    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        console.log('One Tap 표시 불가:', notification.getNotDisplayedReason());
        reject(new Error('ONE_TAP_NOT_DISPLAYED'));
      } else if (notification.isSkippedMoment()) {
        console.log('One Tap 건너뜀:', notification.getSkippedReason());
        reject(new Error('ONE_TAP_SKIPPED'));
      }
    });
  });
}

// Google 로그인 (기존 계정으로 빠른 로그인)
export async function signInWithGoogle() {
  try {
    if (isMobileBrowser()) {
      // 모바일: GIS One Tap 시도 (accounts.google.com 이동 없이 페이지 내 처리)
      try {
        await loadGISScript();
        return await signInWithGIS();
      } catch (gisError) {
        console.log('GIS 실패, popup 방식으로 재시도:', gisError.message);
        const result = await signInWithPopup(auth, provider);
        return result.user;
      }
    } else {
      const result = await signInWithPopup(auth, provider);
      console.log('로그인 성공:', result.user.displayName);
      return result.user;
    }
  } catch (error) {
    console.error('로그인 실패:', error);
    throw error;
  }
}

// Google 회원가입 (계정 선택 화면 표시)
export async function signUpWithGoogle() {
  try {
    if (isMobileBrowser()) {
      // 모바일: GIS Token Client 사용 (계정 선택 가능)
      try {
        await loadGISScript();
        return await signUpWithGIS();
      } catch (gisError) {
        console.log('GIS 회원가입 실패, popup 방식으로 재시도:', gisError.message);
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(auth, provider);
        return result.user;
      }
    } else {
      // 데스크톱: popup 방식 + 계정 선택 강제
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      console.log('회원가입 성공:', result.user.displayName);
      return result.user;
    }
  } catch (error) {
    console.error('회원가입 실패:', error);
    throw error;
  }
}

// GIS Token Client로 계정 선택 (회원가입용)
function signUpWithGIS() {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'email profile',
      prompt: 'select_account',
      callback: async (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        try {
          const credential = GoogleAuthProvider.credential(null, response.access_token);
          const result = await signInWithCredential(auth, credential);
          console.log('GIS 회원가입 성공:', result.user.displayName);
          resolve(result.user);
        } catch (error) {
          reject(error);
        }
      }
    });
    client.requestAccessToken();
  });
}

// 로그아웃
export async function logout() {
  try {
    await signOut(auth);
    console.log('로그아웃 완료');
  } catch (error) {
    console.error('로그아웃 실패:', error);
    throw error;
  }
}

// 인증 상태 변경 감지
export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

// 현재 사용자 가져오기
export function getCurrentUser() {
  return auth.currentUser;
}

// ==================== Firestore 함수 ====================

// 사용자 정보 저장 (로그인/회원가입 시)
// 로그인 직후 인증 상태 리스너와 로그인 처리 함수가 동시에 호출하므로 사용자별로 한 번만 실행한다.
// (동시에 실행되면 신규 회원의 두 번째 쓰기가 '수정'으로 평가되어 보안 규칙에 거부됨)
const saveUserInfoInflight = new Map();

export function saveUserInfo(user) {
  if (!user) return Promise.resolve(null);
  if (!saveUserInfoInflight.has(user.uid)) {
    const task = saveUserInfoOnce(user).finally(() => saveUserInfoInflight.delete(user.uid));
    saveUserInfoInflight.set(user.uid, task);
  }
  return saveUserInfoInflight.get(user.uid);
}

async function saveUserInfoOnce(user) {

  try {
    const userRef = doc(db, 'users', user.uid);

    // 기존 사용자 정보 확인
    const existingDoc = await getDoc(userRef);
    const existingData = existingDoc.exists() ? existingDoc.data() : null;

    // 등급 결정 (Firestore 규칙과 동일한 기준):
    // 1. 신규 회원은 free 등급으로 생성 (최고 관리자 이메일만 admin)
    // 2. 기존 회원의 등급은 로그인 때마다 다시 쓰지 않는다 (등급 변경은 관리자 화면에서만)
    // 3. 최고 관리자 이메일이 아직 admin이 아니면 admin으로 승격
    const isSuperAdmin = user.email === ADMIN_EMAIL && user.emailVerified === true;

    const userData = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      lastLoginAt: serverTimestamp()
    };

    if (!existingData) {
      userData.role = isSuperAdmin ? USER_ROLES.ADMIN : USER_ROLES.FREE;
      userData.createdAt = serverTimestamp();
    } else if (isSuperAdmin && existingData.role !== USER_ROLES.ADMIN) {
      userData.role = USER_ROLES.ADMIN;
    }

    await setDoc(userRef, userData, { merge: true });
    console.log('사용자 정보 저장 완료:', user.email, '등급:', userData.role || existingData?.role);
    return true;
  } catch (error) {
    console.error('사용자 정보 저장 실패:', error);
    throw error;
  }
}

// 사용자 등급 조회 (uid로)
export async function getUserRole(uid) {
  if (!uid) return null;

  try {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      return userDoc.data().role || USER_ROLES.FREE;
    }
    return USER_ROLES.FREE;
  } catch (error) {
    console.error('사용자 등급 조회 실패:', error);
    return USER_ROLES.FREE;
  }
}

// 현재 로그인한 사용자의 등급 조회
export async function getCurrentUserRole() {
  const user = auth.currentUser;
  if (!user) return null;
  return await getUserRole(user.uid);
}

// 현재 사용자 정보 조회 (등급 포함)
export async function getCurrentUserInfo() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      return userDoc.data();
    }
    return null;
  } catch (error) {
    console.error('사용자 정보 조회 실패:', error);
    return null;
  }
}

// 현재 사용자가 admin인지 확인
export async function isAdmin() {
  const role = await getCurrentUserRole();
  return role === USER_ROLES.ADMIN;
}

// 현재 사용자가 manager 이상인지 확인
export async function isManager() {
  const role = await getCurrentUserRole();
  return role === USER_ROLES.ADMIN || role === USER_ROLES.MANAGER;
}

// 사용자 등급 변경 (admin/manager만 가능)
export async function updateUserRole(uid, newRole) {
  const currentRole = await getCurrentUserRole();
  if (currentRole !== USER_ROLES.ADMIN && currentRole !== USER_ROLES.MANAGER) {
    console.error('권한이 없습니다.');
    return false;
  }

  // manager는 admin 등급을 부여할 수 없음
  if (currentRole === USER_ROLES.MANAGER && newRole === USER_ROLES.ADMIN) {
    console.error('관리자는 Admin 등급을 부여할 수 없습니다.');
    return false;
  }

  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      role: newRole,
      updatedAt: serverTimestamp()
    });
    console.log('사용자 등급 변경 완료:', uid, newRole);
    return true;
  } catch (error) {
    console.error('사용자 등급 변경 실패:', error);
    throw error;
  }
}

// 전체 사용자 목록 조회 (admin/manager만 가능)
export async function getAllUsers() {
  const currentRole = await getCurrentUserRole();
  if (currentRole !== USER_ROLES.ADMIN && currentRole !== USER_ROLES.MANAGER) {
    console.error('권한이 없습니다.');
    return [];
  }

  try {
    const q = query(
      collection(db, 'users'),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    const users = [];
    querySnapshot.forEach((doc) => {
      users.push({ ...doc.data(), id: doc.id });
    });
    return users;
  } catch (error) {
    console.error('사용자 목록 조회 실패:', error);
    throw error;
  }
}

// 검색 기록 저장
export async function saveSearchHistory(addressData, buildingData) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return null;
  }

  try {
    const docRef = await addDoc(collection(db, 'searchHistory'), {
      userId: user.uid,
      userEmail: user.email,
      address: addressData.address,
      jibunAddress: addressData.jibunAddress,
      roadAddress: addressData.roadAddress,
      bcode: addressData.bcode,
      buildingData: buildingData,
      createdAt: serverTimestamp()
    });
    console.log('검색 기록 저장 완료:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('검색 기록 저장 실패:', error);
    throw error;
  }
}

// 내 검색 기록 조회
export async function getMySearchHistory(limitCount = 20) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return [];
  }

  try {
    const q = query(
      collection(db, 'searchHistory'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const querySnapshot = await getDocs(q);
    const history = [];
    querySnapshot.forEach((doc) => {
      history.push({ ...doc.data(), id: doc.id });
    });
    return history;
  } catch (error) {
    console.error('검색 기록 조회 실패:', error);
    throw error;
  }
}

// 검색 기록 삭제
export async function deleteSearchHistory(docId) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return false;
  }

  try {
    await deleteDoc(doc(db, 'searchHistory', docId));
    console.log('검색 기록 삭제 완료:', docId);
    return true;
  } catch (error) {
    console.error('검색 기록 삭제 실패:', error);
    throw error;
  }
}

// ==================== 즐겨찾기 함수 ====================

// 즐겨찾기 추가
export async function addFavorite(addressData, buildingData) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return null;
  }

  try {
    const docRef = await addDoc(collection(db, 'favorites'), {
      userId: user.uid,
      userEmail: user.email,
      address: addressData.address,
      jibunAddress: addressData.jibunAddress,
      roadAddress: addressData.roadAddress,
      bcode: addressData.bcode,
      buildingData: buildingData,
      createdAt: serverTimestamp()
    });
    console.log('즐겨찾기 추가 완료:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('즐겨찾기 추가 실패:', error);
    throw error;
  }
}

// 즐겨찾기 삭제
export async function removeFavorite(docId) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return false;
  }

  try {
    await deleteDoc(doc(db, 'favorites', docId));
    console.log('즐겨찾기 삭제 완료:', docId);
    return true;
  } catch (error) {
    console.error('즐겨찾기 삭제 실패:', error);
    throw error;
  }
}

// 내 즐겨찾기 목록 조회
export async function getMyFavorites(limitCount = 50) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return [];
  }

  try {
    const q = query(
      collection(db, 'favorites'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const querySnapshot = await getDocs(q);
    const favorites = [];
    querySnapshot.forEach((doc) => {
      favorites.push({ ...doc.data(), id: doc.id });
    });
    return favorites;
  } catch (error) {
    console.error('즐겨찾기 조회 실패:', error);
    throw error;
  }
}

// 주소로 즐겨찾기 여부 확인
export async function checkFavorite(address) {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const q = query(
      collection(db, 'favorites'),
      where('userId', '==', user.uid),
      where('address', '==', address),
      limit(1)
    );
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return null;

    let result = null;
    querySnapshot.forEach((doc) => {
      result = { ...doc.data(), id: doc.id };
    });
    return result;
  } catch (error) {
    console.error('즐겨찾기 확인 실패:', error);
    return null;
  }
}

// 즐겨찾기 메모 업데이트
export async function updateFavoriteMemo(docId, memo) {
  const user = auth.currentUser;
  if (!user) {
    console.log('로그인이 필요합니다.');
    return false;
  }

  try {
    const favoriteRef = doc(db, 'favorites', docId);
    await updateDoc(favoriteRef, {
      memo: String(memo || '').slice(0, MEMO_MAX_LENGTH),
      updatedAt: serverTimestamp()
    });
    console.log('메모 업데이트 완료:', docId);
    return true;
  } catch (error) {
    console.error('메모 업데이트 실패:', error);
    throw error;
  }
}

// ==================== 공유 링크 함수 ====================

// 짧은 ID 생성 (8자리, 암호학적 난수 — 추측·열거 방지)
function generateShortId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let result = '';
  for (const b of bytes) {
    result += chars.charAt(b % chars.length);
  }
  return result;
}

// 공유 링크 생성
export async function createShareLink(data) {
  try {
    // 규칙과 동일한 형식 검증 (시군구·법정동 5자리, 번·지 0~4자리 숫자)
    const payload = {
      sigunguCd: String(data.sigunguCd || ''),
      bjdongCd: String(data.bjdongCd || ''),
      bun: String(data.bun || ''),
      ji: String(data.ji || ''),
      platGbCd: String(data.platGbCd || '0')
    };
    if (!/^\d{5}$/.test(payload.sigunguCd) || !/^\d{5}$/.test(payload.bjdongCd) ||
        !/^\d{0,4}$/.test(payload.bun) || !/^\d{0,4}$/.test(payload.ji) ||
        !/^[0-2]$/.test(payload.platGbCd)) {
      throw new Error('공유 링크 형식이 올바르지 않습니다.');
    }

    const shortId = generateShortId();
    const shareRef = doc(db, 'shares', shortId);

    await setDoc(shareRef, { ...payload, createdAt: serverTimestamp() });

    return shortId;
  } catch (error) {
    console.error('공유 링크 생성 실패:', error);
    throw error;
  }
}

// 공유 링크 조회
export async function getShareLink(shortId) {
  try {
    const shareRef = doc(db, 'shares', shortId);
    const shareDoc = await getDoc(shareRef);

    if (shareDoc.exists()) {
      return shareDoc.data();
    }
    return null;
  } catch (error) {
    console.error('공유 링크 조회 실패:', error);
    return null;
  }
}

// ==================== 광고 관리 함수 ====================

// 광고 설정 저장 (admin/manager만 가능)
export async function saveAdSettings(adData) {
  const currentRole = await getCurrentUserRole();
  if (currentRole !== USER_ROLES.ADMIN && currentRole !== USER_ROLES.MANAGER) {
    console.error('권한이 없습니다.');
    return false;
  }

  try {
    const adRef = doc(db, 'settings', 'advertisement');
    await setDoc(adRef, {
      imageUrl: adData.imageUrl || '',
      linkUrl: adData.linkUrl || '',
      isActive: adData.isActive !== false,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || ''
    });
    console.log('광고 설정 저장 완료');
    return true;
  } catch (error) {
    console.error('광고 설정 저장 실패:', error);
    throw error;
  }
}

// 광고 설정 조회 (누구나 가능)
export async function getAdSettings() {
  try {
    const adRef = doc(db, 'settings', 'advertisement');
    const adDoc = await getDoc(adRef);

    if (adDoc.exists()) {
      return adDoc.data();
    }
    return null;
  } catch (error) {
    console.error('광고 설정 조회 실패:', error);
    return null;
  }
}

// Firestore DB export
export { db };
