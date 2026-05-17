import { DraftStatus, ExternalInvoiceSource, InvoiceStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ExternalInvoicesService } from "../src/external-invoices/external-invoices.service";

function makeSignedExternal(overrides: Record<string, unknown> = {}) {
  return {
    id: "external-1",
    source: ExternalInvoiceSource.GIB_PORTAL,
    externalKey: "11111111-1111-4111-8111-111111111111",
    invoiceNumber: "GIB202600001",
    invoiceDate: new Date("2026-05-12T09:00:00.000Z"),
    buyerName: "Sarper Test",
    buyerIdentifier: "12345678901",
    orderNumber: "11227170653",
    shipmentPackageId: "pkg-1",
    totalPayableCents: 38336,
    currency: "TRY",
    status: "Onaylandı",
    pdfUrl: null,
    xmlUrl: null,
    raw: {
      uuid: "11111111-1111-4111-8111-111111111111",
      kaynakKomut: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR"
    },
    matchedOrderId: "order-1",
    matchedOrder: { orderNumber: "11227170653", shipmentPackageId: "pkg-1" },
    matchScore: 100,
    matchReason: "Portal taslak UUID eslesti.",
    createdAt: new Date("2026-05-12T09:00:00.000Z"),
    updatedAt: new Date("2026-05-12T09:00:00.000Z"),
    ...overrides
  };
}

function makeDraftWithInvoice() {
  return {
    id: "draft-1",
    orderId: "order-1",
    status: DraftStatus.PORTAL_DRAFTED,
    portalDraftUuid: "11111111-1111-4111-8111-111111111111",
    portalDraftNumber: "GIB202600001",
    order: {
      orderNumber: "11227170653",
      shipmentPackageId: "pkg-1"
    },
    invoice: {
      id: "invoice-1",
      provider: "gib-portal-manual",
      providerInvoiceId: "11111111-1111-4111-8111-111111111111",
      invoiceNumber: "GIB202600001",
      invoiceDate: new Date("2026-05-12T09:00:00.000Z"),
      status: InvoiceStatus.ISSUED,
      pdfPath: "/tmp/GIB202600001.pdf",
      pdfUrl: null,
      trendyolStatus: null
    }
  };
}

function serviceWith(existingDraft = makeDraftWithInvoice()) {
  const prisma = {
    externalInvoice: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([makeSignedExternal()])
        .mockResolvedValueOnce([makeSignedExternal()])
    },
    invoiceDraft: {
      findMany: vi.fn(async () => [existingDraft]),
      update: vi.fn(async (args) => ({ ...existingDraft, ...args.data }))
    },
    invoice: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([existingDraft.invoice])
        .mockResolvedValueOnce([existingDraft.invoice]),
      create: vi.fn(),
      update: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };
  const earsivPortal = {};
  const trendyol = {
    sendInvoiceFile: vi.fn()
  };

  return {
    service: new ExternalInvoicesService(prisma as never, earsivPortal as never, trendyol as never),
    prisma,
    trendyol
  };
}

describe("ExternalInvoicesService", () => {
  it("marks an existing promoted portal draft as ISSUED when the signed GIB invoice is found again", async () => {
    const { service, prisma, trendyol } = serviceWith();

    const result = await service.promoteSignedGibInvoices();

    expect(result.promoted).toBe(0);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.invoiceDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: {
        status: DraftStatus.ISSUED,
        portalDraftStatus: "Onaylandı"
      }
    });
    expect(trendyol.sendInvoiceFile).not.toHaveBeenCalled();
  });
});
