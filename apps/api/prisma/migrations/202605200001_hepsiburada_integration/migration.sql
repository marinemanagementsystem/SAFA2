CREATE TYPE "MarketplaceProvider" AS ENUM ('HEPSIBURADA');
CREATE TYPE "OrderSource" AS ENUM ('TRENDYOL', 'HEPSIBURADA');

ALTER TABLE "Order"
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'TRENDYOL';

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "barcode" TEXT,
  "merchantSku" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "categoryName" TEXT NOT NULL,
  "vatRate" INTEGER NOT NULL DEFAULT 20,
  "priceCents" INTEGER NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "dispatchTime" INTEGER NOT NULL DEFAULT 2,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceListing" (
  "id" TEXT NOT NULL,
  "provider" "MarketplaceProvider" NOT NULL,
  "productId" TEXT NOT NULL,
  "hbSku" TEXT,
  "merchantSku" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "dispatchTime" INTEGER NOT NULL DEFAULT 2,
  "lastStatus" TEXT,
  "lastUploadedAt" TIMESTAMP(3),
  "lastTrackingId" TEXT,
  "lastJobId" TEXT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HepsiburadaOrderLine" (
  "id" TEXT NOT NULL,
  "lineItemId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "hbSku" TEXT NOT NULL,
  "merchantSku" TEXT,
  "quantity" INTEGER NOT NULL,
  "raw" JSONB NOT NULL,
  "packageNumber" TEXT,
  "packageStatus" TEXT NOT NULL DEFAULT 'OPEN',
  "linkedOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HepsiburadaOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicInvoiceToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "packageNumber" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicInvoiceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE UNIQUE INDEX "Product_merchantSku_key" ON "Product"("merchantSku");
CREATE INDEX "Product_active_idx" ON "Product"("active");
CREATE INDEX "Product_merchantSku_idx" ON "Product"("merchantSku");

CREATE UNIQUE INDEX "MarketplaceListing_provider_merchantSku_key" ON "MarketplaceListing"("provider", "merchantSku");
CREATE INDEX "MarketplaceListing_hbSku_idx" ON "MarketplaceListing"("hbSku");
CREATE INDEX "MarketplaceListing_lastTrackingId_idx" ON "MarketplaceListing"("lastTrackingId");

CREATE UNIQUE INDEX "HepsiburadaOrderLine_lineItemId_key" ON "HepsiburadaOrderLine"("lineItemId");
CREATE INDEX "HepsiburadaOrderLine_orderNumber_idx" ON "HepsiburadaOrderLine"("orderNumber");
CREATE INDEX "HepsiburadaOrderLine_hbSku_idx" ON "HepsiburadaOrderLine"("hbSku");
CREATE INDEX "HepsiburadaOrderLine_merchantSku_idx" ON "HepsiburadaOrderLine"("merchantSku");
CREATE INDEX "HepsiburadaOrderLine_packageNumber_idx" ON "HepsiburadaOrderLine"("packageNumber");
CREATE INDEX "HepsiburadaOrderLine_packageStatus_idx" ON "HepsiburadaOrderLine"("packageStatus");
CREATE INDEX "HepsiburadaOrderLine_linkedOrderId_idx" ON "HepsiburadaOrderLine"("linkedOrderId");

CREATE UNIQUE INDEX "PublicInvoiceToken_tokenHash_key" ON "PublicInvoiceToken"("tokenHash");
CREATE INDEX "PublicInvoiceToken_invoiceId_idx" ON "PublicInvoiceToken"("invoiceId");
CREATE INDEX "PublicInvoiceToken_expiresAt_idx" ON "PublicInvoiceToken"("expiresAt");
CREATE INDEX "PublicInvoiceToken_provider_idx" ON "PublicInvoiceToken"("provider");

CREATE INDEX "Order_source_idx" ON "Order"("source");

ALTER TABLE "MarketplaceListing"
  ADD CONSTRAINT "MarketplaceListing_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HepsiburadaOrderLine"
  ADD CONSTRAINT "HepsiburadaOrderLine_linkedOrderId_fkey"
  FOREIGN KEY ("linkedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicInvoiceToken"
  ADD CONSTRAINT "PublicInvoiceToken_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
