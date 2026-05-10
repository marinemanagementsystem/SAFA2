export type InvoiceDraftStatus =
  | "NEEDS_REVIEW"
  | "READY"
  | "APPROVED"
  | "ISSUING"
  | "ISSUED"
  | "ERROR";

export type InvoiceStatus = "ISSUED" | "TRENDYOL_SENT" | "TRENDYOL_SEND_FAILED";

export type JobStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";

export type ExternalInvoiceSource = "GIB_PORTAL" | "TRENDYOL" | "MANUAL";

export interface ExternalInvoiceListItem {
  id: string;
  source: ExternalInvoiceSource;
  invoiceNumber?: string;
  invoiceDate?: string;
  buyerName?: string;
  buyerIdentifier?: string;
  orderNumber?: string;
  shipmentPackageId?: string;
  totalPayableCents?: number;
  currency: string;
  status?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  matchedOrderId?: string;
  matchedOrderNumber?: string;
  matchedShipmentPackageId?: string;
  matchScore: number;
  matchReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem {
  id: string;
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail?: string;
  city: string;
  district: string;
  totalGrossCents: number;
  totalDiscountCents: number;
  totalPayableCents: number;
  currency: string;
  lastModifiedAt?: string;
  updatedAt: string;
  createdAt: string;
  draftId?: string;
  draftStatus?: InvoiceDraftStatus;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  trendyolStatus?: string;
  externalInvoiceCount: number;
  externalInvoiceSources: ExternalInvoiceSource[];
  externalInvoiceNumber?: string;
  externalInvoiceDate?: string;
}

export interface OrderDetail {
  id: string;
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail?: string;
  customerIdentifier?: string;
  invoiceAddress: Record<string, unknown>;
  raw: unknown;
  totalGrossCents: number;
  totalDiscountCents: number;
  totalPayableCents: number;
  currency: string;
  lastModifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  draft: {
    id: string;
    documentType: string;
    status: InvoiceDraftStatus;
    warnings: string[];
    errors: string[];
    lines: Array<Record<string, unknown>>;
    totals: Record<string, unknown>;
    approvedAt?: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  invoice: {
    id: string;
    provider: string;
    providerInvoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    status: InvoiceStatus;
    pdfUrl?: string;
    trendyolSentAt?: string;
    trendyolStatus?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  externalInvoices: ExternalInvoiceListItem[];
}

export interface InvoiceDraftListItem {
  id: string;
  orderId: string;
  shipmentPackageId: string;
  orderNumber: string;
  customerName: string;
  status: InvoiceDraftStatus;
  warnings: string[];
  errors: string[];
  lineCount: number;
  totalPayableCents: number;
  currency: string;
  approvedAt?: string;
  externalInvoiceCount: number;
  externalInvoiceSources: ExternalInvoiceSource[];
  externalInvoiceNumber?: string;
  externalInvoiceDate?: string;
}

export interface InvoiceListItem {
  id: string;
  draftId: string;
  orderNumber: string;
  shipmentPackageId: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: InvoiceStatus;
  pdfUrl?: string;
  trendyolStatus?: string;
}

export interface IntegrationJobListItem {
  id: string;
  type: string;
  target: string;
  status: JobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
