import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getClientFirestore } from "./client";

export const initialUsername = "sarper";
export const initialCredentialHash = "a8e496a04c1ad79567fdbc1201aca061dbe1dfea796e49cf9979cd1433c982c2";

interface StoredUser {
  username?: string;
  credentialHash?: string;
  disabled?: boolean;
}

export interface LoginVerificationResult {
  ok: boolean;
  source: "firestore" | "local";
  reason?: "not_found" | "disabled" | "mismatch" | "firestore_unavailable";
}

function localInitialUserMatches(username: string, credentialHash: string) {
  return username === initialUsername && credentialHash === initialCredentialHash;
}

export async function verifyUserCredential(username: string, credentialHash: string): Promise<LoginVerificationResult> {
  const db = getClientFirestore();

  if (!db) {
    return {
      ok: localInitialUserMatches(username, credentialHash),
      source: "local",
      reason: localInitialUserMatches(username, credentialHash) ? undefined : "firestore_unavailable"
    };
  }

  try {
    const userRef = doc(db, "safaUsers", username);
    let snapshot = await getDoc(userRef);

    if (!snapshot.exists() && username === initialUsername) {
      await setDoc(userRef, {
        username: initialUsername,
        displayName: "Sarper",
        role: "owner",
        credentialHash: initialCredentialHash,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      snapshot = await getDoc(userRef);
    }

    if (!snapshot.exists()) {
      return { ok: false, source: "firestore", reason: "not_found" };
    }

    const user = snapshot.data() as StoredUser;

    if (user.disabled) {
      return { ok: false, source: "firestore", reason: "disabled" };
    }

    const ok = user.credentialHash === credentialHash;

    if (ok) {
      await setDoc(userRef, { lastLoginAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    }

    return { ok, source: "firestore", reason: ok ? undefined : "mismatch" };
  } catch {
    return {
      ok: localInitialUserMatches(username, credentialHash),
      source: "local",
      reason: localInitialUserMatches(username, credentialHash) ? undefined : "firestore_unavailable"
    };
  }
}
