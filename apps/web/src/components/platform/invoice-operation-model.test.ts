import type { ExternalInvoiceListItem, InvoiceDraftListItem, InvoiceListItem } from "@safa/shared";
import { describe, expect, it } from "vitest";
import { buildInvoiceOperationMetrics, buildInvoiceOperationRows } from "./invoice-operation-model";

const deliveredAt = "2026-05-21T09:00:00.000Z";

function draft(input: Partial<InvoiceDraftListItem> = {}): InvoiceDraftListItem {
  return {
    id: "draft-1",
    orderId: "order-1",
    shipmentPackageId: "3847145278",
    orderNumber: "11232094353",
    customerName: "Test Musteri",
    status: "READY",
    warnings: [],
    errors: [],
    lineCount: 1,
    totalPayableCents: 25000,
    currency: "TRY",
    deliveredAt,
    externalInvoiceCount: 0,
    externalInvoiceSources: [],
    ...input
  };
}

function invoice(input: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return {
    id: "invoice-1",
    draftId: "draft-1",
    orderNumber: "11232094353",
    shipmentPackageId: "3847145278",
    invoiceNumber: "FAT202605210001",
    invoiceDate: deliveredAt,
    status: "ISSUED",
    provider: "GIB_PORTAL",
    pdfAvailable: true,
    ...input
  };
}

function externalInvoice(input: Partial<ExternalInvoiceListItem> = {}): ExternalInvoiceListItem {
  return {
    id: "external-1",
    source: "GIB_PORTAL",
    invoiceNumber: "GIB202605210001",
    invoiceDate: deliveredAt,
    buyerName: "Test Musteri",
    orderNumber: "11232094353",
    shipmentPackageId: "3847145278",
    matchedOrderId: "order-1",
    matchedOrderNumber: "11232094353",
    matchedShipmentPackageId: "3847145278",
    matchScore: 96,
    currency: "TRY",
    totalPayableCents: 25000,
    createdAt: deliveredAt,
    updatedAt: deliveredAt,
    ...input
  };
}

describe("buildInvoiceOperationRows", () => {
  it("keeps draft-only records visible and points to approval", () => {
    const [row] = buildInvoiceOperationRows({ drafts: [draft()], invoices: [], externalInvoices: [], jobs: [] });

    expect(row.statusLabel).toBe("Onay bekliyor");
    expect(row.nextAction.kind).toBe("approve");
    expect(row.stages.draft.state).toBe("waiting");
    expect(row.stages.pdf.state).toBe("idle");
  });

  it("keeps invoices without PDF visible in the PDF-missing queue", () => {
    const [row] = buildInvoiceOperationRows({ drafts: [], invoices: [invoice({ pdfAvailable: false })], externalInvoices: [], jobs: [] });

    expect(row.statusLabel).toBe("PDF eksik");
    expect(row.queueKeys).toContain("pdf-missing");
    expect(row.stages.pdf.state).toBe("missing");
  });

  it("promotes matched external GIB invoices before they disappear into archive assumptions", () => {
    const [row] = buildInvoiceOperationRows({ drafts: [], invoices: [], externalInvoices: [externalInvoice()], jobs: [] });

    expect(row.statusLabel).toBe("Harici bulundu");
    expect(row.nextAction.kind).toBe("promote-external");
    expect(row.queueKeys).toContain("external-found");
  });

  it("marks Trendyol-sent invoices as complete", () => {
    const [row] = buildInvoiceOperationRows({
      drafts: [draft({ status: "ISSUED" })],
      invoices: [invoice({ status: "TRENDYOL_SENT", trendyolStatus: "SENT" })],
      externalInvoices: [],
      jobs: []
    });

    expect(row.statusLabel).toBe("Tamam");
    expect(row.stages.marketplace.state).toBe("done");
    expect(row.priorityLabel).toBe("OK");
  });

  it("returns empty metrics when there is no invoice movement", () => {
    const metrics = buildInvoiceOperationMetrics(buildInvoiceOperationRows({ drafts: [], invoices: [], externalInvoices: [], jobs: [] }));

    expect(metrics).toEqual({
      actionCount: 0,
      portalSignatureCount: 0,
      pdfMissingCount: 0,
      externalFoundCount: 0,
      marketplaceCount: 0
    });
  });
});
