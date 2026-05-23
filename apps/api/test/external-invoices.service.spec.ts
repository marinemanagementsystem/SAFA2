import { DraftStatus, ExternalInvoiceSource, InvoiceStatus } from "@prisma/client";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

function makeRepairOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-repair",
    shipmentPackageId: "3842798038",
    orderNumber: "11226054818",
    status: "Delivered",
    customerName: "YK TEKNOLOJI",
    customerEmail: null,
    customerIdentifier: "56200450596",
    invoiceAddress: {
      fullName: "YK TEKNOLOJI",
      addressLine: "Fatura Caddesi No 10 Cankaya/Ankara Turkiye",
      district: "Cankaya",
      city: "Ankara",
      countryCode: "TR",
      taxOffice: "Gaziler"
    },
    raw: {
      shipmentPackageId: "3842798038",
      orderNumber: "11226054818",
      shipmentPackageStatus: "Delivered",
      grossAmount: 583,
      totalDiscount: 0,
      totalPrice: 583,
      currencyCode: "TRY",
      lastModifiedDate: new Date("2026-05-20T09:00:00.000Z").getTime(),
      invoiceAddress: {
        companyName: "YK TEKNOLOJI",
        taxNumber: "56200450596",
        taxOffice: "Gaziler",
        address1: "Fatura Caddesi No 10",
        district: "Cankaya",
        city: "Ankara",
        countryCode: "TR"
      },
      lines: [{ productName: "Urun", quantity: 1, amount: 583, vatBaseAmount: 20 }]
    },
    totalGrossCents: 58300,
    totalDiscountCents: 0,
    totalPayableCents: 58300,
    currency: "TRY",
    lastModifiedAt: new Date("2026-05-20T09:00:00.000Z"),
    createdAt: new Date("2026-05-20T08:30:00.000Z"),
    updatedAt: new Date("2026-05-20T09:15:00.000Z"),
    invoiceDraft: null,
    externalInvoices: [],
    ...overrides
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

  it("previews GIB portal follow-up without writing invoice, match, or Trendyol state", async () => {
    const portalRecord = {
      uuid: "22222222-2222-4222-8222-222222222222",
      faturaNo: "GIB202600002",
      faturaTarihi: "13.05.2026 10:00",
      aliciUnvan: "Ada Test",
      vknTckn: "12345678901",
      odenecekTutar: "383,36",
      durum: "Onaylandı",
      kaynakKomut: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR"
    };
    const prisma = {
      externalInvoice: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(),
        update: vi.fn()
      },
      order: {
        findMany: vi.fn(async () => [
          {
            id: "order-2",
            shipmentPackageId: "pkg-2",
            orderNumber: "11226054818",
            customerName: "Ada Test",
            customerIdentifier: "12345678901",
            totalPayableCents: 38336,
            lastModifiedAt: new Date("2026-05-12T10:00:00.000Z")
          }
        ])
      },
      invoice: {
        findMany: vi.fn(async () => [])
      },
      invoiceDraft: {
        findMany: vi.fn(async () => [])
      },
      auditLog: {
        create: vi.fn()
      }
    };
    const earsivPortal = {
      listIssuedInvoices: vi.fn(async () => [portalRecord])
    };
    const trendyol = { sendInvoiceFile: vi.fn() };
    const service = new ExternalInvoicesService(prisma as never, earsivPortal as never, trendyol as never);

    const result = await service.syncGibPortal({ days: 30, mode: "preview" });

    expect(result.checkedCount).toBe(1);
    expect(result.signedFound).toBe(1);
    expect(result.followup?.timelineEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "signed_found",
          invoiceNumber: "GIB202600002",
          orderNumber: "11226054818"
        })
      ])
    );
    expect(prisma.externalInvoice.upsert).not.toHaveBeenCalled();
    expect(prisma.externalInvoice.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(trendyol.sendInvoiceFile).not.toHaveBeenCalled();
  });

  it("leaves weak name and amount matches as suggestions instead of automatic matches", async () => {
    const external = makeSignedExternal({
      id: "external-weak",
      buyerName: "Ada Test",
      buyerIdentifier: null,
      orderNumber: null,
      shipmentPackageId: null,
      matchedOrderId: null,
      matchScore: 0
    });
    const prisma = {
      externalInvoice: {
        findMany: vi.fn(async () => [external]),
        update: vi.fn(async (args) => ({ ...external, ...args.data }))
      },
      order: {
        findMany: vi.fn(async () => [
          {
            id: "order-weak",
            shipmentPackageId: "pkg-weak",
            orderNumber: "11226054818",
            customerName: "Ada Test",
            customerIdentifier: null,
            totalPayableCents: 38336,
            lastModifiedAt: new Date("2026-05-12T10:00:00.000Z")
          }
        ])
      },
      invoice: { findMany: vi.fn(async () => []) }
    };
    const service = new ExternalInvoicesService(prisma as never, {} as never, {} as never);

    const result = await service.reconcile(ExternalInvoiceSource.GIB_PORTAL);

    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(prisma.externalInvoice.update).toHaveBeenCalledWith({
      where: { id: "external-weak" },
      data: expect.objectContaining({
        matchedOrderId: null,
        matchScore: 78,
        matchReason: expect.stringContaining("Otomatik uygulanmadi")
      })
    });
  });

  it("promotes and sends a signed portal invoice after manual matching", async () => {
    const signed = makeSignedExternal({
      id: "external-manual",
      externalKey: "33333333-3333-4333-8333-333333333333",
      invoiceNumber: "GIB202600003",
      raw: {
        uuid: "33333333-3333-4333-8333-333333333333",
        uploadedPdfPath: "/tmp/GIB202600003.pdf",
        kaynakKomut: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR"
      },
      matchedOrderId: null,
      matchScore: 0
    });
    const draft = {
      id: "draft-manual",
      orderId: "order-manual",
      status: DraftStatus.PORTAL_DRAFTED,
      portalDraftUuid: "33333333-3333-4333-8333-333333333333",
      portalDraftNumber: "GIB202600003",
      order: {
        orderNumber: "11226054818",
        shipmentPackageId: "pkg-manual"
      },
      invoice: null
    };
    const prisma = {
      externalInvoice: {
        findUnique: vi.fn(async () => signed),
        update: vi.fn(async (args) => ({
          ...signed,
          ...args.data,
          matchedOrder: { orderNumber: "11226054818", shipmentPackageId: "pkg-manual" }
        })),
        findMany: vi.fn(async () => [
          {
            ...signed,
            matchedOrderId: "order-manual",
            matchScore: 100,
            matchedOrder: { orderNumber: "11226054818", shipmentPackageId: "pkg-manual" }
          }
        ])
      },
      order: {
        findFirst: vi.fn(async () => ({
          id: "order-manual",
          orderNumber: "11226054818",
          shipmentPackageId: "pkg-manual"
        }))
      },
      invoiceDraft: {
        findMany: vi.fn(async () => [draft]),
        update: vi.fn(async (args) => ({ ...draft, ...args.data }))
      },
      invoice: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async (args) => ({
          id: "invoice-manual",
          ...args.data,
          trendyolStatus: null
        })),
        update: vi.fn(async (args) => ({ id: args.where.id, ...args.data }))
      },
      auditLog: {
        create: vi.fn()
      }
    };
    const trendyol = {
      sendInvoiceFile: vi.fn(async () => ({ ok: true, alreadySent: false }))
    };
    const service = new ExternalInvoicesService(prisma as never, {} as never, trendyol as never);

    await service.manualMatch("external-manual", { orderNumber: "11226054818" });

    expect(prisma.invoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        draftId: "draft-manual",
        invoiceNumber: "GIB202600003",
        pdfPath: "/tmp/GIB202600003.pdf",
        error: null
      })
    });
    expect(trendyol.sendInvoiceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentPackageId: "pkg-manual",
        invoiceNumber: "GIB202600003",
        pdfPath: "/tmp/GIB202600003.pdf"
      })
    );
  });

  it("downloads a missing official portal PDF before sending the promoted invoice to Trendyol", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "safa-gib-pdf-"));
    const previousStorageDir = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = storageRoot;
    const signed = makeSignedExternal({
      id: "external-pdf-fetch",
      externalKey: "55555555-5555-4555-8555-555555555555",
      invoiceNumber: "GIB202600005",
      pdfUrl: null,
      raw: {
        uuid: "55555555-5555-4555-8555-555555555555",
        belgeOid: "oid-555",
        kaynakKomut: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR"
      }
    });
    const draft = {
      id: "draft-pdf-fetch",
      orderId: "order-1",
      status: DraftStatus.PORTAL_DRAFTED,
      portalDraftUuid: "55555555-5555-4555-8555-555555555555",
      portalDraftNumber: "GIB202600005",
      order: {
        orderNumber: "11227170653",
        shipmentPackageId: "pkg-1"
      },
      invoice: null
    };
    const prisma = {
      externalInvoice: {
        findMany: vi.fn(async () => [signed]),
        update: vi.fn(async (args) => ({ ...signed, raw: args.data.raw }))
      },
      invoiceDraft: {
        findMany: vi.fn(async () => [draft]),
        update: vi.fn(async (args) => ({ ...draft, ...args.data }))
      },
      invoice: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async (args) => ({
          id: "invoice-pdf-fetch",
          ...args.data,
          trendyolStatus: null
        })),
        update: vi.fn(async (args) => ({ id: args.where.id, ...args.data }))
      },
      auditLog: {
        create: vi.fn()
      }
    };
    const earsivPortal = {
      downloadIssuedInvoicePdf: vi.fn(async () => ({
        buffer: Buffer.from("%PDF-1.4 official"),
        pdfUrl: "/earsiv-services/download/pdf/oid-555",
        source: "EARSIV_PORTAL_FATURA_PDF_INDIR"
      }))
    };
    const trendyol = {
      sendInvoiceFile: vi.fn(async () => ({ ok: true, alreadySent: false }))
    };
    const service = new ExternalInvoicesService(prisma as never, earsivPortal as never, trendyol as never);

    try {
      const result = await service.promoteSignedGibInvoices({ autoSendTrendyol: true });

      expect(earsivPortal.downloadIssuedInvoicePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceNumber: "GIB202600005",
          externalKey: "55555555-5555-4555-8555-555555555555"
        })
      );
      expect(prisma.externalInvoice.update).toHaveBeenCalledWith({
        where: { id: "external-pdf-fetch" },
        data: expect.objectContaining({
          raw: expect.objectContaining({
            uploadedPdfPath: expect.stringContaining("GIB202600005.pdf"),
            officialPdfSource: "EARSIV_PORTAL_FATURA_PDF_INDIR"
          }),
          pdfUrl: "/earsiv-services/download/pdf/oid-555"
        })
      });
      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoiceNumber: "GIB202600005",
          pdfPath: expect.stringContaining("GIB202600005.pdf"),
          pdfUrl: "/earsiv-services/download/pdf/oid-555",
          error: null
        })
      });
      expect(trendyol.sendInvoiceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentPackageId: "pkg-1",
          invoiceNumber: "GIB202600005",
          pdfPath: expect.stringContaining("GIB202600005.pdf")
        })
      );
      expect(result.trendyolSent).toBe(1);
    } finally {
      if (previousStorageDir === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = previousStorageDir;
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("keeps scheduled GIB follow-up promotion scoped to the requested day", async () => {
    const service = new ExternalInvoicesService({} as never, {} as never, {} as never);
    const input = {
      startDate: "2026-05-22T00:00:00+03:00",
      endDate: "2026-05-22T23:59:59+03:00"
    };
    vi.spyOn(service, "promoteSignedGibInvoices").mockResolvedValueOnce({
      imported: 0,
      matched: 0,
      unmatched: 0,
      checkedCount: 0,
      signedFound: 0,
      promoted: 0,
      pdfMissing: 0,
      trendyolSent: 0,
      trendyolAlreadySent: 0,
      trendyolFailed: 0,
      unmatchedReasons: [],
      timelineEvents: [],
      followup: {
        checkedCount: 0,
        signedFound: 0,
        promoted: 0,
        pdfMissing: 0,
        trendyolSent: 0,
        trendyolAlreadySent: 0,
        trendyolFailed: 0,
        needsManualMatch: 0,
        unmatchedReasons: [],
        timelineEvents: []
      },
      invoices: []
    } as never);

    await service.runGibPortalFollowupJobStep({ kind: "gib-portal-followup", phase: "promote-existing", input }, {});

    expect(service.promoteSignedGibInvoices).toHaveBeenCalledWith({
      autoSendTrendyol: true,
      startDate: "2026-05-22T00:00:00+03:00",
      endDate: "2026-05-22T23:59:59+03:00"
    });
  });

  it("defaults scheduled GIB follow-up promotion to the current 7-day Istanbul window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+03:00"));
    const service = new ExternalInvoicesService({} as never, {} as never, {} as never);
    vi.spyOn(service, "promoteSignedGibInvoices").mockResolvedValueOnce({
      imported: 0,
      matched: 0,
      unmatched: 0,
      checkedCount: 0,
      signedFound: 0,
      promoted: 0,
      pdfMissing: 0,
      trendyolSent: 0,
      trendyolAlreadySent: 0,
      trendyolFailed: 0,
      unmatchedReasons: [],
      timelineEvents: [],
      followup: {
        checkedCount: 0,
        signedFound: 0,
        promoted: 0,
        pdfMissing: 0,
        trendyolSent: 0,
        trendyolAlreadySent: 0,
        trendyolFailed: 0,
        needsManualMatch: 0,
        unmatchedReasons: [],
        timelineEvents: []
      },
      invoices: []
    } as never);

    try {
      await service.runGibPortalFollowupJobStep({ kind: "gib-portal-followup", phase: "promote-existing" }, {});

      expect(service.promoteSignedGibInvoices).toHaveBeenCalledWith({
        autoSendTrendyol: true,
        startDate: "2026-05-17T00:00:00+03:00",
        endDate: "2026-05-23T23:59:59+03:00"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the marketplace step complete when Trendyol order data contains a manual invoice trace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T10:00:00+03:00"));
    const order = {
      id: "order-manual-trendyol",
      orderNumber: "11226054818",
      shipmentPackageId: "pkg-manual-trendyol",
      customerName: "Manual Trendyol",
      customerIdentifier: "12345678901",
      totalPayableCents: 58300,
      currency: "TRY",
      raw: {
        invoiceNumber: "TY-MANUAL-001",
        invoiceLink: "https://supplier.example/invoices/TY-MANUAL-001.pdf"
      }
    };
    const prisma = {
      order: {
        findMany: vi.fn(async () => [order])
      },
      externalInvoice: {
        upsert: vi.fn(async (args) => ({
          id: "external-trendyol-manual",
          ...args.create,
          matchedOrderId: null,
          matchScore: 0,
          createdAt: new Date("2026-05-22T09:00:00.000Z"),
          updatedAt: new Date("2026-05-22T09:00:00.000Z")
        })),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: "external-trendyol-manual",
              source: ExternalInvoiceSource.TRENDYOL,
              externalKey: "https://supplier.example/invoices/TY-MANUAL-001.pdf",
              invoiceNumber: "TY-MANUAL-001",
              invoiceDate: null,
              buyerName: "Manual Trendyol",
              buyerIdentifier: "12345678901",
              orderNumber: "11226054818",
              shipmentPackageId: "pkg-manual-trendyol",
              totalPayableCents: 58300,
              currency: "TRY",
              status: null,
              pdfUrl: "https://supplier.example/invoices/TY-MANUAL-001.pdf",
              xmlUrl: null,
              raw: order.raw,
              matchedOrderId: null,
              matchedOrder: null,
              matchScore: 0,
              matchReason: null,
              createdAt: new Date("2026-05-22T09:00:00.000Z"),
              updatedAt: new Date("2026-05-22T09:00:00.000Z")
            }
          ])
          .mockResolvedValueOnce([
            {
              id: "external-trendyol-manual",
              source: ExternalInvoiceSource.TRENDYOL,
              externalKey: "https://supplier.example/invoices/TY-MANUAL-001.pdf",
              invoiceNumber: "TY-MANUAL-001",
              orderNumber: "11226054818",
              shipmentPackageId: "pkg-manual-trendyol",
              matchedOrder: null
            }
          ]),
        update: vi.fn(async (args) => ({ id: args.where.id, ...args.data }))
      },
      invoice: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: "invoice-manual-trendyol",
              draftId: "draft-manual-trendyol",
              provider: "gib-portal-manual",
              providerInvoiceId: "GIB202600006",
              invoiceNumber: "GIB202600006",
              invoiceDate: new Date("2026-05-22T10:00:00.000Z"),
              status: InvoiceStatus.ISSUED,
              pdfPath: null,
              pdfUrl: null,
              trendyolStatus: null,
              draft: {
                order: {
                  id: "order-manual-trendyol",
                  orderNumber: "11226054818",
                  shipmentPackageId: "pkg-manual-trendyol"
                }
              }
            }
          ]),
        update: vi.fn()
      },
      auditLog: {
        create: vi.fn()
      }
    };
    const service = new ExternalInvoicesService(prisma as never, {} as never, {} as never);

    try {
      const result = await service.syncTrendyolMetadata({ includeInvoices: false });

      expect(result.imported).toBe(1);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            invoiceDate: {
              gte: new Date("2026-05-16T21:00:00.000Z"),
              lt: new Date("2026-05-23T21:00:00.000Z")
            }
          }
        })
      );
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: "invoice-manual-trendyol" },
        data: expect.objectContaining({
          status: InvoiceStatus.TRENDYOL_SENT,
          trendyolStatus: "MANUAL_DETECTED",
          error: null
        })
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("previews only the locked 20 May repair without creating drafts or uploading to GIB", async () => {
    const prisma = {
      externalInvoice: {
        findMany: vi.fn(async () => [])
      },
      invoice: {
        findMany: vi.fn(async () => [])
      },
      order: {
        findMany: vi.fn(async () => [makeRepairOrder()])
      },
      invoiceDraft: {
        create: vi.fn(),
        update: vi.fn()
      },
      auditLog: {
        create: vi.fn()
      }
    };
    const earsivPortal = {
      listIssuedInvoices: vi.fn(async () => []),
      createInvoiceDrafts: vi.fn()
    };
    const service = new ExternalInvoicesService(prisma as never, earsivPortal as never, {} as never);

    const result = await service.syncGibPortal({
      days: 1,
      startDate: "2026-05-20T00:00:00+03:00",
      endDate: "2026-05-20T23:59:59+03:00",
      mode: "preview",
      repairMissingDrafts: true
    });

    expect(result.followup?.timelineEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "signature_pending",
          orderNumber: "11226054818",
          message: expect.stringContaining("SAFA taslagi hic olusmamis")
        })
      ])
    );
    expect(prisma.invoiceDraft.create).not.toHaveBeenCalled();
    expect(earsivPortal.createInvoiceDrafts).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("applies the locked 20 May repair by creating the missing draft and uploading it to GIB portal", async () => {
    const createdDraft = {
      id: "draft-repair",
      orderId: "order-repair",
      status: DraftStatus.ISSUING
    };
    const prisma = {
      externalInvoice: {
        findMany: vi.fn(async () => [])
      },
      invoice: {
        findMany: vi.fn(async () => [])
      },
      order: {
        findMany: vi.fn(async () => [makeRepairOrder()])
      },
      invoiceDraft: {
        create: vi.fn(async (args) => ({ ...createdDraft, ...args.data })),
        update: vi.fn(async (args) => ({ ...createdDraft, ...args.data }))
      },
      auditLog: {
        create: vi.fn()
      }
    };
    const earsivPortal = {
      listIssuedInvoices: vi.fn(async () => []),
      createInvoiceDrafts: vi.fn(async () => [
        {
          localDraftId: "draft-repair",
          ok: true,
          uuid: "44444444-4444-4444-8444-444444444444",
          documentNumber: undefined,
          status: "Onaylanmadı",
          command: "EARSIV_PORTAL_FATURA_OLUSTUR",
          pageName: "RG_BASITFATURA",
          message: "basarili",
          response: { ok: true }
        }
      ])
    };
    const service = new ExternalInvoicesService(prisma as never, earsivPortal as never, {} as never);

    const result = await service.syncGibPortal({
      days: 1,
      startDate: "2026-05-20T00:00:00+03:00",
      endDate: "2026-05-20T23:59:59+03:00",
      mode: "apply",
      repairMissingDrafts: true
    });

    expect(prisma.invoiceDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: "order-repair",
        status: DraftStatus.ISSUING,
        approvedAt: expect.any(Date)
      })
    });
    expect(earsivPortal.createInvoiceDrafts).toHaveBeenCalledWith([
      expect.objectContaining({ localDraftId: "draft-repair", payload: expect.objectContaining({ vknTckn: "56200450596" }) })
    ]);
    expect(prisma.invoiceDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-repair" },
      data: expect.objectContaining({
        status: DraftStatus.PORTAL_DRAFTED,
        portalDraftUuid: "44444444-4444-4444-8444-444444444444",
        portalDraftStatus: "Onaylanmadı"
      })
    });
    expect(result.followup?.timelineEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "portal_uploaded",
          orderNumber: "11226054818"
        })
      ])
    );
  });

  it("rejects missing-draft repair outside 20 May 2026", async () => {
    const service = new ExternalInvoicesService({} as never, {} as never, {} as never);

    await expect(
      service.syncGibPortal({
        days: 1,
        startDate: "2026-05-21T00:00:00+03:00",
        endDate: "2026-05-21T23:59:59+03:00",
        mode: "apply",
        repairMissingDrafts: true
      })
    ).rejects.toThrow("yalnizca 20.05.2026");
  });
});
