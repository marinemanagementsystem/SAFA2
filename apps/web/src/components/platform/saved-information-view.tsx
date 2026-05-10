"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, Plus, RotateCcw, Send, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { GibDirectConnectionInput, GibPortalConnectionInput, TrendyolConnectionInput } from "../../lib/api";
import {
  deleteRemoteVault,
  listRemoteVaults,
  loadRemoteVaultById,
  saveRemoteDefaultVault,
  saveRemoteVault,
  type RemoteVaultSummary
} from "../../lib/firebase/vault-store";
import {
  defaultVaultName,
  clearActiveVaultSession,
  mergeVaultSummaries,
  newProfileDraft,
  normalizeVaultPayload,
  profileNameEquals,
  readActiveVaultSession,
  readVaultRecordById,
  readVaultRecordsFromStorage,
  removeVaultRecordFromStorage,
  saveActiveVaultSession,
  saveVaultRecordToStorage,
  withRemoteTimeout,
  type ProfileDraft,
  type SavedProfile,
  type StoredVaultRecord,
  type VaultPayload
} from "../../lib/platform/saved-information-store";
import { decryptVaultPayload, encryptVaultPayload, type EncryptedVault } from "../../lib/platform/secure-vault";

interface SavedInformationViewProps {
  ownerUsername: string;
  trendyolForm: TrendyolConnectionInput;
  gibPortalForm: GibPortalConnectionInput;
  gibDirectForm: GibDirectConnectionInput;
  setTrendyolForm: Dispatch<SetStateAction<TrendyolConnectionInput>>;
  setGibPortalForm: Dispatch<SetStateAction<GibPortalConnectionInput>>;
  setGibDirectForm: Dispatch<SetStateAction<GibDirectConnectionInput>>;
  setMessage: (message: string) => void;
}

export function SavedInformationView({
  ownerUsername,
  trendyolForm,
  gibPortalForm,
  gibDirectForm,
  setTrendyolForm,
  setGibPortalForm,
  setGibDirectForm,
  setMessage
}: SavedInformationViewProps) {
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [vaults, setVaults] = useState<RemoteVaultSummary[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [creatingVault, setCreatingVault] = useState(false);
  const [vaultNameInput, setVaultNameInput] = useState(defaultVaultName);
  const [unlocked, setUnlocked] = useState(false);
  const [vaultPassword, setVaultPassword] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(() => newProfileDraft(trendyolForm, gibPortalForm, gibDirectForm));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? null;
  const selectedVaultName = selectedVault?.name ?? defaultVaultName;
  const activeProfile = activeProfileId ? profiles.find((profile) => profile.id === activeProfileId) ?? null : null;

  async function readVaultPayload(vaultId: string, vaultName: string, password: string) {
    let remoteReadFailed = false;
    let vault: EncryptedVault | null = null;

    try {
      vault = await withRemoteTimeout(() => loadRemoteVaultById(ownerUsername, vaultId), null);
      if (vault) {
        saveVaultRecordToStorage({ id: vaultId, name: vaultName, vault, updatedAt: new Date().toISOString() });
      } else {
        remoteReadFailed = true;
      }
    } catch {
      remoteReadFailed = true;
    }

    vault ??= readVaultRecordById(vaultId)?.vault ?? null;
    if (!vault) throw new Error("Kasa bulunamadi.");

    return {
      payload: normalizeVaultPayload(await decryptVaultPayload<VaultPayload>(vault, password)),
      remoteReadFailed
    };
  }

  useEffect(() => {
    let mounted = true;

    async function detectVaults() {
      const localVaults = readVaultRecordsFromStorage().map(({ vault: _vault, ...summary }) => summary);
      let remoteVaults: RemoteVaultSummary[] = [];

      try {
        remoteVaults = await withRemoteTimeout(() => listRemoteVaults(ownerUsername), []);
      } catch {
        remoteVaults = [];
      }

      const nextVaults = mergeVaultSummaries(localVaults, remoteVaults);
      const activeSession = readActiveVaultSession(ownerUsername);
      const activeVault = activeSession ? nextVaults.find((vault) => vault.id === activeSession.vaultId) ?? null : null;

      if (!mounted) return;
      setVaults(nextVaults);
      setSelectedVaultId((current) => activeVault?.id ?? (nextVaults.some((vault) => vault.id === current) ? current : nextVaults[0]?.id ?? ""));

      if (activeSession && activeVault) {
        try {
          const { payload, remoteReadFailed } = await readVaultPayload(activeVault.id, activeVault.name, activeSession.password);
          if (!mounted) return;

          const nextActiveProfile = payload.activeProfileId
            ? payload.profiles.find((profile) => profile.id === payload.activeProfileId) ?? null
            : null;

          setProfiles(payload.profiles);
          setActiveProfileId(payload.activeProfileId ?? null);
          setVaultPassword(activeSession.password);
          setPasswordInput("");
          setUnlocked(true);
          setCreatingVault(false);

          if (nextActiveProfile) {
            setTrendyolForm(nextActiveProfile.trendyol);
            setGibPortalForm(nextActiveProfile.gibPortal);
            setGibDirectForm(nextActiveProfile.gibDirect);
            setMessage(`${nextActiveProfile.name} aktif profil olarak yuklendi.`);
          }

          saveActiveVaultSession({
            ownerUsername,
            vaultId: activeVault.id,
            vaultName: activeVault.name,
            password: activeSession.password,
            activeProfileId: payload.activeProfileId ?? null
          });
          void withRemoteTimeout(() => saveRemoteDefaultVault(ownerUsername, activeVault.id), false);
          setStatus(
            remoteReadFailed
              ? `${activeVault.name} aktif kasa olarak yuklendi. Firestore okunamadi; yerel kasa kullanildi.`
              : nextActiveProfile
                ? `${activeVault.name} aktif kasa olarak yuklendi. ${nextActiveProfile.name} profili yuklendi.`
                : `${activeVault.name} aktif kasa olarak yuklendi. Aktif profil secilmemis.`
          );
        } catch {
          clearActiveVaultSession(activeSession.vaultId, ownerUsername);
          if (!mounted) return;
          setCreatingVault(nextVaults.length === 0);
          setUnlocked(false);
          setStatus("Aktif kasa oturumu okunamadi. Kasayi tekrar sifreyle acin.");
        }

        setLoadingVaults(false);
        return;
      }

      if (activeSession && !activeVault) {
        clearActiveVaultSession(activeSession.vaultId, ownerUsername);
      }

      setCreatingVault(nextVaults.length === 0);
      setLoadingVaults(false);
    }

    void detectVaults();

    return () => {
      mounted = false;
    };
  }, [ownerUsername]);

  async function loadVaultSummaries() {
    const localVaults = readVaultRecordsFromStorage().map(({ vault: _vault, ...summary }) => summary);
    let remoteVaults: RemoteVaultSummary[] = [];

    try {
      remoteVaults = await withRemoteTimeout(() => listRemoteVaults(ownerUsername), []);
    } catch {
      remoteVaults = [];
    }

    return mergeVaultSummaries(localVaults, remoteVaults);
  }

  function startCreateVault() {
    setCreatingVault(true);
    setUnlocked(false);
    setVaultPassword("");
    setPasswordInput("");
    setPasswordRepeat("");
    setProfiles([]);
    setActiveProfileId(null);
    setDraft(newProfileDraft(trendyolForm, gibPortalForm, gibDirectForm));
    setVaultNameInput(vaults.length === 0 ? defaultVaultName : `Kasa ${vaults.length + 1}`);
    setStatus("");
  }

  function cancelCreateVault() {
    setCreatingVault(false);
    setPasswordInput("");
    setPasswordRepeat("");
    setStatus("");
  }

  async function persistProfiles(nextProfiles: SavedProfile[], nextActiveProfileId: string | null, password = vaultPassword) {
    if (!selectedVaultId) return false;

    const vault = await encryptVaultPayload<VaultPayload>({ profiles: nextProfiles, activeProfileId: nextActiveProfileId }, password);
    const updatedAt = new Date().toISOString();
    const record: StoredVaultRecord = {
      id: selectedVaultId,
      name: selectedVaultName,
      updatedAt,
      vault
    };

    saveVaultRecordToStorage(record);
    setProfiles(nextProfiles);
    setActiveProfileId(nextActiveProfileId);
    setVaults((current) => mergeVaultSummaries(current, [{ id: selectedVaultId, name: selectedVaultName, updatedAt }]));
    saveActiveVaultSession({
      ownerUsername,
      vaultId: selectedVaultId,
      vaultName: selectedVaultName,
      password,
      activeProfileId: nextActiveProfileId
    });

    let remoteSaved = false;
    try {
      remoteSaved = await withRemoteTimeout(
        () => saveRemoteVault(ownerUsername, vault, { id: selectedVaultId, name: selectedVaultName }),
        false
      );
    } catch {
      remoteSaved = false;
    }

    return remoteSaved;
  }

  async function createVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    const vaultName = vaultNameInput.trim();

    if (!vaultName) {
      setStatus("Kasa adi gerekli.");
      return;
    }

    if (passwordInput.length < 8) {
      setStatus("Kasa sifresi en az 8 karakter olmali.");
      return;
    }

    if (passwordInput !== passwordRepeat) {
      setStatus("Sifreler ayni degil.");
      return;
    }

    setBusy(true);
    const vaultId = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    const vault = await encryptVaultPayload<VaultPayload>({ profiles: [], activeProfileId: null }, passwordInput);
    const record: StoredVaultRecord = { id: vaultId, name: vaultName, updatedAt, vault };

    saveVaultRecordToStorage(record);
    const nextVaults = mergeVaultSummaries(vaults, [{ id: vaultId, name: vaultName, updatedAt }]);
    setVaults(nextVaults);
    setSelectedVaultId(vaultId);
    setVaultPassword(passwordInput);
    setPasswordInput("");
    setPasswordRepeat("");
    setProfiles([]);
    setActiveProfileId(null);
    setUnlocked(true);
    setCreatingVault(false);
    saveActiveVaultSession({ ownerUsername, vaultId, vaultName, password: passwordInput, activeProfileId: null });

    let remoteSaved = false;
    try {
      remoteSaved = await withRemoteTimeout(() => saveRemoteVault(ownerUsername, vault, { id: vaultId, name: vaultName }), false);
    } catch {
      remoteSaved = false;
    }

    setStatus(
      remoteSaved
        ? `${vaultName} olusturuldu ve Firestore'a kaydedildi. Artik profil ekleyebilirsiniz.`
        : `${vaultName} bu tarayicida olusturuldu. Firestore yavas veya yazma izni yok; uzak kayit daha sonra tekrar denenmeli.`
    );
    setBusy(false);
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (!selectedVaultId) {
      setStatus("Once acilacak kasayi secin.");
      return;
    }

    setBusy(true);

    try {
      const { payload, remoteReadFailed } = await readVaultPayload(selectedVaultId, selectedVaultName, passwordInput);
      const nextActiveProfile = payload.activeProfileId
        ? payload.profiles.find((profile) => profile.id === payload.activeProfileId) ?? null
        : null;

      setProfiles(payload.profiles);
      setActiveProfileId(payload.activeProfileId ?? null);
      setVaultPassword(passwordInput);
      setPasswordInput("");
      setUnlocked(true);
      saveActiveVaultSession({
        ownerUsername,
        vaultId: selectedVaultId,
        vaultName: selectedVaultName,
        password: passwordInput,
        activeProfileId: payload.activeProfileId ?? null
      });
      void withRemoteTimeout(() => saveRemoteDefaultVault(ownerUsername, selectedVaultId), false);

      if (nextActiveProfile) {
        setTrendyolForm(nextActiveProfile.trendyol);
        setGibPortalForm(nextActiveProfile.gibPortal);
        setGibDirectForm(nextActiveProfile.gibDirect);
        setMessage(`${nextActiveProfile.name} aktif profil olarak yuklendi.`);
      }

      setStatus(
        remoteReadFailed
          ? "Kasa yerel kayittan acildi. Firestore okunamadi."
          : nextActiveProfile
            ? `Kasa acildi. ${nextActiveProfile.name} aktif profil olarak yuklendi.`
            : "Kasa acildi. Aktif profil secilmemis."
      );
    } catch {
      setStatus("Sifre hatali veya kasa okunamadi.");
      clearActiveVaultSession(selectedVaultId, ownerUsername);
    } finally {
      setBusy(false);
    }
  }

  async function resetForgottenVault() {
    if (!selectedVaultId) {
      setStatus("Sifirlanacak kasa secili degil.");
      return;
    }

    const confirmed = window.confirm(
      `${selectedVaultName} kasasi silinecek. Bu islem sadece secili kasadaki profilleri siler; uygulama girisi ve diger kasalar etkilenmez. Silinen profil bilgileri geri getirilemez. Devam etmek istiyor musunuz?`
    );

    if (!confirmed) return;

    setBusy(true);
    setStatus("");
    removeVaultRecordFromStorage(selectedVaultId);
    clearActiveVaultSession(selectedVaultId, ownerUsername);

    let remoteResult = { available: false, ok: false };

    try {
      remoteResult = await withRemoteTimeout(() => deleteRemoteVault(ownerUsername, selectedVaultId), { available: true, ok: false });
    } catch {
      remoteResult = { available: true, ok: false };
    }

    const nextVaults = await loadVaultSummaries();
    const nextSelectedVault = nextVaults.find((vault) => vault.id !== selectedVaultId) ?? nextVaults[0] ?? null;

    setVaults(nextVaults);
    setSelectedVaultId(nextSelectedVault?.id ?? "");
    setUnlocked(false);
    setVaultPassword("");
    setPasswordInput("");
    setPasswordRepeat("");
    setProfiles([]);
    setActiveProfileId(null);
    setDraft(newProfileDraft(trendyolForm, gibPortalForm, gibDirectForm));
    setCreatingVault(nextVaults.length === 0);

    if (remoteResult.ok || !remoteResult.available) {
      setStatus(
        nextVaults.length === 0
          ? "Secili kasa silindi. Simdi yeni bir kasa olusturabilirsiniz."
          : "Secili kasa silindi. Diger kasalar korunuyor."
      );
    } else {
      setStatus("Tarayicidaki kasa silindi, fakat Firestore'daki kasa silinemedi. Baglantiyi kontrol edip tekrar deneyin.");
    }

    setBusy(false);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();

    if (!name) {
      setStatus("Profil adi gerekli.");
      return;
    }

    setBusy(true);
    const existing = profiles.find((profile) => profileNameEquals(profile.name, name));
    const nextProfile: SavedProfile = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      updatedAt: new Date().toISOString(),
      trendyol: { ...draft.trendyol },
      gibPortal: { ...draft.gibPortal },
      gibDirect: { ...draft.gibDirect }
    };
    const nextProfiles = existing
      ? profiles.map((profile) => (profile.id === existing.id ? nextProfile : profile))
      : [nextProfile, ...profiles];
    const nextActiveProfileId =
      activeProfileId && nextProfiles.some((profile) => profile.id === activeProfileId) ? activeProfileId : nextProfile.id;

    const remoteSaved = await persistProfiles(nextProfiles, nextActiveProfileId);

    if (nextActiveProfileId === nextProfile.id) {
      setTrendyolForm(nextProfile.trendyol);
      setGibPortalForm(nextProfile.gibPortal);
      setGibDirectForm(nextProfile.gibDirect);
      setMessage(`${name} aktif profil olarak ayarlandi.`);
    }

    setStatus(
      remoteSaved
        ? `${name} profili sifreli kasaya kaydedildi. Aktif profil: ${nextProfiles.find((profile) => profile.id === nextActiveProfileId)?.name ?? "yok"}.`
        : `${name} profili bu tarayicidaki sifreli kasaya kaydedildi. Firestore'a yazilamadi.`
    );
    setDraft(newProfileDraft(trendyolForm, gibPortalForm, gibDirectForm));
    setBusy(false);
  }

  async function activateProfile(profile: SavedProfile) {
    setBusy(true);
    setTrendyolForm(profile.trendyol);
    setGibPortalForm(profile.gibPortal);
    setGibDirectForm(profile.gibDirect);
    setMessage(`${profile.name} aktif profil olarak entegrasyon formlarina aktarildi.`);

    const remoteSaved = await persistProfiles(profiles, profile.id);
    setStatus(
      remoteSaved
        ? `${profile.name} aktif profil yapildi ve Firestore'a kaydedildi.`
        : `${profile.name} aktif profil yapildi. Firestore'a yazilamadi, yerel kasa guncellendi.`
    );
    setBusy(false);
  }

  async function deleteProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile || !window.confirm(`${profile.name} profilini silmek istiyor musunuz?`)) return;

    setBusy(true);
    const nextProfiles = profiles.filter((item) => item.id !== profileId);
    const nextActiveProfileId = activeProfileId === profileId ? null : activeProfileId;
    const remoteSaved = await persistProfiles(nextProfiles, nextActiveProfileId);

    if (activeProfileId === profileId) {
      setMessage("Aktif profil silindi. Entegrasyon formlarindaki mevcut bilgiler degistirilmedi.");
    }

    setStatus(remoteSaved ? `${profile.name} profili silindi.` : `${profile.name} profili yerelde silindi. Firestore'a yazilamadi.`);
    setBusy(false);
  }

  function lockVault() {
    setUnlocked(false);
    setVaultPassword("");
    setProfiles([]);
    setActiveProfileId(null);
    setDraft(newProfileDraft(trendyolForm, gibPortalForm, gibDirectForm));
    clearActiveVaultSession(selectedVaultId, ownerUsername);
    setStatus("Kasa kilitlendi. Kayitlar silinmedi; tekrar acmak icin sifre gerekir.");
  }

  if (loadingVaults) {
    return (
      <div className="view-stack">
        <section className="surface-panel vault-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Kontrol</span>
              <h2>Kasalar okunuyor</h2>
              <p>Kayitli kasa listesi bu tarayici ve Firestore uzerinden kontrol ediliyor.</p>
            </div>
            <KeyRound size={20} />
          </div>
        </section>
      </div>
    );
  }

  if (creatingVault) {
    return (
      <div className="view-stack">
        <section className="surface-panel vault-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">{vaults.length === 0 ? "Ilk kurulum" : "Yeni kasa"}</span>
              <h2>Sifreli bilgi kasasi olustur</h2>
              <p>Ayni kullanici altinda birden fazla kasa acabilir, her kasaya ayri sifre verebilirsiniz.</p>
            </div>
            <ShieldCheck size={20} />
          </div>
          <form className="settings-form vault-form" onSubmit={createVault}>
            <label className="field">
              <span>Kasa adi</span>
              <input value={vaultNameInput} onChange={(event) => setVaultNameInput(event.target.value)} autoComplete="off" />
            </label>
            <input className="visually-hidden" value={vaultNameInput || "new-vault"} readOnly tabIndex={-1} autoComplete="username" />
            <label className="field">
              <span>Kasa sifresi</span>
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="field">
              <span>Sifre tekrar</span>
              <input
                type="password"
                value={passwordRepeat}
                onChange={(event) => setPasswordRepeat(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            {status ? <div className="form-alert">{status}</div> : null}
            <div className="form-actions">
              {vaults.length > 0 ? (
                <button className="ui-button ghost" type="button" onClick={cancelCreateVault} disabled={busy}>
                  Kasa listesine don
                </button>
              ) : null}
              <button className="ui-button primary" type="submit" disabled={busy}>
                <LockKeyhole size={18} />
                Kasa olustur
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="view-stack">
        <section className="surface-panel vault-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Kasa kilitli</span>
              <h2>Kayitli bilgileri ac</h2>
              <p>{vaults.length} kasa kayitli. Acmak istediginiz kasayi secip sifresini girin.</p>
            </div>
            <KeyRound size={20} />
          </div>
          <form className="settings-form vault-form" onSubmit={unlockVault}>
            <input className="visually-hidden" value={selectedVaultName} readOnly tabIndex={-1} autoComplete="username" />
            <label className="field">
              <span>Kasa sec</span>
              <select
                value={selectedVaultId}
                onChange={(event) => {
                  setSelectedVaultId(event.target.value);
                  setPasswordInput("");
                  setStatus("");
                }}
              >
                {vaults.map((vault) => (
                  <option value={vault.id} key={vault.id}>
                    {vault.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Kasa sifresi</span>
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            {status ? <div className="form-alert">{status}</div> : null}
            <div className="form-actions">
              <button className="ui-button primary" type="submit" disabled={busy}>
                <LockKeyhole size={18} />
                Kasayi ac
              </button>
              <button className="ui-button ghost" type="button" onClick={startCreateVault} disabled={busy}>
                <Plus size={18} />
                Yeni kasa
              </button>
            </div>
            <div className="vault-reset">
              <p>
                Kasa sifresini unuttuysaniz sadece secili kasa sifirlanir. Diger kasalar ve uygulama girisi etkilenmez.
              </p>
              <button className="ui-button ghost danger" type="button" onClick={() => void resetForgottenVault()} disabled={busy}>
                <RotateCcw size={18} />
                Secili kasayi sifirla
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <section className="content-grid vault-grid">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Acik kasa</span>
              <h2>{selectedVaultName}</h2>
              <p>
                {activeProfile ? `${activeProfile.name} aktif profil.` : "Aktif profil secilmedi."} Yeni profil ekleyebilir veya
                mevcut profili aktif yapabilirsiniz.
              </p>
            </div>
            <div className="form-actions">
              <button className="ui-button ghost compact" onClick={startCreateVault}>
                <Plus size={17} />
                Yeni kasa
              </button>
              <button
                className="ui-button ghost compact"
                onClick={lockVault}
                title="Bu tarayicidaki acik kasa bilgisini temizler; kasa ve profilleri silmez."
              >
                <LockKeyhole size={17} />
                Kilitle
              </button>
            </div>
          </div>
          <form className="settings-form" onSubmit={saveProfile}>
            <label className="field">
              <span>Profil adi</span>
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} autoComplete="off" />
            </label>
            <div className="form-pair">
              <label className="field">
                <span>Trendyol satici ID</span>
                <input
                  value={draft.trendyol.sellerId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      trendyol: { ...current.trendyol, sellerId: event.target.value }
                    }))
                  }
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>Trendyol API key</span>
                <input
                  value={draft.trendyol.apiKey ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      trendyol: { ...current.trendyol, apiKey: event.target.value }
                    }))
                  }
                  autoComplete="off"
                />
              </label>
            </div>
            <label className="field">
              <span>Trendyol API secret</span>
              <input className="visually-hidden" value={draft.trendyol.sellerId || "trendyol-api"} readOnly tabIndex={-1} autoComplete="username" />
              <input
                type="password"
                value={draft.trendyol.apiSecret ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    trendyol: { ...current.trendyol, apiSecret: event.target.value }
                  }))
                }
                autoComplete="new-password"
              />
            </label>
            <div className="form-pair">
              <label className="field">
                <span>GIB kullanici</span>
                <input
                  value={draft.gibPortal.username}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gibPortal: { ...current.gibPortal, username: event.target.value }
                    }))
                  }
                  autoComplete="username"
                />
              </label>
              <label className="field">
                <span>GIB sifre</span>
                <input
                  type="password"
                  value={draft.gibPortal.password ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gibPortal: { ...current.gibPortal, password: event.target.value }
                    }))
                  }
                  autoComplete="current-password"
                />
              </label>
            </div>
            <label className="field">
              <span>GIB portal URL</span>
                <input
                  value={draft.gibPortal.portalUrl}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gibPortal: { ...current.gibPortal, portalUrl: event.target.value }
                    }))
                  }
                  autoComplete="url"
                />
              </label>
            <div className="form-pair">
              <label className="field">
                <span>GIB direct VKN/TCKN</span>
                <input
                  value={draft.gibDirect.taxId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gibDirect: { ...current.gibDirect, taxId: event.target.value }
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Fatura seri prefix</span>
                <input
                  value={draft.gibDirect.invoicePrefix}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gibDirect: { ...current.gibDirect, invoicePrefix: event.target.value }
                    }))
                  }
                  maxLength={3}
                />
              </label>
            </div>
            <label className="field">
              <span>GIB direct servis URL</span>
              <input
                value={draft.gibDirect.serviceUrl}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    gibDirect: { ...current.gibDirect, serviceUrl: event.target.value }
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Mali muhur/NES imzalama komutu</span>
              <input
                value={draft.gibDirect.signerCommand}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    gibDirect: { ...current.gibDirect, signerCommand: event.target.value }
                  }))
                }
              />
            </label>
            <label className="field">
              <span>SOAP/WSS imzalama komutu</span>
              <input
                value={draft.gibDirect.soapSignerCommand}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    gibDirect: { ...current.gibDirect, soapSignerCommand: event.target.value }
                  }))
                }
              />
            </label>
            <div className="form-pair">
              <label className="field">
                <span>GIB izin referansi</span>
                <input
                  value={draft.gibDirect.authorizationReference ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gibDirect: { ...current.gibDirect, authorizationReference: event.target.value }
                    }))
                  }
                />
              </label>
              <div className="field">
                <span>Yetki teyitleri</span>
                <span className="check-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.gibDirect.testAccessConfirmed}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          gibDirect: { ...current.gibDirect, testAccessConfirmed: event.target.checked }
                        }))
                      }
                    />
                    Test
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.gibDirect.productionAccessConfirmed}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          gibDirect: { ...current.gibDirect, productionAccessConfirmed: event.target.checked }
                        }))
                      }
                    />
                    Canli
                  </label>
                </span>
              </div>
            </div>
            {status ? <div className="form-alert">{status}</div> : null}
            <div className="form-actions">
              <button className="ui-button ghost" type="button" onClick={() => setDraft(newProfileDraft(trendyolForm, gibPortalForm, gibDirectForm))}>
                <Plus size={18} />
                Formdan al
              </button>
              <button className="ui-button primary" type="submit" disabled={busy}>
                <ShieldCheck size={18} />
                Profili kaydet
              </button>
            </div>
          </form>
        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Sifreli profiller</span>
              <h2>{profiles.length} profil</h2>
              <p>Aktif profil uygulamadaki entegrasyon formlarini doldurur ve kasa icinde hatirlanir.</p>
            </div>
            <KeyRound size={20} />
          </div>
          <div className="profile-list">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;

              return (
                <article className={`profile-card${isActive ? " active" : ""}`} key={profile.id}>
                  <div>
                    <span className="micro-label">{isActive ? "Aktif profil" : "Profil"}</span>
                    <h3>
                      {profile.name}
                      {isActive ? <CheckCircle2 size={17} aria-label="Aktif" /> : null}
                    </h3>
                    <p>
                      Trendyol: {profile.trendyol.sellerId || "bekliyor"} / GIB:{" "}
                      {profile.gibPortal.username || "bekliyor"} / Direct: {profile.gibDirect.taxId || "bekliyor"}
                    </p>
                  </div>
                  <div className="form-actions">
                    <button
                      className="ui-button primary compact"
                      type="button"
                      onClick={() => void activateProfile(profile)}
                      disabled={busy || isActive}
                    >
                      <Send size={17} />
                      {isActive ? "Aktif" : "Aktif yap"}
                    </button>
                    <button className="ui-button ghost compact" type="button" onClick={() => void deleteProfile(profile.id)} disabled={busy}>
                      <Trash2 size={17} />
                      Sil
                    </button>
                  </div>
                </article>
              );
            })}
            {profiles.length === 0 ? <div className="empty-state">Henuz profil yok. Ilk profili soldaki formdan kaydedin.</div> : null}
          </div>
        </article>
      </section>
    </div>
  );
}
