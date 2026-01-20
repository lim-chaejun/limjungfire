// Firebase 초기화 및 인증 (CDN 방식)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

// Google 로그인
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log('로그인 성공:', user.displayName);
    return user;
  } catch (error) {
    console.error('로그인 실패:', error);
    throw error;
  }
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

// 사용자 정보 저장 (회원가입 시)
export async function saveUserInfo(user) {
  if (!user) return null;

  try {
    const userRef = doc(db, 'users', user.uid);

    // 기존 사용자 정보 확인
    const existingDoc = await getDoc(userRef);
    const isNewUser = !existingDoc.exists();

    // 등급 결정: 신규 사용자이고 admin 이메일이면 admin, 아니면 기존 등급 유지 또는 free
    let role = USER_ROLES.FREE;
    if (isNewUser) {
      role = (user.email === ADMIN_EMAIL) ? USER_ROLES.ADMIN : USER_ROLES.FREE;
    } else if (existingDoc.data()?.role) {
      role = existingDoc.data().role;
    }

    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      role: role,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    }, { merge: true });
    console.log('사용자 정보 저장 완료');
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
      users.push({ id: doc.id, ...doc.data() });
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
      history.push({ id: doc.id, ...doc.data() });
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
      favorites.push({ id: doc.id, ...doc.data() });
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
      result = { id: doc.id, ...doc.data() };
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
      memo: memo,
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

// 짧은 ID 생성 (6자리)
function generateShortId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 공유 링크 생성
export async function createShareLink(data) {
  try {
    const shortId = generateShortId();
    const shareRef = doc(db, 'shares', shortId);

    await setDoc(shareRef, {
      sigunguCd: data.sigunguCd,
      bjdongCd: data.bjdongCd,
      bun: data.bun || '',
      ji: data.ji || '',
      createdAt: serverTimestamp()
    });

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

// Firestore DB export
export { db };
