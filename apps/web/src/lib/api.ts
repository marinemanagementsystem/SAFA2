import type {
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  OrderDetail,
  OrderListItem
} from "@safa/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export { API_BASE };

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  orders: () => request<OrderListItem[]>("/orders"),
  order: (id: string) => request<OrderDetail>(`/orders/${id}`),
  drafts: () => request<InvoiceDraftListItem[]>("/invoice-drafts"),
  invoices: () => request<InvoiceListItem[]>("/invoices"),
  jobs: () => request<IntegrationJobListItem[]>("/jobs"),
  settings: () => request<{ runtime: Record<string, unknown> }>("/settings"),
  connections: () => request<ConnectionsSnapshot>("/settings/connections"),
  saveTrendyolConnection: (input: TrendyolConnectionInput) =>
    request<ConnectionsSnapshot>("/settings/connections/trendyol", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  saveGibPortalConnection: (input: GibPortalConnectionInput) =>
    request<ConnectionsSnapshot>("/settings/connections/gib-portal", {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  openEarsivPortalSession: () =>
    request<{ launchUrl: string; tokenReceived: boolean; openedAt: string }>("/earsiv-portal/open-session", {
      method: "POST"
    }),
  draftPdfUrl: (draftId: string) => `${API_BASE}/invoice-drafts/${draftId}/pdf`,
  draftXmlUrl: (draftId: string) => `${API_BASE}/invoice-drafts/${draftId}/earsiv-xml`,
  invoicePdfUrl: (invoiceId: string) => `${API_BASE}/invoices/${invoiceId}/pdf`,
  sync: () => request<{ packageCount: number; upserted: number; draftsCreated: number }>("/sync/trendyol", { method: "POST" }),
  approve: (id: string) => request(`/invoice-drafts/${id}/approve`, { method: "POST" }),
  issue: (draftIds: string[]) =>
    request<{ enqueued: number }>("/invoices/issue", {
      method: "POST",
      body: JSON.stringify({ draftIds })
    })
};
