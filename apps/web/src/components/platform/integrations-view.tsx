"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { ExternalLink, KeyRound, Loader2, LockKeyhole, LogIn, PlugZap, Send, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ConnectionsSnapshot,
  GibDirectConnectionInput,
  GibPortalConnectionInput,
  TrendyolConnectionInput
} from "../../lib/api";
import {
  listRemoteVaults,
  loadRemoteVaultById,
  saveRemoteDefaultVault,
  saveRemoteVault,
  type RemoteVaultSummary
} from "../../lib/firebase/vault-store";
import { cx } from "../../lib/platform/format";
import { integrationCatalog } from "../../lib/platform/integration-catalog";
import {
  defaultVaultName,
  clearActiveVaultSession,
  mergeVaultSummaries,
  normalizeVaultPayload,
  readActiveVaultSession,
  readVaultRecordById,
  readVaultRecordsFromStorage,
  saveActiveVaultSession,
  saveVaultRecordToStorage,
  withRemoteTimeout,
  type SavedProfile,
  type StoredVaultRecord,
  type VaultPayload
} from "../../lib/platform/saved-information-store";
import { decryptVaultPayload, encryptVaultPayload, type EncryptedVault } from "../../lib/platform/secure-vault";

interface IntegrationsViewProps {
  ownerUsername: string;
  connections: ConnectionsSnapshot | null;
  settings: Record<string, unknown>;
  draftCount: number;
  busyAction: string | null;
  apiAvailable: boolean;
  trendyolForm: TrendyolConnectionInput;
  gibPortalForm: GibPortalConnectionInput;
  gibDirectForm: GibDirectConnectionInput;
  setTrendyolForm: Dispatch<SetStateAction<TrendyolConnectionInput>>;
  setGibPortalForm: Dispatch<SetStateAction<GibPortalConnectionInput>>;
  setGibDirectForm: Dispatch<SetStateAction<GibDirectConnectionInput>>;
  onSaveTrendyol: () => void;
  onSaveGibPortal: () => void;
  onSaveGibDirect: () => void;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
  onOpenTrendyolPartner: () => void;
  setMessage: (message: string) => void;
}

export function IntegrationsView({
  ownerUsername,
  connections,
  settings,
  draftCount,
  busyAction,
  apiAvailable,
  trendyolForm,
  gibPortalForm,
  gibDirectForm,
  setTrendyolForm,
  setGibPortalForm,
  setGibDirectForm,
  onSaveTrendyol,
  onSaveGibPortal,
  onSaveGibDirect,
  onOpenGibPortal,
  onCloseGibPortalSession,
  onOpenTrendyolPartner,
  setMessage
}: IntegrationsViewProps) {
  const marketplaces = integrationCatalog.filter((item) => item.category === "marketplace");
  const invoices = integrationCatalog.filter((item) => item.category === "invoice");
  const cargo = integrationCatalog.filter((item) => item.category === "cargo");
  const trendyolSavedAsDraft = !apiAvailable && connections?.trendyol.configured;
  const gibSavedAsDraft = !apiAvailable && connections?.gibPortal.configured;

  return (
    <div className="view-stack">
      <IntegrationProfilePicker
        ownerUsername={ownerUsername}
        setTrendyolForm={setTrendyolForm}
        setGibPortalForm={setGibPortalForm}
        setGibDirectForm={setGibDirectForm}
        setMessage={setMessage}
      />

      <ConnectionWorkflow
        apiAvailable={apiAvailable}
        connections={connections}
        draftCount={draftCount}
        busyAction={busyAction}
        onSaveTrendyol={onSaveTrendyol}
        onSaveGibPortal={onSaveGibPortal}
        onSaveGibDirect={onSaveGibDirect}
        onOpenGibPortal={onOpenGibPortal}
        onCloseGibPortalSession={onCloseGibPortalSession}
      />

      <section className="content-grid integration-forms">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Canli pazaryeri</span>
              <h2>Trendyol Partner</h2>
            </div>
            <span className={cx("status-pill", apiAvailable && connections?.trendyol.configured ? "success" : "warning")}>
              {apiAvailable && connections?.trendyol.configured
                ? "Bagli"
                : trendyolSavedAsDraft
                  ? "Taslak kayitli"
                  : "Bekliyor"}
            </span>
          </div>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveTrendyol();
            }}
          >
            <label className="field">
              <span>Satici ID</span>
              <input
                value={trendyolForm.sellerId}
                onChange={(event) => setTrendyolForm((current) => ({ ...current, sellerId: event.target.value }))}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                value={trendyolForm.apiKey ?? ""}
                onChange={(event) => setTrendyolForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={connections?.trendyol.apiKeyMasked ?? ""}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>API Secret</span>
              <input
                type="password"
                value={trendyolForm.apiSecret ?? ""}
                onChange={(event) => setTrendyolForm((current) => ({ ...current, apiSecret: event.target.value }))}
                placeholder={connections?.trendyol.apiSecretSaved ? "Kayitli" : ""}
                autoComplete="new-password"
              />
            </label>
            <div className="form-pair">
              <label className="field">
                <span>Storefront</span>
                <input
                  value={trendyolForm.storefrontCode}
                  onChange={(event) => setTrendyolForm((current) => ({ ...current, storefrontCode: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Gun</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={trendyolForm.lookbackDays}
                  onChange={(event) => setTrendyolForm((current) => ({ ...current, lookbackDays: Number(event.target.value) }))}
                />
              </label>
            </div>
            <label className="field">
              <span>User-Agent</span>
              <input
                value={trendyolForm.userAgent}
                onChange={(event) => setTrendyolForm((current) => ({ ...current, userAgent: event.target.value }))}
              />
            </label>
            <div className="form-actions">
              <button className="ui-button ghost" type="button" onClick={onOpenTrendyolPartner}>
                <KeyRound size={18} />
                Partner ac
              </button>
              <button className="ui-button primary" type="submit" disabled={busyAction === "save-trendyol"}>
                {busyAction === "save-trendyol" ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={18} />}
                Baglan
              </button>
            </div>
          </form>
        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Fatura saglayici</span>
              <h2>e-Arsiv Portal</h2>
            </div>
            <span className={cx("status-pill", apiAvailable && connections?.gibPortal.configured ? "success" : "warning")}>
              {apiAvailable && connections?.gibPortal.configured
                ? "Bagli"
                : gibSavedAsDraft
                  ? "Taslak kayitli"
                  : "Bekliyor"}
            </span>
          </div>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveGibPortal();
            }}
          >
            <label className="field">
              <span>Kullanici</span>
              <input
                value={gibPortalForm.username}
                onChange={(event) => setGibPortalForm((current) => ({ ...current, username: event.target.value }))}
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>Sifre</span>
              <input
                type="password"
                value={gibPortalForm.password ?? ""}
                onChange={(event) => setGibPortalForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={connections?.gibPortal.passwordSaved ? "Kayitli" : ""}
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>Portal URL</span>
              <input
                value={gibPortalForm.portalUrl}
                onChange={(event) => setGibPortalForm((current) => ({ ...current, portalUrl: event.target.value }))}
              />
            </label>
            <div className="form-actions">
              <button className="ui-button ghost" type="button" onClick={onOpenGibPortal} disabled={busyAction === "open-gib"}>
                {busyAction === "open-gib" ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
                Portal ac
              </button>
              <button className="ui-button ghost" type="button" onClick={onCloseGibPortalSession} disabled={busyAction === "logout-gib"}>
                {busyAction === "logout-gib" ? <Loader2 size={18} className="spin" /> : <ShieldOff size={18} />}
                Guvenli cikis
              </button>
              <button className="ui-button primary" type="submit" disabled={busyAction === "save-gib"}>
                {busyAction === "save-gib" ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={18} />}
                Baglan
              </button>
            </div>
          </form>
        </article>
      </section>

      <GibDirectPanel
        connections={connections}
        busyAction={busyAction}
        gibDirectForm={gibDirectForm}
        setGibDirectForm={setGibDirectForm}
        onSaveGibDirect={onSaveGibDirect}
      />

      <ProviderSection title="Pazaryeri adaptorlari" description="Trendyol canli, diger kanallar ortak modele hazir." items={marketplaces} />
      <ProviderSection title="Fatura saglayicilari" description={`Runtime saglayici: ${String(settings.invoiceProvider ?? "bekleniyor")}`} items={invoices} />
      <ProviderSection title="Kargo firmalari" description="Kargo takip ve SLA katmani icin planli adapter yuzeyi." items={cargo} />
    </div>
  );
}

function GibDirectPanel({
  connections,
  busyAction,
  gibDirectForm,
  setGibDirectForm,
  onSaveGibDirect
}: {
  connections: ConnectionsSnapshot | null;
  busyAction: string | null;
  gibDirectForm: GibDirectConnectionInput;
  setGibDirectForm: Dispatch<SetStateAction<GibDirectConnectionInput>>;
  onSaveGibDirect: () => void;
}) {
  const direct = connections?.gibDirect;
  const missing = direct?.missing ?? [];

  return (
    <section className="surface-panel">
      <div className="section-head">
        <div>
          <span className="micro-label">Canli fatura yetkisi</span>
          <h2>GIB direct imzalama ve servis</h2>
          <p>
            Ozel entegrator veya sahte cevap yok. UBL XML yerel mali muhur/NES/HSM komutu ile imzalanir ve GIB servis
            sablonuna gore canli gonderilir.
          </p>
        </div>
        <span className={cx("status-pill", direct?.ready ? "success" : "warning")}>{direct?.ready ? "Hazir" : "Eksik ayar"}</span>
      </div>

      {missing.length > 0 ? (
        <div className="form-alert">
          Eksik: {missing.join(", ")}. Bu alanlar tamamlanmadan fatura kesimi sahte basarili sayilmaz, hata verir.
        </div>
      ) : null}

      <form
        className="settings-form gib-direct-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveGibDirect();
        }}
      >
        <div className="form-pair">
          <label className="field">
            <span>Ortam</span>
            <select
              value={gibDirectForm.environment}
              onChange={(event) =>
                setGibDirectForm((current) => ({ ...current, environment: event.target.value === "prod" ? "prod" : "test" }))
              }
            >
              <option value="test">Test</option>
              <option value="prod">Canli</option>
            </select>
          </label>
          <label className="field">
            <span>VKN/TCKN</span>
            <input
              value={gibDirectForm.taxId}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, taxId: event.target.value }))}
              autoComplete="off"
            />
          </label>
        </div>

        <label className="field">
          <span>GIB servis URL</span>
          <input
            value={gibDirectForm.serviceUrl}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, serviceUrl: event.target.value }))}
            placeholder="https://..."
          />
        </label>
        <label className="field">
          <span>WSDL URL</span>
          <input
            value={gibDirectForm.wsdlUrl ?? ""}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, wsdlUrl: event.target.value }))}
            placeholder="Opsiyonel"
          />
        </label>
        <label className="field">
          <span>SOAP Action</span>
          <input
            value={gibDirectForm.soapAction ?? ""}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, soapAction: event.target.value }))}
            placeholder="GIB kilavuzundaki metod"
          />
        </label>
        <label className="field">
          <span>SOAP govde sablonu</span>
          <textarea
            value={gibDirectForm.soapBodyTemplate ?? ""}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, soapBodyTemplate: event.target.value }))}
            placeholder="{signedXmlBase64}, {invoiceNumber}, {uuid}, {taxId}"
            rows={5}
          />
        </label>
        <label className="field">
          <span>SOAP sablon dosya yolu</span>
          <input
            value={gibDirectForm.soapBodyTemplatePath ?? ""}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, soapBodyTemplatePath: event.target.value }))}
            placeholder="/Users/.../gib-soap-template.xml"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Mali muhur/NES imzalama komutu</span>
          <input
            value={gibDirectForm.signerCommand}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, signerCommand: event.target.value }))}
            placeholder="java -jar signer.jar --input {input} --output {output}"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>SOAP/WSS imzalama komutu</span>
          <input
            value={gibDirectForm.soapSignerCommand}
            onChange={(event) => setGibDirectForm((current) => ({ ...current, soapSignerCommand: event.target.value }))}
            placeholder="java -jar wss-signer.jar --input {input} --output {output}"
            autoComplete="off"
          />
        </label>

        <div className="form-pair">
          <label className="field">
            <span>Fatura seri prefix</span>
            <input
              value={gibDirectForm.invoicePrefix}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, invoicePrefix: event.target.value }))}
              maxLength={3}
            />
          </label>
          <label className="field">
            <span>Siradaki numara</span>
            <input
              type="number"
              min={1}
              value={gibDirectForm.nextInvoiceSequence}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, nextInvoiceSequence: Number(event.target.value) }))}
            />
          </label>
        </div>

        <div className="form-pair">
          <label className="field">
            <span>Birim kodu</span>
            <input
              value={gibDirectForm.unitCode}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, unitCode: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Varsayilan alici TCKN</span>
            <input
              value={gibDirectForm.defaultBuyerTckn}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, defaultBuyerTckn: event.target.value }))}
            />
          </label>
        </div>

        <div className="form-pair">
          <label className="field">
            <span>mTLS PFX yolu</span>
            <input
              value={gibDirectForm.clientPfxPath ?? ""}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, clientPfxPath: event.target.value }))}
              placeholder="GIB servis istemci sertifikasi gerekiyorsa"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>mTLS sifre</span>
            <input
              className="visually-hidden"
              value={gibDirectForm.taxId || "gib-direct-client-certificate"}
              readOnly
              tabIndex={-1}
              autoComplete="username"
            />
            <input
              type="password"
              value={gibDirectForm.clientCertPassword ?? ""}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, clientCertPassword: event.target.value }))}
              placeholder={direct?.clientCertificateConfigured ? "Kayitli" : ""}
              autoComplete="current-password"
            />
          </label>
        </div>

        <div className="form-pair">
          <label className="field">
            <span>GIB izin referansi</span>
            <input
              value={gibDirectForm.authorizationReference ?? ""}
              onChange={(event) => setGibDirectForm((current) => ({ ...current, authorizationReference: event.target.value }))}
              placeholder="Yazi/talep/no"
              autoComplete="off"
            />
          </label>
          <div className="field">
            <span>Yetki teyitleri</span>
            <span className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={gibDirectForm.testAccessConfirmed}
                  onChange={(event) => setGibDirectForm((current) => ({ ...current, testAccessConfirmed: event.target.checked }))}
                />
                Test
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={gibDirectForm.productionAccessConfirmed}
                  onChange={(event) => setGibDirectForm((current) => ({ ...current, productionAccessConfirmed: event.target.checked }))}
                />
                Canli
              </label>
            </span>
          </div>
        </div>

        <div className="form-actions">
          <button className="ui-button primary" type="submit" disabled={busyAction === "save-gib-direct"}>
            {busyAction === "save-gib-direct" ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={18} />}
            GIB direct baglan
          </button>
        </div>
      </form>
    </section>
  );
}

function ConnectionWorkflow({
  apiAvailable,
  connections,
  draftCount,
  busyAction,
  onSaveTrendyol,
  onSaveGibPortal,
  onSaveGibDirect,
  onOpenGibPortal,
  onCloseGibPortalSession
}: {
  apiAvailable: boolean;
  connections: ConnectionsSnapshot | null;
  draftCount: number;
  busyAction: string | null;
  onSaveTrendyol: () => void;
  onSaveGibPortal: () => void;
  onSaveGibDirect: () => void;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
}) {
  const trendyolConnected = Boolean(apiAvailable && connections?.trendyol.configured);
  const gibConnected = Boolean(apiAvailable && connections?.gibPortal.configured);
  const gibDirectReady = Boolean(apiAvailable && connections?.gibDirect?.ready);
  const localTrendyolDraft = Boolean(!apiAvailable && connections?.trendyol.configured);
  const localGibDraft = Boolean(!apiAvailable && connections?.gibPortal.configured);

  return (
    <section className="surface-panel">
      <div className="section-head">
        <div>
          <span className="micro-label">Baglan</span>
          <h2>Baglan ve faturalari kes</h2>
          <p>Once Trendyol ve e-Arsiv bilgilerini bagla; sonra kesilmeyen faturalari Faturalar ekraninda kes.</p>
        </div>
        <PlugZap size={20} />
      </div>

      <div className="action-lanes connection-lanes">
        <article className="action-lane">
          <span>1</span>
          <strong>Trendyol baglantisi</strong>
          <small>
            {trendyolConnected
              ? "Canli Trendyol baglantisi hazir."
              : localTrendyolDraft
                ? "Bilgiler bu tarayicida kayitli; canli baglanti icin backend gerekiyor."
                : "Satici ID, API key ve secret girilip baglanmali."}
          </small>
          <button className="ui-button primary compact" type="button" onClick={onSaveTrendyol} disabled={busyAction === "save-trendyol"}>
            {busyAction === "save-trendyol" ? <Loader2 size={17} className="spin" /> : <KeyRound size={17} />}
            Trendyol'a baglan
          </button>
        </article>

        <article className="action-lane">
          <span>2</span>
          <strong>e-Arsiv baglantisi</strong>
          <small>
            {gibConnected
              ? "e-Arsiv/GIB baglantisi hazir."
              : localGibDraft
                ? "Portal bilgileri bu tarayicida kayitli; canli baglanti icin backend gerekiyor."
                : "GIB kullanici, sifre ve portal URL bilgileri girilip baglanmali."}
          </small>
          <div className="form-actions">
            <button className="ui-button primary compact" type="button" onClick={onSaveGibPortal} disabled={busyAction === "save-gib"}>
              {busyAction === "save-gib" ? <Loader2 size={17} className="spin" /> : <KeyRound size={17} />}
              e-Arsiv'e baglan
            </button>
            <button className="ui-button ghost compact" type="button" onClick={onOpenGibPortal} disabled={busyAction === "open-gib"}>
              {busyAction === "open-gib" ? <Loader2 size={17} className="spin" /> : <LogIn size={17} />}
              Portal ac
            </button>
            <button className="ui-button ghost compact" type="button" onClick={onCloseGibPortalSession} disabled={busyAction === "logout-gib"}>
              {busyAction === "logout-gib" ? <Loader2 size={17} className="spin" /> : <ShieldOff size={17} />}
              Guvenli cikis
            </button>
          </div>
        </article>

        <article className="action-lane">
          <span>3</span>
          <strong>GIB direct imza</strong>
          <small>
            {gibDirectReady
              ? "Canli fatura kesimi icin servis ve imza hazir."
              : connections?.gibDirect?.message ?? "GIB direct yetki, servis ve imzalama ayarlari girilmeli."}
          </small>
          <button className="ui-button primary compact" type="button" onClick={onSaveGibDirect} disabled={busyAction === "save-gib-direct"}>
            {busyAction === "save-gib-direct" ? <Loader2 size={17} className="spin" /> : <KeyRound size={17} />}
            GIB direct baglan
          </button>
        </article>

        <article className="action-lane">
          <span>4</span>
          <strong>Kesilmeyen faturalar</strong>
          <small>
            {draftCount > 0
              ? `${draftCount} fatura taslagi bekliyor. Taslaklari secip fatura kesebilirsiniz.`
              : "Fatura taslagi geldiginde burada is akisi Faturalar ekranina yonlenir."}
          </small>
          <a className="ui-button primary compact" href="/invoices">
            <Send size={17} />
            Faturalari ac
          </a>
        </article>
      </div>

      {!apiAvailable ? (
        <div className="form-alert connection-alert">
          Canli baglanma ve otomatik fatura kesme icin backend API URL tanimli olmali. Su anda bilgiler guvenli sekilde kaydedilir,
          canli islem backend baglaninca aktif olur.
        </div>
      ) : null}
    </section>
  );
}

function IntegrationProfilePicker({
  ownerUsername,
  setTrendyolForm,
  setGibPortalForm,
  setGibDirectForm,
  setMessage
}: {
  ownerUsername: string;
  setTrendyolForm: Dispatch<SetStateAction<TrendyolConnectionInput>>;
  setGibPortalForm: Dispatch<SetStateAction<GibPortalConnectionInput>>;
  setGibDirectForm: Dispatch<SetStateAction<GibDirectConnectionInput>>;
  setMessage: (message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [vaults, setVaults] = useState<RemoteVaultSummary[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [vaultPassword, setVaultPassword] = useState("");
  const [unlockedVaultName, setUnlockedVaultName] = useState("");
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? null;
  const selectedVaultName = selectedVault?.name ?? defaultVaultName;
  const unlocked = profiles.length > 0 || Boolean(unlockedVaultName);

  async function readVaultPayload(vaultId: string, vaultName: string, password: string) {
    let vault: EncryptedVault | null = null;
    let remoteReadFailed = false;

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

    async function loadVaults() {
      const localVaults = readVaultRecordsFromStorage().map(({ vault: _vault, ...summary }) => summary);
      const remoteVaults = await withRemoteTimeout(() => listRemoteVaults(ownerUsername), []);
      const nextVaults = mergeVaultSummaries(localVaults, remoteVaults);
      const activeSession = readActiveVaultSession(ownerUsername);
      const activeVault = activeSession ? nextVaults.find((vault) => vault.id === activeSession.vaultId) ?? null : null;

      if (!mounted) return;
      setVaults(nextVaults);
      setSelectedVaultId((current) => activeVault?.id ?? (nextVaults.some((vault) => vault.id === current) ? current : nextVaults[0]?.id ?? ""));

      if (!activeSession) {
        setLoading(false);
        return;
      }

      if (!activeVault) {
        clearActiveVaultSession(activeSession.vaultId, ownerUsername);
        setLoading(false);
        return;
      }

      try {
        const { payload, remoteReadFailed } = await readVaultPayload(activeVault.id, activeVault.name, activeSession.password);
        if (!mounted) return;

        const activeProfile = payload.activeProfileId
          ? payload.profiles.find((profile) => profile.id === payload.activeProfileId) ?? null
          : null;

        setProfiles(payload.profiles);
        setActiveProfileId(payload.activeProfileId ?? null);
        setUnlockedVaultName(activeVault.name);
        setVaultPassword(activeSession.password);

        if (activeProfile) {
          setTrendyolForm(activeProfile.trendyol);
          setGibPortalForm(activeProfile.gibPortal);
          setGibDirectForm(activeProfile.gibDirect);
          setMessage(`${activeProfile.name} aktif profil olarak yuklendi.`);
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
            : activeProfile
              ? `${activeVault.name} aktif kasa olarak yuklendi. ${activeProfile.name} profili yuklendi.`
              : `${activeVault.name} aktif kasa olarak yuklendi. Profil secince bilgiler otomatik dolar.`
        );
      } catch {
        clearActiveVaultSession(activeSession.vaultId, ownerUsername);
        if (!mounted) return;
        setUnlockedVaultName("");
        setProfiles([]);
        setActiveProfileId(null);
        setVaultPassword("");
        setStatus("Aktif kasa oturumu okunamadi. Kasayi tekrar sifreyle acin.");
      }

      setLoading(false);
    }

    void loadVaults();

    return () => {
      mounted = false;
    };
  }, [ownerUsername]);

  function applyProfile(profile: SavedProfile, messageSuffix = "formlara aktarildi") {
    setTrendyolForm(profile.trendyol);
    setGibPortalForm(profile.gibPortal);
    setGibDirectForm(profile.gibDirect);
    setActiveProfileId(profile.id);
    setMessage(`${profile.name} profili entegrasyon formlarina aktarildi.`);
    setStatus(`${profile.name} ${messageSuffix}.`);
  }

  async function persistActiveProfile(nextActiveProfileId: string) {
    if (!selectedVaultId || !vaultPassword) return false;

    const vault = await encryptVaultPayload<VaultPayload>({ profiles, activeProfileId: nextActiveProfileId }, vaultPassword);
    const record: StoredVaultRecord = {
      id: selectedVaultId,
      name: selectedVaultName,
      updatedAt: new Date().toISOString(),
      vault
    };

    saveVaultRecordToStorage(record);
    saveActiveVaultSession({
      ownerUsername,
      vaultId: selectedVaultId,
      vaultName: selectedVaultName,
      password: vaultPassword,
      activeProfileId: nextActiveProfileId
    });

    return withRemoteTimeout(() => saveRemoteVault(ownerUsername, vault, { id: selectedVaultId, name: selectedVaultName }), false);
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (!selectedVaultId) {
      setStatus("Once kasa secin.");
      return;
    }

    if (!vaultPassword) {
      setStatus("Kasa sifresi gerekli.");
      return;
    }

    setBusy(true);

    try {
      const { payload, remoteReadFailed } = await readVaultPayload(selectedVaultId, selectedVaultName, vaultPassword);
      setProfiles(payload.profiles);
      setActiveProfileId(payload.activeProfileId ?? null);
      setUnlockedVaultName(selectedVaultName);
      saveActiveVaultSession({
        ownerUsername,
        vaultId: selectedVaultId,
        vaultName: selectedVaultName,
        password: vaultPassword,
        activeProfileId: payload.activeProfileId ?? null
      });
      void withRemoteTimeout(() => saveRemoteDefaultVault(ownerUsername, selectedVaultId), false);

      const activeProfile = payload.activeProfileId
        ? payload.profiles.find((profile) => profile.id === payload.activeProfileId) ?? null
        : null;

      if (activeProfile) {
        applyProfile(activeProfile, "aktif profil olarak otomatik yuklendi");
      } else {
        setStatus(
          payload.profiles.length > 0
            ? "Kasa acildi. Bir profil secince bilgiler otomatik dolacak."
            : "Kasa acildi ama icinde profil yok."
        );
      }

      if (remoteReadFailed) {
        setStatus((current) => `${current} Firestore yavas veya okunamadi; yerel kasa kullanildi.`);
      }
    } catch {
      clearActiveVaultSession(selectedVaultId, ownerUsername);
      setProfiles([]);
      setActiveProfileId(null);
      setUnlockedVaultName("");
      setStatus("Kasa sifresi hatali veya kasa okunamadi.");
    } finally {
      setBusy(false);
    }
  }

  async function selectProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;

    applyProfile(profile);
    const remoteSaved = await persistActiveProfile(profile.id);
    setStatus(
      remoteSaved
        ? `${profile.name} aktif profil yapildi ve bilgiler otomatik dolduruldu.`
        : `${profile.name} aktif profil yapildi. Firestore yavas veya yazma izni yok; yerel kasa guncellendi.`
    );
  }

  if (loading) {
    return (
      <section className="surface-panel integration-profile-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Profil kasasi</span>
            <h2>Profiller okunuyor</h2>
            <p>Kayitli kasa listesi kontrol ediliyor.</p>
          </div>
          <Loader2 size={20} className="spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="surface-panel integration-profile-panel">
      <div className="section-head">
        <div>
          <span className="micro-label">Profil kasasi</span>
          <h2>Kayitli profilden doldur</h2>
          <p>Profil secildiginde Trendyol ve e-Arsiv alanlari otomatik dolar.</p>
        </div>
        <span className={cx("status-pill", unlocked ? "success" : "warning")}>
          {unlocked ? `${unlockedVaultName} aktif` : "Kasa kapali"}
        </span>
      </div>

      {vaults.length === 0 ? (
        <div className="settings-form">
          <div className="empty-state">
            <strong>Henuz kasa yok</strong>
            <span>Once Kayitli Bilgiler ekraninda sifreli kasa ve profil olusturun.</span>
            <a className="ui-button ghost" href="/saved-information">
              Kayitli Bilgiler'e git
            </a>
          </div>
        </div>
      ) : unlocked ? (
        <div className="settings-form profile-picker-grid">
          <label className="field">
            <span>Aktif kasa</span>
            <input value={unlockedVaultName} readOnly />
          </label>
          <label className="field">
            <span>Profil sec</span>
            <select value={activeProfileId ?? ""} onChange={(event) => void selectProfile(event.target.value)}>
              <option value="" disabled>
                Profil secin
              </option>
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ui-button ghost"
            type="button"
            onClick={() => {
              setUnlockedVaultName("");
              setProfiles([]);
              setActiveProfileId(null);
              setVaultPassword("");
              clearActiveVaultSession(selectedVaultId, ownerUsername);
              setStatus("Kasa kilitlendi. Kayitlar silinmedi; tekrar acmak icin sifre gerekir.");
            }}
            title="Bu tarayicidaki acik kasa bilgisini temizler; kasa ve profilleri silmez."
          >
            <LockKeyhole size={18} />
            Kilitle
          </button>
          {status ? <div className="form-alert profile-picker-status">{status}</div> : null}
        </div>
      ) : (
        <form className="settings-form profile-picker-grid" onSubmit={unlockVault}>
          <input className="visually-hidden" value={selectedVaultName} readOnly tabIndex={-1} autoComplete="username" />
          <label className="field">
            <span>Kasa sec</span>
            <select
              value={selectedVaultId}
              onChange={(event) => {
                setSelectedVaultId(event.target.value);
                setVaultPassword("");
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
              value={vaultPassword}
              onChange={(event) => setVaultPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="ui-button primary" type="submit" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <KeyRound size={18} />}
            Kasayi ac
          </button>
          {status ? <div className="form-alert profile-picker-status">{status}</div> : null}
        </form>
      )}
    </section>
  );
}

function ProviderSection({
  title,
  description,
  items
}: {
  title: string;
  description: string;
  items: typeof integrationCatalog;
}) {
  return (
    <section className="surface-panel">
      <div className="section-head">
        <div>
          <span className="micro-label">Adapter catalog</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <PlugZap size={20} />
      </div>

      <div className="provider-grid">
        {items.map((item) => (
          <article className={cx("provider-card", item.accent)} key={item.id}>
            <span className="provider-initial">{item.name.slice(0, 2).toLocaleUpperCase("tr-TR")}</span>
            <div className="provider-main">
              <div className="provider-title">
                <strong>{item.name}</strong>
                <span className={cx("status-pill", item.availability === "active" ? "success" : "neutral")}>
                  {item.availability === "active" ? "Aktif" : "Adapter planlandi"}
                </span>
              </div>
              <h3>{item.headline}</h3>
              <p>{item.description}</p>
              <div className="capability-row">
                {item.capabilities.map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
            </div>
            {item.availability === "active" ? (
              <a className="icon-button" href={item.id === "trendyol" ? "https://partner.trendyol.com/" : "https://earsivportal.efatura.gov.tr/intragiris.html"} target="_blank" rel="noreferrer" aria-label={`${item.name} ac`}>
                <ExternalLink size={17} />
              </a>
            ) : (
              <button className="icon-button" disabled aria-label={`${item.name} adapter planlandi`}>
                <ExternalLink size={17} />
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
