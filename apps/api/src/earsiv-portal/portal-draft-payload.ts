import { randomUUID } from "node:crypto";
import type { ArchiveInvoicePayload } from "../invoice/invoice-provider";

export interface GibPortalInvoiceDraftLine {
  malHizmet: string;
  miktar: number;
  birim: string;
  birimFiyat: number;
  fiyat: number;
  iskontoArttm: string;
  iskontoOrani: number;
  iskontoTutari: number;
  iskontoNedeni: string;
  malHizmetTutari: number;
  kdvOrani: number;
  kdvTutari: number;
  tevkifatKodu: number;
  ozelMatrahNedeni: number;
  ozelMatrahTutari: number;
  gtip: string;
}

export interface GibPortalInvoiceDraftPayload {
  faturaUuid: string;
  belgeNumarasi: string;
  faturaTarihi: string;
  saat: string;
  paraBirimi: string;
  dovzTLkur: number;
  faturaTipi: string;
  hangiTip: string;
  vknTckn: string;
  aliciUnvan: string;
  aliciAdi: string;
  aliciSoyadi: string;
  binaAdi: string;
  binaNo: string;
  kapiNo: string;
  kasabaKoy: string;
  vergiDairesi: string;
  ulke: string;
  bulvarcaddesokak: string;
  mahalleSemtIlce: string;
  sehir: string;
  postaKodu: string;
  tel: string;
  fax: string;
  eposta: string;
  websitesi: string;
  iadeTable: unknown[];
  ozelMatrahTutari: number;
  ozelMatrahOrani: number;
  ozelMatrahVergiTutari: number;
  vergiCesidi: string;
  malHizmetTable: GibPortalInvoiceDraftLine[];
  tip: string;
  matrah: number;
  malhizmetToplamTutari: number;
  toplamIskonto: number;
  hesaplanankdv: number;
  vergilerToplami: number;
  vergilerDahilToplamTutar: number;
  toplamMasraflar: number;
  odenecekTutar: number;
  not: string;
  siparisNumarasi: string;
  siparisTarihi: string;
  irsaliyeNumarasi: string;
  irsaliyeTarihi: string;
  fisNo: string;
  fisTarihi: string;
  fisSaati: string;
  fisTipi: string;
  zRaporNo: string;
  okcSeriNo: string;
}

export interface BuildGibPortalDraftPayloadOptions {
  uuid?: string;
  issuedAt?: Date;
  unitCode?: string;
}

const portalEttnPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function digits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizePortalEttn(value: string) {
  const ettn = value.trim().replace(/[{}]/g, "").toLowerCase();
  if (!portalEttnPattern.test(ettn)) {
    throw new Error("GIB portal ETTN 36 karakterlik UUID formatinda olmali.");
  }

  return ettn;
}

function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function centsToAmount(cents: number) {
  return roundAmount(cents / 100);
}

function vatExclusiveCents(inclusiveCents: number, vatRate: number) {
  if (vatRate <= 0) return inclusiveCents;
  return Math.round((inclusiveCents * 100) / (100 + vatRate));
}

function formatPortalDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function formatPortalTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function splitBuyerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Nihai", lastName: "Tuketici" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "Tuketici" };
  const lastName = parts.pop() ?? "Tuketici";
  return { firstName: parts.join(" "), lastName };
}

function normalizeBuyerIdentifier(value: string) {
  const normalized = digits(value);
  if (normalized.length === 10 || normalized.length === 11) return normalized;
  return "11111111111";
}

function buildPortalLine(
  line: ArchiveInvoicePayload["lines"][number],
  unitCode: string
): GibPortalInvoiceDraftLine {
  const quantity = line.quantity > 0 ? line.quantity : 1;
  const grossInclusiveCents = Math.max(line.grossCents, line.payableCents + line.discountCents);
  const discountInclusiveCents = Math.max(0, line.discountCents);
  const grossBaseCents = vatExclusiveCents(grossInclusiveCents, line.vatRate);
  const discountBaseCents = vatExclusiveCents(discountInclusiveCents, line.vatRate);
  const taxableBaseCents = Math.max(0, grossBaseCents - discountBaseCents);
  const vatCents = Math.max(0, line.payableCents - taxableBaseCents);
  const discountRate = grossBaseCents > 0 ? (discountBaseCents / grossBaseCents) * 100 : 0;

  return {
    malHizmet: line.description || "Urun",
    miktar: quantity,
    birim: unitCode,
    birimFiyat: centsToAmount(Math.round(grossBaseCents / quantity)),
    fiyat: centsToAmount(grossBaseCents),
    iskontoArttm: "\u0130skonto",
    iskontoOrani: roundAmount(discountRate),
    iskontoTutari: centsToAmount(discountBaseCents),
    iskontoNedeni: "",
    malHizmetTutari: centsToAmount(taxableBaseCents),
    kdvOrani: line.vatRate,
    kdvTutari: centsToAmount(vatCents),
    tevkifatKodu: 0,
    ozelMatrahNedeni: 0,
    ozelMatrahTutari: 0,
    gtip: ""
  };
}

export function buildGibPortalInvoiceDraftPayload(
  payload: ArchiveInvoicePayload,
  options: BuildGibPortalDraftPayloadOptions = {}
): GibPortalInvoiceDraftPayload {
  const issuedAt = options.issuedAt ?? new Date();
  const ettn = normalizePortalEttn(options.uuid ?? randomUUID());
  const unitCode = options.unitCode ?? "C62";
  const buyerIdentifier = normalizeBuyerIdentifier(payload.buyerIdentifier);
  const isCompany = buyerIdentifier.length === 10;
  const buyerName = payload.buyerName.trim();
  const personName = splitBuyerName(buyerName);
  const lines = payload.lines.map((line) => buildPortalLine(line, unitCode));
  const serviceTotal = roundAmount(lines.reduce((sum, line) => sum + line.fiyat, 0));
  const discountTotal = roundAmount(lines.reduce((sum, line) => sum + line.iskontoTutari, 0));
  const taxableTotal = roundAmount(lines.reduce((sum, line) => sum + line.malHizmetTutari, 0));
  const vatTotal = roundAmount(lines.reduce((sum, line) => sum + line.kdvTutari, 0));
  const payableTotal = roundAmount(taxableTotal + vatTotal);

  return {
    faturaUuid: ettn,
    belgeNumarasi: "",
    faturaTarihi: formatPortalDate(issuedAt),
    saat: formatPortalTime(issuedAt),
    paraBirimi: payload.totals.currency || "TRY",
    dovzTLkur: 0,
    faturaTipi: "SATIS",
    hangiTip: "5000/30000",
    vknTckn: buyerIdentifier,
    aliciUnvan: isCompany ? buyerName : "",
    aliciAdi: isCompany ? "" : personName.firstName,
    aliciSoyadi: isCompany ? "" : personName.lastName,
    binaAdi: "",
    binaNo: "",
    kapiNo: "",
    kasabaKoy: "",
    vergiDairesi: "",
    ulke: payload.address.countryCode === "TR" ? "T\u00fcrkiye" : payload.address.countryCode,
    bulvarcaddesokak: payload.address.addressLine,
    mahalleSemtIlce: payload.address.district ?? "",
    sehir: payload.address.city,
    postaKodu: "",
    tel: "",
    fax: "",
    eposta: "",
    websitesi: "",
    iadeTable: [],
    ozelMatrahTutari: 0,
    ozelMatrahOrani: 0,
    ozelMatrahVergiTutari: 0,
    vergiCesidi: "",
    malHizmetTable: lines,
    tip: "\u0130skonto",
    matrah: taxableTotal,
    malhizmetToplamTutari: serviceTotal,
    toplamIskonto: discountTotal,
    hesaplanankdv: vatTotal,
    vergilerToplami: vatTotal,
    vergilerDahilToplamTutar: payableTotal,
    toplamMasraflar: 0,
    odenecekTutar: payableTotal,
    not: `Trendyol siparis no: ${payload.orderNumber} / Paket: ${payload.shipmentPackageId}`,
    siparisNumarasi: payload.orderNumber,
    siparisTarihi: "",
    irsaliyeNumarasi: "",
    irsaliyeTarihi: "",
    fisNo: "",
    fisTarihi: "",
    fisSaati: "",
    fisTipi: "",
    zRaporNo: "",
    okcSeriNo: ""
  };
}
