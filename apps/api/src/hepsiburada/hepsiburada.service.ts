import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { DraftStatus, Prisma } from "@prisma/client";
import axios from "axios";
import FormData from "form-data";
import { createHash } from "node:crypto";
import { toCents } from "../common/money";
import { buildDraft } from "../orders/invoice-draft-builder";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import {
  buildHepsiburadaCatalogPayload,
  buildHepsiburadaListingPayload,
  extractHepsiburadaJobId,
  extractHepsiburadaTrackingId,
  hepsiburadaLineItemId,
  hepsiburadaLineOrderNumber,
  normalizeHepsiburadaError,
  normalizeHepsiburadaOrderLine,
  type HepsiburadaListingUploadKind
} from "./hepsiburada-normalizer";
import { createPublicInvoiceToken, hashPublicInvoiceToken, publicInvoiceUrl } from "../invoice/public-invoice-token";

type RawRecord = Record<string, unknown>;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function nowIso() {
  return new Date().toISOString();
}

function itemsFromResponse(data: unknown): RawRecord[] {
  if (Array.isArray(data)) return data.filter((item): item is RawRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as RawRecord;
  const candidates = [record.items, record.Items, record.lineItems, record.LineItems, record.content];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is RawRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    }
  }
  return [];
}

function packageNumberFromResponse(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as RawRecord;
  const candidate = record.packageNumber ?? record.PackageNumber ?? record.packagenumber ?? record.id;
  return typeof candidate === "string" || typeof candidate === "number" ? String(candidate).trim() || undefined : undefined;
}

function stripHepsiburadaPackagePrefix(value?: string | null) {
  if (!value) return undefined;
  return value.startsWith("HB-") ? value.slice(3) : value;
}

function hasInvoiceProviderPackageId(invoice: any) {
  return stripHepsiburadaPackagePrefix(invoice?.draft?.order?.shipmentPackageId);
}

@Injectable()
export class HepsiburadaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  async listProducts() {
    const products = await (this.prisma as any).product.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: {
        marketplaceListings: {
          where: { provider: "HEPSIBURADA" }
        }
      },
      take: 1000
    });

    return products.map((product: any) => this.mapProduct(product));
  }

  async createProduct(input: RawRecord) {
    const data = this.normalizeProductInput(input);
    const product = await (this.prisma as any).product.create({
      data: {
        name: data.name,
        barcode: data.barcode,
        merchantSku: data.merchantSku,
        brand: data.brand,
        categoryName: data.categoryName,
        vatRate: data.vatRate,
        priceCents: data.priceCents,
        stock: data.stock,
        dispatchTime: data.dispatchTime,
        description: data.description,
        active: data.active
      }
    });

    const listing = await (this.prisma as any).marketplaceListing.create({
      data: {
        provider: "HEPSIBURADA",
        productId: product.id,
        hbSku: data.hbSku,
        merchantSku: data.merchantSku,
        priceCents: data.priceCents,
        stock: data.stock,
        dispatchTime: data.dispatchTime
      }
    });

    return this.mapProduct({ ...product, marketplaceListings: [listing] });
  }

  async updateProduct(id: string, input: RawRecord) {
    const existing = await (this.prisma as any).product.findUnique({
      where: { id },
      include: { marketplaceListings: { where: { provider: "HEPSIBURADA" } } }
    });
    if (!existing) throw new NotFoundException("Urun bulunamadi.");

    const data = this.normalizeProductInput({ ...existing, ...(existing.marketplaceListings?.[0] ?? {}), ...input }, true);
    const product = await (this.prisma as any).product.update({
      where: { id },
      data: {
        name: data.name,
        barcode: data.barcode,
        merchantSku: data.merchantSku,
        brand: data.brand,
        categoryName: data.categoryName,
        vatRate: data.vatRate,
        priceCents: data.priceCents,
        stock: data.stock,
        dispatchTime: data.dispatchTime,
        description: data.description,
        active: data.active
      }
    });

    const existingListing = existing.marketplaceListings?.[0];
    const listing = existingListing
      ? await (this.prisma as any).marketplaceListing.update({
          where: { id: existingListing.id },
          data: {
            hbSku: data.hbSku,
            merchantSku: data.merchantSku,
            priceCents: data.priceCents,
            stock: data.stock,
            dispatchTime: data.dispatchTime
          }
        })
      : await (this.prisma as any).marketplaceListing.create({
          data: {
            provider: "HEPSIBURADA",
            productId: product.id,
            hbSku: data.hbSku,
            merchantSku: data.merchantSku,
            priceCents: data.priceCents,
            stock: data.stock,
            dispatchTime: data.dispatchTime
          }
        });

    return this.mapProduct({ ...product, marketplaceListings: [listing] });
  }

  async uploadCatalog() {
    const connection = await this.requiredConnection();
    const products = await (this.prisma as any).product.findMany({
      where: { active: true },
      include: { marketplaceListings: { where: { provider: "HEPSIBURADA" } } },
      take: 4000
    });
    if (products.length === 0) throw new BadRequestException("Hepsiburada katalog gonderimi icin aktif urun yok.");

    const payload = buildHepsiburadaCatalogPayload(products.map((product: any) => this.productToCatalogSource(product)));
    const form = new FormData();
    form.append("file", payload.buffer, {
      filename: payload.fileName,
      contentType: "application/json"
    });

    const response = await this.post(connection.productBaseUrl, "/product/api/products/import", form, {
      params: { version: 1 },
      headers: form.getHeaders()
    });
    const trackingId = extractHepsiburadaTrackingId(response.data);
    if (!trackingId) throw new ServiceUnavailableException("Hepsiburada katalog cevabinda trackingId bulunamadi.");

    await Promise.all(
      products.flatMap((product: any) =>
        (product.marketplaceListings ?? []).map((listing: any) =>
          (this.prisma as any).marketplaceListing.update({
            where: { id: listing.id },
            data: {
              lastStatus: "CATALOG_UPLOADED",
              lastTrackingId: trackingId,
              lastUploadedAt: new Date(),
              raw: json({ response: response.data })
            }
          })
        )
      )
    );

    await this.audit("hepsiburada.catalog.upload", `${products.length} urun Hepsiburada katalog import servisine gonderildi. TrackingId: ${trackingId}`, {
      trackingId,
      productCount: products.length
    });

    return {
      productCount: products.length,
      trackingId,
      response: response.data
    };
  }

  async catalogStatus(trackingId: string) {
    const connection = await this.requiredConnection();
    const response = await this.get(connection.productBaseUrl, `/product/api/products/status/${encodeURIComponent(trackingId)}`, {
      params: { version: 1, page: 0, size: 1000 }
    });

    await (this.prisma as any).integrationJob.create({
      data: {
        type: "hepsiburada.catalog.status",
        target: trackingId,
        status: "SUCCESS",
        response: json(response.data)
      }
    });

    return {
      trackingId,
      response: response.data
    };
  }

  async syncInventory() {
    const connection = await this.requiredConnection();
    const response = await this.post(connection.supplierBaseUrl, `/suppliers/${connection.merchantId}/supplierlistings/search`, {});
    const listings = itemsFromResponse(response.data);
    let upserted = 0;

    for (const item of listings) {
      const merchantSku = String(item.MerchantSku ?? item.merchantSku ?? item.merchantSKU ?? "").trim();
      if (!merchantSku) continue;
      const product =
        (await (this.prisma as any).product.findUnique({ where: { merchantSku } })) ??
        (await (this.prisma as any).product.create({
          data: {
            name: String(item.ProductName ?? item.productName ?? merchantSku),
            barcode: String(item.Barcode ?? item.barcode ?? "").trim() || undefined,
            merchantSku,
            brand: String(item.Brand ?? item.brand ?? "Hepsiburada"),
            categoryName: String(item.CategoryName ?? item.categoryName ?? "Hepsiburada Envanter"),
            vatRate: Number(item.VatRate ?? item.vatRate ?? 20),
            priceCents: toCents(item.Price ?? item.price ?? 0),
            stock: Number(item.AvailableStock ?? item.availableStock ?? 0),
            dispatchTime: Number(item.DispatchTime ?? item.dispatchTime ?? 2),
            active: true
          }
        }));
      await (this.prisma as any).marketplaceListing.upsert({
        where: { provider_merchantSku: { provider: "HEPSIBURADA", merchantSku } },
        update: {
          hbSku: String(item.HepsiburadaSku ?? item.hepsiburadaSku ?? item.hbSku ?? "").trim() || undefined,
          priceCents: item.Price ? toCents(item.Price) : undefined,
          stock: Number(item.AvailableStock ?? item.availableStock ?? 0),
          lastStatus: "INVENTORY_SYNCED",
          raw: json(item)
        },
        create: {
          provider: "HEPSIBURADA",
          productId: product.id,
          hbSku: String(item.HepsiburadaSku ?? item.hepsiburadaSku ?? item.hbSku ?? "").trim() || undefined,
          merchantSku,
          priceCents: item.Price ? toCents(item.Price) : product.priceCents,
          stock: Number(item.AvailableStock ?? item.availableStock ?? 0),
          dispatchTime: Number(item.DispatchTime ?? item.dispatchTime ?? 2),
          lastStatus: "INVENTORY_SYNCED",
          raw: json(item)
        }
      });
      upserted += 1;
    }

    return { imported: listings.length, upserted, response: response.data };
  }

  async uploadListingPrices() {
    return this.uploadListings("price");
  }

  async uploadListingStocks() {
    return this.uploadListings("stock");
  }

  async syncOrders() {
    const connection = await this.requiredConnection();
    const end = new Date();
    const start = new Date(Date.now() - connection.lookbackDays * 24 * 60 * 60 * 1000);
    const response = await this.get(connection.orderBaseUrl, `/orders/merchantid/${connection.merchantId}`, {
      params: {
        limit: "50",
        offset: "0",
        begindate: start.toISOString(),
        enddate: end.toISOString()
      }
    });
    const lines = itemsFromResponse(response.data);
    let imported = 0;

    for (const line of lines) {
      const lineItemId = hepsiburadaLineItemId(line);
      const orderNumber = hepsiburadaLineOrderNumber(line);
      if (!lineItemId || !orderNumber) continue;
      await (this.prisma as any).hepsiburadaOrderLine.upsert({
        where: { lineItemId },
        update: {
          orderNumber,
          hbSku: String(line.sku ?? line.hbSku ?? ""),
          merchantSku: String(line.merchantSku ?? ""),
          quantity: Number(line.quantity ?? 1),
          raw: json(line),
          packageStatus: String(line.status ?? "OPEN")
        },
        create: {
          lineItemId,
          orderNumber,
          hbSku: String(line.sku ?? line.hbSku ?? ""),
          merchantSku: String(line.merchantSku ?? ""),
          quantity: Number(line.quantity ?? 1),
          raw: json(line),
          packageStatus: String(line.status ?? "OPEN")
        }
      });
      imported += 1;
    }

    await this.audit("hepsiburada.orders.sync", `${imported} Hepsiburada siparis kalemi senkronize edildi.`, { imported });
    return { imported, response: response.data };
  }

  async listOrderLines() {
    const lines = await (this.prisma as any).hepsiburadaOrderLine.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 500
    });
    return lines.map((line: any) => {
      const raw = line.raw && typeof line.raw === "object" ? (line.raw as RawRecord) : {};
      const totalPrice = raw.totalPrice && typeof raw.totalPrice === "object" ? (raw.totalPrice as RawRecord) : {};
      return {
        id: line.id,
        lineItemId: line.lineItemId,
        orderNumber: line.orderNumber,
        hbSku: line.hbSku,
        merchantSku: line.merchantSku ?? undefined,
        quantity: line.quantity,
        packageNumber: line.packageNumber ?? undefined,
        packageStatus: line.packageStatus,
        linkedOrderId: line.linkedOrderId ?? undefined,
        customerName: typeof raw.customerName === "string" ? raw.customerName : undefined,
        totalPayableCents: totalPrice.amount ? toCents(totalPrice.amount) : undefined,
        currency: typeof totalPrice.currency === "string" ? totalPrice.currency : "TRY",
        createdAt: line.createdAt?.toISOString?.() ?? nowIso(),
        updatedAt: line.updatedAt?.toISOString?.() ?? nowIso()
      };
    });
  }

  async createTestOrder(input: RawRecord = {}) {
    const connection = await this.requiredConnection();
    if (connection.environment !== "test") {
      throw new BadRequestException("Hepsiburada test siparisi yalnizca test ortaminda olusturulabilir.");
    }

    const orderNumber = String(input.orderNumber ?? `SAFA-HB-TEST-${Date.now()}`);
    const response = await this.post(connection.orderBaseUrl, `/orders/merchantid/${connection.merchantId}`, {
      OrderNumber: orderNumber,
      OrderDate: new Date().toISOString(),
      Customer: {
        CustomerId: String(input.customerId ?? "safa-test-customer"),
        Name: String(input.customerName ?? "SAFA Test Musteri")
      },
      DeliveryAddress: {
        AddressId: String(input.addressId ?? "safa-test-address"),
        Name: String(input.customerName ?? "SAFA Test Musteri"),
        AddressDetail: String(input.address ?? "SAFA test adresi"),
        Email: String(input.email ?? "test@safa.local"),
        CountryCode: "TR",
        PhoneNumber: String(input.phoneNumber ?? "05000000000"),
        Town: String(input.town ?? "Kadikoy"),
        District: String(input.district ?? "Merkez"),
        City: String(input.city ?? "Istanbul")
      },
      LineItems: Array.isArray(input.lineItems) ? input.lineItems : []
    });

    await this.audit("hepsiburada.test-order.create", `${orderNumber} test siparisi Hepsiburada test ortaminda olusturuldu.`, {
      orderNumber,
      response: response.data
    });

    return { orderNumber, response: response.data };
  }

  async packageOrderLine(id: string) {
    const connection = await this.requiredConnection();
    const line = await (this.prisma as any).hepsiburadaOrderLine.findUnique({ where: { id } });
    if (!line) throw new NotFoundException("Hepsiburada siparis kalemi bulunamadi.");
    if (line.packageNumber) throw new BadRequestException("Bu Hepsiburada kalemi zaten paketlenmis.");

    const raw = line.raw as RawRecord;
    const lineItemId = String(line.lineItemId);
    const packageable = await this.packageableLineItems(connection.orderBaseUrl, connection.merchantId, lineItemId);
    const lineItemRequests = this.packageLineItemRequests(lineItemId, line.quantity, packageable);
    const response = await this.post(connection.orderBaseUrl, `/packages/merchantid/${connection.merchantId}`, {
      cargoCompany: String((raw.cargoCompanyModel as RawRecord | undefined)?.shortName ?? raw.cargoCompany ?? "Yurtiçi Kargo"),
      lineItemRequests,
      parcelQuantity: 1
    });
    const packageNumber = packageNumberFromResponse(response.data);
    if (!packageNumber) throw new ServiceUnavailableException("Hepsiburada paketleme cevabinda packageNumber bulunamadi.");

    const normalized = normalizeHepsiburadaOrderLine(raw, packageNumber);
    const order = await (this.prisma as any).order.upsert({
      where: { shipmentPackageId: normalized.shipmentPackageId },
      update: {
        source: "HEPSIBURADA",
        orderNumber: normalized.orderNumber,
        status: normalized.status,
        customerName: normalized.customerName,
        customerEmail: normalized.customerEmail,
        customerIdentifier: normalized.customerIdentifier,
        invoiceAddress: json(normalized.invoiceAddress),
        raw: json(normalized.raw),
        totalGrossCents: normalized.totalGrossCents,
        totalDiscountCents: normalized.totalDiscountCents,
        totalPayableCents: normalized.totalPayableCents,
        currency: normalized.currency,
        lastModifiedAt: normalized.lastModifiedAt
      },
      create: {
        source: "HEPSIBURADA",
        shipmentPackageId: normalized.shipmentPackageId,
        orderNumber: normalized.orderNumber,
        status: normalized.status,
        customerName: normalized.customerName,
        customerEmail: normalized.customerEmail,
        customerIdentifier: normalized.customerIdentifier,
        invoiceAddress: json(normalized.invoiceAddress),
        raw: json(normalized.raw),
        totalGrossCents: normalized.totalGrossCents,
        totalDiscountCents: normalized.totalDiscountCents,
        totalPayableCents: normalized.totalPayableCents,
        currency: normalized.currency,
        lastModifiedAt: normalized.lastModifiedAt
      }
    });

    const draft = buildDraft(normalized);
    const existingDraft = await (this.prisma as any).invoiceDraft.findUnique({ where: { orderId: order.id }, include: { invoice: true } });
    if (!existingDraft) {
      await (this.prisma as any).invoiceDraft.create({
        data: {
          orderId: order.id,
          status: draft.status === "READY" ? DraftStatus.READY : DraftStatus.NEEDS_REVIEW,
          validation: json(draft.validation),
          lines: json(draft.lines),
          totals: json(draft.totals)
        }
      });
    }

    const updated = await (this.prisma as any).hepsiburadaOrderLine.update({
      where: { id },
      data: {
        packageNumber,
        packageStatus: "PACKAGED",
        linkedOrderId: order.id,
        raw: json({ ...raw, packageResponse: response.data })
      }
    });

    await this.audit("hepsiburada.order-line.package", `${line.orderNumber} siparis kalemi paketlendi. Paket: ${packageNumber}`, {
      lineItemId,
      orderNumber: line.orderNumber,
      packageNumber,
      linkedOrderId: order.id
    });

    return { ...updated, packageNumber, linkedOrderId: order.id };
  }

  async sendInvoiceLink(invoiceId: string, options: { packageNumber?: string } = {}) {
    const connection = await this.requiredConnection();
    const invoice = await (this.prisma as any).invoice.findUnique({
      where: { id: invoiceId },
      include: { draft: { include: { order: true } } }
    });
    if (!invoice) throw new NotFoundException("Fatura bulunamadi.");
    if (!invoice.pdfPath) throw new BadRequestException("Hepsiburada fatura linki icin resmi PDF dosyasi gerekli.");

    const packageNumber = options.packageNumber ?? hasInvoiceProviderPackageId(invoice);
    if (!packageNumber) throw new BadRequestException("Hepsiburada packageNumber bulunamadi.");

    const token = createPublicInvoiceToken();
    const tokenHash = hashPublicInvoiceToken(token);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await (this.prisma as any).publicInvoiceToken.create({
      data: {
        tokenHash,
        invoiceId: invoice.id,
        provider: "HEPSIBURADA",
        packageNumber,
        expiresAt
      }
    });

    const response = await this.put(connection.orderBaseUrl, `/packages/merchantid/${connection.merchantId}/packagenumber/${packageNumber}/invoice`, {
      arrangementDate: invoice.invoiceDate.toISOString(),
      invoiceLink: publicInvoiceUrl(token),
      invoices: [
        {
          rowNumber: "1",
          serialNumber: invoice.invoiceNumber
        }
      ]
    });

    await (this.prisma as any).invoice.update({
      where: { id: invoice.id },
      data: {
        error: null
      }
    });

    await this.audit("hepsiburada.invoice-link.send", `${invoice.invoiceNumber} faturasi Hepsiburada paketine link olarak gonderildi.`, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      packageNumber,
      responseStatus: response.status
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      packageNumber,
      invoiceLink: publicInvoiceUrl(token),
      sent: true
    };
  }

  private async uploadListings(kind: HepsiburadaListingUploadKind) {
    const connection = await this.requiredConnection();
    const listings = await (this.prisma as any).marketplaceListing.findMany({
      where: { provider: "HEPSIBURADA" },
      include: { product: true },
      take: 4000
    });
    if (listings.length === 0) throw new BadRequestException("Hepsiburada listing gonderimi icin kayit yok.");

    const payload = buildHepsiburadaListingPayload(
      listings.map((listing: any) => ({
        hbSku: listing.hbSku,
        merchantSku: listing.merchantSku,
        productName: listing.product?.name ?? listing.merchantSku,
        priceCents: listing.priceCents,
        stock: listing.stock,
        dispatchTime: listing.dispatchTime
      })),
      kind
    );

    const path = `/listings/merchantid/${connection.merchantId}/${kind === "price" ? "price-uploads" : "stock-uploads"}`;
    const response = await this.post(connection.listingBaseUrl, path, payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json-patch+json"
      }
    });
    const uploadId = extractHepsiburadaJobId(response.data);

    await Promise.all(
      listings.map((listing: any) =>
        (this.prisma as any).marketplaceListing.update({
          where: { id: listing.id },
          data: {
            lastStatus: kind === "price" ? "PRICE_UPLOADED" : "STOCK_UPLOADED",
            lastJobId: uploadId,
            lastUploadedAt: new Date(),
            raw: json({ response: response.data })
          }
        })
      )
    );

    await (this.prisma as any).integrationJob.create({
      data: {
        type: `hepsiburada.listing.${kind}`,
        target: connection.merchantId,
        status: "SUCCESS",
        response: json({ uploadId, response: response.data, listingCount: listings.length })
      }
    });

    return {
      uploadId,
      listingCount: listings.length,
      response: response.data
    };
  }

  private async requiredConnection() {
    const connection = await this.settings.getHepsiburadaConnection();
    if (!connection) throw new BadRequestException("Hepsiburada baglanti bilgileri kayitli degil.");
    return connection;
  }

  private async get(baseUrl: string, path: string, options: Record<string, unknown> = {}) {
    const connection = await this.requiredConnection();
    const response = await axios.get(`${baseUrl}${path}`, this.requestConfig(connection, options));
    return this.ensureOk(response.status, response.data);
  }

  private async post(baseUrl: string, path: string, body: unknown, options: Record<string, unknown> = {}) {
    const connection = await this.requiredConnection();
    const response = await axios.post(`${baseUrl}${path}`, body, this.requestConfig(connection, options));
    return this.ensureOk(response.status, response.data);
  }

  private async put(baseUrl: string, path: string, body: unknown, options: Record<string, unknown> = {}) {
    const connection = await this.requiredConnection();
    const response = await axios.put(`${baseUrl}${path}`, body, this.requestConfig(connection, options));
    return this.ensureOk(response.status, response.data);
  }

  private requestConfig(connection: Awaited<ReturnType<SettingsService["getHepsiburadaConnection"]>>, options: Record<string, any>) {
    if (!connection) throw new BadRequestException("Hepsiburada baglanti bilgileri kayitli degil.");
    return {
      auth: { username: connection.username, password: connection.password },
      headers: {
        "User-Agent": connection.userAgent,
        ...(options.headers ?? {})
      },
      params: options.params,
      timeout: 30_000,
      validateStatus: () => true
    };
  }

  private ensureOk(status: number, data: unknown) {
    if (status >= 200 && status < 300) return { status, data };
    const message = normalizeHepsiburadaError(status, data);
    if (status === 400) throw new BadRequestException(message);
    if (status === 401 || status === 403) throw new BadRequestException(message);
    if (status === 404) throw new NotFoundException(message);
    throw new ServiceUnavailableException(message);
  }

  private async packageableLineItems(orderBaseUrl: string, merchantId: string, lineItemId: string) {
    try {
      const response = await this.get(orderBaseUrl, `/lineitems/merchantid/${merchantId}/packageablewith/lineitemid/${lineItemId}`);
      return itemsFromResponse(response.data);
    } catch (error) {
      if (error instanceof NotFoundException) return [];
      throw error;
    }
  }

  private packageLineItemRequests(lineItemId: string, quantity: number, packageable: RawRecord[]) {
    const requests = new Map<string, { id: string; quantity: number }>();
    requests.set(lineItemId, { id: lineItemId, quantity: Number(quantity || 1) });
    for (const item of packageable) {
      const id = String(item.lineItemId ?? item.id ?? "").trim();
      if (!id || requests.has(id)) continue;
      requests.set(id, { id, quantity: Number(item.quantity ?? 1) });
    }
    return Array.from(requests.values());
  }

  private productToCatalogSource(product: any) {
    const listing = product.marketplaceListings?.[0];
    return {
      name: product.name,
      barcode: product.barcode,
      merchantSku: listing?.merchantSku ?? product.merchantSku,
      brand: product.brand,
      categoryName: product.categoryName,
      vatRate: product.vatRate,
      priceCents: listing?.priceCents ?? product.priceCents,
      stock: listing?.stock ?? product.stock,
      dispatchTime: listing?.dispatchTime ?? product.dispatchTime,
      description: product.description
    };
  }

  private normalizeProductInput(input: RawRecord, partial = false) {
    const value = (key: string, fallback?: unknown) => input[key] ?? fallback;
    const name = String(value("name", "")).trim();
    const merchantSku = String(value("merchantSku", "")).trim();
    const brand = String(value("brand", "")).trim();
    const categoryName = String(value("categoryName", "")).trim();
    const priceCents = Number(value("priceCents", 0));
    const stock = Number(value("stock", 0));
    const dispatchTime = Number(value("dispatchTime", 2));
    const vatRate = Number(value("vatRate", 20));

    if (!partial && (!name || !merchantSku || !brand || !categoryName)) {
      throw new BadRequestException("Urun adi, merchantSku, marka ve kategori zorunlu.");
    }
    if (!Number.isFinite(priceCents) || priceCents < 0) throw new BadRequestException("Urun fiyati gecersiz.");
    if (!Number.isFinite(stock) || stock < 0) throw new BadRequestException("Urun stogu gecersiz.");

    return {
      name,
      barcode: String(value("barcode", "")).trim() || undefined,
      hbSku: String(value("hbSku", "")).trim() || undefined,
      merchantSku,
      brand,
      categoryName,
      vatRate,
      priceCents: Math.round(priceCents),
      stock: Math.trunc(stock),
      dispatchTime: Math.max(1, Math.trunc(dispatchTime || 2)),
      description: String(value("description", "")).trim() || undefined,
      active: Boolean(value("active", true))
    };
  }

  private mapProduct(product: any) {
    const listing = product.marketplaceListings?.[0];
    return {
      id: product.id,
      name: product.name,
      barcode: product.barcode ?? undefined,
      merchantSku: product.merchantSku,
      brand: product.brand,
      categoryName: product.categoryName,
      vatRate: product.vatRate,
      priceCents: product.priceCents,
      stock: product.stock,
      dispatchTime: product.dispatchTime,
      description: product.description ?? undefined,
      active: product.active,
      updatedAt: product.updatedAt?.toISOString?.() ?? nowIso(),
      hepsiburada: listing
        ? {
            id: listing.id,
            hbSku: listing.hbSku ?? undefined,
            merchantSku: listing.merchantSku,
            priceCents: listing.priceCents,
            stock: listing.stock,
            dispatchTime: listing.dispatchTime,
            lastStatus: listing.lastStatus ?? undefined,
            lastTrackingId: listing.lastTrackingId ?? undefined,
            lastJobId: listing.lastJobId ?? undefined,
            lastUploadedAt: listing.lastUploadedAt?.toISOString?.()
          }
        : null
    };
  }

  private async audit(action: string, message: string, metadata: RawRecord) {
    await (this.prisma as any).auditLog.create({
      data: {
        action,
        subjectType: "hepsiburada",
        subjectId: createHash("sha1").update(action + JSON.stringify(metadata)).digest("hex").slice(0, 16),
        message,
        metadata: json(metadata)
      }
    });
  }
}
