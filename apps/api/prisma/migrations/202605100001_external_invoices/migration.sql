CREATE TYPE "ExternalInvoiceSource" AS ENUM ('GIB_PORTAL', 'TRENDYOL', 'MANUAL');

CREATE TABLE "ExternalInvoice" (
  "id" TEXT NOT NULL,
  "source" "ExternalInvoiceSource" NOT NULL,
  "externalKey" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "invoiceDate" TIMESTAMP(3),
  "buyerName" TEXT,
  "buyerIdentifier" TEXT,
  "orderNumber" TEXT,
  "shipmentPackageId" TEXT,
  "totalPayableCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "status" TEXT,
  "pdfUrl" TEXT,
  "xmlUrl" TEXT,
  "raw" JSONB NOT NULL,
  "matchedOrderId" TEXT,
  "matchScore" INTEGER NOT NULL DEFAULT 0,
  "matchReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalInvoice_source_externalKey_key" ON "ExternalInvoice"("source", "externalKey");
CREATE INDEX "ExternalInvoice_invoiceNumber_idx" ON "ExternalInvoice"("invoiceNumber");
CREATE INDEX "ExternalInvoice_invoiceDate_idx" ON "ExternalInvoice"("invoiceDate");
CREATE INDEX "ExternalInvoice_orderNumber_idx" ON "ExternalInvoice"("orderNumber");
CREATE INDEX "ExternalInvoice_shipmentPackageId_idx" ON "ExternalInvoice"("shipmentPackageId");
CREATE INDEX "ExternalInvoice_matchedOrderId_idx" ON "ExternalInvoice"("matchedOrderId");

ALTER TABLE "ExternalInvoice"
  ADD CONSTRAINT "ExternalInvoice_matchedOrderId_fkey"
  FOREIGN KEY ("matchedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
