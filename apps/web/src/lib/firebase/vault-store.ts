import { deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getClientFirestore } from "./client";
import { isEncryptedVault, type EncryptedVault } from "../platform/secure-vault";

export const legacyVaultId = "default";
const legacyVaultName = "Varsayilan kasa";

interface StoredVault {
  vault?: unknown;
  vaultName?: unknown;
  vaults?: unknown;
  defaultVaultId?: unknown;
}

interface StoredVaultEntry {
  name?: unknown;
  vault?: unknown;
  updatedAt?: unknown;
}

export interface RemoteVaultSummary {
  id: string;
  name: string;
  updatedAt?: string;
  isDefault?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeVaultEntry(value: unknown): StoredVaultEntry | null {
  if (!isRecord(value)) return null;
  return value as StoredVaultEntry;
}

function readVaultEntries(data: StoredVault) {
  const entries = new Map<string, StoredVaultEntry>();

  if (isRecord(data.vaults)) {
    for (const [id, value] of Object.entries(data.vaults)) {
      const entry = normalizeVaultEntry(value);
      if (entry?.vault && isEncryptedVault(entry.vault)) {
        entries.set(id, entry);
      }
    }
  }

  if (isEncryptedVault(data.vault) && !entries.has(legacyVaultId)) {
    entries.set(legacyVaultId, {
      name: typeof data.vaultName === "string" ? data.vaultName : legacyVaultName,
      vault: data.vault
    });
  }

  return entries;
}

function entryName(entry: StoredVaultEntry, fallback: string) {
  return typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : fallback;
}

function entryUpdatedAt(entry: StoredVaultEntry) {
  return typeof entry.updatedAt === "string" ? entry.updatedAt : undefined;
}

export async function loadRemoteVault(ownerUsername: string) {
  return loadRemoteVaultById(ownerUsername, legacyVaultId);
}

export async function listRemoteVaults(ownerUsername: string): Promise<RemoteVaultSummary[]> {
  const db = getClientFirestore();
  if (!db) return [];

  const snapshot = await getDoc(doc(db, "safaVaults", ownerUsername));
  if (!snapshot.exists()) return [];

  const entries = readVaultEntries(snapshot.data() as StoredVault);
  const defaultVaultId = typeof snapshot.data().defaultVaultId === "string" ? snapshot.data().defaultVaultId : undefined;
  return Array.from(entries.entries()).map(([id, entry]) => ({
    id,
    name: entryName(entry, id === legacyVaultId ? legacyVaultName : "Kasa"),
    updatedAt: entryUpdatedAt(entry),
    isDefault: id === defaultVaultId
  }));
}

export async function loadRemoteVaultById(ownerUsername: string, vaultId: string) {
  const db = getClientFirestore();
  if (!db) return null;

  const snapshot = await getDoc(doc(db, "safaVaults", ownerUsername));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as StoredVault;
  const entries = readVaultEntries(data);
  const entry = entries.get(vaultId);

  return isEncryptedVault(entry?.vault) ? entry.vault : null;
}

export async function saveRemoteVault(ownerUsername: string, vault: EncryptedVault, options?: { id?: string; name?: string }) {
  const db = getClientFirestore();
  if (!db) return false;

  const vaultId = options?.id ?? legacyVaultId;
  const vaultName = options?.name?.trim() || (vaultId === legacyVaultId ? legacyVaultName : "Kasa");
  const ref = doc(db, "safaVaults", ownerUsername);
  const snapshot = await getDoc(ref);
  const existing = snapshot.exists() ? (snapshot.data() as StoredVault) : {};
  const entries = Object.fromEntries(readVaultEntries(existing));

  entries[vaultId] = {
    name: vaultName,
    vault,
    updatedAt: new Date().toISOString()
  };

  await setDoc(
    ref,
    {
      username: ownerUsername,
      vaults: entries,
      defaultVaultId: vaultId,
      version: 2,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return true;
}

export async function saveRemoteDefaultVault(ownerUsername: string, vaultId: string) {
  const db = getClientFirestore();
  if (!db) return false;

  const ref = doc(db, "safaVaults", ownerUsername);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return false;

  const entries = readVaultEntries(snapshot.data() as StoredVault);
  if (!entries.has(vaultId)) return false;

  await setDoc(
    ref,
    {
      username: ownerUsername,
      defaultVaultId: vaultId,
      version: 2,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return true;
}

export async function deleteRemoteVault(ownerUsername: string, vaultId = legacyVaultId) {
  const db = getClientFirestore();
  if (!db) return { available: false, ok: false };

  const ref = doc(db, "safaVaults", ownerUsername);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    return { available: true, ok: true };
  }

  const entries = Object.fromEntries(readVaultEntries(snapshot.data() as StoredVault));
  delete entries[vaultId];

  if (Object.keys(entries).length === 0) {
    await deleteDoc(ref);
    return { available: true, ok: true };
  }

  await setDoc(
    ref,
    {
      vaults: entries,
      ...(vaultId === legacyVaultId ? { vault: deleteField(), vaultName: deleteField() } : {}),
      defaultVaultId: Object.keys(entries)[0],
      version: 2,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return { available: true, ok: true };
}
