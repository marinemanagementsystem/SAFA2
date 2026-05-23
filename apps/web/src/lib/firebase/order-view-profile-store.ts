import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import type { OrderViewProfileVault } from "../../components/platform/order-view-state";
import { normalizeOrderViewProfileVault } from "../../components/platform/order-view-state";
import { getClientFirestore } from "./client";

const collectionName = "safaOrderViewProfiles";
const localStoragePrefix = "safa.orderViewProfiles.v1";

function localStorageKey(ownerUsername: string) {
  return `${localStoragePrefix}:${ownerUsername}`;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadLocalOrderViewProfiles(ownerUsername: string): OrderViewProfileVault {
  if (!canUseLocalStorage()) return { profiles: [], activeProfileId: null };

  try {
    const raw = window.localStorage.getItem(localStorageKey(ownerUsername));
    if (!raw) return { profiles: [], activeProfileId: null };
    return normalizeOrderViewProfileVault(JSON.parse(raw));
  } catch {
    return { profiles: [], activeProfileId: null };
  }
}

export function saveLocalOrderViewProfiles(ownerUsername: string, vault: OrderViewProfileVault) {
  if (!canUseLocalStorage()) return false;

  try {
    window.localStorage.setItem(localStorageKey(ownerUsername), JSON.stringify(normalizeOrderViewProfileVault(vault)));
    return true;
  } catch {
    return false;
  }
}

export async function loadRemoteOrderViewProfiles(ownerUsername: string): Promise<OrderViewProfileVault | null> {
  const db = getClientFirestore();
  if (!db) return null;

  const snapshot = await getDoc(doc(db, collectionName, ownerUsername));
  if (!snapshot.exists()) return null;
  return normalizeOrderViewProfileVault(snapshot.data());
}

export async function saveRemoteOrderViewProfiles(ownerUsername: string, vault: OrderViewProfileVault) {
  const db = getClientFirestore();
  if (!db) return false;

  await setDoc(
    doc(db, collectionName, ownerUsername),
    {
      username: ownerUsername,
      ...normalizeOrderViewProfileVault(vault),
      version: 1,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return true;
}

export async function loadOrderViewProfiles(ownerUsername: string): Promise<{ vault: OrderViewProfileVault; source: "remote" | "local" | "empty" }> {
  try {
    const remote = await loadRemoteOrderViewProfiles(ownerUsername);
    if (remote) {
      saveLocalOrderViewProfiles(ownerUsername, remote);
      return { vault: remote, source: "remote" };
    }
  } catch {
    const local = loadLocalOrderViewProfiles(ownerUsername);
    return { vault: local, source: local.profiles.length > 0 ? "local" : "empty" };
  }

  const local = loadLocalOrderViewProfiles(ownerUsername);
  return { vault: local, source: local.profiles.length > 0 ? "local" : "empty" };
}

export async function saveOrderViewProfiles(ownerUsername: string, vault: OrderViewProfileVault): Promise<{ remoteSaved: boolean; localSaved: boolean }> {
  const normalized = normalizeOrderViewProfileVault(vault);
  const localSaved = saveLocalOrderViewProfiles(ownerUsername, normalized);
  let remoteSaved = false;

  try {
    remoteSaved = await saveRemoteOrderViewProfiles(ownerUsername, normalized);
  } catch {
    remoteSaved = false;
  }

  return { remoteSaved, localSaved };
}
