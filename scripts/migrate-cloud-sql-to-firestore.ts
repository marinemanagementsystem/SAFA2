import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { firestoreCollections, firestoreIndexDocId, firestoreProjectId } from "../apps/api/src/prisma/firestore-schema";

type Row = Record<string, any>;

const projectId = process.env.PROJECT_ID || firestoreProjectId();

function requireConfirmation() {
  if (process.env.CONFIRM_FIRESTORE_MIGRATION !== "1") {
    throw new Error("Set CONFIRM_FIRESTORE_MIGRATION=1 to migrate Cloud SQL data into Firestore.");
  }
}

function firestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function accessToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function firestoreRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${firestoreBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Firestore request failed with HTTP ${response.status}: ${await response.text()}`);
  }

  return response.text().then((text) => (text ? JSON.parse(text) : {}));
}

function toFirestoreValue(value: any): any {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue).filter((item) => item !== undefined) } };
  }
  if (value && typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .map(([key, item]) => [key, toFirestoreValue(item)])
            .filter(([, item]) => item !== undefined)
        )
      }
    };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(value: Row) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, toFirestoreValue(item)])
      .filter(([, item]) => item !== undefined)
  );
}

function documentName(collection: string, id: string) {
  return `projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
}

async function commitWrites(writes: unknown[]) {
  if (writes.length === 0) return;
  await firestoreRequest(":commit", {
    method: "POST",
    body: JSON.stringify({ writes })
  });
}

async function writeRows(collection: string, rows: Row[]) {
  for (let index = 0; index < rows.length; index += 400) {
    const writes = rows.slice(index, index + 400).map((row) => ({
      update: {
        name: documentName(collection, String(row.id ?? row.key)),
        fields: toFirestoreFields(row)
      }
    }));
    await commitWrites(writes);
  }
}

async function writeIndex(kind: string, value: string, targetId: string) {
  await commitWrites([
    {
      update: {
        name: documentName(firestoreCollections.uniqueIndexes, firestoreIndexDocId(kind, value)),
        fields: toFirestoreFields({ kind, value, targetId, updatedAt: new Date() })
      }
    }
  ]);
}

async function count(collection: string) {
  let pageToken: string | undefined;
  let total = 0;

  do {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await firestoreRequest(`/${collection}?${query.toString()}`);
    total += Array.isArray(result.documents) ? result.documents.length : 0;
    pageToken = result.nextPageToken;
  } while (pageToken);

  return total;
}

function encryptedSettingCount(settings: Row[]) {
  return settings.filter((setting) => setting.value?.encrypted === true).length;
}

function serializeRow(row: Row) {
  return Object.fromEntries(
    Object.entries(row)
      .map(([key, value]) => [key, serializeValue(value)])
      .filter(([, value]) => value !== undefined)
  );
}

function serializeValue(value: any): any {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serializeValue).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, serializeValue(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

async function main() {
  requireConfirmation();

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    const [settings, orders, drafts, invoices, externalInvoices, integrationJobs, auditLogs] = await Promise.all([
      prisma.setting.findMany(),
      prisma.order.findMany(),
      prisma.invoiceDraft.findMany(),
      prisma.invoice.findMany(),
      prisma.externalInvoice.findMany(),
      prisma.integrationJob.findMany(),
      prisma.auditLog.findMany()
    ]);

    await writeRows(firestoreCollections.settings, settings.map(serializeRow));
    await writeRows(firestoreCollections.orders, orders.map(serializeRow));
    await writeRows(firestoreCollections.invoiceDrafts, drafts.map(serializeRow));
    await writeRows(firestoreCollections.invoices, invoices.map(serializeRow));
    await writeRows(firestoreCollections.externalInvoices, externalInvoices.map(serializeRow));
    await writeRows(firestoreCollections.integrationJobs, integrationJobs.map(serializeRow));
    await writeRows(firestoreCollections.auditLogs, auditLogs.map(serializeRow));

    for (const order of orders) {
      await writeIndex("order.shipmentPackageId", order.shipmentPackageId, order.id);
    }
    for (const draft of drafts) {
      await writeIndex("draft.orderId", draft.orderId, draft.id);
    }
    for (const invoice of invoices) {
      await writeIndex("invoice.invoiceNumber", invoice.invoiceNumber, invoice.id);
      await writeIndex("invoice.draftId", invoice.draftId, invoice.id);
    }
    for (const externalInvoice of externalInvoices) {
      await writeIndex(
        "externalInvoice.sourceExternalKey",
        `${externalInvoice.source}:${externalInvoice.externalKey}`,
        externalInvoice.id
      );
    }

    const report = {
      projectId,
      source: {
        settings: settings.length,
        orders: orders.length,
        invoiceDrafts: drafts.length,
        invoices: invoices.length,
        externalInvoices: externalInvoices.length,
        integrationJobs: integrationJobs.length,
        auditLogs: auditLogs.length,
        encryptedSettings: encryptedSettingCount(settings)
      },
      firestore: {
        settings: await count(firestoreCollections.settings),
        orders: await count(firestoreCollections.orders),
        invoiceDrafts: await count(firestoreCollections.invoiceDrafts),
        invoices: await count(firestoreCollections.invoices),
        externalInvoices: await count(firestoreCollections.externalInvoices),
        integrationJobs: await count(firestoreCollections.integrationJobs),
        auditLogs: await count(firestoreCollections.auditLogs)
      },
      spotChecks: {
        orders: orders.slice(0, 3).map((order) => ({ id: order.id, shipmentPackageId: order.shipmentPackageId })),
        invoiceDrafts: drafts.slice(0, 3).map((draft) => ({ id: draft.id, orderId: draft.orderId, status: draft.status })),
        invoices: invoices.slice(0, 1).map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber })),
        encryptedSettings: settings
          .filter((setting) => setting.value?.encrypted === true)
          .slice(0, 3)
          .map((setting) => setting.key)
      }
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
