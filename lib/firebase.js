import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCSPwYEPZZj1n2-17jBir6gScAevyeKEtY",
  authDomain: "ark-348a0.firebaseapp.com",
  projectId: "ark-348a0",
  storageBucket: "ark-348a0.firebasestorage.app",
  messagingSenderId: "525909893817",
  appId: "1:525909893817:web:93a20c496a2d637a6db168",
  measurementId: "G-FHNW7F0GRS",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export { app };
