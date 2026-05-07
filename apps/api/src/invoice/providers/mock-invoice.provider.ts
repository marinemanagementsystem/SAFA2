import { Injectable } from "@nestjs/common";
import { ArchiveInvoicePayload, ArchiveInvoiceResult, InvoiceProvider } from "../invoice-provider";
import { buildInvoicePdf } from "../pdf/simple-invoice-pdf";

@Injectable()
export class MockInvoiceProvider implements InvoiceProvider {
  async issueArchiveInvoice(payload: ArchiveInvoicePayload): Promise<ArchiveInvoiceResult> {
    const year = new Date().getFullYear();
    const sequence = String(Date.now() % 1_000_000_000).padStart(9, "0");
    const invoiceNumber = `SAF${year}${sequence}`;
    const invoiceDate = new Date();

    return {
      provider: "mock",
      providerInvoiceId: `mock-${payload.shipmentPackageId}-${Date.now()}`,
      invoiceNumber,
      invoiceDate,
      pdf: buildInvoicePdf(payload, {
        title: "Mock e-Arsiv Faturasi",
        documentNumber: invoiceNumber,
        documentDate: invoiceDate
      })
    };
  }
}
