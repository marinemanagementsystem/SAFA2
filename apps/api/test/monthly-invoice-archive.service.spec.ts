import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalInvoiceSource, InvoiceStatus } from "@prisma/client";
import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MonthlyInvoiceArchiveService } from "../src/invoice/monthly-invoice-archive.service";

const originalEnv = { ...process.env };

function makePrismaMock() {
  return {
    invoice: {
      findMany: vi.fn()
    },
    externalInvoice: {
      findMany: vi.fn()
    }
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  const order = {
    id: "order-1",
    shipmentPackageId: "pkg-1",
    orderNumber: "order-1",
    status: "Delivered",
    customerName: "Sarper Test",
    customerEmail: null,
    customerIdentifier: "12345678901",
    invoiceAddress: {},
    raw: {},
    totalGrossCents: 40462,
    totalDiscountCents: 8515,
    totalPayableCents: 38336,
    currency: "TRY",
    lastModifiedAt: null,
    createdAt: new Date("2026-05-10T09:00:00.000Z"),
    updatedAt: new Date("2026-05-10T09:00:00.000Z")
  };
  const draft = {
    id: "draft-1",
    orderId: order.id,
    order,
    documentType: "E_ARCHIVE",
    status: "ISSUED",
    validation: {},
    lines: [{ description: "Urun", quantity: 1, payableCents: 38336, vatRate: 20 }],
    totals: { payableCents: 38336 },
    approvedAt: new Date("2026-05-10T09:00:00.000Z"),
    portalDraftUuid: null,
    portalDraftNumber: null,
    portalDraftUploadedAt: null,
    portalDraftStatus: null,
    portalDraftResponse: null,
    createdAt: new Date("2026-05-10T09:00:00.000Z"),
    updatedAt: new Date("2026-05-10T09:00:00.000Z")
  };

  return {
    id: "invoice-1",
    draftId: draft.id,
    draft,
    provider: "gib-portal-manual",
    providerInvoiceId: "external-1",
    invoiceNumber: "SAF202600001",
    invoiceDate: new Date("2026-05-10T09:00:00.000Z"),
    status: InvoiceStatus.ISSUED,
    pdfPath: null,
    pdfUrl: null,
    trendyolSentAt: null,
    trendyolStatus: null,
    error: null,
    createdAt: new Date("2026-05-10T09:00:00.000Z"),
    updatedAt: new Date("2026-05-10T09:00:00.000Z"),
    ...overrides
  };
}

function makeExternal(overrides: Record<string, unknown> = {}) {
  return {
    id: "external-1",
    source: ExternalInvoiceSource.GIB_PORTAL,
    externalKey: "external-1",
    invoiceNumber: "SAF202600001",
    invoiceDate: new Date("2026-05-10T09:00:00.000Z"),
    buyerName: "Sarper Test",
    buyerIdentifier: "12345678901",
    orderNumber: "order-1",
    shipmentPackageId: "pkg-1",
    totalPayableCents: 38336,
    currency: "TRY",
    status: "Onaylandi",
    pdfUrl: null,
    xmlUrl: null,
    raw: { kaynakKomut: "ADIMA_KESILEN_BELGELERI_GETIR" },
    matchedOrderId: null,
    matchedOrder: null,
    matchScore: 0,
    matchReason: null,
    createdAt: new Date("2026-05-10T09:00:00.000Z"),
    updatedAt: new Date("2026-05-10T09:00:00.000Z"),
    ...overrides
  };
}

async function workbookFromBuffer(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("Faturalar");
  if (!sheet) throw new Error("Faturalar sheet missing");
  return sheet;
}

describe("MonthlyInvoiceArchiveService", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("exports the exact monthly Excel columns and VAT totals from official invoices", async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);
    prisma.externalInvoice.findMany.mockResolvedValue([makeExternal()]);
    const service = new MonthlyInvoiceArchiveService(prisma as never);

    const buffer = await service.buildMonthlyExcel({ year: 2026, month: 5 });
    const sheet = await workbookFromBuffer(buffer);

    expect(sheet.getCell("A1").value).toBe("Fatura numarası");
    expect(sheet.getCell("B1").value).toBe("Fatura tarihi");
    expect(sheet.getCell("C1").value).toBe("İsim Soyisim");
    expect(sheet.getCell("D1").value).toBe("TC ya da VKN");
    expect(sheet.getCell("E1").value).toBe("KDV tutarı");
    expect(sheet.getCell("F1").value).toBe("Ödenecek tutar");
    expect(sheet.getCell("G1").value).toBe("Vergiler hariç tutar");
    expect(sheet.actualRowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe("SAF202600001");
    expect(sheet.getCell("E2").value).toBe(63.89);
    expect(sheet.getCell("F2").value).toBe(383.36);
    expect(sheet.getCell("G2").value).toBe(319.47);
  });

  it("deduplicates the same invoice when it also exists as a signed external GIB record", async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);
    prisma.externalInvoice.findMany.mockResolvedValue([
      makeExternal(),
      makeExternal({
        id: "external-2",
        externalKey: "external-2",
        invoiceNumber: "SAF202600002",
        totalPayableCents: 18012,
        raw: {
          kaynakKomut: "ADIMA_KESILEN_BELGELERI_GETIR",
          hesaplananKdv: "30,02",
          vergilerHaricTutar: "150,10"
        }
      })
    ]);
    const service = new MonthlyInvoiceArchiveService(prisma as never);

    const sheet = await workbookFromBuffer(await service.buildMonthlyExcel({ year: 2026, month: 5 }));

    expect(sheet.actualRowCount).toBe(3);
    expect(sheet.getCell("A2").value).toBe("SAF202600001");
    expect(sheet.getCell("A3").value).toBe("SAF202600002");
    expect(sheet.getCell("E3").value).toBe(30.02);
    expect(sheet.getCell("G3").value).toBe(150.1);
  });

  it("does not export unsigned portal drafts to the official monthly Excel", async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.externalInvoice.findMany.mockResolvedValue([
      makeExternal({
        id: "draft-external",
        externalKey: "draft-external",
        invoiceNumber: "TMP202600003",
        status: "Onaylanmadı",
        raw: {
          kaynakKomut: "EARSIV_PORTAL_TASLAKLARI_GETIR"
        }
      })
    ]);
    const service = new MonthlyInvoiceArchiveService(prisma as never);

    const sheet = await workbookFromBuffer(await service.buildMonthlyExcel({ year: 2026, month: 5 }));

    expect(sheet.actualRowCount).toBe(1);
  });

  it("fills VAT and tax-exclusive totals from the matched draft when signed external raw totals are incomplete", async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.externalInvoice.findMany.mockResolvedValue([
      makeExternal({
        id: "external-matched-draft",
        externalKey: "external-matched-draft",
        invoiceNumber: "GIB202600004",
        totalPayableCents: 38336,
        raw: {
          kaynakKomut: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR"
        },
        matchedOrder: {
          id: "order-1",
          shipmentPackageId: "pkg-1",
          orderNumber: "order-1",
          customerName: "Sarper Test",
          customerIdentifier: "12345678901",
          totalPayableCents: 38336,
          currency: "TRY",
          invoiceDraft: {
            id: "draft-1",
            lines: [{ description: "Urun", quantity: 1, payableCents: 38336, vatRate: 20 }],
            totals: { payableCents: 38336 }
          }
        }
      })
    ]);
    const service = new MonthlyInvoiceArchiveService(prisma as never);

    const sheet = await workbookFromBuffer(await service.buildMonthlyExcel({ year: 2026, month: 5 }));

    expect(sheet.actualRowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe("GIB202600004");
    expect(sheet.getCell("E2").value).toBe(63.89);
    expect(sheet.getCell("F2").value).toBe(383.36);
    expect(sheet.getCell("G2").value).toBe(319.47);
  });

  it("creates a monthly ZIP package without inventing official XML", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "safa-monthly-archive-"));
    process.env.STORAGE_DIR = tempDir;
    const pdfPath = path.join(tempDir, "invoice.pdf");
    await fs.writeFile(pdfPath, Buffer.from("%PDF-1.4\n"));

    const prisma = makePrismaMock();
    prisma.invoice.findMany.mockResolvedValue([makeInvoice({ pdfPath })]);
    prisma.externalInvoice.findMany.mockResolvedValue([makeExternal()]);
    const service = new MonthlyInvoiceArchiveService(prisma as never);

    const result = await service.createMonthlyArchive({ year: 2026, month: 5 });
    const manifest = JSON.parse(await fs.readFile(path.join(tempDir, "monthly-archives", "2026", "05", "manifest.json"), "utf8"));
    const archive = await fs.stat(result.archivePath);

    expect(result.invoiceCount).toBe(1);
    expect(result.missingPdfCount).toBe(0);
    expect(result.missingXmlCount).toBe(1);
    expect(result.draftXmlAvailableCount).toBe(1);
    expect(archive.size).toBeGreaterThan(100);
    expect(manifest.entries[0]).toMatchObject({
      pdfIncluded: true,
      xmlIncluded: false,
      xmlMissing: true,
      draftXmlAvailable: true
    });
  });
});
