"use client";

import type {
  ExternalInvoiceListItem,
  ExternalInvoiceSource,
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  OrderDetail,
  OrderListItem
} from "@safa/shared";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  API_AVAILABLE,
  ConnectionsSnapshot,
  GibDirectConnectionInput,
  GibPortalConnectionInput,
  TrendyolConnectionInput
} from "../../lib/api";
import type { LoadState } from "../../lib/platform/types";

export interface PlatformSnapshot {
  orders: OrderListItem[];
  drafts: InvoiceDraftListItem[];
  invoices: InvoiceListItem[];
  externalInvoices: ExternalInvoiceListItem[];
  jobs: IntegrationJobListItem[];
  settings: Record<string, unknown>;
  connections: ConnectionsSnapshot | null;
}

const emptySnapshot: PlatformSnapshot = {
  orders: [],
  drafts: [],
  invoices: [],
  externalInvoices: [],
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
const gibPortalDraftStorageKey = "safa.gibPortalConnectionDraft.v1";
const gibDirectDraftStorageKey = "safa.gibDirectConnectionDraft.v1";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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
  const [gibPortalForm, setGibPortalForm] = useState<GibPortalConnectionInput>(initialGibPortalForm);
  const [gibDirectForm, setGibDirectForm] = useState<GibDirectConnectionInput>(initialGibDirectForm);

  const load = useCallback(async () => {
    if (!API_AVAILABLE) {
      const storedTrendyol = readStoredJson(trendyolDraftStorageKey, initialTrendyolForm);
      const storedGibPortal = readStoredJson(gibPortalDraftStorageKey, initialGibPortalForm);
      const storedGibDirect = readStoredJson(gibDirectDraftStorageKey, initialGibDirectForm);

      setTrendyolForm(storedTrendyol);
      setGibPortalForm(storedGibPortal);
      setGibDirectForm(storedGibDirect);
      setSnapshot({
        ...emptySnapshot,
        settings: { localConnectionDrafts: true },
        connections: localDraftConnections(storedTrendyol, storedGibPortal, storedGibDirect)
      });
      setLoadState("idle");
      setMessage(apiOfflineMessage);
      return;
    }

    setLoadState("loading");

    try {
      const [orders, drafts, invoices, externalInvoices, jobs, settings, connections] = await Promise.all([
        api.orders(),
        api.drafts(),
        api.invoices(),
        api.externalInvoices(),
        api.jobs(),
        api.settings(),
        api.connections()
      ]);

      const normalizedConnections = normalizeConnectionsSnapshot(connections);

      setSnapshot({
        orders,
        drafts,
        invoices,
        externalInvoices,
        jobs,
        settings: settings.runtime ?? {},
        connections: normalizedConnections
      });
      setTrendyolForm({
        sellerId: normalizedConnections.trendyol.sellerId,
        apiKey: "",
        apiSecret: "",
        userAgent: normalizedConnections.trendyol.userAgent,
        baseUrl: normalizedConnections.trendyol.baseUrl,
        storefrontCode: normalizedConnections.trendyol.storefrontCode,
        lookbackDays: normalizedConnections.trendyol.lookbackDays
      });
      setGibPortalForm({
        username: normalizedConnections.gibPortal.username,
        password: "",
        portalUrl: normalizedConnections.gibPortal.portalUrl
      });
      setGibDirectForm({
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
      });
      setMessage(
        normalizedConnections.gibDirect.ready
          ? "Canli entegrasyon modu acik. GIB direct fatura kesimi hazir."
          : `Canli entegrasyon modu acik. ${normalizedConnections.gibDirect.message}`
      );
      setLoadState("idle");
    } catch (error) {
      setLoadState("error");
      setMessage(errorMessage(error, "API baglantisi basarisiz."));
    }
  }, []);

  useEffect(() => {
    void load();
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

    setBusyAction("sync");
    setMessage("Trendyol senkronizasyonu baslatildi.");

    try {
      const result = await api.sync();
      setMessage(`${result.upserted} siparis guncellendi, ${result.draftsCreated} yeni taslak olustu.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Trendyol senkronizasyonu basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const approveDrafts = useCallback(
    async (draftIds: string[]) => {
      if (draftIds.length === 0) return;

      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction("approve");

      try {
        for (const id of draftIds) {
          await api.approve(id);
        }
        setMessage(`${draftIds.length} taslak onaylandi.`);
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Taslak onaylama islemi basarisiz."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const issueDrafts = useCallback(
    async (draftIds: string[]) => {
      if (draftIds.length === 0) return;

      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction("issue");

      try {
        const result = await api.issue(draftIds);
        setMessage(`${result.enqueued} fatura isi kuyruga alindi. Kisa sure sonra liste yenilenecek.`);
        window.setTimeout(() => void load(), 1400);
      } catch (error) {
        setMessage(errorMessage(error, "Fatura kesme isi kuyruga alinamadi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const uploadPortalDrafts = useCallback(
    async (draftIds: string[]) => {
      if (draftIds.length === 0) return;

      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction("portal-draft-upload");

      try {
        const result = await api.uploadPortalDrafts(draftIds);
        const failureText = result.failed > 0 ? ` ${result.failed} taslak yuklenemedi; listede tekrar denenebilir.` : "";
        setMessage(`${result.uploaded} taslak GIB e-Arsiv portalina yuklendi. Imza portaldan toplu atilacak.${failureText}`);
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "GIB portal taslak yukleme basarisiz."));
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
        connections: localDraftConnections(trendyolForm, gibPortalForm, gibDirectForm)
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
  }, [gibDirectForm, gibPortalForm, load, trendyolForm]);

  const saveGibPortal = useCallback(async () => {
    if (!API_AVAILABLE) {
      writeStoredJson(gibPortalDraftStorageKey, gibPortalForm);
      setSnapshot((current) => ({
        ...current,
        settings: { ...current.settings, localConnectionDrafts: true },
        connections: localDraftConnections(trendyolForm, gibPortalForm, gibDirectForm)
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
  }, [gibDirectForm, gibPortalForm, load, trendyolForm]);

  const saveGibDirect = useCallback(async () => {
    if (!API_AVAILABLE) {
      writeStoredJson(gibDirectDraftStorageKey, gibDirectForm);
      setSnapshot((current) => ({
        ...current,
        settings: { ...current.settings, localConnectionDrafts: true },
        connections: localDraftConnections(trendyolForm, gibPortalForm, gibDirectForm)
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
  }, [gibDirectForm, gibPortalForm, load, trendyolForm]);

  const openGibPortal = useCallback(async () => {
    const popup = window.open("about:blank", "gib-earsiv-portal", "popup=yes,width=1280,height=860");
    if (!popup) {
      setMessage("Popup engellendi. Tarayicida bu site icin popup izni verin.");
      return;
    }

    popup.document.write('<p style="font-family:Arial;padding:24px">e-Arsiv oturumu aciliyor...</p>');

    if (!snapshot.connections?.gibPortal.configured) {
      popup.location.href = gibPortalForm.portalUrl;
      setMessage(
        API_AVAILABLE
          ? "e-Arsiv portal bilgisi kayitli degil; portal manuel giris icin acildi."
          : "Canli API bagli degil; e-Arsiv portali manuel giris icin acildi."
      );
      return;
    }

    if (!API_AVAILABLE) {
      popup.location.href = gibPortalForm.portalUrl;
      setMessage("Canli API bagli degil; e-Arsiv portali manuel giris icin acildi.");
      return;
    }

    setBusyAction("open-gib");

    try {
      const session = await api.openEarsivPortalSession();
      popup.location.href = session.launchUrl;
      setMessage(session.tokenReceived ? "e-Arsiv portali tokenli oturumla acildi." : "e-Arsiv portali acildi.");
    } catch (error) {
      popup.location.href = gibPortalForm.portalUrl;
      setMessage(errorMessage(error, "e-Arsiv oturumu acilamadi; portal manuel giris icin acildi."));
    } finally {
      setBusyAction(null);
    }
  }, [gibPortalForm.portalUrl, snapshot.connections?.gibPortal.configured]);

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
        setMessage(`${result.imported} harici fatura alindi, ${result.matched} kayit siparisle eslesti.`);
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "Harici fatura listesi alinamadi."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const syncGibExternalInvoices = useCallback(
    async (days: number) => {
      if (!API_AVAILABLE) {
        setMessage(apiOfflineMessage);
        return;
      }

      setBusyAction("external-gib-sync");

      try {
        const result = await api.syncGibExternalInvoices({ days });
        setMessage(`${result.imported} e-Arsiv faturasi sorgulandi, ${result.matched} kayit siparisle eslesti.`);
        await load();
      } catch (error) {
        setMessage(errorMessage(error, "e-Arsiv harici fatura sorgusu basarisiz."));
      } finally {
        setBusyAction(null);
      }
    },
    [load]
  );

  const syncTrendyolExternalInvoices = useCallback(async () => {
    if (!API_AVAILABLE) {
      setMessage(apiOfflineMessage);
      return;
    }

    setBusyAction("external-trendyol-sync");

    try {
      const result = await api.syncTrendyolExternalInvoices();
      setMessage(result.message ?? `${result.imported} Trendyol fatura kaydi okundu, ${result.matched} kayit siparisle eslesti.`);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, "Trendyol harici fatura sorgusu basarisiz."));
    } finally {
      setBusyAction(null);
    }
  }, [load]);

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
    gibPortalForm,
    gibDirectForm,
    setMessage,
    setSelectedOrderId,
    setTrendyolForm,
    setGibPortalForm,
    setGibDirectForm,
    refresh,
    syncOrders,
    approveDrafts,
    issueDrafts,
    uploadPortalDrafts,
    saveTrendyol,
    saveGibPortal,
    saveGibDirect,
    openGibPortal,
    openTrendyolPartner,
    importExternalInvoices,
    syncGibExternalInvoices,
    syncTrendyolExternalInvoices,
    reconcileExternalInvoices,
    matchExternalInvoice
  };
}
