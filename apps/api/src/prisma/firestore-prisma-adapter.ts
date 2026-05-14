import { randomUUID } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { Firestore, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import { firestoreCollections, firestoreIndexDocId, firestoreProjectId } from "./firestore-schema";

type AnyRecord = Record<string, any>;
type FirestoreTransaction = Transaction | undefined;

function now() {
  return new Date();
}

function newId() {
  return randomUUID();
}

function isObject(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Timestamp);
}

function toFirestore(value: any): any {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(toFirestore).filter((item) => item !== undefined);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toFirestore(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

function fromFirestore(value: any): any {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(fromFirestore);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromFirestore(item)]));
  }
  return value;
}

function materializeSnapshot(snapshot: FirebaseFirestore.QuerySnapshot | FirebaseFirestore.DocumentSnapshot) {
  if ("docs" in snapshot) {
    return snapshot.docs.map((doc) => ({ id: doc.id, ...fromFirestore(doc.data()) }));
  }
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...fromFirestore(snapshot.data()) };
}

function compareValue(left: any, right: any) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue === rightValue) return 0;
  if (leftValue === undefined || leftValue === null) return -1;
  if (rightValue === undefined || rightValue === null) return 1;
  return leftValue > rightValue ? 1 : -1;
}

function matchesWhere(item: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true;

  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") {
      const clauses = Array.isArray(expected) ? expected.filter(Boolean) : [];
      if (!clauses.some((clause) => matchesWhere(item, clause))) return false;
      continue;
    }

    const actual = item[key];
    if (isObject(expected) && "in" in expected) {
      if (!Array.isArray(expected.in) || !expected.in.includes(actual)) return false;
      continue;
    }

    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }

    if (actual !== expected) return false;
  }

  return true;
}

function applyOrderBy(items: AnyRecord[], orderBy?: AnyRecord | AnyRecord[]) {
  const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  if (clauses.length === 0) return items;

  return [...items].sort((left, right) => {
    for (const clause of clauses) {
      const [field, direction] = Object.entries(clause)[0] ?? [];
      if (!field) continue;
      const comparison = compareValue(left[field], right[field]);
      if (comparison !== 0) return direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}

function applySelect(item: AnyRecord, select?: AnyRecord) {
  if (!select) return item;
  const selected: AnyRecord = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) selected[key] = item[key];
  }
  return selected;
}

function groupBy(items: AnyRecord[], key: string) {
  const grouped = new Map<string, AnyRecord[]>();
  for (const item of items) {
    const value = item[key];
    if (typeof value !== "string") continue;
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

function takeOrdered(items: AnyRecord[], args?: AnyRecord) {
  const ordered = applyOrderBy(items, args?.orderBy);
  return typeof args?.take === "number" ? ordered.slice(0, args.take) : ordered;
}

function mergeData(current: AnyRecord, data: AnyRecord, updateTimestamp = true) {
  const next = { ...current };
  for (const [key, value] of Object.entries(data)) {
    if (isObject(value) && "increment" in value) {
      next[key] = Number(next[key] ?? 0) + Number(value.increment ?? 0);
      continue;
    }
    next[key] = value;
  }
  if (updateTimestamp) next.updatedAt = now();
  return next;
}

function ensureAdminApp() {
  if (getApps().length > 0) return;
  initializeApp({
    projectId: firestoreProjectId(),
    credential: applicationDefault()
  });
}

export class FirestorePrismaAdapter {
  readonly db: Firestore;
  readonly setting: SettingDelegate;
  readonly order: OrderDelegate;
  readonly invoiceDraft: InvoiceDraftDelegate;
  readonly invoice: InvoiceDelegate;
  readonly externalInvoice: ExternalInvoiceDelegate;
  readonly integrationJob: IntegrationJobDelegate;
  readonly auditLog: AuditLogDelegate;

  constructor() {
    ensureAdminApp();
    this.db = getFirestore();
    this.setting = new SettingDelegate(this);
    this.order = new OrderDelegate(this);
    this.invoiceDraft = new InvoiceDraftDelegate(this);
    this.invoice = new InvoiceDelegate(this);
    this.externalInvoice = new ExternalInvoiceDelegate(this);
    this.integrationJob = new IntegrationJobDelegate(this);
    this.auditLog = new AuditLogDelegate(this);
  }

  collection(name: string) {
    return this.db.collection(name);
  }

  async all(collection: string) {
    const snapshot = await this.collection(collection).get();
    return materializeSnapshot(snapshot) as AnyRecord[];
  }

  async get(collection: string, id: string, tx?: FirestoreTransaction) {
    const ref = this.collection(collection).doc(id);
    const snapshot = tx ? await tx.get(ref) : await ref.get();
    return materializeSnapshot(snapshot) as AnyRecord | null;
  }

  set(collection: string, id: string, data: AnyRecord, tx?: FirestoreTransaction) {
    const ref = this.collection(collection).doc(id);
    const prepared = toFirestore(data);
    if (tx) {
      tx.set(ref, prepared);
      return Promise.resolve();
    }
    return ref.set(prepared);
  }

  update(collection: string, id: string, data: AnyRecord, tx?: FirestoreTransaction) {
    const ref = this.collection(collection).doc(id);
    const prepared = toFirestore(data);
    if (tx) {
      tx.set(ref, prepared, { merge: true });
      return Promise.resolve();
    }
    return ref.set(prepared, { merge: true });
  }

  async findByIndex(kind: string, value: string, tx?: FirestoreTransaction) {
    const index = await this.get(firestoreCollections.uniqueIndexes, firestoreIndexDocId(kind, value), tx);
    return typeof index?.targetId === "string" ? index.targetId : undefined;
  }

  writeIndex(kind: string, value: string, targetId: string, tx?: FirestoreTransaction) {
    return this.set(
      firestoreCollections.uniqueIndexes,
      firestoreIndexDocId(kind, value),
      { kind, value, targetId, updatedAt: now() },
      tx
    );
  }

  async $transaction<T>(callback: (tx: { setting: SettingDelegate }) => Promise<T>) {
    return this.db.runTransaction((transaction) => callback({ setting: new SettingDelegate(this, transaction) }));
  }
}

class BaseDelegate {
  constructor(
    protected readonly store: FirestorePrismaAdapter,
    protected readonly tx?: FirestoreTransaction
  ) {}

  protected async records(collection: string, args?: { where?: AnyRecord; orderBy?: AnyRecord | AnyRecord[]; take?: number }) {
    const items = (await this.store.all(collection)).filter((item) => matchesWhere(item, args?.where));
    const ordered = applyOrderBy(items, args?.orderBy);
    return typeof args?.take === "number" ? ordered.slice(0, args.take) : ordered;
  }
}

class SettingDelegate extends BaseDelegate {
  async findMany() {
    return this.records(firestoreCollections.settings);
  }

  async findUnique(args: { where: { key: string } }) {
    return this.store.get(firestoreCollections.settings, args.where.key, this.tx);
  }

  async upsert(args: { where: { key: string }; update: AnyRecord; create: AnyRecord }) {
    const existing = await this.findUnique(args);
    const data = existing
      ? mergeData(existing, { ...args.update, key: args.where.key })
      : { ...args.create, key: args.where.key, updatedAt: now() };
    await this.store.set(firestoreCollections.settings, args.where.key, data, this.tx);
    return data;
  }
}

class OrderDelegate extends BaseDelegate {
  async findMany(args: AnyRecord = {}) {
    let items = await this.records(firestoreCollections.orders, args);
    items = await hydrateOrdersBatch(this.store, items, args.include);
    return items.map((item) => applySelect(item, args.select));
  }

  async findUnique(args: { where: { id: string }; include?: AnyRecord }) {
    const item = await this.store.get(firestoreCollections.orders, args.where.id);
    return item ? hydrateOrder(this.store, item, args.include) : null;
  }

  async findFirst(args: AnyRecord = {}) {
    const [item] = await this.findMany({ ...args, take: 1 });
    return item ?? null;
  }

  async upsert(args: { where: { shipmentPackageId: string }; update: AnyRecord; create: AnyRecord }) {
    const shipmentPackageId = args.where.shipmentPackageId;
    return this.store.db.runTransaction(async (tx) => {
      const existingId = await this.store.findByIndex("order.shipmentPackageId", shipmentPackageId, tx);
      if (existingId) {
        const existing = (await this.store.get(firestoreCollections.orders, existingId, tx)) ?? { id: existingId, createdAt: now() };
        const updated = mergeData(existing, { ...args.update, id: existingId, shipmentPackageId });
        await this.store.set(firestoreCollections.orders, existingId, updated, tx);
        return updated;
      }

      const id = newId();
      const created = {
        id,
        ...args.create,
        shipmentPackageId,
        currency: args.create.currency ?? "TRY",
        createdAt: now(),
        updatedAt: now()
      };
      await this.store.set(firestoreCollections.orders, id, created, tx);
      await this.store.writeIndex("order.shipmentPackageId", shipmentPackageId, id, tx);
      return created;
    });
  }
}

class InvoiceDraftDelegate extends BaseDelegate {
  async findMany(args: AnyRecord = {}) {
    let items = await this.records(firestoreCollections.invoiceDrafts, args);
    items = await hydrateDraftsBatch(this.store, items, args.include);
    return items;
  }

  async findUnique(args: { where: { id?: string; orderId?: string }; include?: AnyRecord }) {
    const id = args.where.id ?? (args.where.orderId ? await this.store.findByIndex("draft.orderId", args.where.orderId) : undefined);
    if (!id) return null;
    const item = await this.store.get(firestoreCollections.invoiceDrafts, id);
    return item ? hydrateDraft(this.store, item, args.include) : null;
  }

  async create(args: { data: AnyRecord }) {
    return this.store.db.runTransaction(async (tx) => {
      const existingId = await this.store.findByIndex("draft.orderId", args.data.orderId, tx);
      if (existingId) throw new Error("Invoice draft already exists for order.");
      const id = args.data.id ?? newId();
      const created = {
        id,
        documentType: args.data.documentType ?? "E_ARCHIVE",
        ...args.data,
        createdAt: args.data.createdAt ?? now(),
        updatedAt: args.data.updatedAt ?? now()
      };
      await this.store.set(firestoreCollections.invoiceDrafts, id, created, tx);
      await this.store.writeIndex("draft.orderId", args.data.orderId, id, tx);
      return created;
    });
  }

  async update(args: { where: { id: string }; data: AnyRecord }) {
    const existing = await this.store.get(firestoreCollections.invoiceDrafts, args.where.id);
    if (!existing) throw new Error("Invoice draft not found.");
    const updated = mergeData(existing, args.data);
    await this.store.set(firestoreCollections.invoiceDrafts, args.where.id, updated);
    return updated;
  }

  async updateMany(args: { where?: AnyRecord; data: AnyRecord }) {
    const items = await this.records(firestoreCollections.invoiceDrafts, { where: args.where });
    await Promise.all(items.map((item) => this.update({ where: { id: item.id }, data: args.data })));
    return { count: items.length };
  }
}

class InvoiceDelegate extends BaseDelegate {
  async findMany(args: AnyRecord = {}) {
    let items = await this.records(firestoreCollections.invoices, args);
    items = await Promise.all(items.map((item) => hydrateInvoice(this.store, item, args.include)));
    return items;
  }

  async findUnique(args: { where: { id: string }; include?: AnyRecord }) {
    const item = await this.store.get(firestoreCollections.invoices, args.where.id);
    return item ? hydrateInvoice(this.store, item, args.include) : null;
  }

  async create(args: { data: AnyRecord }) {
    return this.store.db.runTransaction(async (tx) => {
      const existingInvoiceNumber = await this.store.findByIndex("invoice.invoiceNumber", args.data.invoiceNumber, tx);
      const existingDraftInvoice = await this.store.findByIndex("invoice.draftId", args.data.draftId, tx);
      if (existingInvoiceNumber || existingDraftInvoice) throw new Error("Invoice already exists.");
      const id = args.data.id ?? newId();
      const created = {
        id,
        ...args.data,
        createdAt: args.data.createdAt ?? now(),
        updatedAt: args.data.updatedAt ?? now()
      };
      await this.store.set(firestoreCollections.invoices, id, created, tx);
      await this.store.writeIndex("invoice.invoiceNumber", args.data.invoiceNumber, id, tx);
      await this.store.writeIndex("invoice.draftId", args.data.draftId, id, tx);
      return created;
    });
  }

  async update(args: { where: { id: string }; data: AnyRecord }) {
    const existing = await this.store.get(firestoreCollections.invoices, args.where.id);
    if (!existing) throw new Error("Invoice not found.");
    const updated = mergeData(existing, args.data);
    await this.store.set(firestoreCollections.invoices, args.where.id, updated);
    return updated;
  }
}

class ExternalInvoiceDelegate extends BaseDelegate {
  async findMany(args: AnyRecord = {}) {
    let items = await this.records(firestoreCollections.externalInvoices, args);
    items = await Promise.all(items.map((item) => hydrateExternalInvoice(this.store, item, args.include)));
    return items.map((item) => applySelect(item, args.select));
  }

  async findUnique(args: { where: { id: string } }) {
    return this.store.get(firestoreCollections.externalInvoices, args.where.id);
  }

  async upsert(args: { where: { source_externalKey: { source: string; externalKey: string } }; update: AnyRecord; create: AnyRecord }) {
    const { source, externalKey } = args.where.source_externalKey;
    return this.store.db.runTransaction(async (tx) => {
      const existingId = await this.store.findByIndex("externalInvoice.sourceExternalKey", `${source}:${externalKey}`, tx);
      if (existingId) {
        const existing = (await this.store.get(firestoreCollections.externalInvoices, existingId, tx)) ?? { id: existingId, createdAt: now() };
        const updated = mergeData(existing, { ...args.update, source, externalKey });
        await this.store.set(firestoreCollections.externalInvoices, existingId, updated, tx);
        return updated;
      }

      const id = args.create.id ?? newId();
      const created = {
        id,
        ...args.create,
        source,
        externalKey,
        currency: args.create.currency ?? "TRY",
        matchScore: args.create.matchScore ?? 0,
        createdAt: args.create.createdAt ?? now(),
        updatedAt: args.create.updatedAt ?? now()
      };
      await this.store.set(firestoreCollections.externalInvoices, id, created, tx);
      await this.store.writeIndex("externalInvoice.sourceExternalKey", `${source}:${externalKey}`, id, tx);
      return created;
    });
  }

  async update(args: { where: { id: string }; data: AnyRecord; include?: AnyRecord }) {
    const existing = await this.store.get(firestoreCollections.externalInvoices, args.where.id);
    if (!existing) throw new Error("External invoice not found.");
    const updated = mergeData(existing, args.data);
    await this.store.set(firestoreCollections.externalInvoices, args.where.id, updated);
    return hydrateExternalInvoice(this.store, updated, args.include);
  }
}

class IntegrationJobDelegate extends BaseDelegate {
  async create(args: { data: AnyRecord }) {
    const id = args.data.id ?? newId();
    const created = {
      id,
      attempts: 0,
      ...args.data,
      createdAt: args.data.createdAt ?? now(),
      updatedAt: args.data.updatedAt ?? now()
    };
    await this.store.set(firestoreCollections.integrationJobs, id, created);
    return created;
  }

  async update(args: { where: { id: string }; data: AnyRecord }) {
    const existing = await this.store.get(firestoreCollections.integrationJobs, args.where.id);
    if (!existing) throw new Error("Integration job not found.");
    const updated = mergeData(existing, args.data);
    await this.store.set(firestoreCollections.integrationJobs, args.where.id, updated);
    return updated;
  }

  async findMany(args: AnyRecord = {}) {
    return this.records(firestoreCollections.integrationJobs, args);
  }
}

class AuditLogDelegate extends BaseDelegate {
  async create(args: { data: AnyRecord }) {
    const id = args.data.id ?? newId();
    const created = {
      id,
      ...args.data,
      createdAt: args.data.createdAt ?? now()
    };
    await this.store.set(firestoreCollections.auditLogs, id, created);
    return created;
  }
}

async function findDraftByOrderId(store: FirestorePrismaAdapter, orderId: string) {
  const id = await store.findByIndex("draft.orderId", orderId);
  if (!id) return null;
  return store.get(firestoreCollections.invoiceDrafts, id);
}

async function findInvoiceByDraftId(store: FirestorePrismaAdapter, draftId: string) {
  const id = await store.findByIndex("invoice.draftId", draftId);
  if (!id) return null;
  return store.get(firestoreCollections.invoices, id);
}

async function findExternalInvoicesByOrderId(store: FirestorePrismaAdapter, orderId: string, args: AnyRecord = {}) {
  const delegate = new ExternalInvoiceDelegate(store);
  return delegate.findMany({ where: { matchedOrderId: orderId }, orderBy: args.orderBy, take: args.take });
}

async function hydrateOrdersBatch(store: FirestorePrismaAdapter, orders: AnyRecord[], include?: AnyRecord) {
  if (!include || orders.length === 0) return orders;

  const nextOrders = orders.map((order) => ({ ...order }));
  const orderIds = new Set(nextOrders.map((order) => order.id).filter(Boolean));
  let draftsByOrderId = new Map<string, AnyRecord>();
  let invoicesByDraftId = new Map<string, AnyRecord>();
  let externalInvoicesByOrderId = new Map<string, AnyRecord[]>();

  if (include.invoiceDraft) {
    const drafts = (await store.all(firestoreCollections.invoiceDrafts)).filter((draft) => orderIds.has(draft.orderId));
    draftsByOrderId = new Map(drafts.map((draft) => [draft.orderId, draft]));

    if (include.invoiceDraft.include?.invoice && drafts.length > 0) {
      const draftIds = new Set(drafts.map((draft) => draft.id));
      const invoices = (await store.all(firestoreCollections.invoices)).filter((invoice) => draftIds.has(invoice.draftId));
      invoicesByDraftId = new Map(invoices.map((invoice) => [invoice.draftId, invoice]));
    }
  }

  if (include.externalInvoices || include._count?.select?.externalInvoices) {
    const externalInvoices = (await store.all(firestoreCollections.externalInvoices)).filter((invoice) => orderIds.has(invoice.matchedOrderId));
    externalInvoicesByOrderId = groupBy(externalInvoices, "matchedOrderId");
  }

  return nextOrders.map((order) => {
    if (include.invoiceDraft) {
      const draft = draftsByOrderId.get(order.id);
      order.invoiceDraft = draft
        ? {
            ...draft,
            ...(include.invoiceDraft.include?.invoice ? { invoice: invoicesByDraftId.get(draft.id) ?? null } : {})
          }
        : null;
    }

    if (include.externalInvoices) {
      order.externalInvoices = takeOrdered(externalInvoicesByOrderId.get(order.id) ?? [], include.externalInvoices);
    }

    if (include._count?.select?.externalInvoices) {
      order._count = { externalInvoices: (externalInvoicesByOrderId.get(order.id) ?? []).length };
    }

    return order;
  });
}

async function hydrateDraftsBatch(store: FirestorePrismaAdapter, drafts: AnyRecord[], include?: AnyRecord) {
  if (!include || drafts.length === 0) return drafts;

  const nextDrafts = drafts.map((draft) => ({ ...draft }));
  const draftIds = new Set(nextDrafts.map((draft) => draft.id).filter(Boolean));
  const orderIds = new Set(nextDrafts.map((draft) => draft.orderId).filter(Boolean));
  let ordersById = new Map<string, AnyRecord>();
  let invoicesByDraftId = new Map<string, AnyRecord>();
  let externalInvoicesByOrderId = new Map<string, AnyRecord[]>();

  if (include.order) {
    const orders = (await store.all(firestoreCollections.orders)).filter((order) => orderIds.has(order.id));
    ordersById = new Map(orders.map((order) => [order.id, order]));

    if (include.order.include?.externalInvoices || include.order.include?._count?.select?.externalInvoices) {
      const externalInvoices = (await store.all(firestoreCollections.externalInvoices)).filter((invoice) => orderIds.has(invoice.matchedOrderId));
      externalInvoicesByOrderId = groupBy(externalInvoices, "matchedOrderId");
    }
  }

  if (include.invoice) {
    const invoices = (await store.all(firestoreCollections.invoices)).filter((invoice) => draftIds.has(invoice.draftId));
    invoicesByDraftId = new Map(invoices.map((invoice) => [invoice.draftId, invoice]));
  }

  return nextDrafts.map((draft) => {
    if (include.order) {
      const order = ordersById.get(draft.orderId);
      if (!order) {
        draft.order = null;
      } else {
        draft.order = { ...order };
        if (include.order.include?.externalInvoices) {
          draft.order.externalInvoices = takeOrdered(externalInvoicesByOrderId.get(order.id) ?? [], include.order.include.externalInvoices);
        }
        if (include.order.include?._count?.select?.externalInvoices) {
          draft.order._count = { externalInvoices: (externalInvoicesByOrderId.get(order.id) ?? []).length };
        }
      }
    }

    if (include.invoice) {
      draft.invoice = invoicesByDraftId.get(draft.id) ?? null;
    }

    return draft;
  });
}

async function hydrateOrder(store: FirestorePrismaAdapter, order: AnyRecord, include?: AnyRecord) {
  if (!include) return order;
  const next = { ...order };

  if (include.invoiceDraft) {
    const draft = await findDraftByOrderId(store, order.id);
    next.invoiceDraft = draft ? await hydrateDraft(store, draft, include.invoiceDraft.include) : null;
  }

  if (include.externalInvoices) {
    next.externalInvoices = await findExternalInvoicesByOrderId(store, order.id, include.externalInvoices);
  }

  if (include._count?.select?.externalInvoices) {
    const externalInvoices = await findExternalInvoicesByOrderId(store, order.id);
    next._count = { externalInvoices: externalInvoices.length };
  }

  return next;
}

async function hydrateDraft(store: FirestorePrismaAdapter, draft: AnyRecord, include?: AnyRecord) {
  if (!include) return draft;
  const next = { ...draft };

  if (include.order) {
    const order = await store.get(firestoreCollections.orders, draft.orderId);
    next.order = order ? await hydrateOrder(store, order, include.order.include) : null;
  }

  if (include.invoice) {
    next.invoice = await findInvoiceByDraftId(store, draft.id);
  }

  return next;
}

async function hydrateInvoice(store: FirestorePrismaAdapter, invoice: AnyRecord, include?: AnyRecord) {
  if (!include) return invoice;
  const next = { ...invoice };

  if (include.draft) {
    const draft = await store.get(firestoreCollections.invoiceDrafts, invoice.draftId);
    next.draft = draft ? await hydrateDraft(store, draft, include.draft.include) : null;
  }

  return next;
}

async function hydrateExternalInvoice(store: FirestorePrismaAdapter, invoice: AnyRecord, include?: AnyRecord) {
  if (!include?.matchedOrder || !invoice.matchedOrderId) return invoice;
  const order = await store.get(firestoreCollections.orders, invoice.matchedOrderId);
  if (!order) return { ...invoice, matchedOrder: null };
  return {
    ...invoice,
    matchedOrder: applySelect(order, include.matchedOrder.select)
  };
}
