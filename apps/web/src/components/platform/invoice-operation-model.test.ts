import type { ExternalInvoiceListItem, InvoiceDraftListItem, InvoiceListItem } from "@safa/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInvoiceOperationMetrics, buildInvoiceOperationRows } from "./invoice-operation-model";

const deliveredAt = "2026-05-22T09:00:00.000Z";

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00+03:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("keeps signed portal invoices without PDF actionable instead of marking them complete", () => {
    const [row] = buildInvoiceOperationRows({
      drafts: [],
      invoices: [],
      externalInvoices: [
        externalInvoice({
          orderNumber: undefined,
          shipmentPackageId: undefined,
          matchedOrderId: undefined,
          matchedOrderNumber: undefined,
          matchedShipmentPackageId: undefined,
          pdfUrl: undefined,
          requiresPdfUpload: false
        })
      ],
      jobs: []
    });

    expect(row.statusLabel).toBe("PDF eksik");
    expect(row.queueKeys).toContain("pdf-missing");
    expect(row.nextAction.kind).not.toBe("none");
    expect(row.nextAction.detail).not.toContain("yapilacak is yok");
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

  it("keeps yesterday invoices actionable inside the 7-day operation window", () => {
    vi.setSystemTime(new Date("2026-05-23T10:00:00+03:00"));
    const rows = buildInvoiceOperationRows({
      drafts: [],
      invoices: [
        invoice({
          invoiceDate: "2026-05-22T09:00:00.000Z",
          status: "TRENDYOL_SEND_FAILED",
          pdfAvailable: false,
          error: "Dunku pazaryeri hatasi"
        })
      ],
      externalInvoices: [],
      jobs: []
    });
    const [row] = rows;

    expect(row.statusLabel).toBe("Pazaryeri hatasi");
    expect(row.nextAction.kind).toBe("send-trendyol");
    expect(row.queueKeys).toEqual(expect.arrayContaining(["action", "pdf-missing", "marketplace"]));
    expect(row.stages.pdf.state).toBe("missing");
    expect(buildInvoiceOperationMetrics(rows)).toEqual({
      actionCount: 1,
      portalSignatureCount: 0,
      pdfMissingCount: 1,
      externalFoundCount: 0,
      marketplaceCount: 1
    });
  });

  it("keeps invoices outside the 7-day operation window visible but out of operation queues", () => {
    vi.setSystemTime(new Date("2026-05-23T10:00:00+03:00"));
    const rows = buildInvoiceOperationRows({
      drafts: [],
      invoices: [
        invoice({
          invoiceDate: "2026-05-16T09:00:00.000Z",
          status: "TRENDYOL_SEND_FAILED",
          pdfAvailable: false,
          error: "Eski pazaryeri hatasi"
        })
      ],
      externalInvoices: [],
      jobs: []
    });
    const [row] = rows;

    expect(row.statusLabel).toBe("Eski kayit");
    expect(row.nextAction.kind).toBe("view-order");
    expect(row.queueKeys).toEqual(["all"]);
    expect(row.stages.pdf.state).toBe("idle");
    expect(buildInvoiceOperationMetrics(rows)).toEqual({
      actionCount: 0,
      portalSignatureCount: 0,
      pdfMissingCount: 0,
      externalFoundCount: 0,
      marketplaceCount: 0
    });
  });
});
