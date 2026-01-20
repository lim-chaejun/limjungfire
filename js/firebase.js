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
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
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
