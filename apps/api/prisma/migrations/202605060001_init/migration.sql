CREATE TYPE "DraftStatus" AS ENUM ('NEEDS_REVIEW', 'READY', 'APPROVED', 'ISSUING', 'ISSUED', 'ERROR');
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'TRENDYOL_SENT', 'TRENDYOL_SEND_FAILED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

CREATE TABLE "Setting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "shipmentPackageId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerEmail" TEXT,
  "customerIdentifier" TEXT,
  "invoiceAddress" JSONB NOT NULL,
  "raw" JSONB NOT NULL,
  "totalGrossCents" INTEGER NOT NULL,
  "totalDiscountCents" INTEGER NOT NULL,
  "totalPayableCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "lastModifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceDraft" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL DEFAULT 'E_ARCHIVE',
  "status" "DraftStatus" NOT NULL,
  "validation" JSONB NOT NULL,
  "lines" JSONB NOT NULL,
  "totals" JSONB NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerInvoiceId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "status" "InvoiceStatus" NOT NULL,
  "pdfPath" TEXT,
  "pdfUrl" TEXT,
  "trendyolSentAt" TIMESTAMP(3),
  "trendyolStatus" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationJob" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "payload" JSONB,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Order_shipmentPackageId_key" ON "Order"("shipmentPackageId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");
CREATE INDEX "Order_lastModifiedAt_idx" ON "Order"("lastModifiedAt");
CREATE UNIQUE INDEX "InvoiceDraft_orderId_key" ON "InvoiceDraft"("orderId");
CREATE INDEX "InvoiceDraft_status_idx" ON "InvoiceDraft"("status");
CREATE UNIQUE INDEX "Invoice_draftId_key" ON "Invoice"("draftId");
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");
CREATE INDEX "IntegrationJob_status_idx" ON "IntegrationJob"("status");
CREATE INDEX "IntegrationJob_type_idx" ON "IntegrationJob"("type");
CREATE INDEX "AuditLog_subjectType_subjectId_idx" ON "AuditLog"("subjectType", "subjectId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InvoiceDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
