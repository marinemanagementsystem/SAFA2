import type { GibDirectConnectionInput, GibPortalConnectionInput, TrendyolConnectionInput } from "../api";
import { isEncryptedVault, type EncryptedVault } from "./secure-vault";
import type { RemoteVaultSummary } from "../firebase/vault-store";

export interface SavedProfile {
  id: string;
  name: string;
  updatedAt: string;
  trendyol: TrendyolConnectionInput;
  gibPortal: GibPortalConnectionInput;
  gibDirect: GibDirectConnectionInput;
}

export interface VaultPayload {
  profiles: SavedProfile[];
  activeProfileId?: string | null;
}

export interface ProfileDraft {
  name: string;
  trendyol: TrendyolConnectionInput;
  gibPortal: GibPortalConnectionInput;
  gibDirect: GibDirectConnectionInput;
}

export interface StoredVaultRecord extends RemoteVaultSummary {
  vault: EncryptedVault;
}

export interface ActiveVaultSession {
  ownerUsername?: string;
  vaultId: string;
  vaultName: string;
  password: string;
  activeProfileId?: string | null;
  updatedAt: string;
}

export const defaultVaultName = "Varsayilan kasa";
export const legacyVaultStorageKey = "safa.savedInformationVault.v1";
export const vaultStorageKey = "safa.savedInformationVaults.v2";
export const activeVaultSessionKey = "safa.activeVaultSession.v1";
export const activeVaultStorageKey = "safa.activeVaultSession.v2";
export const savedInformationLegacyVaultId = "default";
export const remoteTimeoutMs = 3500;

export const defaultGibDirectConnectionInput: GibDirectConnectionInput = {
  environment: "test",
  taxId: "",
  serviceUrl: "",
  wsdlUrl: "",
  soapAction: "",
  soapBodyTemplate: "",
  soapBodyTemplatePath: "",
  signerMode: "external-command",
  signerCommand: "",
  soapSignerCommand: "",
  invoicePrefix: "SAF",
  nextInvoiceSequence: 1,
  unitCode: "C62",
  defaultBuyerTckn: "11111111111",
  testAccessConfirmed: false,
  productionAccessConfirmed: false,
  authorizationReference: "",
  clientCertPath: "",
  clientKeyPath: "",
  clientPfxPath: "",
  clientCertPassword: ""
};

export function newProfileDraft(
  trendyol: TrendyolConnectionInput,
  gibPortal: GibPortalConnectionInput,
  gibDirect: GibDirectConnectionInput = defaultGibDirectConnectionInput
): ProfileDraft {
  return {
    name: "",
    trendyol: { ...trendyol },
    gibPortal: { ...gibPortal },
    gibDirect: { ...gibDirect }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeVaultRecord(value: unknown): StoredVaultRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (!isEncryptedVault(value.vault)) return null;

  return {
    id: value.id,
    name: value.name.trim() || defaultVaultName,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    vault: value.vault
  };
}

export function readVaultRecordsFromStorage() {
  const records = new Map<string, StoredVaultRecord>();

  try {
    const raw = window.localStorage.getItem(vaultStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const values = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.records) ? parsed.records : [];

    for (const value of values) {
      const record = normalizeVaultRecord(value);
      if (record) records.set(record.id, record);
    }
  } catch {
    // Broken local vault index must not block the app. The legacy key is checked below.
  }

  try {
    const rawLegacyVault = window.localStorage.getItem(legacyVaultStorageKey);
    const parsedLegacyVault = rawLegacyVault ? (JSON.parse(rawLegacyVault) as unknown) : null;

    if (isEncryptedVault(parsedLegacyVault) && !records.has(savedInformationLegacyVaultId)) {
      records.set(savedInformationLegacyVaultId, {
        id: savedInformationLegacyVaultId,
        name: defaultVaultName,
        vault: parsedLegacyVault
      });
    }
  } catch {
    // Ignore unreadable legacy payloads.
  }

  return Array.from(records.values());
}

function writeVaultRecordsToStorage(records: StoredVaultRecord[]) {
  if (records.length === 0) {
    window.localStorage.removeItem(vaultStorageKey);
    return;
  }

  window.localStorage.setItem(vaultStorageKey, JSON.stringify(records));
}

export function saveVaultRecordToStorage(record: StoredVaultRecord) {
  const records = new Map(readVaultRecordsFromStorage().map((item) => [item.id, item]));
  records.set(record.id, record);
  writeVaultRecordsToStorage(Array.from(records.values()));

  if (record.id === savedInformationLegacyVaultId) {
    window.localStorage.setItem(legacyVaultStorageKey, JSON.stringify(record.vault));
  }
}

export function removeVaultRecordFromStorage(vaultId: string) {
  const records = readVaultRecordsFromStorage().filter((record) => record.id !== vaultId);
  writeVaultRecordsToStorage(records);

  if (vaultId === savedInformationLegacyVaultId) {
    window.localStorage.removeItem(legacyVaultStorageKey);
  }
}

export function readVaultRecordById(vaultId: string) {
  return readVaultRecordsFromStorage().find((record) => record.id === vaultId) ?? null;
}

function parseActiveVaultSession(value: unknown, ownerUsername?: string): ActiveVaultSession | null {
  if (!isRecord(value) || typeof value.vaultId !== "string" || typeof value.vaultName !== "string") return null;
  if (typeof value.password !== "string" || !value.password) return null;

  const sessionOwner = typeof value.ownerUsername === "string" ? value.ownerUsername : undefined;
  if (ownerUsername && sessionOwner && sessionOwner !== ownerUsername) return null;

  return {
    ownerUsername: sessionOwner,
    vaultId: value.vaultId,
    vaultName: value.vaultName.trim() || defaultVaultName,
    password: value.password,
    activeProfileId: typeof value.activeProfileId === "string" ? value.activeProfileId : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
}

function readActiveVaultSessionFromStorage(storage: Storage, key: string, ownerUsername?: string) {
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parseActiveVaultSession(parsed, ownerUsername);
  } catch {
    return null;
  }
}

export function readActiveVaultSession(ownerUsername?: string): ActiveVaultSession | null {
  return (
    readActiveVaultSessionFromStorage(window.localStorage, activeVaultStorageKey, ownerUsername) ??
    readActiveVaultSessionFromStorage(window.sessionStorage, activeVaultSessionKey, ownerUsername)
  );
}

export function saveActiveVaultSession(session: Omit<ActiveVaultSession, "updatedAt"> & { updatedAt?: string }) {
  const payload = JSON.stringify({
    ...session,
    updatedAt: session.updatedAt ?? new Date().toISOString()
  });

  window.localStorage.setItem(activeVaultStorageKey, payload);
  window.sessionStorage.setItem(activeVaultSessionKey, payload);
}

function clearActiveVaultSessionFromStorage(storage: Storage, key: string, vaultId?: string, ownerUsername?: string) {
  if (!vaultId) {
    storage.removeItem(key);
    return;
  }

  const current = readActiveVaultSessionFromStorage(storage, key, ownerUsername);
  if (current?.vaultId === vaultId) {
    storage.removeItem(key);
  }
}

export function clearActiveVaultSession(vaultId?: string, ownerUsername?: string) {
  clearActiveVaultSessionFromStorage(window.localStorage, activeVaultStorageKey, vaultId, ownerUsername);
  clearActiveVaultSessionFromStorage(window.sessionStorage, activeVaultSessionKey, vaultId, ownerUsername);
}

function sortVaults(vaults: RemoteVaultSummary[]) {
  return [...vaults].sort((left, right) => {
    if (left.isDefault && !right.isDefault) return -1;
    if (!left.isDefault && right.isDefault) return 1;
    if (left.id === savedInformationLegacyVaultId) return -1;
    if (right.id === savedInformationLegacyVaultId) return 1;
    return left.name.localeCompare(right.name, "tr-TR");
  });
}

export function mergeVaultSummaries(...groups: RemoteVaultSummary[][]) {
  const merged = new Map<string, RemoteVaultSummary>();

  for (const group of groups) {
    for (const vault of group) {
      if (!vault.id) continue;
      const name = vault.name.trim() || (vault.id === savedInformationLegacyVaultId ? defaultVaultName : "Kasa");
      const existing = merged.get(vault.id);
      merged.set(vault.id, { ...existing, ...vault, name, isDefault: Boolean(existing?.isDefault || vault.isDefault) });
    }
  }

  return sortVaults(Array.from(merged.values()));
}

export function normalizeVaultPayload(payload: VaultPayload): VaultPayload {
  const profiles = (Array.isArray(payload.profiles) ? payload.profiles : []).map((profile) => ({
    ...profile,
    gibDirect: { ...defaultGibDirectConnectionInput, ...(profile.gibDirect ?? {}) }
  }));
  const activeProfileId =
    typeof payload.activeProfileId === "string" && profiles.some((profile) => profile.id === payload.activeProfileId)
      ? payload.activeProfileId
      : null;

  return { profiles, activeProfileId };
}

export function profileNameEquals(left: string, right: string) {
  return left.toLocaleLowerCase("tr-TR") === right.toLocaleLowerCase("tr-TR");
}

export function withRemoteTimeout<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, remoteTimeoutMs);

    operation()
      .then((value) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}
