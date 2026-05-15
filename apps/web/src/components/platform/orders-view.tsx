"use client";

import type { OrderDetail, OrderListItem } from "@safa/shared";
import { ArrowUpDown, CalendarDays, Eye, FileText, ListFilter, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
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

type InvoiceFilter = "all" | "issued" | "external" | "unissued" | "issued-today" | "issued-previous";
type DateFilter = "all" | "today" | "last7" | "last30";
type OrderSortField =
  | "deliveredAt"
  | "updatedAt"
  | "orderNumber"
  | "shipmentPackageId"
  | "customerName"
  | "city"
  | "totalPayableCents"
  | "draftStatus"
  | "invoiceNumber";

interface SortState {
  field: OrderSortField;
  direction: "asc" | "desc";
}

interface OrdersViewProps {
  orders: OrderListItem[];
  selectedOrderId: string | null;
  selectedOrder: OrderDetail | null;
  detailState: "idle" | "loading" | "error";
  onSelectOrder: (id: string) => void;
}

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

export function OrdersView({ orders, selectedOrderId, selectedOrder, detailState, onSelectOrder }: OrdersViewProps) {
  const [query, setQuery] = useState(initialOrderQuery);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [draftStatusFilter, setDraftStatusFilter] = useState("all");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortState>({ field: "deliveredAt", direction: "desc" });

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

  const filterOptions = useMemo(() => {
    const statuses = Array.from(new Set(orders.map((order) => order.status).filter(Boolean))).sort();
    const draftStatuses = Array.from(new Set(orders.map((order) => order.draftStatus).filter(Boolean))).sort();
    const cities = Array.from(new Set(orders.map((order) => order.city).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, "tr-TR")
    );

    return { statuses, draftStatuses, cities };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const search = stringValue(query);

    const filtered = orders.filter((order) => {
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
  }, [cityFilter, dateFilter, draftStatusFilter, invoiceFilter, orderStatusFilter, orders, query, sort]);

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
    setSort({ field: "deliveredAt", direction: "desc" });
  }

  return (
    <div className="view-stack">
      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Siparis merkezi</span>
            <h2>{filteredOrders.length} kayit gosteriliyor</h2>
          </div>
          <button className="ui-button ghost compact" onClick={resetFilters}>
            <X size={17} />
            Temizle
          </button>
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
            <select value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value as InvoiceFilter)}>
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
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}>
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
                  <SortableHead label="Paket" onClick={() => changeSort("shipmentPackageId")} />
                  <SortableHead label="Siparis" onClick={() => changeSort("orderNumber")} />
                  <SortableHead label="Teslim" onClick={() => changeSort("deliveredAt")} />
                  <SortableHead label="Alici" onClick={() => changeSort("customerName")} />
                  <SortableHead label="Sehir" onClick={() => changeSort("city")} />
                  <SortableHead label="Tutar" onClick={() => changeSort("totalPayableCents")} />
                  <SortableHead label="Taslak" onClick={() => changeSort("draftStatus")} />
                  <SortableHead label="Fatura" onClick={() => changeSort("invoiceNumber")} />
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <OrderTableRow
                    order={order}
                    selected={selectedOrderId === order.id}
                    onSelect={() => onSelectOrder(order.id)}
                    key={order.id}
                  />
                ))}
              </tbody>
            </table>

            <div className="mobile-order-list" aria-label="Mobil siparis listesi">
              {filteredOrders.map((order) => (
                <button
                  className={cx("mobile-order-card", selectedOrderId === order.id && "active")}
                  onClick={() => onSelectOrder(order.id)}
                  key={order.id}
                >
                  <span className="mono">{order.shipmentPackageId}</span>
                  <strong>{order.customerName || "Alici eksik"}</strong>
                  <small>
                    {order.city || "Sehir yok"} · Teslim {order.deliveredAt ? formatDateTime(order.deliveredAt) : "-"} ·{" "}
                    {money(order.totalPayableCents, order.currency)}
                  </small>
                  <span className={cx("status-pill", statusTone(order.draftStatus))}>{statusLabel(order.draftStatus ?? "YOK")}</span>
                </button>
              ))}
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

function OrderTableRow({ order, selected, onSelect }: { order: OrderListItem; selected: boolean; onSelect: () => void }) {
  const invoiceDisplay = invoiceStateForOrder(order);

  return (
    <tr
      className={cx(selected && "selected-row")}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      <td className="mono">{order.shipmentPackageId}</td>
      <td>{order.orderNumber}</td>
      <td>{order.deliveredAt ? formatDateTime(order.deliveredAt) : <span className="muted">-</span>}</td>
      <td>{order.customerName || <span className="muted">Eksik</span>}</td>
      <td>{order.city || <span className="muted">Eksik</span>}</td>
      <td>{money(order.totalPayableCents, order.currency)}</td>
      <td>
        <span className={cx("status-pill", statusTone(order.draftStatus))}>{statusLabel(order.draftStatus ?? "YOK")}</span>
      </td>
      <td>
        <span className={cx("status-pill", invoiceDisplay.tone)}>{invoiceDisplay.label}</span>
      </td>
      <td onClick={(event) => event.stopPropagation()}>
        {order.invoiceId && order.invoicePdfAvailable ? (
          <a className="text-link" href={api.invoicePdfUrl(order.invoiceId)} target="_blank" rel="noreferrer">
            PDF
          </a>
        ) : order.invoiceId ? (
          <span className="muted">PDF bekliyor</span>
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
    </tr>
  );
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
          <span className="status-pill warning">PDF bekliyor</span>
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
