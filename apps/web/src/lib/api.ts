import type {
  ExternalInvoiceListItem,
  ExternalInvoiceSource,
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  OrderDetail,
  OrderListItem,
  PortalDraftUploadResult
} from "@safa/shared";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const isStaticFrontend = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
const API_BASE = configuredApiBase || (isStaticFrontend ? "" : "/api");
const API_AVAILABLE = Boolean(API_BASE);
const SENSITIVE_FIELD_PATTERN = /(password|secret|token|apikey|api_key|authorization|signercommand|clientcert|clientkey|clientpfx)/i;

export { API_AVAILABLE, API_BASE };

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: "loopback" | "local" | "public" | "private";
};

type LoopbackOrLocalAddressSpace = "loopback" | "local" | null;

export interface ConnectionsSnapshot {
  trendyol: {
    configured: boolean;
    source: string;
    sellerId: string;
    apiKeyMasked?: string;
    apiSecretSaved: boolean;
    userAgent: string;
    baseUrl: string;
    storefrontCode: string;
    lookbackDays: number;
  };
  gibPortal: {
    configured: boolean;
    source: string;
    username: string;
    passwordSaved: boolean;
    portalUrl: string;
  };
  gibDirect: {
    configured: boolean;
    ready: boolean;
    source: string;
    environment: "test" | "prod";
    signerMode: "external-command";
    taxId: string;
    serviceUrl: string;
    wsdlUrl?: string;
    soapAction?: string;
    soapBodyTemplateSaved: boolean;
    signerCommandSaved: boolean;
    soapSignerCommandSaved: boolean;
    invoicePrefix: string;
    nextInvoiceSequence: number;
    unitCode: string;
    defaultBuyerTckn: string;
    testAccessConfirmed: boolean;
    productionAccessConfirmed: boolean;
    authorizationReference?: string;
    clientCertificateConfigured: boolean;
    missing: string[];
    message: string;
  };
}

export interface TrendyolConnectionInput {
  sellerId: string;
  apiKey?: string;
  apiSecret?: string;
  userAgent: string;
  baseUrl: string;
  storefrontCode: string;
  lookbackDays: number;
}

export interface GibPortalConnectionInput {
  username: string;
  password?: string;
  portalUrl: string;
}

export interface GibDirectConnectionInput {
  environment: "test" | "prod";
  taxId: string;
  serviceUrl: string;
  wsdlUrl?: string;
  soapAction?: string;
  soapBodyTemplate?: string;
  soapBodyTemplatePath?: string;
  signerMode: "external-command";
  signerCommand: string;
  soapSignerCommand: string;
  invoicePrefix: string;
  nextInvoiceSequence: number;
  unitCode: string;
  defaultBuyerTckn: string;
  testAccessConfirmed: boolean;
  productionAccessConfirmed: boolean;
  authorizationReference?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  clientPfxPath?: string;
  clientCertPassword?: string;
}

export interface ConnectionHealth {
  provider: "trendyol" | "gib-portal" | "gib-direct";
  connected: true;
  checkedAt: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ConnectionResult {
  connections: ConnectionsSnapshot;
  health: ConnectionHealth;
}

export interface ExternalInvoiceSyncResult {
  imported: number;
  matched: number;
  unmatched: number;
  message?: string;
  invoices: ExternalInvoiceListItem[];
}

function getRequestMethod(init?: RequestInit) {
  return (init?.method ?? "GET").toUpperCase();
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? "[redacted]" : redactSensitiveValues(item)
    ])
  );
}

function parseLoggableBody(body?: BodyInit | null) {
  if (typeof body !== "string") {
    return body ? "[non-string body]" : undefined;
  }

  try {
    return redactSensitiveValues(JSON.parse(body));
  } catch {
    return body;
  }
}

function parseResponseBody(text: string, contentType: string) {
  if (!text) return null;

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

function logApiRequest(method: string, path: string, url: string, init?: RequestInit) {
  console.info(`[SAFA API] -> ${method} ${path}`, {
    method,
    path,
    url,
    body: parseLoggableBody(init?.body),
    requestedAt: new Date().toISOString()
  });
}

function logApiResponse(
  method: string,
  path: string,
  response: Response,
  durationMs: number,
  responseBody: unknown
) {
  const level = response.ok ? "info" : "error";
  console[level](`[SAFA API] <- ${response.status} ${method} ${path} (${durationMs}ms)`, {
    method,
    path,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    durationMs,
    response: redactSensitiveValues(responseBody),
    respondedAt: new Date().toISOString()
  });
}

function logApiFailure(method: string, path: string, url: string, durationMs: number, error: unknown) {
  console.error(`[SAFA API] !! ${method} ${path} failed before response (${durationMs}ms)`, {
    method,
    path,
    url,
    durationMs,
    error: error instanceof Error ? error.message : error,
    failedAt: new Date().toISOString()
  });
}

function classifyApiTarget(url: string): LoopbackOrLocalAddressSpace {
  if (typeof window === "undefined") return null;

  try {
    const host = new URL(url, window.location.href).hostname.toLowerCase();

    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return "loopback";
    }

    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return "local";
    }

    return null;
  } catch {
    return null;
  }
}

function isLocalApiTarget(url: string) {
  return classifyApiTarget(url) !== null;
}

function localNetworkFetchOptions(url: string): Partial<LocalNetworkRequestInit> {
  if (typeof window === "undefined" || window.location.protocol !== "https:") {
    return {};
  }

  const targetAddressSpace = classifyApiTarget(url);
  return targetAddressSpace ? { targetAddressSpace } : {};
}

function apiConnectionFailureMessage(url: string, error: unknown) {
  if (isLocalApiTarget(url) && typeof window !== "undefined" && window.location.protocol === "https:") {
    const target = new URL(url, window.location.href);
    return new Error(
      `Tarayici, yerel API (${target.host}) icin "Yerel Ag erisimi" iznini henuz vermedi. ` +
        "Yapmaniz gerekenler: 1) Bu sayfayi yenileyin; Chrome bir izin penceresi gosterecek, \"Izin ver\"i secin. " +
        "2) Izin penceresi gelmiyorsa chrome://settings/content/localNetworkAccess adresinden https://safa-8f76e.web.app icin izni acin. " +
        "3) Calismazsa uygulamayi http://localhost:3000 uzerinden acin; ayni kaynaktan istek atildiginda Chrome'un bu kontrolune takilmaz."
    );
  }

  return error instanceof Error ? error : new Error("Canli API'ye baglanilamadi.");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_AVAILABLE) {
    throw new Error("Canli API bagli degil. Backend deploy edilince bu aksiyon aktif olacak.");
  }

  const method = getRequestMethod(init);
  const url = `${API_BASE}${path}`;
  const startedAt = performance.now();

  logApiRequest(method, path, url, init);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      ...localNetworkFetchOptions(url),
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
  } catch (error) {
    logApiFailure(method, path, url, Math.round(performance.now() - startedAt), error);
    throw apiConnectionFailureMessage(url, error);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const parsedBody = parseResponseBody(body, contentType);
  const durationMs = Math.round(performance.now() - startedAt);

  logApiResponse(method, path, response, durationMs, parsedBody);

  if (!response.ok) {
    if (contentType.includes("text/html")) {
      throw new Error(`${response.status} ${response.statusText}. Canli API yanit vermiyor veya yanlis adrese bagli.`);
    }

    if (contentType.includes("application/json")) {
      try {
        const parsed =
          parsedBody && typeof parsedBody === "object" ? (parsedBody as { message?: unknown; error?: unknown }) : {};
        const message = Array.isArray(parsed.message) ? parsed.message.join(" ") : parsed.message;
        if (typeof message === "string" && message.trim()) {
          throw new Error(message);
        }
        if (typeof parsed.error === "string" && parsed.error.trim()) {
          throw new Error(parsed.error);
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          // Fall through to the raw body below.
        } else {
          throw error;
        }
      }
    }

    throw new Error(body || `${response.status} ${response.statusText}`);
  }

  return parsedBody as T;
}

export const api = {
  orders: () => request<OrderListItem[]>("/orders"),
  order: (id: string) => request<OrderDetail>(`/orders/${id}`),
  drafts: () => request<InvoiceDraftListItem[]>("/invoice-drafts"),
  invoices: () => request<InvoiceListItem[]>("/invoices"),
  externalInvoices: () => request<ExternalInvoiceListItem[]>("/external-invoices"),
  jobs: () => request<IntegrationJobListItem[]>("/jobs"),
  settings: () => request<{ runtime: Record<string, unknown> }>("/settings"),
  connections: () => request<ConnectionsSnapshot>("/settings/connections"),
  saveTrendyolConnection: (input: TrendyolConnectionInput) =>
    request<ConnectionsSnapshot>("/settings/connections/trendyol", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  connectTrendyol: (input: TrendyolConnectionInput) =>
    request<ConnectionResult>("/settings/connections/trendyol/connect", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  saveGibPortalConnection: (input: GibPortalConnectionInput) =>
    request<ConnectionsSnapshot>("/settings/connections/gib-portal", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  connectGibPortal: (input: GibPortalConnectionInput) =>
    request<ConnectionResult>("/settings/connections/gib-portal/connect", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  saveGibDirectConnection: (input: GibDirectConnectionInput) =>
    request<ConnectionsSnapshot>("/settings/connections/gib-direct", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  connectGibDirect: (input: GibDirectConnectionInput) =>
    request<ConnectionResult>("/settings/connections/gib-direct/connect", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  openEarsivPortalSession: () =>
    request<{ launchUrl: string; tokenReceived: boolean; openedAt: string }>("/earsiv-portal/open-session", {
      method: "POST"
    }),
  importExternalInvoices: (source: ExternalInvoiceSource, invoices: Array<Record<string, unknown>>) =>
    request<ExternalInvoiceSyncResult>("/external-invoices/import", {
      method: "POST",
      body: JSON.stringify({ source, invoices })
    }),
  reconcileExternalInvoices: (source?: ExternalInvoiceSource) =>
    request<ExternalInvoiceSyncResult>("/external-invoices/reconcile", {
      method: "POST",
      body: JSON.stringify(source ? { source } : {})
    }),
  syncGibExternalInvoices: (input: { days?: number; startDate?: string; endDate?: string }) =>
    request<ExternalInvoiceSyncResult>("/external-invoices/sync/gib-portal", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  syncTrendyolExternalInvoices: () =>
    request<ExternalInvoiceSyncResult>("/external-invoices/sync/trendyol", {
      method: "POST"
    }),
  matchExternalInvoice: (id: string, target: { orderNumber?: string; shipmentPackageId?: string }) =>
    request<ExternalInvoiceListItem>(`/external-invoices/${id}/match`, {
      method: "POST",
      body: JSON.stringify(target)
    }),
  clearExternalInvoiceMatch: (id: string) =>
    request<ExternalInvoiceListItem>(`/external-invoices/${id}/match`, {
      method: "DELETE"
    }),
  draftPdfUrl: (draftId: string) => `${API_BASE}/invoice-drafts/${draftId}/pdf`,
  draftXmlUrl: (draftId: string) => `${API_BASE}/invoice-drafts/${draftId}/earsiv-xml`,
  invoicePdfUrl: (invoiceId: string) => `${API_BASE}/invoices/${invoiceId}/pdf`,
  sync: () => request<{ packageCount: number; upserted: number; draftsCreated: number }>("/sync/trendyol", { method: "POST" }),
  approve: (id: string) => request(`/invoice-drafts/${id}/approve`, { method: "POST" }),
  issue: (draftIds: string[]) =>
    request<{ requested: number; enqueued: number; autoApproved: number; failed: number; failures: Array<{ draftId: string; error: string }> }>(
      "/invoices/issue",
      {
      method: "POST",
      body: JSON.stringify({ draftIds })
      }
    ),
  uploadPortalDrafts: (draftIds: string[]) =>
    request<PortalDraftUploadResult>("/invoice-drafts/gib-portal-drafts", {
      method: "POST",
      body: JSON.stringify({ draftIds })
    })
};
