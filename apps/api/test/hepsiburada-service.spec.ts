import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HepsiburadaService } from "../src/hepsiburada/hepsiburada.service";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn()
  }
}));

const get = vi.mocked(axios.get);
const post = vi.mocked(axios.post);
const put = vi.mocked(axios.put);

function connection() {
  return {
    merchantId: "merchant-1",
    username: "user",
    password: "pass",
    userAgent: "SAFA HB Test",
    environment: "test" as const,
    productBaseUrl: "https://mpop-sit.hepsiburada.com",
    listingBaseUrl: "https://listing-external-sit.hepsiburada.com",
    orderBaseUrl: "https://oms-external-sit.hepsiburada.com",
    supplierBaseUrl: "https://supplier-api-external-sit.hepsiburada.com",
    lookbackDays: 7
  };
}

function makePrisma() {
  const product = {
    id: "product-1",
    name: "SAFA Test Urun",
    barcode: "8680000000011",
    merchantSku: "SAFA-HB-1",
    brand: "SAFA",
    categoryName: "Online Lisanslar",
    vatRate: 20,
    priceCents: 19990,
    stock: 7,
    dispatchTime: 2,
    description: "Test katalog urunu",
    active: true,
    marketplaceListings: [
      {
        id: "listing-1",
        productId: "product-1",
        provider: "HEPSIBURADA",
        hbSku: "HBV000TEST",
        merchantSku: "SAFA-HB-1",
        priceCents: 19990,
        stock: 7,
        dispatchTime: 2
      }
    ]
  };

  return {
    product: {
      findMany: vi.fn(async () => [product])
    },
    marketplaceListing: {
      findMany: vi.fn(async () => product.marketplaceListings.map((listing) => ({ ...listing, product }))),
      update: vi.fn(async (args) => ({ ...product.marketplaceListings[0], ...args.data }))
    },
    hepsiburadaOrderLine: {
      upsert: vi.fn(async ({ create, update }) => ({ id: "hb-line-1", ...create, ...update })),
      findUnique: vi.fn(async () => ({
        id: "hb-line-1",
        lineItemId: "line-1",
        orderNumber: "HB-1001",
        hbSku: "HBV000TEST",
        merchantSku: "SAFA-HB-1",
        quantity: 2,
        raw: {
          id: "line-1",
          sku: "HBV000TEST",
          merchantSku: "SAFA-HB-1",
          name: "SAFA Test Urun",
          orderNumber: "HB-1001",
          customerName: "Sarper Test",
          quantity: 2,
          unitPrice: { amount: 100, currency: "TRY" },
          totalPrice: { amount: 200, currency: "TRY" },
          vatRate: 20,
          invoice: { turkishIdentityNumber: "12345678901", address: { address: "Adres", town: "Kadikoy", city: "Istanbul" } }
        },
        packageNumber: null,
        packageStatus: "OPEN",
        linkedOrderId: null
      })),
      update: vi.fn(async (args) => ({ id: args.where.id, ...args.data }))
    },
    order: {
      upsert: vi.fn(async ({ create }) => ({ id: "order-1", ...create }))
    },
    invoiceDraft: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: "draft-1", ...data }))
    },
    invoice: {
      findUnique: vi.fn(async () => ({
        id: "invoice-1",
        invoiceNumber: "SAF202600001",
        invoiceDate: new Date("2026-05-20T10:00:00.000Z"),
        pdfPath: "/tmp/SAF202600001.pdf",
        draft: {
          order: {
            shipmentPackageId: "HB-PKG-1001"
          }
        }
      })),
      update: vi.fn(async (args) => ({ id: args.where.id, ...args.data }))
    },
    publicInvoiceToken: {
      create: vi.fn(async ({ data }) => ({ id: "token-1", ...data }))
    },
    integrationJob: {
      create: vi.fn(async ({ data }) => ({ id: "job-db-1", ...data }))
    },
    auditLog: {
      create: vi.fn(async ({ data }) => ({ id: "audit-1", ...data }))
    }
  };
}

function serviceWith() {
  const prisma = makePrisma();
  const settings = { getHepsiburadaConnection: vi.fn(async () => connection()) };
  return {
    service: new HepsiburadaService(prisma as any, settings as any),
    prisma,
    settings
  };
}

describe("HepsiburadaService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_API_BASE_URL = "https://safa.example.com/api";
  });

  it("uploads active products as a catalog file and stores the returned trackingId", async () => {
    post.mockResolvedValueOnce({ status: 200, data: { trackingId: "track-1" } });
    const { service, prisma } = serviceWith();

    const result = await service.uploadCatalog();

    expect(post).toHaveBeenCalledWith(
      "https://mpop-sit.hepsiburada.com/product/api/products/import",
      expect.anything(),
      expect.objectContaining({
        auth: { username: "user", password: "pass" },
        headers: expect.objectContaining({ "User-Agent": "SAFA HB Test" }),
        params: { version: 1 },
        timeout: 30000
      })
    );
    expect(prisma.marketplaceListing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "listing-1" },
        data: expect.objectContaining({ lastTrackingId: "track-1", lastStatus: "CATALOG_UPLOADED" })
      })
    );
    expect(result).toMatchObject({ productCount: 1, trackingId: "track-1" });
  });

  it("sends price and stock upload payloads to listing endpoints", async () => {
    post.mockResolvedValueOnce({ status: 200, data: { id: "price-job" } });
    post.mockResolvedValueOnce({ status: 200, data: { id: "stock-job" } });
    const { service } = serviceWith();

    const price = await service.uploadListingPrices();
    const stock = await service.uploadListingStocks();

    expect(post.mock.calls[0]?.[0]).toBe("https://listing-external-sit.hepsiburada.com/listings/merchantid/merchant-1/price-uploads");
    expect(post.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ HepsiburadaSku: "HBV000TEST", MerchantSku: "SAFA-HB-1", Price: 199.9 })
    ]);
    expect(post.mock.calls[1]?.[0]).toBe("https://listing-external-sit.hepsiburada.com/listings/merchantid/merchant-1/stock-uploads");
    expect(post.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({ HepsiburadaSku: "HBV000TEST", MerchantSku: "SAFA-HB-1", AvailableStock: 7 })
    ]);
    expect(price).toMatchObject({ uploadId: "price-job", listingCount: 1 });
    expect(stock).toMatchObject({ uploadId: "stock-job", listingCount: 1 });
  });

  it("syncs paid order lines and packages an operator-approved line into the invoice flow", async () => {
    get.mockResolvedValueOnce({
      status: 200,
      data: {
        items: [
          {
            id: "line-1",
            sku: "HBV000TEST",
            merchantSku: "SAFA-HB-1",
            orderNumber: "HB-1001",
            customerName: "Sarper Test",
            quantity: 2,
            unitPrice: { amount: 100, currency: "TRY" },
            totalPrice: { amount: 200, currency: "TRY" },
            vatRate: 20,
            canCreatePackage: true,
            invoice: { turkishIdentityNumber: "12345678901", address: { address: "Adres", town: "Kadikoy", city: "Istanbul" } }
          }
        ]
      }
    });
    get.mockResolvedValueOnce({ status: 404, data: { message: "no packageable pair" } });
    post.mockResolvedValueOnce({ status: 201, data: { packageNumber: "PKG-1001" } });
    const { service, prisma } = serviceWith();

    const sync = await service.syncOrders();
    const packaged = await service.packageOrderLine("hb-line-1");

    expect(sync).toMatchObject({ imported: 1 });
    expect(get.mock.calls[0]?.[0]).toBe("https://oms-external-sit.hepsiburada.com/orders/merchantid/merchant-1");
    expect(post).toHaveBeenCalledWith(
      "https://oms-external-sit.hepsiburada.com/packages/merchantid/merchant-1",
      expect.objectContaining({ lineItemRequests: [{ id: "line-1", quantity: 2 }] }),
      expect.anything()
    );
    expect(prisma.order.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { shipmentPackageId: "HB-PKG-1001" } }));
    expect(prisma.invoiceDraft.create).toHaveBeenCalled();
    expect(packaged).toMatchObject({ packageNumber: "PKG-1001", linkedOrderId: "order-1" });
  });

  it("sends a short-lived public invoice PDF link to the Hepsiburada package invoice endpoint", async () => {
    put.mockResolvedValueOnce({ status: 204, data: null });
    const { service, prisma } = serviceWith();

    const result = await service.sendInvoiceLink("invoice-1", { packageNumber: "PKG-1001" });

    expect(put).toHaveBeenCalledWith(
      "https://oms-external-sit.hepsiburada.com/packages/merchantid/merchant-1/packagenumber/PKG-1001/invoice",
      expect.objectContaining({
        invoiceLink: expect.stringMatching(/^https:\/\/safa\.example\.com\/api\/public\/invoices\/.+\.pdf$/),
        invoices: [{ rowNumber: "1", serialNumber: "SAF202600001" }]
      }),
      expect.anything()
    );
    expect(prisma.publicInvoiceToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceId: "invoice-1", provider: "HEPSIBURADA" }) })
    );
    expect(result).toMatchObject({ packageNumber: "PKG-1001", sent: true });
  });
});
