import type { OrderListItem } from "@safa/shared";

export type OrderColumnId =
  | "select"
  | "shipmentPackageId"
  | "orderNumber"
  | "deliveredAt"
  | "customerName"
  | "city"
  | "totalPayableCents"
  | "draftStatus"
  | "invoiceNumber"
  | "pdf";

export type OrderColumnKind = "control" | "text" | "date" | "money" | "status" | "link";

export interface OrderColumnDefinition {
  id: OrderColumnId;
  label: string;
  kind: OrderColumnKind;
  sortable?: boolean;
  filterable?: boolean;
}

export type OrderInvoiceFilter = "all" | "issued" | "external" | "unissued" | "issued-today" | "issued-previous";
export type OrderDateFilter = "all" | "today" | "last7" | "last30";
export type OrderSortField =
  | "deliveredAt"
  | "updatedAt"
  | "orderNumber"
  | "shipmentPackageId"
  | "customerName"
  | "city"
  | "totalPayableCents"
  | "draftStatus"
  | "invoiceNumber";

export interface OrderSortState {
  field: OrderSortField;
  direction: "asc" | "desc";
}

export interface OrderTopFilterState {
  query: string;
  orderStatusFilter: string;
  draftStatusFilter: string;
  invoiceFilter: OrderInvoiceFilter;
  cityFilter: string;
  dateFilter: OrderDateFilter;
}

export interface OrderColumnFilterState {
  shipmentPackageId?: string;
  orderNumber?: string;
  customerName?: string;
  city?: string;
  status?: string;
  draftStatus?: string;
  invoiceNumber?: string;
  totalPayableMin?: string;
  totalPayableMax?: string;
}

export interface OrderViewProfile {
  id: string;
  name: string;
  columnOrder: OrderColumnId[];
  visibleColumnIds: OrderColumnId[];
  columnFilters: OrderColumnFilterState;
  topFilters: Partial<OrderTopFilterState>;
  sort: OrderSortState;
  createdAt: string;
  updatedAt: string;
}

export interface OrderViewProfileVault {
  profiles: OrderViewProfile[];
  activeProfileId: string | null;
}

export const orderColumnDefinitions: OrderColumnDefinition[] = [
  { id: "select", label: "Sec", kind: "control" },
  { id: "shipmentPackageId", label: "Paket", kind: "text", sortable: true, filterable: true },
  { id: "orderNumber", label: "Siparis", kind: "text", sortable: true, filterable: true },
  { id: "deliveredAt", label: "Teslim", kind: "date", sortable: true },
  { id: "customerName", label: "Alici", kind: "text", sortable: true, filterable: true },
  { id: "city", label: "Sehir", kind: "text", sortable: true, filterable: true },
  { id: "totalPayableCents", label: "Tutar", kind: "money", sortable: true, filterable: true },
  { id: "draftStatus", label: "Taslak", kind: "status", sortable: true, filterable: true },
  { id: "invoiceNumber", label: "Fatura", kind: "status", sortable: true, filterable: true },
  { id: "pdf", label: "PDF", kind: "link" }
];

export const defaultOrderColumnOrder = orderColumnDefinitions.map((column) => column.id);
export const defaultOrderVisibleColumnIds: OrderColumnId[] = [
  "shipmentPackageId",
  "orderNumber",
  "deliveredAt",
  "customerName",
  "city",
  "totalPayableCents",
  "draftStatus",
  "invoiceNumber",
  "pdf"
];
export const defaultOrderSort: OrderSortState = { field: "deliveredAt", direction: "desc" };

const orderColumnIdSet = new Set<OrderColumnId>(defaultOrderColumnOrder);
const dataColumnIds = defaultOrderColumnOrder.filter((id) => id !== "select");
const sortFieldSet = new Set<OrderSortField>([
  "deliveredAt",
  "updatedAt",
  "orderNumber",
  "shipmentPackageId",
  "customerName",
  "city",
  "totalPayableCents",
  "draftStatus",
  "invoiceNumber"
]);
const invoiceFilterSet = new Set<OrderInvoiceFilter>(["all", "issued", "external", "unissued", "issued-today", "issued-previous"]);
const dateFilterSet = new Set<OrderDateFilter>(["all", "today", "last7", "last30"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function searchable(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function uniqueKnownColumnIds(values: unknown): OrderColumnId[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<OrderColumnId>();
  const output: OrderColumnId[] = [];

  for (const value of values) {
    if (typeof value !== "string" || !orderColumnIdSet.has(value as OrderColumnId)) continue;
    const columnId = value as OrderColumnId;
    if (seen.has(columnId)) continue;
    seen.add(columnId);
    output.push(columnId);
  }

  return output;
}

export function normalizeOrderColumnOrder(values: unknown): OrderColumnId[] {
  const known = uniqueKnownColumnIds(values);
  return [...known, ...defaultOrderColumnOrder.filter((id) => !known.includes(id))];
}

export function normalizeVisibleOrderColumnIds(values: unknown, selectionMode: boolean): OrderColumnId[] {
  const known = uniqueKnownColumnIds(values);
  const hasDataColumn = known.some((id) => id !== "select");
  const base: OrderColumnId[] = hasDataColumn ? known : selectionMode ? ["select", "orderNumber"] : defaultOrderVisibleColumnIds;
  const visible: OrderColumnId[] = selectionMode && !base.includes("select") ? ["select", ...base] : base.filter((id) => id !== "select" || selectionMode);
  return visible.some((id) => id !== "select") ? visible : ["select", "orderNumber"];
}

export function getPortalTransferBlockReason(order: OrderListItem) {
  if (!order.draftId) return "Taslak yok.";
  if (order.invoiceId) return "Fatura zaten kesilmis.";
  if (order.externalInvoiceCount > 0) return "Harici fatura eslesmesi var.";
  if (order.draftStatus === "PORTAL_DRAFTED") return "Taslak zaten portala aktarilmis.";
  if (order.draftStatus !== "READY" && order.draftStatus !== "APPROVED") return "Taslak hazir veya onayli degil.";
  return "";
}

export function isPortalTransferableOrder(order: OrderListItem) {
  return getPortalTransferBlockReason(order) === "";
}

function moneyFilterValue(value: string | undefined) {
  if (!value?.trim()) return null;
  const normalized = Number(value.replace(",", "."));
  return Number.isFinite(normalized) ? Math.round(normalized * 100) : null;
}

function includesFilter(value: unknown, filter: string | undefined) {
  const normalized = searchable(filter);
  return !normalized || searchable(value).includes(normalized);
}

export function filterOrdersByColumnFilters(orders: OrderListItem[], filters: OrderColumnFilterState) {
  const minCents = moneyFilterValue(filters.totalPayableMin);
  const maxCents = moneyFilterValue(filters.totalPayableMax);

  return orders.filter((order) => {
    if (!includesFilter(order.shipmentPackageId, filters.shipmentPackageId)) return false;
    if (!includesFilter(order.orderNumber, filters.orderNumber)) return false;
    if (!includesFilter(order.customerName, filters.customerName)) return false;
    if (filters.city && order.city !== filters.city) return false;
    if (filters.status && order.status !== filters.status) return false;
    if (filters.draftStatus && (order.draftStatus ?? "YOK") !== filters.draftStatus) return false;
    if (!includesFilter(order.invoiceNumber ?? order.externalInvoiceNumber, filters.invoiceNumber)) return false;
    if (minCents !== null && order.totalPayableCents < minCents) return false;
    if (maxCents !== null && order.totalPayableCents > maxCents) return false;
    return true;
  });
}

function normalizeColumnFilters(value: unknown): OrderColumnFilterState {
  if (!isRecord(value)) return {};
  return {
    shipmentPackageId: compactString(value.shipmentPackageId),
    orderNumber: compactString(value.orderNumber),
    customerName: compactString(value.customerName),
    city: compactString(value.city),
    status: compactString(value.status),
    draftStatus: compactString(value.draftStatus),
    invoiceNumber: compactString(value.invoiceNumber),
    totalPayableMin: compactString(value.totalPayableMin),
    totalPayableMax: compactString(value.totalPayableMax)
  };
}

function normalizeTopFilters(value: unknown): Partial<OrderTopFilterState> {
  if (!isRecord(value)) return {};
  const invoiceFilter =
    typeof value.invoiceFilter === "string" && invoiceFilterSet.has(value.invoiceFilter as OrderInvoiceFilter)
      ? (value.invoiceFilter as OrderInvoiceFilter)
      : undefined;
  const dateFilter =
    typeof value.dateFilter === "string" && dateFilterSet.has(value.dateFilter as OrderDateFilter)
      ? (value.dateFilter as OrderDateFilter)
      : undefined;
  return {
    query: compactString(value.query),
    orderStatusFilter: compactString(value.orderStatusFilter),
    draftStatusFilter: compactString(value.draftStatusFilter),
    cityFilter: compactString(value.cityFilter),
    ...(invoiceFilter ? { invoiceFilter } : {}),
    ...(dateFilter ? { dateFilter } : {})
  };
}

function normalizeSort(value: unknown): OrderSortState {
  if (!isRecord(value)) return defaultOrderSort;
  const field = typeof value.field === "string" && sortFieldSet.has(value.field as OrderSortField) ? (value.field as OrderSortField) : defaultOrderSort.field;
  const direction = value.direction === "asc" ? "asc" : "desc";
  return { field, direction };
}

function normalizeProfile(value: unknown): OrderViewProfile | null {
  if (!isRecord(value)) return null;
  const id = compactString(value.id);
  const name = compactString(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    columnOrder: normalizeOrderColumnOrder(value.columnOrder),
    visibleColumnIds: normalizeVisibleOrderColumnIds(value.visibleColumnIds, false),
    columnFilters: normalizeColumnFilters(value.columnFilters),
    topFilters: normalizeTopFilters(value.topFilters),
    sort: normalizeSort(value.sort),
    createdAt: compactString(value.createdAt) || new Date(0).toISOString(),
    updatedAt: compactString(value.updatedAt) || new Date(0).toISOString()
  };
}

export function normalizeOrderViewProfileVault(value: unknown): OrderViewProfileVault {
  if (!isRecord(value) || !Array.isArray(value.profiles)) return { profiles: [], activeProfileId: null };
  const profiles = value.profiles.map(normalizeProfile).filter((profile): profile is OrderViewProfile => Boolean(profile));
  const activeProfileId =
    typeof value.activeProfileId === "string" && profiles.some((profile) => profile.id === value.activeProfileId)
      ? value.activeProfileId
      : null;
  return { profiles, activeProfileId };
}

export function createOrderViewProfile(input: {
  id: string;
  name: string;
  columnOrder: OrderColumnId[];
  visibleColumnIds: OrderColumnId[];
  columnFilters: OrderColumnFilterState;
  topFilters: OrderTopFilterState;
  sort: OrderSortState;
  now?: string;
}): OrderViewProfile {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    columnOrder: normalizeOrderColumnOrder(input.columnOrder),
    visibleColumnIds: normalizeVisibleOrderColumnIds(input.visibleColumnIds, false),
    columnFilters: normalizeColumnFilters(input.columnFilters),
    topFilters: normalizeTopFilters(input.topFilters),
    sort: normalizeSort(input.sort),
    createdAt: now,
    updatedAt: now
  };
}
