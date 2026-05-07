export interface ArchiveInvoicePayload {
  orderNumber: string;
  shipmentPackageId: string;
  buyerName: string;
  buyerIdentifier: string;
  address: {
    addressLine: string;
    district?: string;
    city: string;
    countryCode: string;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    grossCents: number;
    discountCents: number;
    payableCents: number;
    vatRate: number;
  }>;
  totals: {
    grossCents: number;
    discountCents: number;
    payableCents: number;
    currency: string;
  };
}

export interface ArchiveInvoiceResult {
  provider: string;
  providerInvoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  pdf: Buffer;
  pdfUrl?: string;
}

export interface InvoiceProvider {
  issueArchiveInvoice(payload: ArchiveInvoicePayload): Promise<ArchiveInvoiceResult>;
}
