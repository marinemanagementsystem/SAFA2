ALTER TYPE "DraftStatus" ADD VALUE 'PORTAL_DRAFTED';

ALTER TABLE "InvoiceDraft"
  ADD COLUMN "portalDraftUuid" TEXT,
  ADD COLUMN "portalDraftNumber" TEXT,
  ADD COLUMN "portalDraftUploadedAt" TIMESTAMP(3),
  ADD COLUMN "portalDraftStatus" TEXT,
  ADD COLUMN "portalDraftResponse" JSONB;

CREATE INDEX "InvoiceDraft_portalDraftUuid_idx" ON "InvoiceDraft"("portalDraftUuid");
CREATE INDEX "InvoiceDraft_portalDraftUploadedAt_idx" ON "InvoiceDraft"("portalDraftUploadedAt");
