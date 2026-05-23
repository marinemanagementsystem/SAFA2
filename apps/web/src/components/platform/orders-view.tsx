"use client";

import type { OrderDetail, OrderListItem } from "@safa/shared";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Check,
  Columns3,
  Eye,
  FileText,
  GripVertical,
  ListFilter,
  Loader2,
  Save,
  Search,
  SlidersHorizontal,
  UploadCloud,
  X
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { loadOrderViewProfiles, saveOrderViewProfiles } from "../../lib/firebase/order-view-profile-store";
import {
  cx,
  dateMatches,
  formatDateTime,
  lineNumber,
  money,
  numberValue,
  statusLabel,
  statusTone,
  stringValue
} from "../../lib/platform/format";
import {
  createOrderViewProfile,
  defaultOrderColumnOrder,
  defaultOrderSort,
  defaultOrderVisibleColumnIds,
  filterOrdersByColumnFilters,
  getPortalTransferBlockReason,
  isPortalTransferableOrder,
  normalizeOrderColumnOrder,
  normalizeVisibleOrderColumnIds,
  orderColumnDefinitions,
  type OrderColumnFilterState,
  type OrderColumnId,
  type OrderDateFilter,
  type OrderInvoiceFilter,
  type OrderSortField,
  type OrderSortState,
  type OrderTopFilterState,
  type OrderViewProfile,
  type OrderViewProfileVault
} from "./order-view-state";

interface OrdersViewProps {
  ownerUsername: string;
  orders: OrderListItem[];
  selectedOrderId: string | null;
  selectedOrder: OrderDetail | null;
  detailState: "idle" | "loading" | "error";
  busyAction: string;
  onSelectOrder: (id: string) => void;
  onUploadPortalDrafts: (draftIds: string[]) => Promise<string>;
}

const defaultTopFilters: OrderTopFilterState = {
  query: "",
  orderStatusFilter: "all",
  draftStatusFilter: "all",
  invoiceFilter: "all",
  cityFilter: "all",
  dateFilter: "all"
};

const columnDefinitionById = new Map(orderColumnDefinitions.map((column) => [column.id, column]));

function initialOrderQuery() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("order") ?? params.get("package") ?? "";
}

function dateTimeValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function orderDeliveryTime(order: OrderListItem) {
  return dateTimeValue(order.deliveredAt ?? order.lastModifiedAt ?? order.updatedAt);
}

function invoiceDeskHref(order: OrderListItem) {
  const target = order.draftId ? `draft=${encodeURIComponent(order.draftId)}` : `order=${encodeURIComponent(order.orderNumber)}`;
  return `/invoices?${target}`;
}

export function OrdersView({
  ownerUsername,
  orders,
  selectedOrderId,
  selectedOrder,
  detailState,
  busyAction,
  onSelectOrder,
  onUploadPortalDrafts
}: OrdersViewProps) {
  const [query, setQuery] = useState(initialOrderQuery);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [draftStatusFilter, setDraftStatusFilter] = useState("all");
  const [invoiceFilter, setInvoiceFilter] = useState<OrderInvoiceFilter>("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<OrderDateFilter>("all");
  const [sort, setSort] = useState<OrderSortState>(defaultOrderSort);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<OrderColumnId[]>(defaultOrderColumnOrder);
  const [visibleColumnIds, setVisibleColumnIds] = useState<OrderColumnId[]>(defaultOrderVisibleColumnIds);
  const [columnFilters, setColumnFilters] = useState<OrderColumnFilterState>({});
  const [profiles, setProfiles] = useState<OrderViewProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draggedColumnId, setDraggedColumnId] = useState<OrderColumnId | null>(null);

  useEffect(() => {
    if (selectedOrderId || !query) return;
    const search = stringValue(query);
    const matched = orders.find(
      (order) =>
        stringValue(order.orderNumber) === search ||
        stringValue(order.shipmentPackageId) === search ||
        stringValue(order.draftId) === search ||
        stringValue(order.invoiceNumber) === search ||
        stringValue(order.externalInvoiceNumber) === search
    );
    if (matched) onSelectOrder(matched.id);
  }, [onSelectOrder, orders, query, selectedOrderId]);

  useEffect(() => {
    let cancelled = false;

    loadOrderViewProfiles(ownerUsername).then(({ vault, source }) => {
      if (cancelled) return;
      setProfiles(vault.profiles);
      setActiveProfileId(vault.activeProfileId);
      const active = vault.profiles.find((profile) => profile.id === vault.activeProfileId);
      if (active) applyProfile(active);
      if (source === "local") setProfileStatus("Gorunum profilleri yerel yedekten yuklendi.");
    });

    return () => {
      cancelled = true;
    };
  }, [ownerUsername]);

  useEffect(() => {
    setSelectedOrderIds((current) => current.filter((id) => orders.some((order) => order.id === id)));
  }, [orders]);

  const filterOptions = useMemo(() => {
    const statuses = Array.from(new Set(orders.map((order) => order.status).filter(Boolean))).sort();
    const draftStatuses = Array.from(new Set(orders.flatMap((order) => (order.draftStatus ? [order.draftStatus] : [])))).sort();
    const cities = Array.from(new Set(orders.map((order) => order.city).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, "tr-TR")
    );

    return { statuses, draftStatuses, cities };
  }, [orders]);

  const topFilteredOrders = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const search = stringValue(query);

    return orders.filter((order) => {
      const haystack = [
        order.shipmentPackageId,
        order.orderNumber,
        order.customerName,
        order.customerEmail,
        order.city,
        order.district,
        order.invoiceNumber,
        order.externalInvoiceNumber,
        order.externalInvoiceSources?.join(" "),
        order.trendyolStatus,
        order.draftStatus
      ]
        .map(stringValue)
        .join(" ");

      if (search && !haystack.includes(search)) return false;
      if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) return false;
      if (draftStatusFilter !== "all" && (order.draftStatus ?? "YOK") !== draftStatusFilter) return false;
      if (cityFilter !== "all" && order.city !== cityFilter) return false;
      if (!dateMatches(order.deliveredAt ?? order.lastModifiedAt ?? order.updatedAt, dateFilter)) return false;
      if (invoiceFilter === "issued" && !order.invoiceId) return false;
      if (invoiceFilter === "external" && order.externalInvoiceCount === 0) return false;
      if (invoiceFilter === "unissued" && (order.invoiceId || order.externalInvoiceCount > 0)) return false;
      if (invoiceFilter === "issued-today" && (!order.invoiceDate || new Date(order.invoiceDate) < today)) return false;
      if (invoiceFilter === "issued-previous" && (!order.invoiceDate || new Date(order.invoiceDate) >= today)) return false;
      return true;
    });
  }, [cityFilter, dateFilter, draftStatusFilter, invoiceFilter, orderStatusFilter, orders, query]);

  const filteredOrders = useMemo(() => {
    const filtered = filterOrdersByColumnFilters(topFilteredOrders, columnFilters);
    const direction = sort.direction === "asc" ? 1 : -1;

    return [...filtered].sort((left, right) => {
      let result = 0;

      if (sort.field === "totalPayableCents") {
        result = numberValue(left.totalPayableCents) - numberValue(right.totalPayableCents);
      } else if (sort.field === "deliveredAt") {
        result = orderDeliveryTime(left) - orderDeliveryTime(right);
      } else if (sort.field === "updatedAt") {
        result = dateTimeValue(left.lastModifiedAt ?? left.updatedAt) - dateTimeValue(right.lastModifiedAt ?? right.updatedAt);
      } else {
        result = stringValue(left[sort.field]).localeCompare(stringValue(right[sort.field]), "tr-TR");
      }

      return result * direction;
    });
  }, [columnFilters, sort, topFilteredOrders]);

  const effectiveVisibleColumnIds = useMemo(() => normalizeVisibleOrderColumnIds(visibleColumnIds, selectionMode), [selectionMode, visibleColumnIds]);
  const visibleColumns = useMemo(
    () => columnOrder.filter((id) => effectiveVisibleColumnIds.includes(id)).map((id) => columnDefinitionById.get(id)).filter(Boolean),
    [columnOrder, effectiveVisibleColumnIds]
  );
  const selectedOrders = useMemo(
    () => selectedOrderIds.map((id) => orders.find((order) => order.id === id)).filter((order): order is OrderListItem => Boolean(order)),
    [orders, selectedOrderIds]
  );
  const transferableVisibleOrders = useMemo(() => filteredOrders.filter(isPortalTransferableOrder), [filteredOrders]);
  const selectedTransferableDraftIds = useMemo(
    () => selectedOrders.filter(isPortalTransferableOrder).flatMap((order) => (order.draftId ? [order.draftId] : [])),
    [selectedOrders]
  );
  const blockedVisibleCount = filteredOrders.length - transferableVisibleOrders.length;
  const isPortalBusy = busyAction === "portal-draft-upload";
  const activeProfile = activeProfileId ? profiles.find((profile) => profile.id === activeProfileId) ?? null : null;

  function changeSort(field: OrderSortField) {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  function resetFilters() {
    setQuery("");
    setOrderStatusFilter("all");
    setDraftStatusFilter("all");
    setInvoiceFilter("all");
    setCityFilter("all");
    setDateFilter("all");
    setColumnFilters({});
    setSort(defaultOrderSort);
  }

  function currentTopFilters(): OrderTopFilterState {
    return { query, orderStatusFilter, draftStatusFilter, invoiceFilter, cityFilter, dateFilter };
  }

  function applyTopFilters(filters: Partial<OrderTopFilterState>) {
    setQuery(filters.query ?? "");
    setOrderStatusFilter(filters.orderStatusFilter || "all");
    setDraftStatusFilter(filters.draftStatusFilter || "all");
    setInvoiceFilter(filters.invoiceFilter ?? "all");
    setCityFilter(filters.cityFilter || "all");
    setDateFilter(filters.dateFilter ?? "all");
  }

  function applyProfile(profile: OrderViewProfile) {
    setColumnOrder(normalizeOrderColumnOrder(profile.columnOrder));
    setVisibleColumnIds(normalizeVisibleOrderColumnIds(profile.visibleColumnIds, false));
    setColumnFilters(profile.columnFilters);
    applyTopFilters({ ...defaultTopFilters, ...profile.topFilters });
    setSort(profile.sort);
  }

  async function persistProfiles(nextProfiles: OrderViewProfile[], nextActiveProfileId: string | null) {
    const vault: OrderViewProfileVault = { profiles: nextProfiles, activeProfileId: nextActiveProfileId };
    const result = await saveOrderViewProfiles(ownerUsername, vault);
    setProfileStatus(result.remoteSaved ? "Gorunum profili hesaba kaydedildi." : "Firestore yazilamadi; gorunum profili bu tarayicida saklandi.");
  }

  function profileFromCurrent(name: string, existing?: OrderViewProfile): OrderViewProfile {
    const now = new Date().toISOString();
    const profile = createOrderViewProfile({
      id: existing?.id ?? `order-view-${Date.now()}`,
      name,
      columnOrder,
      visibleColumnIds,
      columnFilters,
      topFilters: currentTopFilters(),
      sort,
      now: existing?.createdAt ?? now
    });
    return { ...profile, createdAt: existing?.createdAt ?? profile.createdAt, updatedAt: now };
  }

  function saveActiveProfile() {
    const existing = activeProfile;
    if (!existing) {
      saveNewProfile();
      return;
    }

    const nextProfile = profileFromCurrent(existing.name, existing);
    const nextProfiles = profiles.map((profile) => (profile.id === existing.id ? nextProfile : profile));
    setProfiles(nextProfiles);
    void persistProfiles(nextProfiles, existing.id);
  }

  function saveNewProfile() {
    const name = window.prompt("Gorunum profili adi", activeProfile?.name ?? "Siparis gorunumu");
    const trimmed = name?.trim();
    if (!trimmed) return;
    const nextProfile = profileFromCurrent(trimmed);
    const nextProfiles = [nextProfile, ...profiles.filter((profile) => profile.name.toLocaleLowerCase("tr-TR") !== trimmed.toLocaleLowerCase("tr-TR"))];
    setProfiles(nextProfiles);
    setActiveProfileId(nextProfile.id);
    void persistProfiles(nextProfiles, nextProfile.id);
  }

  function selectProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      setActiveProfileId(null);
      return;
    }
    setActiveProfileId(profile.id);
    applyProfile(profile);
    void persistProfiles(profiles, profile.id);
  }

  function resetViewDefaults() {
    setColumnOrder(defaultOrderColumnOrder);
    setVisibleColumnIds(defaultOrderVisibleColumnIds);
    setColumnFilters({});
    setSort(defaultOrderSort);
    setProfileStatus("Varsayilan gorunum uygulandi. Kaydetmedikce profil ezilmez.");
  }

  function toggleColumn(columnId: OrderColumnId, checked: boolean) {
    setVisibleColumnIds((current) => normalizeVisibleOrderColumnIds(checked ? [...current, columnId] : current.filter((id) => id !== columnId), selectionMode));
  }

  function moveColumn(columnId: OrderColumnId, direction: -1 | 1) {
    setColumnOrder((current) => {
      const index = current.indexOf(columnId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function dropColumn(targetId: OrderColumnId) {
    if (!draggedColumnId || draggedColumnId === targetId) return;
    setColumnOrder((current) => {
      const next = current.filter((id) => id !== draggedColumnId);
      const targetIndex = next.indexOf(targetId);
      next.splice(targetIndex, 0, draggedColumnId);
      return next;
    });
    setDraggedColumnId(null);
  }

  function toggleOrderSelection(order: OrderListItem, checked: boolean) {
    if (!isPortalTransferableOrder(order)) return;
    setSelectedOrderIds((current) => (checked ? Array.from(new Set([...current, order.id])) : current.filter((id) => id !== order.id)));
  }

  function selectVisibleTransferableOrders() {
    setSelectionMode(true);
    setSelectedOrderIds((current) => Array.from(new Set([...current, ...transferableVisibleOrders.map((order) => order.id)])));
  }

  async function uploadSelectedToPortal() {
    if (selectedTransferableDraftIds.length === 0) return;
    const message = await onUploadPortalDrafts(selectedTransferableDraftIds);
    setProfileStatus(message);
    setSelectedOrderIds([]);
  }

  function setColumnFilter<Key extends keyof OrderColumnFilterState>(key: Key, value: OrderColumnFilterState[Key]) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="view-stack">
      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Siparis merkezi</span>
            <h2>{filteredOrders.length} kayit gosteriliyor</h2>
            <p>
              {orders.length} toplam · {transferableVisibleOrders.length} portala aktarilabilir · {blockedVisibleCount} kilitli
            </p>
          </div>
          <div className="section-actions">
            <button className={cx("ui-button compact", selectionMode ? "primary" : "ghost")} type="button" onClick={() => setSelectionMode((current) => !current)}>
              <Check size={17} />
              Toplu secim
            </button>
            <button className="ui-button ghost compact" type="button" onClick={() => setSettingsOpen((current) => !current)}>
              <Columns3 size={17} />
              Sutunlar
            </button>
            <button className="ui-button ghost compact" onClick={resetFilters}>
              <X size={17} />
              Temizle
            </button>
          </div>
        </div>

        <div className="filter-dock" aria-label="Liste filtreleri">
          <label className="field search-field">
            <span>
              <Search size={17} />
              Arama
            </span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Siparis, paket, alici, sehir, fatura no" />
          </label>
          <label className="field">
            <span>
              <ListFilter size={17} />
              Fatura
            </span>
            <select value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value as OrderInvoiceFilter)}>
              <option value="all">Tum kayitlar</option>
              <option value="issued">SAFA'da kesilenler</option>
              <option value="external">Harici faturada bulunanlar</option>
              <option value="unissued">SAFA faturasi bekleyenler</option>
              <option value="issued-today">Bugun SAFA'da kesilenler</option>
              <option value="issued-previous">Onceki SAFA faturalari</option>
            </select>
          </label>
          <label className="field">
            <span>
              <ListFilter size={17} />
              Trendyol
            </span>
            <select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
              <option value="all">Tum durumlar</option>
              {filterOptions.statuses.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              <FileText size={17} />
              Taslak
            </span>
            <select value={draftStatusFilter} onChange={(event) => setDraftStatusFilter(event.target.value)}>
              <option value="all">Tum taslaklar</option>
              <option value="YOK">Taslak yok</option>
              {filterOptions.draftStatuses.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              <CalendarDays size={17} />
              Tarih
            </span>
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as OrderDateFilter)}>
              <option value="all">Tum zamanlar</option>
              <option value="today">Bugun teslim edilen</option>
              <option value="last7">Son 7 gun teslim</option>
              <option value="last30">Son 30 gun teslim</option>
            </select>
          </label>
          <label className="field">
            <span>
              <ListFilter size={17} />
              Sehir
            </span>
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="all">Tum sehirler</option>
              {filterOptions.cities.map((city) => (
                <option value={city} key={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>
        </div>

        {settingsOpen ? (
          <div className="order-view-settings">
            <div className="order-profile-strip">
              <label className="field">
                <span>
                  <SlidersHorizontal size={17} />
                  Gorunum profili
                </span>
                <select value={activeProfileId ?? ""} onChange={(event) => selectProfile(event.target.value)}>
                  <option value="">Profil secilmedi</option>
                  {profiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="ui-button ghost compact" type="button" onClick={saveActiveProfile}>
                <Save size={16} />
                Gorunumu kaydet
              </button>
              <button className="ui-button ghost compact" type="button" onClick={saveNewProfile}>
                <Save size={16} />
                Yeni profil
              </button>
              <button className="ui-button ghost compact" type="button" onClick={resetViewDefaults}>
                <X size={16} />
                Varsayilan
              </button>
            </div>
            <div className="order-column-manager" aria-label="Sutun yonetimi">
              {columnOrder.map((columnId, index) => {
                const column = columnDefinitionById.get(columnId);
                if (!column) return null;
                const checked = effectiveVisibleColumnIds.includes(columnId);
                const disabled = selectionMode && columnId === "select";

                return (
                  <div
                    className="order-column-item"
                    draggable
                    onDragStart={() => setDraggedColumnId(columnId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropColumn(columnId)}
                    key={columnId}
                  >
                    <GripVertical size={16} />
                    <label>
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => toggleColumn(columnId, event.target.checked)} />
                      {column.label}
                    </label>
                    <button className="icon-button" type="button" onClick={() => moveColumn(columnId, -1)} disabled={index === 0} title="Yukari tasi">
                      <ArrowUp size={14} />
                    </button>
                    <button className="icon-button" type="button" onClick={() => moveColumn(columnId, 1)} disabled={index === columnOrder.length - 1} title="Asagi tasi">
                      <ArrowDown size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            {profileStatus ? <div className="form-alert table-note">{profileStatus}</div> : null}
          </div>
        ) : profileStatus ? (
          <div className="form-alert table-note">{profileStatus}</div>
        ) : null}

        <div className={cx("order-bulkbar", selectionMode && "active")} aria-label="Toplu siparis islemleri">
          <div className="order-bulkbar-copy">
            <span className={cx("mode-pill", selectedOrderIds.length > 0 && "success")}>
              {selectedOrderIds.length > 0 ? `${selectedOrderIds.length} secili` : "Secim yok"}
            </span>
            <div>
              <strong>Toplu portal aktarimi</strong>
              <small>Yalniz hazir/onayli ve faturalanmamis taslaklar secilebilir.</small>
            </div>
          </div>
          <div className="order-bulkbar-actions">
            <button className="ui-button ghost compact" type="button" onClick={selectVisibleTransferableOrders} disabled={transferableVisibleOrders.length === 0}>
              <Check size={16} />
              Gorunen aktarilabilirleri sec
            </button>
            <button className="ui-button ghost compact" type="button" onClick={() => setSelectedOrderIds([])} disabled={selectedOrderIds.length === 0}>
              <X size={16} />
              Secimi temizle
            </button>
            <button
              className="ui-button primary compact"
              type="button"
              onClick={() => void uploadSelectedToPortal()}
              disabled={selectedTransferableDraftIds.length === 0 || isPortalBusy}
            >
              {isPortalBusy ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
              Secilenleri portala aktar
            </button>
          </div>
        </div>

        <div className="form-alert table-note">
          Fatura kolonu once SAFA'da kesilen faturayi, yoksa harici e-Arsiv/Trendyol eslesmesini gosterir. Hicbir kaynakta
          kayit bulunmadiginda "Kesim bekliyor" veya "SAFA kaydi yok" olarak ayrilir. Varsayilan siralama teslim tarihine
          gore yeniden eskiyedir.
        </div>

        <div className="split-workspace">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {visibleColumns.map((column) =>
                    column ? (
                      column.sortable ? (
                        <SortableHead label={column.label} onClick={() => changeSort(column.id as OrderSortField)} key={column.id} />
                      ) : (
                        <th key={column.id}>{column.label}</th>
                      )
                    ) : null
                  )}
                </tr>
                <tr className="order-column-filter-row">
                  {visibleColumns.map((column) => (column ? <OrderColumnFilterCell columnId={column.id} filters={columnFilters} options={filterOptions} onChange={setColumnFilter} key={column.id} /> : null))}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <OrderTableRow
                    order={order}
                    selected={selectedOrderId === order.id}
                    bulkSelected={selectedOrderIds.includes(order.id)}
                    columns={visibleColumns.flatMap((column) => (column ? [column.id] : []))}
                    onSelect={() => onSelectOrder(order.id)}
                    onToggleSelection={toggleOrderSelection}
                    key={order.id}
                  />
                ))}
              </tbody>
            </table>

            <div className="mobile-order-list" aria-label="Mobil siparis listesi">
              {filteredOrders.map((order) => {
                const draftDisplay = draftStateForOrder(order);
                const selected = selectedOrderIds.includes(order.id);
                const blockedReason = getPortalTransferBlockReason(order);

                return (
                  <button className={cx("mobile-order-card", selectedOrderId === order.id && "active", selected && "bulk-selected")} onClick={() => onSelectOrder(order.id)} key={order.id}>
                    {selectionMode ? (
                      <span className="mobile-order-select" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={Boolean(blockedReason)}
                          title={blockedReason}
                          onChange={(event) => toggleOrderSelection(order, event.target.checked)}
                        />
                        {blockedReason || "Aktarilabilir"}
                      </span>
                    ) : null}
                    <span className="mono">{order.shipmentPackageId}</span>
                    <strong>{order.customerName || "Alici eksik"}</strong>
                    <small>
                      {order.city || "Sehir yok"} · Teslim {order.deliveredAt ? formatDateTime(order.deliveredAt) : "-"} ·{" "}
                      {money(order.totalPayableCents, order.currency)}
                    </small>
                    <span className={cx("status-pill", draftDisplay.tone)}>{draftDisplay.label}</span>
                  </button>
                );
              })}
            </div>

            {orders.length === 0 ? <div className="empty-state table-empty">Once Trendyol cek islemini calistirin.</div> : null}
            {orders.length > 0 && filteredOrders.length === 0 ? (
              <div className="empty-state table-empty">Bu filtrelerle kayit bulunamadi.</div>
            ) : null}
          </div>

          <OrderDetailPanel selectedOrder={selectedOrder} detailState={detailState} />
        </div>
      </section>
    </div>
  );
}

function SortableHead({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th>
      <button className="sort-head" onClick={onClick}>
        {label}
        <ArrowUpDown size={14} />
      </button>
    </th>
  );
}

function OrderColumnFilterCell({
  columnId,
  filters,
  options,
  onChange
}: {
  columnId: OrderColumnId;
  filters: OrderColumnFilterState;
  options: { statuses: string[]; draftStatuses: string[]; cities: string[] };
  onChange: <Key extends keyof OrderColumnFilterState>(key: Key, value: OrderColumnFilterState[Key]) => void;
}) {
  if (columnId === "select" || columnId === "deliveredAt" || columnId === "pdf") return <th />;

  if (columnId === "city") {
    return (
      <th>
        <select className="column-filter-control" value={filters.city ?? ""} onChange={(event) => onChange("city", event.target.value)}>
          <option value="">Tum sehirler</option>
          {options.cities.map((city) => (
            <option value={city} key={city}>
              {city}
            </option>
          ))}
        </select>
      </th>
    );
  }

  if (columnId === "draftStatus") {
    return (
      <th>
        <select className="column-filter-control" value={filters.draftStatus ?? ""} onChange={(event) => onChange("draftStatus", event.target.value)}>
          <option value="">Tum taslaklar</option>
          <option value="YOK">Taslak yok</option>
          {options.draftStatuses.map((status) => (
            <option value={status} key={status}>
              {status}
            </option>
          ))}
        </select>
      </th>
    );
  }

  if (columnId === "totalPayableCents") {
    return (
      <th>
        <div className="amount-filter-pair">
          <input
            className="column-filter-control"
            inputMode="decimal"
            placeholder="Min"
            value={filters.totalPayableMin ?? ""}
            onChange={(event) => onChange("totalPayableMin", event.target.value)}
          />
          <input
            className="column-filter-control"
            inputMode="decimal"
            placeholder="Max"
            value={filters.totalPayableMax ?? ""}
            onChange={(event) => onChange("totalPayableMax", event.target.value)}
          />
        </div>
      </th>
    );
  }

  const filterKeyByColumn: Partial<Record<OrderColumnId, keyof OrderColumnFilterState>> = {
    shipmentPackageId: "shipmentPackageId",
    orderNumber: "orderNumber",
    customerName: "customerName",
    invoiceNumber: "invoiceNumber"
  };
  const filterKey = filterKeyByColumn[columnId];

  if (!filterKey) return <th />;

  return (
    <th>
      <input
        className="column-filter-control"
        value={String(filters[filterKey] ?? "")}
        placeholder="Filtre"
        onChange={(event) => onChange(filterKey, event.target.value)}
      />
    </th>
  );
}

function OrderTableRow({
  order,
  selected,
  bulkSelected,
  columns,
  onSelect,
  onToggleSelection
}: {
  order: OrderListItem;
  selected: boolean;
  bulkSelected: boolean;
  columns: OrderColumnId[];
  onSelect: () => void;
  onToggleSelection: (order: OrderListItem, checked: boolean) => void;
}) {
  const invoiceDisplay = invoiceStateForOrder(order);
  const draftDisplay = draftStateForOrder(order);
  const blockedReason = getPortalTransferBlockReason(order);

  return (
    <tr
      className={cx(selected && "selected-row", bulkSelected && "bulk-selected")}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      {columns.map((columnId) => (
        <OrderTableCell
          order={order}
          columnId={columnId}
          invoiceDisplay={invoiceDisplay}
          draftDisplay={draftDisplay}
          bulkSelected={bulkSelected}
          blockedReason={blockedReason}
          onToggleSelection={onToggleSelection}
          key={columnId}
        />
      ))}
    </tr>
  );
}

function OrderTableCell({
  order,
  columnId,
  invoiceDisplay,
  draftDisplay,
  bulkSelected,
  blockedReason,
  onToggleSelection
}: {
  order: OrderListItem;
  columnId: OrderColumnId;
  invoiceDisplay: { label: string; tone: string };
  draftDisplay: { label: string; tone: string };
  bulkSelected: boolean;
  blockedReason: string;
  onToggleSelection: (order: OrderListItem, checked: boolean) => void;
}) {
  if (columnId === "select") {
    return (
      <td onClick={(event) => event.stopPropagation()}>
        <label className={cx("order-row-select", blockedReason && "disabled")} title={blockedReason || "Portala aktarilabilir"}>
          <input
            type="checkbox"
            checked={bulkSelected}
            disabled={Boolean(blockedReason)}
            onChange={(event) => onToggleSelection(order, event.target.checked)}
          />
        </label>
      </td>
    );
  }

  if (columnId === "shipmentPackageId") return <td className="mono">{order.shipmentPackageId}</td>;
  if (columnId === "orderNumber") return <td>{order.orderNumber}</td>;
  if (columnId === "deliveredAt") return <td>{order.deliveredAt ? formatDateTime(order.deliveredAt) : <span className="muted">-</span>}</td>;
  if (columnId === "customerName") return <td>{order.customerName || <span className="muted">Eksik</span>}</td>;
  if (columnId === "city") return <td>{order.city || <span className="muted">Eksik</span>}</td>;
  if (columnId === "totalPayableCents") return <td>{money(order.totalPayableCents, order.currency)}</td>;
  if (columnId === "draftStatus") {
    return (
      <td>
        <span className={cx("status-pill", draftDisplay.tone)}>{draftDisplay.label}</span>
      </td>
    );
  }
  if (columnId === "invoiceNumber") {
    return (
      <td>
        <span className={cx("status-pill", invoiceDisplay.tone)}>{invoiceDisplay.label}</span>
      </td>
    );
  }

  return (
    <td onClick={(event) => event.stopPropagation()}>
      {order.invoiceId && order.invoicePdfAvailable ? (
        <a className="text-link" href={api.invoicePdfUrl(order.invoiceId)} target="_blank" rel="noreferrer">
          PDF
        </a>
      ) : order.invoiceId ? (
        <span className="muted">{order.invoiceSourceLabel?.includes("e-Arsiv") ? "portal imzali / PDF bekliyor" : "PDF bekliyor"}</span>
      ) : order.draftId ? (
        <a className="text-link" href={api.draftPdfUrl(order.draftId)} target="_blank" rel="noreferrer">
          Taslak
        </a>
      ) : (
        <span className="muted">-</span>
      )}
      <Link className="text-link route-link" href={invoiceDeskHref(order)}>
        Fatura masasi
      </Link>
    </td>
  );
}

function draftStateForOrder(order: OrderListItem) {
  if (order.invoiceId) {
    return {
      label: "Fatura kesildi",
      tone: statusTone(order.trendyolStatus ?? "ISSUED")
    };
  }

  if (order.externalInvoiceCount > 0 && order.draftStatus === "PORTAL_DRAFTED") {
    const source = order.externalInvoiceSources?.[0] ? sourceLabel(order.externalInvoiceSources[0]) : "Harici";
    return {
      label: `${source} imzali`,
      tone: statusTone("ISSUED")
    };
  }

  return {
    label: statusLabel(order.draftStatus ?? "YOK"),
    tone: statusTone(order.draftStatus)
  };
}

function invoiceStateForOrder(order: OrderListItem) {
  if (order.invoiceId) {
    return {
      label: order.invoiceSourceLabel ? `${order.invoiceSourceLabel}: ${order.invoiceNumber ?? "kesildi"}` : order.invoiceNumber ?? "SAFA'da kesildi",
      tone: statusTone(order.trendyolStatus ?? "ISSUED")
    };
  }

  if (order.externalInvoiceCount > 0) {
    const source = order.externalInvoiceSources?.[0] ? sourceLabel(order.externalInvoiceSources[0]) : "Harici";
    return {
      label: order.externalInvoiceNumber ? `${source}: ${order.externalInvoiceNumber}` : `${source} bulundu`,
      tone: statusTone("ISSUED")
    };
  }

  if (order.draftStatus === "ISSUING") {
    return { label: "Kesiliyor", tone: statusTone("ISSUING") };
  }

  if (order.draftStatus === "PORTAL_DRAFTED") {
    return { label: "GIB imza bekliyor", tone: statusTone("PORTAL_DRAFTED") };
  }

  if (order.draftStatus === "READY" || order.draftStatus === "APPROVED") {
    return { label: "Kesim bekliyor", tone: statusTone("PENDING") };
  }

  if (order.draftStatus === "ERROR") {
    return { label: "Fatura hatasi", tone: statusTone("ERROR") };
  }

  return { label: "SAFA kaydi yok", tone: statusTone(undefined) };
}

function sourceLabel(source: string) {
  if (source === "GIB_PORTAL") return "e-Arsiv";
  if (source === "TRENDYOL") return "Trendyol";
  return "Harici";
}

function OrderDetailPanel({
  selectedOrder,
  detailState
}: {
  selectedOrder: OrderDetail | null;
  detailState: "idle" | "loading" | "error";
}) {
  if (detailState === "loading") {
    return (
      <aside className="detail-rail">
        <div className="empty-state">
          <Eye size={24} />
          <strong>Detay yukleniyor</strong>
          <p>Secilen siparisin fatura ve satir bilgileri aliniyor.</p>
        </div>
      </aside>
    );
  }

  if (!selectedOrder) {
    return (
      <aside className="detail-rail">
        <div className="empty-state">
          <Eye size={24} />
          <strong>Siparis secin</strong>
          <p>Tablodan bir satir secildiginde fatura, adres ve urun detaylari burada acilir.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="detail-rail">
      <div className="detail-title">
        <span className="micro-label">Siparis icerigi</span>
        <h3>{selectedOrder.orderNumber}</h3>
        <p className="mono">{selectedOrder.shipmentPackageId}</p>
      </div>

      <div className="detail-stats">
        <div>
          <span>Alici</span>
          <strong>{selectedOrder.customerName}</strong>
          <small>{selectedOrder.customerEmail ?? "E-posta yok"}</small>
        </div>
        <div>
          <span>Fatura adresi</span>
          <strong>{String(selectedOrder.invoiceAddress.city ?? "-")}</strong>
          <small>{String(selectedOrder.invoiceAddress.addressLine ?? selectedOrder.invoiceAddress.address1 ?? "-")}</small>
        </div>
        <div>
          <span>Toplam</span>
          <strong>{money(selectedOrder.totalPayableCents, selectedOrder.currency)}</strong>
          <small>Indirim: {money(selectedOrder.totalDiscountCents, selectedOrder.currency)}</small>
        </div>
        <div>
          <span>Teslim</span>
          <strong>{selectedOrder.deliveredAt ? formatDateTime(selectedOrder.deliveredAt) : "Tarih yok"}</strong>
          <small>Fatura masasi bu tarih ile siralanir.</small>
        </div>
        <div>
          <span>Fatura</span>
          <strong>{selectedOrder.invoice?.invoiceNumber ?? selectedOrder.externalInvoices[0]?.invoiceNumber ?? "SAFA faturasi yok"}</strong>
          <small>
            {selectedOrder.invoice
              ? formatDateTime(selectedOrder.invoice.invoiceDate)
              : selectedOrder.externalInvoices[0]
                ? `${sourceLabel(selectedOrder.externalInvoices[0].source)} harici eslesme · ${selectedOrder.externalInvoices[0].matchReason ?? "Kaynak eslesti"}`
                : "Harici e-Arsiv/Trendyol fatura eslesmesi bulunamadi."}
          </small>
        </div>
      </div>

      <div className="detail-actions">
        <Link className="ui-button ghost" href={`/invoices?${selectedOrder.draft ? `draft=${encodeURIComponent(selectedOrder.draft.id)}` : `order=${encodeURIComponent(selectedOrder.orderNumber)}`}`}>
          <FileText size={18} />
          Fatura masasi
        </Link>
        {selectedOrder.invoice?.pdfAvailable ? (
          <a className="ui-button primary" href={api.invoicePdfUrl(selectedOrder.invoice.id)} target="_blank" rel="noreferrer">
            <FileText size={18} />
            Fatura PDF
          </a>
        ) : selectedOrder.invoice ? (
          <span className="status-pill warning">
            {selectedOrder.invoice.sourceLabel?.includes("e-Arsiv") ? "portal imzali / PDF bekliyor" : "PDF bekliyor"}
          </span>
        ) : selectedOrder.draft ? (
          <a className="ui-button primary" href={api.draftPdfUrl(selectedOrder.draft.id)} target="_blank" rel="noreferrer">
            <FileText size={18} />
            Taslak PDF
          </a>
        ) : null}
        <span className={cx("status-pill", statusTone(selectedOrder.invoice ? selectedOrder.invoice.status : selectedOrder.draft?.status))}>
          {statusLabel(selectedOrder.invoice ? selectedOrder.invoice.status : selectedOrder.draft?.status)}
        </span>
      </div>

      {selectedOrder.draft?.warnings.length ? <div className="warning-box">{selectedOrder.draft.warnings.join(" ")}</div> : null}

      {selectedOrder.externalInvoices.length > 0 ? (
        <div className="line-list">
          <div className="line-list-head">
            <strong>Harici faturalar</strong>
            <span>{selectedOrder.externalInvoices.length}</span>
          </div>
          {selectedOrder.externalInvoices.map((invoice) => (
            <div className="line-item" key={invoice.id}>
              <strong>{invoice.invoiceNumber ?? "Fatura no yok"}</strong>
              <small>
                {sourceLabel(invoice.source)} · {invoice.invoiceDate ? formatDateTime(invoice.invoiceDate) : "Tarih yok"}
                {invoice.status ? ` · Portal durum: ${invoice.status}` : ""}
                {invoice.matchReason ? ` · Eslesme: ${invoice.matchReason}` : ""}
              </small>
              <span>{invoice.totalPayableCents ? money(invoice.totalPayableCents, invoice.currency) : "Tutar yok"}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="line-list">
        <div className="line-list-head">
          <strong>Urun satirlari</strong>
          <span>{selectedOrder.draft?.lines.length ?? 0}</span>
        </div>
        {(selectedOrder.draft?.lines ?? []).map((line, index) => (
          <div className="line-item" key={`${String(line.description)}-${index}`}>
            <strong>{String(line.description ?? "-")}</strong>
            <small>
              {lineNumber(line.quantity)} adet · %{lineNumber(line.vatRate)} KDV
            </small>
            <span>{money(lineNumber(line.payableCents), selectedOrder.currency)}</span>
          </div>
        ))}
        {!selectedOrder.draft?.lines.length ? <div className="mini-empty">Taslak satiri yok.</div> : null}
      </div>

      <details className="raw-detail">
        <summary>Ham Trendyol verisi</summary>
        <pre>{JSON.stringify(selectedOrder.raw, null, 2)}</pre>
      </details>
    </aside>
  );
}
