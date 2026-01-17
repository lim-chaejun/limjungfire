// Firebase 초기화 및 인증
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";

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
