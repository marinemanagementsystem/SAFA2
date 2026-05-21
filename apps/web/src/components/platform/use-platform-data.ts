"use client";

import type {
  ExternalInvoiceListItem,
  ExternalInvoiceSource,
  ExternalInvoiceSyncResult,
  HepsiburadaOrderLineListItem,
  HepsiburadaProductListItem,
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  MonthlyInvoiceArchiveResult,
  OrderDetail,
  OrderListItem
} from "@safa/shared";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  API_AVAILABLE,
  ConnectionsSnapshot,
  HepsiburadaConnectionInput,
  HepsiburadaProductInput,
  GibDirectConnectionInput,
  GibPortalConnectionInput,
  isApiGatewayProxyError,
  TrendyolConnectionInput
} from "../../lib/api";
import { money } from "../../lib/platform/format";
import type { LoadState } from "../../lib/platform/types";

export interface PlatformSnapshot {
  orders: OrderListItem[];
  drafts: InvoiceDraftListItem[];
  invoices: InvoiceListItem[];
  externalInvoices: ExternalInvoiceListItem[];
  hepsiburadaProducts: HepsiburadaProductListItem[];
  hepsiburadaOrderLines: HepsiburadaOrderLineListItem[];
  jobs: IntegrationJobListItem[];
  settings: Record<string, unknown>;
  connections: ConnectionsSnapshot | null;
}

const emptySnapshot: PlatformSnapshot = {
  orders: [],
  drafts: [],
  invoices: [],
  externalInvoices: [],
  hepsiburadaProducts: [],
  hepsiburadaOrderLines: [],
  jobs: [],
  settings: {},
  connections: null
};

const initialTrendyolForm: TrendyolConnectionInput = {
  sellerId: "",
  apiKey: "",
  apiSecret: "",
  userAgent: "SAFA local e-arsiv integration",
  baseUrl: "https://apigw.trendyol.com",
  storefrontCode: "TR",
  lookbackDays: 14
};

const initialHepsiburadaForm: HepsiburadaConnectionInput = {
  merchantId: "",
  username: "",
  password: "",
  userAgent: "SAFA Hepsiburada integration",
  environment: "test",
  productBaseUrl: "https://mpop-sit.hepsiburada.com",
  listingBaseUrl: "https://listing-external-sit.hepsiburada.com",
  orderBaseUrl: "https://oms-external-sit.hepsiburada.com",
  supplierBaseUrl: "https://supplier-api-external-sit.hepsiburada.com",
  lookbackDays: 7
};

const initialGibPortalForm: GibPortalConnectionInput = {
  username: "",
  password: "",
  portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html"
};

const initialGibDirectForm: GibDirectConnectionInput = {
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

const apiOfflineMessage = "Canli API bagli degil. Frontend yayinda; backend URL tanimlaninca operasyon aksiyonlari aktif olacak.";
const trendyolDraftStorageKey = "safa.trendyolConnectionDraft.v1";
const hepsiburadaDraftStorageKey = "safa.hepsiburadaConnectionDraft.v1";
const gibPortalDraftStorageKey = "safa.gibPortalConnectionDraft.v1";
const gibDirectDraftStorageKey = "safa.gibDirectConnectionDraft.v1";
const platformSnapshotCacheFreshMs = 5_000;

interface PlatformSnapshotCache {
  snapshot: PlatformSnapshot;
  trendyolForm: TrendyolConnectionInput;
  hepsiburadaForm: HepsiburadaConnectionInput;
  gibPortalForm: GibPortalConnectionInput;
  gibDirectForm: GibDirectConnectionInput;
  message: string;
  storedAt: number;
}

let platformSnapshotCache: PlatformSnapshotCache | null = null;

interface GibPortalSyncRequest {
  days?: number;
  startDate?: string;
  endDate?: string;
  repairMissingDrafts?: boolean;
  repairOrderNumber?: string;
}

function gibPortalSyncRequest(input: number | GibPortalSyncRequest): GibPortalSyncRequest {
  return typeof input === "number" ? { days: input } : input;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function canUseServerIssuedPortalLaunchUrl() {
  if (typeof window === "undefined") return false;

  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.startsWith("192.168.") || host.startsWith("10.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host.endsWith(".local");
}

function portalUploadedSummary(items: Array<{ orderNumber: string; shipmentPackageId: string; customerName: string; totalPayableCents: number; currency: string }>) {
  if (items.length === 0) return "";

  const visible = items
    .slice(0, 3)
    .map(
      (item) =>
        `${item.orderNumber} / ${item.customerName} / ${money(item.totalPayableCents, item.currency)} / Paket ${item.shipmentPackageId}`
    )
    .join("; ");
  const extra = items.length > 3 ? ` +${items.length - 3} kayit daha` : "";
  return ` Yuklenen fatura: ${visible}${extra}.`;
}

function externalSyncSummary(
  prefix: string,
  result: {
    imported: number;
    matched: number;
    checkedCount?: number;
    signedFound?: number;
    promoted?: number;
    trendyolSent?: number;
    trendyolAlreadySent?: number;
    trendyolFailed?: number;
    pdfMissing?: number;
    followup?: { needsManualMatch?: number };
  }
) {
  const parts = [
    `${result.checkedCount ?? result.imported ?? 0} kayit sorgulandi`,
    result.signedFound ? `${result.signedFound} imzali bulundu` : undefined,
    `${result.matched ?? 0} eslesti`,
    result.promoted ? `${result.promoted} fatura arsive alindi` : undefined,
    result.trendyolSent ? `${result.trendyolSent} Trendyol'a gonderildi` : undefined,
    result.trendyolAlreadySent ? `${result.trendyolAlreadySent} Trendyol'da zaten vardi` : undefined,
    result.pdfMissing ? `${result.pdfMissing} PDF bekliyor` : undefined,
    result.trendyolFailed ? `${result.trendyolFailed} Trendyol hatasi` : undefined,
    result.followup?.needsManualMatch ? `${result.followup.needsManualMatch} manuel eslesme bekliyor` : undefined
  ].filter(Boolean);

  return `${prefix}: ${parts.join(", ")}.`;
}

function externalSyncErrorResult(message: string): ExternalInvoiceSyncResult {
  return {
    imported: 0,
    matched: 0,
    unmatched: 0,
    checkedCount: 0,
    signedFound: 0,
    promoted: 0,
    pdfMissing: 0,
    trendyolSent: 0,
    trendyolAlreadySent: 0,
    trendyolFailed: 0,
    message,
    invoices: [],
    timelineEvents: [
      {
        type: "needs_manual_match",
        severity: "danger",
        at: new Date().toISOString(),
        message: message.includes("Canli API yanit vermiyor") ? "Canli API yanit vermiyor veya proxy yanlis adrese bagli." : message,
        nextAction: "Backend/API durumunu kontrol edin; fatura durumu bu hata yuzunden basarisiz sayilmadi."
      }
    ],
    followup: {
      checkedCount: 0,
      signedFound: 0,
      promoted: 0,
      pdfMissing: 0,
      trendyolSent: 0,
      trendyolAlreadySent: 0,
      trendyolFailed: 0,
      needsManualMatch: 0,
      unmatchedReasons: [],
      timelineEvents: [
        {
          type: "needs_manual_match",
          severity: "danger",
          at: new Date().toISOString(),
          message: message.includes("Canli API yanit vermiyor") ? "Canli API yanit vermiyor veya proxy yanlis adrese bagli." : message,
          nextAction: "Backend/API durumunu kontrol edin; fatura durumu bu hata yuzunden basarisiz sayilmadi."
        }
      ]
    }
  };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function numberFromJobResponse(job: IntegrationJobListItem, key: string) {
  const value = job.response?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function jobUserMessage(label: string, job: IntegrationJobListItem) {
  const responseMessage = typeof job.response?.message === "string" ? job.response.message : "";
  if (job.status === "SUCCESS") return responseMessage || `${label} tamamlandi.`;
  if (job.status === "FAILED") return job.lastError || responseMessage || `${label} tamamlanamadi.`;
  return responseMessage || `${label} isleniyor.`;
}

function externalSyncResultFromJob(job: IntegrationJobListItem): ExternalInvoiceSyncResult {
  const message = jobUserMessage("e-Arsiv guvenli uygulama", job);
  const checkedCount = numberFromJobResponse(job, "checkedCount");
  const signedFound = numberFromJobResponse(job, "signedFound");
  const promoted = numberFromJobResponse(job, "promoted");
  const pdfMissing = numberFromJobResponse(job, "pdfMissing");
  const trendyolSent = numberFromJobResponse(job, "trendyolSent");
  const trendyolAlreadySent = numberFromJobResponse(job, "trendyolAlreadySent");
  const trendyolFailed = numberFromJobResponse(job, "trendyolFailed");
  const needsManualMatch = numberFromJobResponse(job, "needsManualMatch");
  return {
    imported: numberFromJobResponse(job, "imported"),
    matched: numberFromJobResponse(job, "matched"),
    unmatched: numberFromJobResponse(job, "unmatched"),
    checkedCount,
    signedFound,
    promoted,
    pdfMissing,
    trendyolSent,
    trendyolAlreadySent,
    trendyolFailed,
    message,
    invoices: [],
    followup: {
      checkedCount,
      signedFound,
      promoted,
      pdfMissing,
      trendyolSent,
      trendyolAlreadySent,
      trendyolFailed,
      needsManualMatch,
      unmatchedReasons: [],
      timelineEvents: []
    }
  };
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(key);
    return stored ? ({ ...fallback, ...JSON.parse(stored) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function hasTrendyolDraft(input: TrendyolConnectionInput) {
  return Boolean(input.sellerId.trim() || input.apiKey?.trim() || input.apiSecret?.trim());
}

function hasGibPortalDraft(input: GibPortalConnectionInput) {
  return Boolean(
    input.username.trim() ||
      input.password?.trim() ||
      (input.portalUrl.trim() && input.portalUrl.trim() !== initialGibPortalForm.portalUrl)
  );
}

function hasHepsiburadaDraft(input: HepsiburadaConnectionInput) {
  return Boolean(input.merchantId.trim() || input.username.trim() || input.password?.trim());
}

function hasGibDirectDraft(input: GibDirectConnectionInput) {
  return Boolean(
    input.taxId.trim() ||
      input.serviceUrl.trim() ||
      input.signerCommand.trim() ||
      input.soapSignerCommand.trim() ||
      input.soapBodyTemplate?.trim()
  );
}

function maskValue(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= 6) return "Kayitli";
  return `${normalized.slice(0, 3)}...${normalized.slice(-3)}`;
}

function localDraftConnections(
  trendyol: TrendyolConnectionInput,
  hepsiburada: HepsiburadaConnectionInput,
  gibPortal: GibPortalConnectionInput,
  gibDirect: GibDirectConnectionInput
): ConnectionsSnapshot {
  return {
    trendyol: {
      configured: hasTrendyolDraft(trendyol),
      source: "tarayici-taslak",
      sellerId: trendyol.sellerId,
      apiKeyMasked: maskValue(trendyol.apiKey),
      apiSecretSaved: Boolean(trendyol.apiSecret?.trim()),
      userAgent: trendyol.userAgent,
      baseUrl: trendyol.baseUrl,
      storefrontCode: trendyol.storefrontCode,
      lookbackDays: trendyol.lookbackDays
    },
    hepsiburada: {
      configured: hasHepsiburadaDraft(hepsiburada),
      source: "tarayici-taslak",
      merchantId: hepsiburada.merchantId,
      username: hepsiburada.username,
      passwordSaved: Boolean(hepsiburada.password?.trim()),
      userAgent: hepsiburada.userAgent,
      environment: hepsiburada.environment,
      productBaseUrl: hepsiburada.productBaseUrl,
      listingBaseUrl: hepsiburada.listingBaseUrl,
      orderBaseUrl: hepsiburada.orderBaseUrl,
      supplierBaseUrl: hepsiburada.supplierBaseUrl,
      lookbackDays: hepsiburada.lookbackDays
    },
    gibPortal: {
      configured: hasGibPortalDraft(gibPortal),
      source: "tarayici-taslak",
      username: gibPortal.username,
      passwordSaved: Boolean(gibPortal.password?.trim()),
      portalUrl: gibPortal.portalUrl
    },
    gibDirect: {
      configured: hasGibDirectDraft(gibDirect),
      ready: hasGibDirectDraft(gibDirect),
      source: "tarayici-taslak",
      environment: gibDirect.environment,
      signerMode: gibDirect.signerMode,
      taxId: gibDirect.taxId,
      serviceUrl: gibDirect.serviceUrl,
      wsdlUrl: gibDirect.wsdlUrl,
      soapAction: gibDirect.soapAction,
      soapBodyTemplateSaved: Boolean(gibDirect.soapBodyTemplate || gibDirect.soapBodyTemplatePath),
      signerCommandSaved: Boolean(gibDirect.signerCommand),
      soapSignerCommandSaved: Boolean(gibDirect.soapSignerCommand),
      invoicePrefix: gibDirect.invoicePrefix,
      nextInvoiceSequence: gibDirect.nextInvoiceSequence,
      unitCode: gibDirect.unitCode,
      defaultBuyerTckn: gibDirect.defaultBuyerTckn,
      testAccessConfirmed: gibDirect.testAccessConfirmed,
      productionAccessConfirmed: gibDirect.productionAccessConfirmed,
      authorizationReference: gibDirect.authorizationReference,
      clientCertificateConfigured: Boolean(gibDirect.clientCertPath || gibDirect.clientPfxPath),
      missing: [],
      message: hasGibDirectDraft(gibDirect)
        ? "GIB direct bilgileri bu tarayicida taslak olarak kayitli."
        : "GIB direct ayarlari bekleniyor."
    }
  };
}

function normalizeConnectionsSnapshot(connections: ConnectionsSnapshot): ConnectionsSnapshot {
  return {
    ...connections,
    hepsiburada: connections.hepsiburada ?? {
      configured: false,
      source: "backend-eski",
      merchantId: "",
      username: "",
      passwordSaved: false,
      userAgent: "SAFA Hepsiburada integration",
      environment: "test",
      productBaseUrl: "https://mpop-sit.hepsiburada.com",
      listingBaseUrl: "https://listing-external-sit.hepsiburada.com",
      orderBaseUrl: "https://oms-external-sit.hepsiburada.com",
      supplierBaseUrl: "https://supplier-api-external-sit.hepsiburada.com",
      lookbackDays: 7
    },
    gibDirect: connections.gibDirect ?? {
      configured: false,
      ready: false,
      source: "backend-eski",
      environment: "test",
      signerMode: "external-command",
      taxId: "",
      serviceUrl: "",
      wsdlUrl: "",
      soapAction: "",
      soapBodyTemplateSaved: false,
      signerCommandSaved: false,
      soapSignerCommandSaved: false,
      invoicePrefix: "SAF",
      nextInvoiceSequence: 1,
      unitCode: "C62",
      defaultBuyerTckn: "11111111111",
      testAccessConfirmed: false,
      productionAccessConfirmed: false,
      authorizationReference: "",
      clientCertificateConfigured: false,
      missing: ["Backend GIB direct alanini henuz donmuyor"],
      message: "Backend eski cevap verdi. API yeniden baslatilinca GIB direct baglanti durumu gorunecek."
    }
  };
}

export function usePlatformData() {
  const [snapshot, setSnapshot] = useState<PlatformSnapshot>(emptySnapshot);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState(
    API_AVAILABLE
      ? "Canli entegrasyon modu acik. Sahte veri uretilmez; baglanti yoksa islem hata verir."
      : apiOfflineMessage
  );
  const [trendyolForm, setTrendyolForm] = useState<TrendyolConnectionInput>(initialTrendyolForm);
  const [hepsiburadaForm, setHepsiburadaForm] = useState<HepsiburadaConnectionInput>(initialHepsiburadaForm);
  const [gibPortalForm, setGibPortalForm] = useState<GibPortalConnectionInput>(initialGibPortalForm);
  const [gibDirectForm, setGibDirectForm] = useState<GibDirectConnectionInput>(initialGibDirectForm);

  const applyCachedSnapshot = useCallback((cached: PlatformSnapshotCache) => {
    setSnapshot(cached.snapshot);
    setTrendyolForm(cached.trendyolForm);
    setHepsiburadaForm(cached.hepsiburadaForm);
    setGibPortalForm(cached.gibPortalForm);
    setGibDirectForm(cached.gibDirectForm);
    setMessage(cached.message);
    setLoadState("idle");
  }, []);

  const load = useCallback(async (options: { preferCache?: boolean; force?: boolean } = {}) => {
    if (!API_AVAILABLE) {
      const storedTrendyol = readStoredJson(trendyolDraftStorageKey, initialTrendyolForm);
      const storedHepsiburada = readStoredJson(hepsiburadaDraftStorageKey, initialHepsiburadaForm);
      const storedGibPortal = readStoredJson(gibPortalDraftStorageKey, initialGibPortalForm);
      const storedGibDirect = readStoredJson(gibDirectDraftStorageKey, initialGibDirectForm);

      setTrendyolForm(storedTrendyol);
      setHepsiburadaForm(storedHepsiburada);
      setGibPortalForm(storedGibPortal);
      setGibDirectForm(storedGibDirect);
      setSnapshot({
        ...emptySnapshot,
        settings: { localConnectionDrafts: true },
        connections: localDraftConnections(storedTrendyol, storedHepsiburada, storedGibPortal, storedGibDirect)
      });
      setLoadState("idle");
      setMessage(apiOfflineMessage);
      return;
    }

    if (options.preferCache && platformSnapshotCache) {
      applyCachedSnapshot(platformSnapshotCache);
      const cacheAge = Date.now() - platformSnapshotCache.storedAt;
      if (!options.force && cacheAge < platformSnapshotCacheFreshMs) {
        return;
      }
    }

    setLoadState(options.preferCache && platformSnapshotCache ? "idle" : "loading");

    try {
      const [orders, hepsiburadaProducts, hepsiburadaOrderLines, drafts, invoices, externalInvoices, jobs, settings, connections] = await Promise.all([
        api.orders(),
        api.products(),
        api.hepsiburadaOrderLines(),
        api.drafts(),
        api.invoices(),
        api.externalInvoices(),
        api.jobs(),
        api.settings(),
        api.connections()
      ]);

      const normalizedConnections = normalizeConnectionsSnapshot(connections);
      const nextSnapshot = {
        orders,
        hepsiburadaProducts,
        hepsiburadaOrderLines,
        drafts,
        invoices,
        externalInvoices,
        jobs,
        settings: settings.runtime ?? {},
        connections: normalizedConnections
      };
      const nextTrendyolForm = {
        sellerId: normalizedConnections.trendyol.sellerId,
        apiKey: "",
        apiSecret: "",
        userAgent: normalizedConnections.trendyol.userAgent,
        baseUrl: normalizedConnections.trendyol.baseUrl,
        storefrontCode: normalizedConnections.trendyol.storefrontCode,
        lookbackDays: normalizedConnections.trendyol.lookbackDays
      };
      const nextHepsiburadaForm = {
        merchantId: normalizedConnections.hepsiburada.merchantId,
        username: normalizedConnections.hepsiburada.username,
        password: "",
        userAgent: normalizedConnections.hepsiburada.userAgent,
        environment: normalizedConnections.hepsiburada.environment,
        productBaseUrl: normalizedConnections.hepsiburada.productBaseUrl,
        listingBaseUrl: normalizedConnections.hepsiburada.listingBaseUrl,
        orderBaseUrl: normalizedConnections.hepsiburada.orderBaseUrl,
        supplierBaseUrl: normalizedConnections.hepsiburada.supplierBaseUrl,
        lookbackDays: normalizedConnections.hepsiburada.lookbackDays
      };
      const nextGibPortalForm = {
        username: normalizedConnections.gibPortal.username,
        password: "",
        portalUrl: normalizedConnections.gibPortal.portalUrl
      };
      const nextGibDirectForm = {
        environment: normalizedConnections.gibDirect.environment,
        taxId: normalizedConnections.gibDirect.taxId,
        serviceUrl: normalizedConnections.gibDirect.serviceUrl,
        wsdlUrl: normalizedConnections.gibDirect.wsdlUrl ?? "",
        soapAction: normalizedConnections.gibDirect.soapAction ?? "",
        soapBodyTemplate: "",
        soapBodyTemplatePath: "",
        signerMode: normalizedConnections.gibDirect.signerMode,
        signerCommand: "",
        soapSignerCommand: "",
        invoicePrefix: normalizedConnections.gibDirect.invoicePrefix,
        nextInvoiceSequence: normalizedConnections.gibDirect.nextInvoiceSequence,
        unitCode: normalizedConnections.gibDirect.unitCode,
        defaultBuyerTckn: normalizedConnections.gibDirect.defaultBuyerTckn,
        testAccessConfirmed: normalizedConnections.gibDirect.testAccessConfirmed,
        productionAccessConfirmed: normalizedConnections.gibDirect.productionAccessConfirmed,
        authorizationReference: normalizedConnections.gibDirect.authorizationReference ?? "",
        clientCertPath: "",
        clientKeyPath: "",
        clientPfxPath: "",
        clientCertPassword: ""
      };
      const nextMessage = normalizedConnections.gibDirect.ready
        ? "Canli entegrasyon modu acik. GIB direct fatura kesimi hazir."
        : `Canli entegrasyon modu acik. ${normalizedConnections.gibDirect.message}`;

      platformSnapshotCache = {
        snapshot: nextSnapshot,
        trendyolForm: nextTrendyolForm,
        hepsiburadaForm: nextHepsiburadaForm,
        gibPortalForm: nextGibPortalForm,
        gibDirectForm: nextGibDirectForm,
        message: nextMessage,
        storedAt: Date.now()
      };

      setSnapshot(nextSnapshot);
      setTrendyolForm(nextTrendyolForm);
      setHepsiburadaForm(nextHepsiburadaForm);
      setGibPortalForm(nextGibPortalForm);
      setGibDirectForm(nextGibDirectForm);
      setMessage(nextMessage);
      setLoadState("idle");
    } catch (error) {
      setLoadState("error");
      setMessage(errorMessage(error, "API baglantisi basarisiz."));
    }
  }, [applyCachedSnapshot]);

  const upsertJobInSnapshot = useCallback((job: IntegrationJobListItem) => {
    setSnapshot((current) => {
      const existing = current.jobs.filter((item) => item.id !== job.id);
      return { ...current, jobs: [job, ...existing].slice(0, 200) };
    });
  }, []);

  const findLatestRelatedJob = useCallback(
    async (types: string[]) => {
      if (types.length === 0) return null;
      const jobs = await api.jobs();
      const job = jobs.find((item) => types.includes(item.type)) ?? null;
      if (job) upsertJobInSnapshot(job);
      return job;
    },
    [upsertJobInSnapshot]
  );

  const runIntegrationJob = useCallback(
    async (
      label: string,
      busyKey: string,
      startJob: () => Promise<IntegrationJobListItem>,
      relatedTypes: string[] = []
    ): Promise<IntegrationJobListItem | null> => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return null;
      }

      setBusyAction(busyKey);
      let currentJob: IntegrationJobListItem | null = null;

      const driveJob = async (initialJob: IntegrationJobListItem) => {
        let job = initialJob;
        upsertJobInSnapshot(job);
        setMessage(jobUserMessage(label, job));

        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (job.status === "SUCCESS" || job.status === "FAILED") break;

          try {
            job = await api.runJobNext(job.id);
          } catch (error) {
            if (!isApiGatewayProxyError(error)) throw error;
            setMessage("Istek proxy'de kesildi; islem durumunu kontrol ediyorum. Fatura basarisiz sayilmadi.");
            await wait(1200);
            job = await api.job(job.id);
          }

          upsertJobInSnapshot(job);
          setMessage(jobUserMessage(label, job));

          if (job.status === "SUCCESS" || job.status === "FAILED") break;
          await wait(350);
        }

        if (job.status === "SUCCESS") {
          await load({ force: true });
        }
        return job;
      };

      try {
        currentJob = await startJob();
        currentJob = await driveJob(currentJob);
        return currentJob;
      } catch (error) {
        if (isApiGatewayProxyError(error)) {
          setMessage("Istek proxy'de kesildi; son islem durumunu kontrol ediyorum. Fatura basarisiz sayilmadi.");
          const recoveredJob = await findLatestRelatedJob(relatedTypes);
          if (recoveredJob) {
            currentJob = await driveJob(recoveredJob);
            return currentJob;
          }
          setMessage(
            "Istek proxy'de kesildi; son islem bulunamadi. Yenile ile canli durumu kontrol edin. Fatura basarisiz sayilmadi."
          );
        } else {
          setMessage(errorMessage(error, `${label} basarisiz.`));
        }
        return currentJob;
      } finally {
        setBusyAction(null);
      }
    },
    [findLatestRelatedJob, load, upsertJobInSnapshot]
  );

  useEffect(() => {
    void load({ preferCache: true });
  }, [load]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrder(null);
      setDetailState("idle");
      return;
    }

    if (!API_AVAILABLE) {
      setSelectedOrder(null);
      setDetailState("idle");
      setMessage(apiOfflineMessage);
      return;
    }

    let cancelled = false;
    setDetailState("loading");

    api
      .order(selectedOrderId)
      .then((detail) => {
        if (cancelled) return;
        setSelectedOrder(detail);
        setDetailState("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setSelectedOrder(null);
        setDetailState("error");
        setMessage(errorMessage(error, "Siparis detayi alinamadi."));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOrderId]);

  const refresh = useCallback(async () => {
    setBusyAction("refresh");
    await load();
    setBusyAction(null);
  }, [load]);

  const syncOrders = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setMessage("Trendyol siparisleri yenileniyor; ardindan manuel eklenen fatura izleri islenecek.");
    const job = await runIntegrationJob("Trendyol yenileme ve fatura izi", "sync", api.startTrendyolSyncJob, ["trendyol.sync"]);
    if (job?.status === "SUCCESS") {
      const imported = numberFromJobResponse(job, "externalInvoicesImported");
      const matched = numberFromJobResponse(job, "externalInvoicesMatched");
      const upserted = numberFromJobResponse(job, "ordersUpserted");
      setMessage(
        imported > 0
          ? `${upserted} siparis guncellendi. ${imported} Trendyol fatura izi yakalandi, ${matched} tanesi siparisle eslesti.`
          : `${upserted} siparis guncellendi. Trendyol siparis verisinde fatura izi henuz yok.`
      );
    }
  }, [runIntegrationJob]);

  const approveDrafts = useCallback(
    async (draftIds: string[]) => {
      if (draftIds.length === 0) return "Secili taslak yok.";

      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return apiOfflineMessage;
      }

      setBusyAction("approve");

      try {
        for (const id of draftIds) {
          await api.approve(id);
        }
        const nextMessage = `${draftIds.length} taslak onaylandi.`;
        const resultMessage = `${nextMessage} Sonraki adim: GIB taslagina yukle; imza ve Trendyol aktarimi portal takip ekranindan izlenecek.`;
        setMessage(resultMessage);
        await load();
        return resultMessage;
      } catch (error) {
        const nextMessage = errorMessage(error, "Taslak onaylama islemi basarisiz.");
        setMessage(nextMessage);
        return nextMessage;
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const issueDrafts = useCallback(
    async (draftIds: string[]) => {
      if (draftIds.length === 0) return "Secili taslak yok.";

      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return apiOfflineMessage;
      }

      setBusyAction("issue");

      try {
        const result = await api.issue(draftIds);
        const autoApprovedText = result.autoApproved > 0 ? ` ${result.autoApproved} hazir taslak otomatik onaylandi.` : "";
        const firstFailure = result.failures[0]?.error ? ` Ilk hata: ${result.failures[0].error}` : "";
        const failedText =
          result.failed > 0
            ? ` ${result.failed} taslak basarisiz; fatura kesimi baslamadi veya tamamlanmadi.${firstFailure} Karttaki kirmizi uyariyi kontrol edin.`
            : "";
        const processed = result.processed ?? 0;
        const issueText =
          processed > 0
            ? `${processed} fatura isi islendi.`
            : result.enqueued > 0
              ? `${result.enqueued} fatura isi kuyruga alindi.`
              : "Fatura isi tamamlanamadi.";
        const nextMessage = `${issueText}${autoApprovedText}${failedText} Sureci kartlardaki cubuktan izleyebilirsiniz.`;
        setMessage(nextMessage);
        await load();
        window.setTimeout(() => void load(), 1500);
        window.setTimeout(() => void load(), 4500);
        window.setTimeout(() => void load(), 9000);
        return nextMessage;
      } catch (error) {
        const nextMessage = errorMessage(error, "Fatura kesme isi kuyruga alinamadi.");
        setMessage(nextMessage);
        return nextMessage;
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const uploadPortalDrafts = useCallback(
    async (draftIds: string[]) => {
      if (draftIds.length === 0) return "Secili taslak yok.";

      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return apiOfflineMessage;
      }

      setBusyAction("portal-draft-upload");

      try {
        const result = await api.uploadPortalDrafts(draftIds);
        const firstFailure = result.failures[0]?.error ? ` Ilk hata: ${result.failures[0].error}` : "";
        const uploadedSummary = portalUploadedSummary(result.uploadedDrafts);
        const nextMessage =
          result.failed > 0
            ? result.uploaded > 0
              ? `${result.uploaded} taslak GIB e-Arsiv portalina yuklendi, ${result.failed} taslak yuklenemedi.${uploadedSummary}${firstFailure} Yuklenenler portalda imza bekler; basarisiz kartlari tekrar deneyin.`
              : `GIB taslagi yuklenemedi. ${result.failed} taslak basarisiz.${firstFailure} Bu fatura henuz portalda imza beklemiyor; karttaki sebebi kontrol edip tekrar deneyin.`
            : `${result.uploaded} taslak GIB e-Arsiv portalina yuklendi.${uploadedSummary} Simdi GIB portalinda Duzenlenen Belgeler ekranindan toplu imza atin.`;
        setMessage(nextMessage);
        await load();
        return nextMessage;
      } catch (error) {
        const nextMessage = errorMessage(error, "GIB portal taslak yukleme basarisiz.");
        setMessage(nextMessage);
        return nextMessage;
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const saveTrendyol = useCallback(async () => {
    if (!API_AVAILABLE) {
      writeStoredJson(trendyolDraftStorageKey, trendyolForm);
      setSnapshot((current) => ({
        ...current,
        settings: { ...current.settings, localConnectionDrafts: true },
        connections: localDraftConnections(trendyolForm, hepsiburadaForm, gibPortalForm, gibDirectForm)
      }));
      setMessage("Trendyol API bilgileri bu tarayicida taslak olarak kaydedildi. Canli kullanim icin backend baglantisi gerekir.");
      return;
    }

    setBusyAction("save-trendyol");

    try {
      const result = await api.connectTrendyol(trendyolForm);
      setSnapshot((current) => ({ ...current, connections: normalizeConnectionsSnapshot(result.connections) }));
      setMessage(`${result.health.message} Bilgiler sifreli olarak kaydedildi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Trendyol baglantisi kaydedilemedi."));
    } finally {
      setBusyAction(null);
    }
  }, [gibDirectForm, gibPortalForm, hepsiburadaForm, load, trendyolForm]);

  const saveHepsiburada = useCallback(async () => {
    if (!API_AVAILABLE) {
      writeStoredJson(hepsiburadaDraftStorageKey, hepsiburadaForm);
      setSnapshot((current) => ({
        ...current,
        settings: { ...current.settings, localConnectionDrafts: true },
        connections: localDraftConnections(trendyolForm, hepsiburadaForm, gibPortalForm, gibDirectForm)
      }));
      setMessage("Hepsiburada API bilgileri bu tarayicida taslak olarak kaydedildi. Canli kullanim icin backend baglantisi gerekir.");
      return;
    }

    setBusyAction("save-hepsiburada");

    try {
      const result = await api.connectHepsiburada(hepsiburadaForm);
      setSnapshot((current) => ({ ...current, connections: normalizeConnectionsSnapshot(result.connections) }));
      setMessage(`${result.health.message} Hepsiburada bilgileri sifreli olarak kaydedildi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada baglantisi kaydedilemedi."));
    } finally {
      setBusyAction(null);
    }
  }, [gibDirectForm, gibPortalForm, hepsiburadaForm, load, trendyolForm]);

  const saveGibPortal = useCallback(async () => {
    if (!API_AVAILABLE) {
      writeStoredJson(gibPortalDraftStorageKey, gibPortalForm);
      setSnapshot((current) => ({
        ...current,
        settings: { ...current.settings, localConnectionDrafts: true },
        connections: localDraftConnections(trendyolForm, hepsiburadaForm, gibPortalForm, gibDirectForm)
      }));
      setMessage("e-Arsiv portal bilgileri bu tarayicida taslak olarak kaydedildi. Canli kullanim icin backend baglantisi gerekir.");
      return;
    }

    setBusyAction("save-gib");

    try {
      const result = await api.connectGibPortal(gibPortalForm);
      setSnapshot((current) => ({ ...current, connections: normalizeConnectionsSnapshot(result.connections) }));
      setMessage(`${result.health.message} Bilgiler sifreli olarak kaydedildi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "e-Arsiv portal bilgileri kaydedilemedi."));
    } finally {
      setBusyAction(null);
    }
  }, [gibDirectForm, gibPortalForm, hepsiburadaForm, load, trendyolForm]);

  const saveGibDirect = useCallback(async () => {
    if (!API_AVAILABLE) {
      writeStoredJson(gibDirectDraftStorageKey, gibDirectForm);
      setSnapshot((current) => ({
        ...current,
        settings: { ...current.settings, localConnectionDrafts: true },
        connections: localDraftConnections(trendyolForm, hepsiburadaForm, gibPortalForm, gibDirectForm)
      }));
      setMessage("GIB direct bilgileri bu tarayicida taslak olarak kaydedildi. Canli kullanim icin backend baglantisi gerekir.");
      return;
    }

    setBusyAction("save-gib-direct");

    try {
      const result = await api.connectGibDirect(gibDirectForm);
      setSnapshot((current) => ({ ...current, connections: normalizeConnectionsSnapshot(result.connections) }));
      setMessage(`${result.health.message} GIB direct bilgileri sifreli olarak kaydedildi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "GIB direct baglantisi kaydedilemedi."));
    } finally {
      setBusyAction(null);
    }
  }, [gibDirectForm, gibPortalForm, hepsiburadaForm, load, trendyolForm]);

  const openGibPortal = useCallback(async () => {
    const portalTab = window.open("about:blank", "_blank");
    if (!portalTab) {
      setMessage("Popup engellendi. Tarayicida bu site icin popup izni verin.");
      return;
    }

    portalTab.document.write('<p style="font-family:Arial;padding:24px">e-Arsiv oturumu aciliyor...</p>');

    if (!snapshot.connections?.gibPortal.configured) {
      portalTab.location.href = gibPortalForm.portalUrl;
      setMessage(
        API_AVAILABLE
          ? "e-Arsiv portal bilgisi kayitli degil; portal manuel giris icin acildi."
          : "Canli API bagli degil; e-Arsiv portali manuel giris icin acildi."
      );
      return;
    }

    if (!API_AVAILABLE) {
      portalTab.location.href = gibPortalForm.portalUrl;
      setMessage("Canli API bagli degil; e-Arsiv portali manuel giris icin acildi.");
      return;
    }

    setBusyAction("open-gib");

    try {
      if (!canUseServerIssuedPortalLaunchUrl()) {
        portalTab.document.body.innerHTML =
          '<p style="font-family:Arial;padding:24px">e-Arsiv proxy oturumu aciliyor...</p>';
        const proxySession = await api.openEarsivPortalProxySession();
        portalTab.location.href = proxySession.proxyUrl;
        setMessage(proxySession.message);
        return;
      }

      const session = await api.openEarsivPortalSession();
      portalTab.location.href = session.launchUrl;
      setMessage(session.source === "cached" ? "Aktif e-Arsiv oturumu yeni sekmede acildi." : session.message);
    } catch (error) {
      portalTab.location.href = gibPortalForm.portalUrl;
      const details = errorMessage(error, "e-Arsiv oturumu acilamadi; portal manuel giris icin acildi.");
      setMessage(`${details} GIB portali acilirsa Guvenli Cikis yapip SAFA'dan tekrar deneyin.`);
    } finally {
      setBusyAction(null);
    }
  }, [gibPortalForm.portalUrl, snapshot.connections?.gibPortal.configured]);

  const logoutGibPortalSession = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage("Canli API bagli degil; e-Arsiv oturumu SAFA uzerinden kapatilamaz.");
      return;
    }

    if (!snapshot.connections?.gibPortal.configured) {
      setMessage("e-Arsiv portal bilgisi kayitli degil; SAFA'nin kapatabilecegi aktif oturum yok.");
      return;
    }

    setBusyAction("logout-gib");

    try {
      const result = await api.logoutEarsivPortalSession();
      const detail = result.portalMessage ? ` Portal mesaji: ${result.portalMessage}` : "";
      setMessage(`${result.message}${detail}`);
    } catch (error) {
      setMessage(errorMessage(error, "e-Arsiv guvenli cikis islemi basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [snapshot.connections?.gibPortal.configured]);

  const openTrendyolPartner = useCallback(() => {
    window.open("https://partner.trendyol.com/", "trendyol-partner", "popup=yes,width=1280,height=860");
  }, []);

  const importExternalInvoices = useCallback(
    async (source: ExternalInvoiceSource, invoices: Array<Record<string, unknown>>) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction("external-import");

      try {
        const result = await api.importExternalInvoices(source, invoices);
        setMessage(externalSyncSummary("Harici fatura aktarimi", result));
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Harici fatura listesi alinamadi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const previewGibExternalInvoices = useCallback(
    async (input: number | GibPortalSyncRequest): Promise<ExternalInvoiceSyncResult | null> => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return externalSyncErrorResult(apiOfflineMessage);
      }

      setBusyAction("external-gib-preview");

      try {
        const result = await api.previewGibExternalInvoices(gibPortalSyncRequest(input));
        setMessage(externalSyncSummary("e-Arsiv imza kontrolu", result));
        return result;
      } catch (error) {
        const message = errorMessage(error, "e-Arsiv imza kontrolu basarisiz.");
        setMessage(message);
        return externalSyncErrorResult(message);
      } finally {
        setBusyAction(null);
      }
    },
    []
  );

  const applyGibExternalInvoices = useCallback(
    async (input: number | GibPortalSyncRequest): Promise<ExternalInvoiceSyncResult | null> => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return externalSyncErrorResult(apiOfflineMessage);
      }

      const job = await runIntegrationJob(
        "e-Arsiv guvenli uygulama",
        "external-gib-apply",
        () => api.startGibApplyJob(gibPortalSyncRequest(input)),
        ["gib-portal.apply"]
      );
      if (!job) return externalSyncErrorResult(apiOfflineMessage);
      if (job.status === "FAILED") return externalSyncErrorResult(job.lastError ?? "e-Arsiv guvenli uygulama basarisiz.");
      const result = externalSyncResultFromJob(job);
      setMessage(externalSyncSummary("e-Arsiv guvenli uygulama", result));
      return result;
    },
    [runIntegrationJob]
  );

  const syncGibExternalInvoices = useCallback(
    async (days: number) => {
      await applyGibExternalInvoices(days);
    },
    [applyGibExternalInvoices]
  );

  const syncTrendyolExternalInvoices = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setMessage("Trendyol siparisleri yenileniyor; manuel eklenen fatura izleri sonra islenecek.");
    const job = await runIntegrationJob("Trendyol fatura izi", "external-trendyol-sync", api.startTrendyolExternalInvoiceJob, [
      "trendyol.sync"
    ]);
    if (job?.status === "SUCCESS") {
      const imported = numberFromJobResponse(job, "externalInvoicesImported");
      const matched = numberFromJobResponse(job, "externalInvoicesMatched");
      setMessage(
        imported > 0
          ? `Trendyol fatura izi: ${imported} kayit yakalandi, ${matched} tanesi siparisle eslesti.`
          : "Trendyol siparisleri yenilendi; Trendyol siparis verisinde fatura izi henuz yok."
      );
    }
  }, [runIntegrationJob]);

  const reconcileExternalInvoices = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("external-reconcile");

      try {
        const result = await api.reconcileExternalInvoices();
      setMessage(`${result.matched} harici fatura siparisle eslesti, ${result.unmatched} kayit acik kaldi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Harici fatura eslestirme basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const matchExternalInvoice = useCallback(
    async (id: string, target: string) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      const trimmed = target.trim();
      if (!trimmed) {
        setMessage("Eslestirme icin siparis no veya paket no yazin.");
        return;
      }

      setBusyAction(`external-match-${id}`);

      try {
        await api.matchExternalInvoice(id, {
          orderNumber: trimmed,
          shipmentPackageId: trimmed
        });
        setMessage("Harici fatura secilen siparisle eslestirildi.");
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Harici fatura manuel eslestirilemedi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const promoteExternalInvoice = useCallback(
    async (id: string, sendToTrendyol: boolean) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction(`external-promote-${id}`);

      try {
        const result = sendToTrendyol ? await api.promoteAndSendExternalInvoice(id) : await api.promoteExternalInvoice(id);
        setMessage(externalSyncSummary(sendToTrendyol ? "e-Arsiv fatura arsivi ve Trendyol" : "e-Arsiv fatura arsivi", result));
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "e-Arsiv faturasi arsive alinamadi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const uploadExternalInvoicePdf = useCallback(
    async (id: string, file: File) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction(`external-pdf-${id}`);

      try {
        const result = await api.uploadExternalInvoicePdf(id, file);
        setMessage(externalSyncSummary("Resmi PDF yuklendi", result));
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Resmi e-Arsiv PDF yuklenemedi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const sendInvoiceToTrendyol = useCallback(
    async (id: string) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction(`invoice-send-${id}`);

      try {
        const invoice = await api.sendInvoiceToTrendyol(id);
        setMessage(invoice.trendyolStatus === "ALREADY_SENT" ? "Fatura Trendyol'da zaten kayitli." : "Fatura PDF'i Trendyol'a gonderildi.");
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Fatura Trendyol'a gonderilemedi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const createMonthlyInvoiceArchive = useCallback(async (year: number, month: number): Promise<MonthlyInvoiceArchiveResult | null> => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return null;
    }

    setBusyAction("monthly-archive");

    try {
      const result = await api.createMonthlyInvoiceArchive({ year, month });
      setMessage(
        `Aylik arsiv hazirlandi: ${result.invoiceCount} fatura, ${result.missingPdfCount} PDF eksik, ${result.missingXmlCount} resmi XML eksik.`
      );
      return result;
    } catch (error) {
      setMessage(errorMessage(error, "Aylik fatura arsivi olusturulamadi."));
      return null;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const saveHepsiburadaProduct = useCallback(
    async (input: HepsiburadaProductInput, productId?: string) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction("hepsiburada-product");

      try {
        const product = productId ? await api.updateProduct(productId, input) : await api.createProduct(input);
        setMessage(`${product.merchantSku} Hepsiburada urun kaydi ${productId ? "guncellendi" : "olusturuldu"}.`);
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Hepsiburada urun kaydi tamamlanamadi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const uploadHepsiburadaCatalog = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("hepsiburada-catalog");

    try {
      const result = await api.hepsiburadaCatalogUpload();
      setMessage(`${result.productCount} urun Hepsiburada katalog test/canli servisine gonderildi. TrackingId: ${result.trackingId}`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada katalog gonderimi basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const checkHepsiburadaCatalogStatus = useCallback(async (trackingId: string) => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    const trimmed = trackingId.trim();
    if (!trimmed) {
      setMessage("Katalog status sorgusu icin trackingId yazin.");
      return;
    }

    setBusyAction("hepsiburada-catalog-status");

    try {
      await api.hepsiburadaCatalogStatus(trimmed);
      setMessage(`${trimmed} trackingId durumu sorgulandi; detay backend log/audit kaydinda.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada katalog durumu sorgulanamadi."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const syncHepsiburadaInventory = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("hepsiburada-inventory");

    try {
      const result = await api.hepsiburadaListingSync();
      setMessage(`${result.imported} Hepsiburada envanter kaydi okundu, ${result.upserted} listing guncellendi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada envanter senkronizasyonu basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const uploadHepsiburadaPrices = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("hepsiburada-price");

    try {
      const result = await api.hepsiburadaPriceUpload();
      setMessage(`${result.listingCount} Hepsiburada fiyati gonderildi.${result.uploadId ? ` UploadId: ${result.uploadId}` : ""}`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada fiyat gonderimi basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const uploadHepsiburadaStocks = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("hepsiburada-stock");

    try {
      const result = await api.hepsiburadaStockUpload();
      setMessage(`${result.listingCount} Hepsiburada stogu gonderildi.${result.uploadId ? ` UploadId: ${result.uploadId}` : ""}`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada stok gonderimi basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const syncHepsiburadaOrders = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("hepsiburada-orders");

    try {
      const result = await api.hepsiburadaOrdersSync();
      setMessage(`${result.imported} Hepsiburada paketlenecek siparis kalemi senkronize edildi.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada siparis senkronizasyonu basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const createHepsiburadaTestOrder = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("hepsiburada-test-order");

    try {
      const result = await api.hepsiburadaCreateTestOrder();
      setMessage(`${result.orderNumber} Hepsiburada test siparisi olusturuldu.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Hepsiburada test siparisi olusturulamadi."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const packageHepsiburadaOrderLine = useCallback(
    async (id: string) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction(`hepsiburada-package-${id}`);

      try {
        const result = await api.hepsiburadaPackageOrderLine(id);
        setMessage(`${result.orderNumber} siparis kalemi paketlendi. Paket: ${result.packageNumber ?? "olustu"}`);
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Hepsiburada paketleme basarisiz."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  return {
    snapshot,
    apiAvailable: API_AVAILABLE,
    loadState,
    detailState,
    busyAction,
    message,
    selectedOrderId,
    selectedOrder,
    trendyolForm,
    hepsiburadaForm,
    gibPortalForm,
    gibDirectForm,
    setMessage,
    setSelectedOrderId,
    setTrendyolForm,
    setHepsiburadaForm,
    setGibPortalForm,
    setGibDirectForm,
    refresh,
    syncOrders,
    approveDrafts,
    issueDrafts,
    uploadPortalDrafts,
    saveTrendyol,
    saveHepsiburada,
    saveGibPortal,
    saveGibDirect,
    openGibPortal,
    logoutGibPortalSession,
    openTrendyolPartner,
    importExternalInvoices,
    previewGibExternalInvoices,
    applyGibExternalInvoices,
    syncGibExternalInvoices,
    syncTrendyolExternalInvoices,
    reconcileExternalInvoices,
    matchExternalInvoice,
    promoteExternalInvoice,
    uploadExternalInvoicePdf,
    sendInvoiceToTrendyol,
    createMonthlyInvoiceArchive,
    saveHepsiburadaProduct,
    uploadHepsiburadaCatalog,
    checkHepsiburadaCatalogStatus,
    syncHepsiburadaInventory,
    uploadHepsiburadaPrices,
    uploadHepsiburadaStocks,
    syncHepsiburadaOrders,
    createHepsiburadaTestOrder,
    packageHepsiburadaOrderLine
  };
}
