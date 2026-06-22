export type InvoiceDeskTab = "queue" | "archive" | "external";

export type InvoiceDeskFeature =
  | "draft-approve"
  | "portal-draft-upload"
  | "retry-draft"
  | "row-next-action"
  | "invoice-list"
  | "invoice-pdf"
  | "monthly-excel"
  | "monthly-zip"
  | "send-trendyol"
  | "open-portal"
  | "close-portal"
  | "preview-signed"
  | "apply-signed"
  | "sync-trendyol-trace"
  | "reconcile-external"
  | "import-external"
  | "manual-match"
  | "promote-external"
  | "upload-official-pdf";

export interface InvoiceDeskTabSummary {
  key: InvoiceDeskTab;
  label: string;
  mobileLabel: string;
  count: number;
  description: string;
  tone: "danger" | "warning" | "success" | "neutral";
}

export interface InvoiceDeskTabInput {
  actionCount: number;
  invoiceCount: number;
  externalInvoiceCount: number;
  archiveWarningCount: number;
}

export const INVOICE_DESK_FEATURES: Record<InvoiceDeskTab, readonly InvoiceDeskFeature[]> = {
  queue: ["draft-approve", "portal-draft-upload", "retry-draft", "row-next-action", "preview-signed", "send-trendyol"],
  archive: ["invoice-list", "invoice-pdf", "monthly-excel", "monthly-zip", "send-trendyol"],
  external: [
    "open-portal",
    "close-portal",
    "preview-signed",
    "apply-signed",
    "sync-trendyol-trace",
    "reconcile-external",
    "import-external",
    "manual-match",
    "promote-external",
    "upload-official-pdf",
    "send-trendyol"
  ]
};

export function buildInvoiceDeskTabs(input: InvoiceDeskTabInput): InvoiceDeskTabSummary[] {
  return [
    {
      key: "queue",
      label: "Islem Kuyrugu",
      mobileLabel: "Kuyruk",
      count: input.actionCount,
      description: "Onay, GIB, PDF veya Trendyol aksiyonu bekleyen kayitlar",
      tone: input.actionCount > 0 ? "danger" : "success"
    },
    {
      key: "archive",
      label: "Arsiv / Indirme",
      mobileLabel: "Arsiv",
      count: input.invoiceCount,
      description: "PDF listesi, aylik Excel ve ZIP arsivi",
      tone: input.archiveWarningCount > 0 ? "warning" : "neutral"
    },
    {
      key: "external",
      label: "Harici & GIB",
      mobileLabel: "Harici",
      count: input.externalInvoiceCount,
      description: "e-Arsiv sorgu, Trendyol izi, import ve eslestirme",
      tone: input.externalInvoiceCount > 0 ? "warning" : "neutral"
    }
  ];
}

export function invoiceDeskFeaturesFor(tab: InvoiceDeskTab) {
  return INVOICE_DESK_FEATURES[tab];
}
