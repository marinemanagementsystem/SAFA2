"use client";

import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";
import { ExternalLink, KeyRound, Loader2, LockKeyhole, LogIn, PlugZap, Send, ShieldOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ConnectionsSnapshot,
  HepsiburadaConnectionInput,
  HepsiburadaProductInput,
  GibDirectConnectionInput,
  GibPortalConnectionInput,
  TrendyolConnectionInput
} from "../../lib/api";
import type { HepsiburadaOrderLineListItem, HepsiburadaProductListItem } from "@safa/shared";
import {
  listRemoteVaults,
  loadRemoteVaultById,
  saveRemoteDefaultVault,
  saveRemoteVault,
  type RemoteVaultSummary
} from "../../lib/firebase/vault-store";
import { cx, money } from "../../lib/platform/format";
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

type ActiveIntegration = "trendyol" | "hepsiburada" | "gibPortal" | "gibDirect";
type IntegrationStatusTone = "success" | "warning";

interface IntegrationControl {
  id: ActiveIntegration;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  status: string;
  tone: IntegrationStatusTone;
}

interface IntegrationsViewProps {
  ownerUsername: string;
  connections: ConnectionsSnapshot | null;
  settings: Record<string, unknown>;
  busyAction: string | null;
  apiAvailable: boolean;
  trendyolForm: TrendyolConnectionInput;
  hepsiburadaForm: HepsiburadaConnectionInput;
  hepsiburadaProducts: HepsiburadaProductListItem[];
  hepsiburadaOrderLines: HepsiburadaOrderLineListItem[];
  gibPortalForm: GibPortalConnectionInput;
  gibDirectForm: GibDirectConnectionInput;
  setTrendyolForm: Dispatch<SetStateAction<TrendyolConnectionInput>>;
  setHepsiburadaForm: Dispatch<SetStateAction<HepsiburadaConnectionInput>>;
  setGibPortalForm: Dispatch<SetStateAction<GibPortalConnectionInput>>;
  setGibDirectForm: Dispatch<SetStateAction<GibDirectConnectionInput>>;
  onSaveTrendyol: () => void;
  onSaveHepsiburada: () => void;
  onSaveHepsiburadaProduct: (input: HepsiburadaProductInput, id?: string) => void;
  onUploadHepsiburadaCatalog: () => void;
  onCheckHepsiburadaCatalogStatus: (trackingId: string) => void;
  onSyncHepsiburadaInventory: () => void;
  onUploadHepsiburadaPrices: () => void;
  onUploadHepsiburadaStocks: () => void;
  onSyncHepsiburadaOrders: () => void;
  onCreateHepsiburadaTestOrder: () => void;
  onPackageHepsiburadaOrderLine: (id: string) => void;
  onSaveGibPortal: () => void;
  onSaveGibDirect: () => void;
  onSetReconstructedPdfFallback: (enabled: boolean) => void;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
  onOpenTrendyolPartner: () => void;
  setMessage: (message: string) => void;
}

export function IntegrationsView({
  ownerUsername,
  connections,
  settings,
  busyAction,
  apiAvailable,
  trendyolForm,
  hepsiburadaForm,
  hepsiburadaProducts,
  hepsiburadaOrderLines,
  gibPortalForm,
  gibDirectForm,
  setTrendyolForm,
  setHepsiburadaForm,
  setGibPortalForm,
  setGibDirectForm,
  onSaveTrendyol,
  onSaveHepsiburada,
  onSaveHepsiburadaProduct,
  onUploadHepsiburadaCatalog,
  onCheckHepsiburadaCatalogStatus,
  onSyncHepsiburadaInventory,
  onUploadHepsiburadaPrices,
  onUploadHepsiburadaStocks,
  onSyncHepsiburadaOrders,
  onCreateHepsiburadaTestOrder,
  onPackageHepsiburadaOrderLine,
  onSaveGibPortal,
  onSaveGibDirect,
  onSetReconstructedPdfFallback,
  onOpenGibPortal,
  onCloseGibPortalSession,
  onOpenTrendyolPartner,
  setMessage
}: IntegrationsViewProps) {
  const marketplaces = integrationCatalog.filter((item) => item.category === "marketplace");
  const invoices = integrationCatalog.filter((item) => item.category === "invoice");
  const cargo = integrationCatalog.filter((item) => item.category === "cargo");
  const trendyolSavedAsDraft = !apiAvailable && connections?.trendyol.configured;
  const hepsiburadaSavedAsDraft = !apiAvailable && connections?.hepsiburada.configured;
  const gibSavedAsDraft = !apiAvailable && connections?.gibPortal.configured;
  const plannedMarketplaces = marketplaces.filter((item) => item.id !== "trendyol" && item.id !== "hepsiburada");
  const plannedInvoices = invoices.filter((item) => item.id !== "gib-earsiv");
  const [activeIntegration, setActiveIntegration] = useState<ActiveIntegration | null>(null);

  const integrationControls: IntegrationControl[] = [
    {
      id: "trendyol",
      title: "Trendyol",
      eyebrow: "Pazaryeri",
      description: "Satici bilgileri ve partner aksiyonu.",
      icon: KeyRound,
      status: apiAvailable && connections?.trendyol.configured ? "Bagli" : trendyolSavedAsDraft ? "Taslak kayitli" : "Bekliyor",
      tone: apiAvailable && connections?.trendyol.configured ? "success" : "warning"
    },
    {
      id: "hepsiburada",
      title: "Hepsiburada",
      eyebrow: "Pazaryeri",
      description: "Katalog, stok/fiyat, siparis ve paketleme.",
      icon: Send,
      status: apiAvailable && connections?.hepsiburada.configured ? "Bagli" : hepsiburadaSavedAsDraft ? "Taslak kayitli" : "Bekliyor",
      tone: apiAvailable && connections?.hepsiburada.configured ? "success" : "warning"
    },
    {
      id: "gibPortal",
      title: "e-Arsiv Portal",
      eyebrow: "Fatura",
      description: "Portal girisi, oturum ve baglanti.",
      icon: LogIn,
      status: apiAvailable && connections?.gibPortal.configured ? "Bagli" : gibSavedAsDraft ? "Taslak kayitli" : "Bekliyor",
      tone: apiAvailable && connections?.gibPortal.configured ? "success" : "warning"
    },
    {
      id: "gibDirect",
      title: "GIB Direct",
      eyebrow: "Fatura",
      description: "Servis, imza ve yetki ayarlari.",
      icon: LockKeyhole,
      status: apiAvailable && connections?.gibDirect?.ready ? "Bagli" : "Eksik ayar",
      tone: apiAvailable && connections?.gibDirect?.ready ? "success" : "warning"
    }
  ];
  const activeControl = integrationControls.find((item) => item.id === activeIntegration) ?? null;

  return (
    <div className="view-stack">
      <IntegrationProfilePicker
        ownerUsername={ownerUsername}
        setTrendyolForm={setTrendyolForm}
        setGibPortalForm={setGibPortalForm}
        setGibDirectForm={setGibDirectForm}
        setMessage={setMessage}
      />

      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Entegrasyonlar</span>
            <h2>Baglanti kartlari</h2>
            <p>Kartlardan birini acarak ilgili alanlari ve operasyon butonlarini sayfa ici modalda yonetin.</p>
          </div>
          <PlugZap size={20} />
        </div>

        <div className="integration-control-grid">
          {integrationControls.map((control) => (
            <IntegrationControlCard
              control={control}
              isActive={activeIntegration === control.id}
              key={control.id}
              onOpen={setActiveIntegration}
            />
          ))}
        </div>
      </section>

      <IntegrationModal control={activeControl} onClose={() => setActiveIntegration(null)}>
        {activeIntegration === "trendyol" ? (
          <TrendyolPanel
            connections={connections}
            busyAction={busyAction}
            trendyolForm={trendyolForm}
            setTrendyolForm={setTrendyolForm}
            onOpenTrendyolPartner={onOpenTrendyolPartner}
            onSaveTrendyol={onSaveTrendyol}
          />
        ) : null}
        {activeIntegration === "hepsiburada" ? (
          <HepsiburadaPanel
            connections={connections}
            busyAction={busyAction}
            hepsiburadaForm={hepsiburadaForm}
            products={hepsiburadaProducts}
            orderLines={hepsiburadaOrderLines}
            setHepsiburadaForm={setHepsiburadaForm}
            onSaveHepsiburada={onSaveHepsiburada}
            onSaveProduct={onSaveHepsiburadaProduct}
            onUploadCatalog={onUploadHepsiburadaCatalog}
            onCheckCatalogStatus={onCheckHepsiburadaCatalogStatus}
            onSyncInventory={onSyncHepsiburadaInventory}
            onUploadPrices={onUploadHepsiburadaPrices}
            onUploadStocks={onUploadHepsiburadaStocks}
            onSyncOrders={onSyncHepsiburadaOrders}
            onCreateTestOrder={onCreateHepsiburadaTestOrder}
            onPackageOrderLine={onPackageHepsiburadaOrderLine}
          />
        ) : null}
        {activeIntegration === "gibPortal" ? (
          <GibPortalPanel
            connections={connections}
            settings={settings}
            busyAction={busyAction}
            gibPortalForm={gibPortalForm}
            setGibPortalForm={setGibPortalForm}
            onOpenGibPortal={onOpenGibPortal}
            onCloseGibPortalSession={onCloseGibPortalSession}
            onSaveGibPortal={onSaveGibPortal}
            onSetReconstructedPdfFallback={onSetReconstructedPdfFallback}
          />
        ) : null}
        {activeIntegration === "gibDirect" ? (
          <GibDirectPanel
            connections={connections}
            busyAction={busyAction}
            gibDirectForm={gibDirectForm}
            setGibDirectForm={setGibDirectForm}
            onSaveGibDirect={onSaveGibDirect}
          />
        ) : null}
      </IntegrationModal>

      <ProviderSection title="Pazaryeri adaptorlari" description="Planli pazaryeri kanallari ortak modele hazir." items={plannedMarketplaces} />
      <ProviderSection title="Fatura saglayicilari" description={`Runtime saglayici: ${String(settings.invoiceProvider ?? "bekleniyor")}`} items={plannedInvoices} />
      <ProviderSection title="Kargo firmalari" description="Kargo takip ve SLA katmani icin planli adapter yuzeyi." items={cargo} />
    </div>
  );
}

function IntegrationControlCard({
  control,
  isActive,
  onOpen
}: {
  control: IntegrationControl;
  isActive: boolean;
  onOpen: (id: ActiveIntegration) => void;
}) {
  const Icon = control.icon;

  return (
    <button
      aria-controls={isActive ? "integration-detail-modal" : undefined}
      aria-haspopup="dialog"
      className={cx("integration-control-card", control.tone === "success" ? "connected" : "pending")}
      type="button"
      onClick={() => onOpen(control.id)}
    >
      <span className="integration-control-icon">
        <Icon size={19} />
      </span>
      <span className="integration-control-main">
        <span className="micro-label">{control.eyebrow}</span>
        <span className="integration-control-title">
          <strong>{control.title}</strong>
          <span className={cx("status-pill", control.tone)}>{control.status}</span>
        </span>
        <span className="integration-control-description">{control.description}</span>
      </span>
    </button>
  );
}

function IntegrationModal({
  control,
  onClose,
  children
}: {
  control: IntegrationControl | null;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!control) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [control, onClose]);

  if (!control) return null;

  return (
    <div className="integration-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="integration-modal-title"
        aria-modal="true"
        className="integration-modal"
        id="integration-detail-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="integration-modal-head">
          <div>
            <span className="micro-label">{control.eyebrow}</span>
            <h2 id="integration-modal-title">{control.title}</h2>
            <p>{control.description}</p>
          </div>
          <div className="integration-modal-actions">
            <span className={cx("status-pill", control.tone)}>{control.status}</span>
            <button className="icon-button" type="button" onClick={onClose} aria-label={`${control.title} modalini kapat`}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="integration-modal-body">{children}</div>
      </section>
    </div>
  );
}

function TrendyolPanel({
  connections,
  busyAction,
  trendyolForm,
  setTrendyolForm,
  onOpenTrendyolPartner,
  onSaveTrendyol
}: {
  connections: ConnectionsSnapshot | null;
  busyAction: string | null;
  trendyolForm: TrendyolConnectionInput;
  setTrendyolForm: Dispatch<SetStateAction<TrendyolConnectionInput>>;
  onOpenTrendyolPartner: () => void;
  onSaveTrendyol: () => void;
}) {
  return (
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
        <input value={trendyolForm.userAgent} onChange={(event) => setTrendyolForm((current) => ({ ...current, userAgent: event.target.value }))} />
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
  );
}

function GibPortalPanel({
  connections,
  settings,
  busyAction,
  gibPortalForm,
  setGibPortalForm,
  onOpenGibPortal,
  onCloseGibPortalSession,
  onSaveGibPortal,
  onSetReconstructedPdfFallback
}: {
  connections: ConnectionsSnapshot | null;
  settings: Record<string, unknown>;
  busyAction: string | null;
  gibPortalForm: GibPortalConnectionInput;
  setGibPortalForm: Dispatch<SetStateAction<GibPortalConnectionInput>>;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
  onSaveGibPortal: () => void;
  onSetReconstructedPdfFallback: (enabled: boolean) => void;
}) {
  const reconstructedPdfFallbackEnabled = Boolean(settings.gibPortalReconstructedPdfFallbackEnabled);

  return (
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
        <input value={gibPortalForm.portalUrl} onChange={(event) => setGibPortalForm((current) => ({ ...current, portalUrl: event.target.value }))} />
      </label>
      <div className="field">
        <span>PDF fallback</span>
        <span className="check-row">
          <label>
            <input
              type="checkbox"
              checked={reconstructedPdfFallbackEnabled}
              disabled={busyAction === "save-reconstructed-pdf-fallback"}
              onChange={(event) => onSetReconstructedPdfFallback(event.target.checked)}
            />
            GIB PDF alinamazsa imzali kayittan pazaryeri PDF kopyasi uret ve otomatik gonder
          </label>
        </span>
      </div>
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
  );
}

function HepsiburadaPanel({
  connections,
  busyAction,
  hepsiburadaForm,
  products,
  orderLines,
  setHepsiburadaForm,
  onSaveHepsiburada,
  onSaveProduct,
  onUploadCatalog,
  onCheckCatalogStatus,
  onSyncInventory,
  onUploadPrices,
  onUploadStocks,
  onSyncOrders,
  onCreateTestOrder,
  onPackageOrderLine
}: {
  connections: ConnectionsSnapshot | null;
  busyAction: string | null;
  hepsiburadaForm: HepsiburadaConnectionInput;
  products: HepsiburadaProductListItem[];
  orderLines: HepsiburadaOrderLineListItem[];
  setHepsiburadaForm: Dispatch<SetStateAction<HepsiburadaConnectionInput>>;
  onSaveHepsiburada: () => void;
  onSaveProduct: (input: HepsiburadaProductInput, id?: string) => void;
  onUploadCatalog: () => void;
  onCheckCatalogStatus: (trackingId: string) => void;
  onSyncInventory: () => void;
  onUploadPrices: () => void;
  onUploadStocks: () => void;
  onSyncOrders: () => void;
  onCreateTestOrder: () => void;
  onPackageOrderLine: (id: string) => void;
}) {
  const [trackingId, setTrackingId] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [productForm, setProductForm] = useState({
    name: "",
    barcode: "",
    hbSku: "",
    merchantSku: "",
    brand: "SAFA",
    categoryName: "Hepsiburada Envanter",
    vatRate: 20,
    price: "0",
    stock: 0,
    dispatchTime: 2,
    description: "",
    active: true
  });

  function fillProduct(product: HepsiburadaProductListItem) {
    setEditingId(product.id);
    setProductForm({
      name: product.name,
      barcode: product.barcode ?? "",
      hbSku: product.hepsiburada?.hbSku ?? "",
      merchantSku: product.merchantSku,
      brand: product.brand,
      categoryName: product.categoryName,
      vatRate: product.vatRate,
      price: String(product.priceCents / 100),
      stock: product.stock,
      dispatchTime: product.dispatchTime,
      description: product.description ?? "",
      active: product.active
    });
  }

  function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const priceNumber = Number(productForm.price.replace(",", "."));
    onSaveProduct(
      {
        name: productForm.name,
        barcode: productForm.barcode || undefined,
        hbSku: productForm.hbSku || undefined,
        merchantSku: productForm.merchantSku,
        brand: productForm.brand,
        categoryName: productForm.categoryName,
        vatRate: productForm.vatRate,
        priceCents: Number.isFinite(priceNumber) ? Math.round(priceNumber * 100) : 0,
        stock: productForm.stock,
        dispatchTime: productForm.dispatchTime,
        description: productForm.description || undefined,
        active: productForm.active
      },
      editingId
    );
  }

  return (
    <>
      <div className="content-grid integration-forms">
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveHepsiburada();
          }}
        >
          <div className="form-pair">
            <label className="field">
              <span>Merchant ID</span>
              <input
                value={hepsiburadaForm.merchantId}
                onChange={(event) => setHepsiburadaForm((current) => ({ ...current, merchantId: event.target.value }))}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Ortam</span>
              <select
                value={hepsiburadaForm.environment}
                onChange={(event) =>
                  setHepsiburadaForm((current) => ({
                    ...current,
                    environment: event.target.value === "prod" ? "prod" : "test"
                  }))
                }
              >
                <option value="test">Test</option>
                <option value="prod">Canli</option>
              </select>
            </label>
          </div>
          <div className="form-pair">
            <label className="field">
              <span>User</span>
              <input
                value={hepsiburadaForm.username}
                onChange={(event) => setHepsiburadaForm((current) => ({ ...current, username: event.target.value }))}
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={hepsiburadaForm.password ?? ""}
                placeholder={connections?.hepsiburada.passwordSaved ? "Kayitli" : ""}
                onChange={(event) => setHepsiburadaForm((current) => ({ ...current, password: event.target.value }))}
                autoComplete="new-password"
              />
            </label>
          </div>
          <label className="field">
            <span>User-Agent</span>
            <input
              value={hepsiburadaForm.userAgent}
              onChange={(event) => setHepsiburadaForm((current) => ({ ...current, userAgent: event.target.value }))}
            />
          </label>
          <div className="form-pair">
            <label className="field">
              <span>Gun</span>
              <input
                type="number"
                min={1}
                max={30}
                value={hepsiburadaForm.lookbackDays}
                onChange={(event) => setHepsiburadaForm((current) => ({ ...current, lookbackDays: Number(event.target.value) }))}
              />
            </label>
            <label className="field">
              <span>OMS URL</span>
              <input
                value={hepsiburadaForm.orderBaseUrl}
                onChange={(event) => setHepsiburadaForm((current) => ({ ...current, orderBaseUrl: event.target.value }))}
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="ui-button primary" type="submit" disabled={busyAction === "save-hepsiburada"}>
              {busyAction === "save-hepsiburada" ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={18} />}
              Baglan
            </button>
          </div>
        </form>

        <form className="settings-form" onSubmit={submitProduct}>
          <div className="form-pair">
            <label className="field">
              <span>Urun adi</span>
              <input value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="field">
              <span>Merchant SKU</span>
              <input
                value={productForm.merchantSku}
                onChange={(event) => setProductForm((current) => ({ ...current, merchantSku: event.target.value }))}
              />
            </label>
          </div>
          <div className="form-pair">
            <label className="field">
              <span>HB SKU</span>
              <input value={productForm.hbSku} onChange={(event) => setProductForm((current) => ({ ...current, hbSku: event.target.value }))} />
            </label>
            <label className="field">
              <span>Barkod</span>
              <input
                value={productForm.barcode}
                onChange={(event) => setProductForm((current) => ({ ...current, barcode: event.target.value }))}
              />
            </label>
          </div>
          <div className="form-pair">
            <label className="field">
              <span>Fiyat</span>
              <input value={productForm.price} onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))} />
            </label>
            <label className="field">
              <span>Stok</span>
              <input
                type="number"
                min={0}
                value={productForm.stock}
                onChange={(event) => setProductForm((current) => ({ ...current, stock: Number(event.target.value) }))}
              />
            </label>
          </div>
          <div className="form-pair">
            <label className="field">
              <span>Marka</span>
              <input value={productForm.brand} onChange={(event) => setProductForm((current) => ({ ...current, brand: event.target.value }))} />
            </label>
            <label className="field">
              <span>Kategori</span>
              <input
                value={productForm.categoryName}
                onChange={(event) => setProductForm((current) => ({ ...current, categoryName: event.target.value }))}
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="ui-button primary" type="submit" disabled={busyAction === "hepsiburada-product"}>
              {busyAction === "hepsiburada-product" ? <Loader2 size={18} className="spin" /> : <KeyRound size={18} />}
              {editingId ? "Urunu guncelle" : "Urun ekle"}
            </button>
            {editingId ? (
              <button className="ui-button ghost" type="button" onClick={() => setEditingId(undefined)}>
                Yeni kayit
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="action-lanes connection-lanes">
        <article className="action-lane">
          <span>1</span>
          <strong>Katalog</strong>
          <small>{products.length} urun kayitli. TrackingId Hepsiburada test ticket kanitidir.</small>
          <button className="ui-button primary compact" type="button" onClick={onUploadCatalog} disabled={busyAction === "hepsiburada-catalog"}>
            {busyAction === "hepsiburada-catalog" ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
            Katalog gonder
          </button>
          <div className="inline-action">
            <input value={trackingId} onChange={(event) => setTrackingId(event.target.value)} placeholder="trackingId" />
            <button
              className="ui-button ghost compact"
              type="button"
              onClick={() => onCheckCatalogStatus(trackingId)}
              disabled={busyAction === "hepsiburada-catalog-status"}
            >
              Sorgula
            </button>
          </div>
        </article>
        <article className="action-lane">
          <span>2</span>
          <strong>Stok / fiyat</strong>
          <small>HB envanteriyle eslesen merchantSku veya hbSku kayitlari gonderilir.</small>
          <div className="form-actions">
            <button className="ui-button ghost compact" type="button" onClick={onSyncInventory} disabled={busyAction === "hepsiburada-inventory"}>
              Envanter
            </button>
            <button className="ui-button ghost compact" type="button" onClick={onUploadPrices} disabled={busyAction === "hepsiburada-price"}>
              Fiyat
            </button>
            <button className="ui-button ghost compact" type="button" onClick={onUploadStocks} disabled={busyAction === "hepsiburada-stock"}>
              Stok
            </button>
          </div>
        </article>
        <article className="action-lane">
          <span>3</span>
          <strong>Siparis</strong>
          <small>{orderLines.length} Hepsiburada kalemi takipte. Paketleme operator onaylidir.</small>
          <div className="form-actions">
            <button className="ui-button ghost compact" type="button" onClick={onCreateTestOrder} disabled={busyAction === "hepsiburada-test-order"}>
              Test siparis
            </button>
            <button className="ui-button primary compact" type="button" onClick={onSyncOrders} disabled={busyAction === "hepsiburada-orders"}>
              Siparis cek
            </button>
          </div>
        </article>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Urun</th>
              <th>SKU</th>
              <th>Fiyat</th>
              <th>Stok</th>
              <th>Durum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.slice(0, 8).map((product) => (
              <tr key={product.id}>
                <td>{product.name}</td>
                <td>{product.hepsiburada?.hbSku ?? product.merchantSku}</td>
                <td>{money(product.priceCents, "TRY")}</td>
                <td>{product.stock}</td>
                <td>{product.hepsiburada?.lastStatus ?? "Bekliyor"}</td>
                <td>
                  <button className="text-link" type="button" onClick={() => fillProduct(product)}>
                    Duzenle
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 ? (
              <tr>
                <td colSpan={6}>Hepsiburada urun kaydi yok.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Siparis</th>
              <th>Kalem</th>
              <th>Musteri</th>
              <th>Paket</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orderLines.slice(0, 8).map((line) => (
              <tr key={line.id}>
                <td>{line.orderNumber}</td>
                <td>
                  {line.hbSku} / {line.quantity}
                </td>
                <td>{line.customerName ?? "-"}</td>
                <td>{line.packageNumber ?? line.packageStatus}</td>
                <td>
                  {!line.packageNumber ? (
                    <button
                      className="ui-button primary compact"
                      type="button"
                      onClick={() => onPackageOrderLine(line.id)}
                      disabled={busyAction === `hepsiburada-package-${line.id}`}
                    >
                      {busyAction === `hepsiburada-package-${line.id}` ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                      Paketle
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {orderLines.length === 0 ? (
              <tr>
                <td colSpan={5}>Hepsiburada siparis kalemi yok.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
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
    <>
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
    </>
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
