// Firebase 초기화 및 인증 (CDN 방식)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
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

// Firestore DB export
export { db };
