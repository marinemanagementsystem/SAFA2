import { createHash } from "node:crypto";

export const firestoreCollections = {
  settings: "safaSettings",
  orders: "safaOrders",
  invoiceDrafts: "safaInvoiceDrafts",
  invoices: "safaInvoices",
  externalInvoices: "safaExternalInvoices",
  integrationJobs: "safaIntegrationJobs",
  auditLogs: "safaAuditLogs",
  uniqueIndexes: "safaUniqueIndexes"
} as const;

export function firestoreIndexDocId(kind: string, value: string) {
  const normalized = `${kind}:${value}`;
  return createHash("sha256").update(normalized).digest("hex");
}

export function firestoreProjectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "safa-8f76e";
}
