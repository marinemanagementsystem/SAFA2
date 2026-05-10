import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyD11t68m81QTI9TnoGGR9j9KVIkUay6N24",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "safa-8f76e.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "safa-8f76e",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "safa-8f76e.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "530529382052",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:530529382052:web:97e84c5aacf681c0aa8031",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-QS3BB1YCLK"
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let cachedApp: FirebaseApp | null = null;
let cachedFirestore: Firestore | null = null;

export function getFirebaseApp() {
  if (!firebaseConfigured) return null;
  if (cachedApp) return cachedApp;

  cachedApp =
    getApps().find((app) => app.options.projectId === firebaseConfig.projectId) ??
    initializeApp(firebaseConfig);

  return cachedApp;
}

export function getClientFirestore() {
  if (cachedFirestore) return cachedFirestore;
  const app = getFirebaseApp();
  if (!app) return null;
  cachedFirestore = getFirestore(app);
  return cachedFirestore;
}
