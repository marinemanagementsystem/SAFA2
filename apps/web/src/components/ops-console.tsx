"use client";

import type {
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  OrderDetail,
  OrderListItem
} from "@safa/shared";
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  Eye,
  FileCheck2,
  FileText,
  KeyRound,
  ListFilter,
  Loader2,
  LockKeyhole,
  LogIn,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Settings2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ConnectionsSnapshot, GibPortalConnectionInput, TrendyolConnectionInput } from "../lib/api";

type LoadState = "idle" | "loading" | "error";
type InvoiceFilter = "all" | "issued" | "unissued" | "issued-today" | "issued-previous";
type DateFilter = "all" | "today" | "last7" | "last30";
type OrderSortField =
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

function money(cents: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency
  }).format(cents / 100);
}

function badgeClass(status?: string) {
  if (!status) return "badge";
  if (["READY", "APPROVED", "ISSUED", "TRENDYOL_SENT", "SUCCESS"].includes(status)) return "badge success";
  if (["PENDING", "PROCESSING", "ISSUING", "NEEDS_REVIEW"].includes(status)) return "badge processing";
  if (["ERROR", "FAILED", "TRENDYOL_SEND_FAILED", "SEND_FAILED"].includes(status)) return "badge error";
  return "badge";
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateMatches(value: string | undefined, filter: DateFilter) {
  if (filter === "all") return true;
  if (!value) return false;

  const date = new Date(value);
  const today = startOfToday();

  if (filter === "today") return date >= today;

  const days = filter === "last7" ? 7 : 30;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  return date >= threshold;
}

function stringValue(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("tr-TR");
}

function numberValue(value: unknown) {
  if (value === undefined || value === null || value === "") return Number.NEGATIVE_INFINITY;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY;
}

function lineNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function OpsConsole() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [drafts, setDrafts] = useState<InvoiceDraftListItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [jobs, setJobs] = useState<IntegrationJobListItem[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [connections, setConnections] = useState<ConnectionsSnapshot | null>(null);
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [query, setQuery] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [draftStatusFilter, setDraftStatusFilter] = useState("all");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortState>({ field: "updatedAt", direction: "desc" });
  const [message, setMessage] = useState("Canli entegrasyon modu acik. Sahte veri uretilmez; baglanti yoksa islem hata verir.");
  const [trendyolForm, setTrendyolForm] = useState<TrendyolConnectionInput>({
    sellerId: "",
    apiKey: "",
    apiSecret: "",
    userAgent: "SAFA local e-arsiv integration",
    baseUrl: "https://apigw.trendyol.com",
    storefrontCode: "TR",
    lookbackDays: 14
  });
  const [gibPortalForm, setGibPortalForm] = useState<GibPortalConnectionInput>({
    username: "",
    password: "",
    portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html"
  });

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const [ordersData, draftsData, invoicesData, jobsData, settingsData, connectionsData] = await Promise.all([
        api.orders(),
        api.drafts(),
        api.invoices(),
        api.jobs(),
        api.settings(),
        api.connections()
      ]);
      setOrders(ordersData);
      setDrafts(draftsData);
      setInvoices(invoicesData);
      setJobs(jobsData);
      setSettings(settingsData.runtime ?? {});
      setConnections(connectionsData);
      setTrendyolForm({
        sellerId: connectionsData.trendyol.sellerId,
        apiKey: "",
        apiSecret: "",
        userAgent: connectionsData.trendyol.userAgent,
        baseUrl: connectionsData.trendyol.baseUrl,
        storefrontCode: connectionsData.trendyol.storefrontCode,
        lookbackDays: connectionsData.trendyol.lookbackDays
      });
      setGibPortalForm({
        username: connectionsData.gibPortal.username,
        password: "",
        portalUrl: connectionsData.gibPortal.portalUrl
      });
      setLoadState("idle");
    } catch (error) {
      setLoadState("error");
      setMessage(error instanceof Error ? error.message : "API baglantisi basarisiz.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrder(null);
      setDetailState("idle");
      return;
    }

    let cancelled = false;
    setDetailState("loading");

    api
      .order(selectedOrderId)
      .then((detail) => {
        if (cancelled) return;
        setSelectedOrder(detail);
        setDetailState("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setSelectedOrder(null);
        setDetailState("error");
        setMessage(error instanceof Error ? error.message : "Siparis detayi alinamadi.");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOrderId]);

  const metrics = useMemo(() => {
    const ready = drafts.filter((draft) => draft.status === "READY").length;
    const approved = drafts.filter((draft) => draft.status === "APPROVED").length;
    const failed = jobs.filter((job) => job.status === "FAILED").length;
    const issued = orders.filter((order) => order.invoiceId).length;
    const unissued = Math.max(orders.length - issued, 0);
    return [
      { label: "Teslim paket", value: orders.length },
      { label: "Hazir taslak", value: ready },
      { label: "Onayli taslak", value: approved },
      { label: "Kesilen / kesilmeyen", value: `${issued} / ${unissued}${failed > 0 ? ` / ${failed} hata` : ""}` }
    ];
  }, [drafts, jobs, orders]);

  const filterOptions = useMemo(() => {
    const statuses = Array.from(new Set(orders.map((order) => order.status).filter(Boolean))).sort();
    const draftStatuses = Array.from(new Set(orders.map((order) => order.draftStatus).filter(Boolean))).sort();
    const cities = Array.from(new Set(orders.map((order) => order.city).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, "tr-TR")
    );

    return { statuses, draftStatuses, cities };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const today = startOfToday();
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
        order.trendyolStatus,
        order.draftStatus
      ]
        .map(stringValue)
        .join(" ");

      if (search && !haystack.includes(search)) return false;
      if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) return false;
      if (draftStatusFilter !== "all" && (order.draftStatus ?? "YOK") !== draftStatusFilter) return false;
      if (cityFilter !== "all" && order.city !== cityFilter) return false;
      if (!dateMatches(order.lastModifiedAt ?? order.updatedAt, dateFilter)) return false;

      if (invoiceFilter === "issued" && !order.invoiceId) return false;
      if (invoiceFilter === "unissued" && order.invoiceId) return false;
      if (invoiceFilter === "issued-today" && (!order.invoiceDate || new Date(order.invoiceDate) < today)) return false;
      if (invoiceFilter === "issued-previous" && (!order.invoiceDate || new Date(order.invoiceDate) >= today)) return false;

      return true;
    });

    const direction = sort.direction === "asc" ? 1 : -1;

    return filtered.sort((left, right) => {
      let result = 0;

      if (sort.field === "totalPayableCents") {
        result = numberValue(left.totalPayableCents) - numberValue(right.totalPayableCents);
      } else if (sort.field === "updatedAt") {
        result =
          new Date(left.lastModifiedAt ?? left.updatedAt).getTime() -
          new Date(right.lastModifiedAt ?? right.updatedAt).getTime();
      } else {
        result = stringValue(left[sort.field]).localeCompare(stringValue(right[sort.field]), "tr-TR");
      }

      return result * direction;
    });
  }, [cityFilter, dateFilter, draftStatusFilter, invoiceFilter, orderStatusFilter, orders, query, sort]);

  const invoiceGroups = useMemo(() => {
    const today = startOfToday();
    const newInvoices = invoices.filter((invoice) => new Date(invoice.invoiceDate) >= today);
    const previousInvoices = invoices.filter((invoice) => new Date(invoice.invoiceDate) < today);
    return { newInvoices, previousInvoices };
  }, [invoices]);

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
    setSort({ field: "updatedAt", direction: "desc" });
  }

  async function sync() {
    setMessage("Trendyol senkronizasyonu baslatildi.");
    const result = await api.sync();
    setMessage(`${result.upserted} siparis guncellendi, ${result.draftsCreated} yeni taslak olustu.`);
    await load();
  }

  async function approveSelected() {
    for (const id of selectedDrafts) {
      await api.approve(id);
    }
    setMessage(`${selectedDrafts.length} taslak onaylandi.`);
    setSelectedDrafts([]);
    await load();
  }

  async function issueSelected() {
    const result = await api.issue(selectedDrafts);
    setMessage(`${result.enqueued} fatura isi kuyruga alindi. Kisa sure sonra liste yenilenecek.`);
    setSelectedDrafts([]);
    window.setTimeout(() => void load(), 1400);
  }

  async function saveTrendyol() {
    const updated = await api.saveTrendyolConnection(trendyolForm);
    setConnections(updated);
    setMessage("Trendyol baglanti bilgileri sifreli olarak kaydedildi.");
    await load();
  }

  async function saveGibPortal() {
    const updated = await api.saveGibPortalConnection(gibPortalForm);
    setConnections(updated);
    setMessage("e-Arsiv portal bilgileri sifreli olarak kaydedildi.");
    await load();
  }

  async function openGibPortal() {
    const popup = window.open("about:blank", "gib-earsiv-portal", "popup=yes,width=1280,height=860");
    if (!popup) {
      setMessage("Popup engellendi. Tarayicida bu site icin popup izni verin.");
      return;
    }

    popup.document.write("<p style=\"font-family:Arial;padding:24px\">e-Arsiv oturumu aciliyor...</p>");

    if (!connections?.gibPortal.configured) {
      popup.location.href = gibPortalForm.portalUrl;
      setMessage("e-Arsiv portal bilgisi kayitli degil; portal manuel giris icin acildi.");
      return;
    }

    try {
      const session = await api.openEarsivPortalSession();
      popup.location.href = session.launchUrl;
      setMessage(session.tokenReceived ? "e-Arsiv portali tokenli oturumla acildi." : "e-Arsiv portali acildi.");
    } catch (error) {
      popup.location.href = gibPortalForm.portalUrl;
      setMessage(error instanceof Error ? error.message : "e-Arsiv oturumu acilamadi; portal manuel giris icin acildi.");
    }
  }

  function openTrendyolPartner() {
    window.open("https://partner.trendyol.com/", "trendyol-partner", "popup=yes,width=1280,height=860");
  }

  const readyOrApproved = drafts.filter((draft) => draft.status === "READY" || draft.status === "APPROVED");

  return (
    <main className="shell">
      <section className="topbar" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">SAFA / yerel operasyon paneli</p>
          <h1 id="page-title">Trendyol e-Arsiv masasi</h1>
          <p className="subtitle">
            Teslim edilen Trendyol paketlerini izler, e-Arsiv taslaklarini kontrol ettirir, onaylananlari GIB direct
            entegrasyon akisiyle faturalandirir ve PDF bilgisini Trendyol tarafina geri yollar.
          </p>
        </div>
        <div className="toolbar" aria-label="Ana islemler">
          <button className="button secondary" onClick={() => void load()} disabled={loadState === "loading"} title="Verileri yenile">
            {loadState === "loading" ? <Loader2 size={18} /> : <RefreshCw size={18} />}
            Yenile
          </button>
          <button className="button accent" onClick={() => void sync()} title="Trendyol siparislerini cek">
            <Send size={18} />
            Trendyol cek
          </button>
          <button className="button secondary" onClick={() => void openGibPortal()} title="e-Arsiv portalini ac">
            <LogIn size={18} />
            e-Arsiv ac
          </button>
        </div>
      </section>

      <section className="metrics" aria-label="Ozet metrikler">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      <p className="notice">
        {message} {settings.liveIntegrationsOnly === true ? "Canli entegrasyon modu acik." : "Canli mod kontrol ediliyor."}
      </p>

      <section className="layout">
        <div className="main-column">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <ClipboardList size={22} />
                <div>
                  <h2>Siparis ve fatura listesi</h2>
                  <p>{filteredOrders.length} kayit gosteriliyor; satira tiklayinca icerik acilir.</p>
                </div>
              </div>
              <button className="button secondary compact" onClick={resetFilters} title="Filtreleri temizle">
                <X size={17} />
                Temizle
              </button>
            </div>

            <div className="filter-grid" aria-label="Liste filtreleri">
              <label className="search-field">
                <Search size={18} />
                <span>Arama</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Siparis, paket, alici, sehir, fatura no"
                />
              </label>
              <label>
                <ListFilter size={18} />
                <span>Fatura</span>
                <select value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value as InvoiceFilter)}>
                  <option value="all">Tum kayitlar</option>
                  <option value="issued">Kesilenler</option>
                  <option value="unissued">Kesilmeyenler</option>
                  <option value="issued-today">Bugun kesilenler</option>
                  <option value="issued-previous">Onceki faturalar</option>
                </select>
              </label>
              <label>
                <ListFilter size={18} />
                <span>Trendyol</span>
                <select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
                  <option value="all">Tum durumlar</option>
                  {filterOptions.statuses.map((status) => (
                    <option value={status} key={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <FileCheck2 size={18} />
                <span>Taslak</span>
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
              <label>
                <CalendarDays size={18} />
                <span>Tarih</span>
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}>
                  <option value="all">Tum zamanlar</option>
                  <option value="today">Bugun guncellenen</option>
                  <option value="last7">Son 7 gun</option>
                  <option value="last30">Son 30 gun</option>
                </select>
              </label>
              <label>
                <ListFilter size={18} />
                <span>Sehir</span>
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

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("shipmentPackageId")}>
                        Paket <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("orderNumber")}>
                        Siparis <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("customerName")}>
                        Alici <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("city")}>
                        Sehir <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("totalPayableCents")}>
                        Tutar <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("draftStatus")}>
                        Taslak <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>
                      <button className="sort-head" onClick={() => changeSort("invoiceNumber")}>
                        Fatura <ArrowUpDown size={14} />
                      </button>
                    </th>
                    <th>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr
                      className={selectedOrderId === order.id ? "selected-row" : undefined}
                      key={order.id}
                      onClick={() => setSelectedOrderId(order.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setSelectedOrderId(order.id);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td className="mono">{order.shipmentPackageId}</td>
                      <td>{order.orderNumber}</td>
                      <td>{order.customerName || <span className="muted">Eksik</span>}</td>
                      <td>{order.city || <span className="muted">Eksik</span>}</td>
                      <td>{money(order.totalPayableCents, order.currency)}</td>
                      <td>
                        <span className={badgeClass(order.draftStatus)}>{order.draftStatus ?? "YOK"}</span>
                      </td>
                      <td>
                        <span className={badgeClass(order.invoiceId ? order.trendyolStatus ?? "ISSUED" : "PENDING")}>
                          {order.invoiceNumber ?? "Kesilmedi"}
                        </span>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {order.invoiceId ? (
                          <a className="icon-link" href={api.invoicePdfUrl(order.invoiceId)} target="_blank" rel="noreferrer" title="Fatura PDF ac">
                            <FileText size={17} />
                            PDF
                          </a>
                        ) : order.draftId ? (
                          <a className="icon-link" href={api.draftPdfUrl(order.draftId)} target="_blank" rel="noreferrer" title="Taslak PDF ac">
                            <FileText size={17} />
                            Taslak
                          </a>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orders.length === 0 ? <div className="empty">Once Trendyol cek islemini calistirin.</div> : null}
              {orders.length > 0 && filteredOrders.length === 0 ? <div className="empty">Bu filtrelerle kayit bulunamadi.</div> : null}
            </div>
          </div>

          <div className="panel detail-panel">
            <div className="panel-header">
              <div className="panel-title">
                <Eye size={22} />
                <div>
                  <h2>Siparis icerigi</h2>
                  <p>{selectedOrder ? selectedOrder.orderNumber : "Listeden bir satir secin"}</p>
                </div>
              </div>
            </div>
            {detailState === "loading" ? (
              <div className="empty">Detay yukleniyor...</div>
            ) : selectedOrder ? (
              <div className="detail-body">
                <div className="detail-summary">
                  <div>
                    <span>Alici</span>
                    <strong>{selectedOrder.customerName}</strong>
                    <p>{selectedOrder.customerEmail ?? "E-posta yok"}</p>
                  </div>
                  <div>
                    <span>Adres</span>
                    <strong>{String(selectedOrder.invoiceAddress.city ?? "-")}</strong>
                    <p>{String(selectedOrder.invoiceAddress.addressLine ?? selectedOrder.invoiceAddress.address1 ?? "-")}</p>
                  </div>
                  <div>
                    <span>Toplam</span>
                    <strong>{money(selectedOrder.totalPayableCents, selectedOrder.currency)}</strong>
                    <p>Indirim: {money(selectedOrder.totalDiscountCents, selectedOrder.currency)}</p>
                  </div>
                  <div>
                    <span>Fatura</span>
                    <strong>{selectedOrder.invoice?.invoiceNumber ?? "Kesilmedi"}</strong>
                    <p>{selectedOrder.invoice ? formatDateTime(selectedOrder.invoice.invoiceDate) : selectedOrder.draft?.status ?? "Taslak yok"}</p>
                  </div>
                </div>

                <div className="detail-actions">
                  {selectedOrder.invoice ? (
                    <a className="button accent" href={api.invoicePdfUrl(selectedOrder.invoice.id)} target="_blank" rel="noreferrer">
                      <FileText size={18} />
                      Fatura PDF
                    </a>
                  ) : selectedOrder.draft ? (
                    <a className="button accent" href={api.draftPdfUrl(selectedOrder.draft.id)} target="_blank" rel="noreferrer">
                      <FileText size={18} />
                      Taslak PDF
                    </a>
                  ) : null}
                  <span className={badgeClass(selectedOrder.invoice ? selectedOrder.invoice.status : selectedOrder.draft?.status)}>
                    {selectedOrder.invoice ? selectedOrder.invoice.status : selectedOrder.draft?.status ?? "Fatura yok"}
                  </span>
                </div>

                {selectedOrder.draft?.warnings.length ? (
                  <div className="warning-box">{selectedOrder.draft.warnings.join(" ")}</div>
                ) : null}

                <div className="line-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Urun</th>
                        <th>Miktar</th>
                        <th>Birim</th>
                        <th>KDV</th>
                        <th>Tutar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedOrder.draft?.lines ?? []).map((line, index) => (
                        <tr key={`${String(line.description)}-${index}`}>
                          <td>{String(line.description ?? "-")}</td>
                          <td>{lineNumber(line.quantity)}</td>
                          <td>{money(lineNumber(line.unitPriceCents), selectedOrder.currency)}</td>
                          <td>%{lineNumber(line.vatRate)}</td>
                          <td>{money(lineNumber(line.payableCents), selectedOrder.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!selectedOrder.draft?.lines.length ? <div className="empty">Taslak satiri yok.</div> : null}
                </div>

                <details className="raw-detail">
                  <summary>Ham Trendyol verisi</summary>
                  <pre>{JSON.stringify(selectedOrder.raw, null, 2)}</pre>
                </details>
              </div>
            ) : (
              <div className="empty">Filtrelenmis listeden bir siparis secin.</div>
            )}
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <PlugZap size={22} />
                <div>
                  <h2>Baglantilar</h2>
                  <p>Trendyol ve e-Arsiv oturum bilgileri</p>
                </div>
              </div>
            </div>
            <div className="connection-stack">
              <form
                className="connection-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTrendyol();
                }}
              >
                <div className="form-head">
                  <h3>Trendyol Partner</h3>
                  <span className={connections?.trendyol.configured ? "badge success" : "badge processing"}>
                    {connections?.trendyol.configured ? "BAGLI" : "BEKLIYOR"}
                  </span>
                </div>
                <label>
                  Satici ID
                  <input
                    value={trendyolForm.sellerId}
                    onChange={(event) => setTrendyolForm((current) => ({ ...current, sellerId: event.target.value }))}
                    autoComplete="off"
                  />
                </label>
                <label>
                  API Key
                  <input
                    value={trendyolForm.apiKey ?? ""}
                    onChange={(event) => setTrendyolForm((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder={connections?.trendyol.apiKeyMasked ?? ""}
                    autoComplete="off"
                  />
                </label>
                <label>
                  API Secret
                  <input
                    type="password"
                    value={trendyolForm.apiSecret ?? ""}
                    onChange={(event) => setTrendyolForm((current) => ({ ...current, apiSecret: event.target.value }))}
                    placeholder={connections?.trendyol.apiSecretSaved ? "Kayitli" : ""}
                    autoComplete="new-password"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Storefront
                    <input
                      value={trendyolForm.storefrontCode}
                      onChange={(event) => setTrendyolForm((current) => ({ ...current, storefrontCode: event.target.value }))}
                    />
                  </label>
                  <label>
                    Gun
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={trendyolForm.lookbackDays}
                      onChange={(event) => setTrendyolForm((current) => ({ ...current, lookbackDays: Number(event.target.value) }))}
                    />
                  </label>
                </div>
                <label>
                  User-Agent
                  <input
                    value={trendyolForm.userAgent}
                    onChange={(event) => setTrendyolForm((current) => ({ ...current, userAgent: event.target.value }))}
                  />
                </label>
                <div className="form-actions">
                  <button className="button secondary" type="button" onClick={openTrendyolPartner}>
                    <KeyRound size={18} />
                    Partner ac
                  </button>
                  <button className="button accent" type="submit">
                    <LockKeyhole size={18} />
                    Kaydet
                  </button>
                </div>
              </form>

              <form
                className="connection-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveGibPortal();
                }}
              >
                <div className="form-head">
                  <h3>e-Arsiv Portal</h3>
                  <span className={connections?.gibPortal.configured ? "badge success" : "badge processing"}>
                    {connections?.gibPortal.configured ? "BAGLI" : "BEKLIYOR"}
                  </span>
                </div>
                <label>
                  Kullanici
                  <input
                    value={gibPortalForm.username}
                    onChange={(event) => setGibPortalForm((current) => ({ ...current, username: event.target.value }))}
                    autoComplete="username"
                  />
                </label>
                <label>
                  Sifre
                  <input
                    type="password"
                    value={gibPortalForm.password ?? ""}
                    onChange={(event) => setGibPortalForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder={connections?.gibPortal.passwordSaved ? "Kayitli" : ""}
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  Portal URL
                  <input
                    value={gibPortalForm.portalUrl}
                    onChange={(event) => setGibPortalForm((current) => ({ ...current, portalUrl: event.target.value }))}
                  />
                </label>
                <div className="form-actions">
                  <button className="button secondary" type="button" onClick={() => void openGibPortal()}>
                    <LogIn size={18} />
                    Portal ac
                  </button>
                  <button className="button accent" type="submit">
                    <LockKeyhole size={18} />
                    Kaydet
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <FileText size={22} />
                <div>
                  <h2>Fatura arsivi</h2>
                  <p>Yeni ve onceki PDF faturalar</p>
                </div>
              </div>
            </div>
            <div className="invoice-archive">
              <section>
                <div className="archive-head">
                  <h3>Bugun kesilenler</h3>
                  <span>{invoiceGroups.newInvoices.length}</span>
                </div>
                {invoiceGroups.newInvoices.map((invoice) => (
                  <a className="invoice-row" href={api.invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer" key={invoice.id}>
                    <strong>{invoice.invoiceNumber}</strong>
                    <span>{invoice.orderNumber}</span>
                    <small>{formatDateTime(invoice.invoiceDate)}</small>
                  </a>
                ))}
                {invoiceGroups.newInvoices.length === 0 ? <div className="mini-empty">Bugun kesilen fatura yok.</div> : null}
              </section>
              <section>
                <div className="archive-head">
                  <h3>Onceki faturalar</h3>
                  <span>{invoiceGroups.previousInvoices.length}</span>
                </div>
                {invoiceGroups.previousInvoices.slice(0, 8).map((invoice) => (
                  <a className="invoice-row" href={api.invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer" key={invoice.id}>
                    <strong>{invoice.invoiceNumber}</strong>
                    <span>{invoice.orderNumber}</span>
                    <small>{formatDateTime(invoice.invoiceDate)}</small>
                  </a>
                ))}
                {invoiceGroups.previousInvoices.length === 0 ? <div className="mini-empty">Onceki fatura yok.</div> : null}
              </section>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <FileCheck2 size={22} />
                <div>
                  <h2>Fatura taslaklari</h2>
                  <p>{selectedDrafts.length} secili</p>
                </div>
              </div>
            </div>
            <div className="draft-list">
              {readyOrApproved.map((draft) => (
                <label className="draft-row" key={draft.id}>
                  <input
                    type="checkbox"
                    checked={selectedDrafts.includes(draft.id)}
                    onChange={(event) => {
                      setSelectedDrafts((current) =>
                        event.target.checked ? [...current, draft.id] : current.filter((id) => id !== draft.id)
                      );
                    }}
                  />
                  <span>
                    <h3>{draft.orderNumber}</h3>
                    <p>
                      {draft.customerName} · {money(draft.totalPayableCents, draft.currency)} · {draft.lineCount} satir
                    </p>
                  <p>
                    <span className={badgeClass(draft.status)}>{draft.status}</span>
                  </p>
                  {draft.warnings.length > 0 ? <p>{draft.warnings[0]}</p> : null}
                  <p>
                    <a className="inline-link" href={api.draftPdfUrl(draft.id)} target="_blank" rel="noreferrer">
                      Taslak PDF
                    </a>
                  </p>
                </span>
              </label>
              ))}
              {readyOrApproved.length === 0 ? <div className="empty">Onaya hazir taslak yok.</div> : null}
              <button className="button secondary" onClick={() => void approveSelected()} disabled={selectedDrafts.length === 0}>
                <Check size={18} />
                Seciliyi onayla
              </button>
              <button className="button accent" onClick={() => void issueSelected()} disabled={selectedDrafts.length === 0}>
                <CircleDollarSign size={18} />
                Fatura kes
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <AlertTriangle size={22} />
                <div>
                  <h2>Is kuyruğu</h2>
                  <p>Fatura ve Trendyol gonderim denemeleri</p>
                </div>
              </div>
            </div>
            <div className="job-list">
              {jobs.slice(0, 8).map((job) => (
                <div className="job-row" key={job.id}>
                  <h3>
                    <span className={badgeClass(job.status)}>{job.status}</span> {job.type}
                  </h3>
                  <p className="mono">{job.target}</p>
                  {job.lastError ? <p>{job.lastError}</p> : null}
                </div>
              ))}
              {jobs.length === 0 ? <div className="empty">Kuyruk bos.</div> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Settings2 size={22} />
                <div>
                  <h2>Ayar durumu</h2>
                  <p>{settings.invoiceProvider ? `Saglayici: ${String(settings.invoiceProvider)}` : "Ayar bekleniyor"}</p>
                </div>
              </div>
            </div>
            <div className="job-list">
              <div className="job-row">
                <h3>Trendyol</h3>
                <p>{settings.trendyolConfigured ? "API bilgileri tanimli." : "Canli Trendyol bilgileri henuz tanimli degil."}</p>
              </div>
              <div className="job-row">
                <h3>GIB direct</h3>
                <p>{settings.gibDirectConfigured ? "GIB servis ve imza bilgileri tanimli." : "GIB direct canli yetki ve imza bilgileri bekleniyor."}</p>
              </div>
              <div className="job-row">
                <h3>Saklama</h3>
                <p>{String(settings.storageDir ?? "./storage")}</p>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
