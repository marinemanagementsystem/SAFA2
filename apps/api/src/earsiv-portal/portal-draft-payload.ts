import { randomUUID } from "node:crypto";
import { invoiceNote } from "../invoice/invoice-note";
import type { ArchiveInvoicePayload } from "../invoice/invoice-provider";

type PortalAmount = string;

export interface GibPortalInvoiceDraftLine {
  malHizmet: string;
  miktar: number;
  birim: string;
  birimFiyat: PortalAmount;
  fiyat: PortalAmount;
  iskontoArttm: string;
  iskontoOrani: number;
  iskontoTutari: PortalAmount;
  iskontoNedeni: string;
  malHizmetTutari: PortalAmount;
  kdvOrani: string;
  vergiOrani: number;
  kdvTutari: PortalAmount;
  vergininKdvTutari: PortalAmount;
}

export interface GibPortalInvoiceDraftPayload {
  faturaUuid: string;
  belgeNumarasi: string;
  faturaTarihi: string;
  saat: string;
  paraBirimi: string;
  dovzTLkur: string;
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
  komisyonOrani: number;
  navlunOrani: number;
  hammaliyeOrani: number;
  nakliyeOrani: number;
  komisyonTutari: PortalAmount;
  navlunTutari: PortalAmount;
  hammaliyeTutari: PortalAmount;
  nakliyeTutari: PortalAmount;
  komisyonKDVOrani: number;
  navlunKDVOrani: number;
  hammaliyeKDVOrani: number;
  nakliyeKDVOrani: number;
  komisyonKDVTutari: PortalAmount;
  navlunKDVTutari: PortalAmount;
  hammaliyeKDVTutari: PortalAmount;
  nakliyeKDVTutari: PortalAmount;
  gelirVergisiOrani: number;
  bagkurTevkifatiOrani: number;
  gelirVergisiTevkifatiTutari: PortalAmount;
  bagkurTevkifatiTutari: PortalAmount;
  halRusumuOrani: number;
  ticaretBorsasiOrani: number;
  milliSavunmaFonuOrani: number;
  digerOrani: number;
  halRusumuTutari: PortalAmount;
  ticaretBorsasiTutari: PortalAmount;
  milliSavunmaFonuTutari: PortalAmount;
  digerTutari: PortalAmount;
  halRusumuKDVOrani: number;
  ticaretBorsasiKDVOrani: number;
  milliSavunmaFonuKDVOrani: number;
  digerKDVOrani: number;
  halRusumuKDVTutari: PortalAmount;
  ticaretBorsasiKDVTutari: PortalAmount;
  milliSavunmaFonuKDVTutari: PortalAmount;
  digerKDVTutari: PortalAmount;
  iadeTable: unknown[];
  ozelMatrahTutari: PortalAmount;
  ozelMatrahOrani: number;
  ozelMatrahVergiTutari: PortalAmount;
  vergiCesidi: string;
  malHizmetTable: GibPortalInvoiceDraftLine[];
  tip: string;
  matrah: PortalAmount;
  malhizmetToplamTutari: PortalAmount;
  toplamIskonto: PortalAmount;
  hesaplanankdv: PortalAmount;
  vergilerToplami: PortalAmount;
  vergilerDahilToplamTutar: PortalAmount;
  toplamMasraflar: PortalAmount;
  odenecekTutar: PortalAmount;
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

function formatPortalAmount(value: number) {
  return roundAmount(value).toFixed(2);
}

function vatExclusiveCents(inclusiveCents: number, vatRate: number) {
  if (vatRate <= 0) return inclusiveCents;
  return Math.round((inclusiveCents * 100) / (100 + vatRate));
}

function allocateCents(totalCents: number, weights: number[]) {
  if (weights.length === 0) return [];
  if (totalCents <= 0) return weights.map(() => 0);

  const positiveWeights = weights.map((weight) => Math.max(0, weight));
  const weightTotal = positiveWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) {
    const base = Math.floor(totalCents / weights.length);
    const remainder = totalCents - base * weights.length;
    return weights.map((_, index) => base + (index < remainder ? 1 : 0));
  }

  const allocations = positiveWeights.map((weight, index) => {
    const exact = (totalCents * weight) / weightTotal;
    const floor = Math.floor(exact);
    return { index, cents: floor, remainder: exact - floor };
  });
  let allocated = allocations.reduce((sum, allocation) => sum + allocation.cents, 0);

  for (const allocation of [...allocations].sort((left, right) => right.remainder - left.remainder)) {
    if (allocated >= totalCents) break;
    allocation.cents += 1;
    allocated += 1;
  }

  return allocations.sort((left, right) => left.index - right.index).map((allocation) => allocation.cents);
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
  adjustedGrossCents: number,
  adjustedPayableCents: number,
  unitCode: string
): GibPortalInvoiceDraftLine & { numeric: { fiyat: number; iskontoTutari: number; malHizmetTutari: number; kdvTutari: number } } {
  const quantity = line.quantity > 0 ? line.quantity : 1;
  const grossInclusiveCents = Math.max(adjustedGrossCents, adjustedPayableCents);
  const grossBaseCents = vatExclusiveCents(grossInclusiveCents, line.vatRate);
  const targetTaxableBaseCents = vatExclusiveCents(adjustedPayableCents, line.vatRate);
  const taxableBaseCents = Math.min(Math.max(0, targetTaxableBaseCents), grossBaseCents);
  const discountBaseCents = Math.max(0, grossBaseCents - taxableBaseCents);
  const vatCents = Math.max(0, adjustedPayableCents - taxableBaseCents);
  const discountRate = grossBaseCents > 0 ? (discountBaseCents / grossBaseCents) * 100 : 0;
  const unitPrice = centsToAmount(Math.round(grossBaseCents / quantity));
  const grossBase = centsToAmount(grossBaseCents);
  const discountBase = centsToAmount(discountBaseCents);
  const taxableBase = centsToAmount(taxableBaseCents);
  const vat = centsToAmount(vatCents);

  return {
    malHizmet: line.description || "Urun",
    miktar: quantity,
    birim: unitCode,
    birimFiyat: formatPortalAmount(unitPrice),
    fiyat: formatPortalAmount(grossBase),
    iskontoArttm: "\u0130skonto",
    iskontoOrani: roundAmount(discountRate),
    iskontoTutari: formatPortalAmount(discountBase),
    iskontoNedeni: "",
    malHizmetTutari: formatPortalAmount(taxableBase),
    kdvOrani: String(Math.round(line.vatRate)),
    vergiOrani: 0,
    kdvTutari: formatPortalAmount(vat),
    vergininKdvTutari: "0.00",
    numeric: {
      fiyat: grossBase,
      iskontoTutari: discountBase,
      malHizmetTutari: taxableBase,
      kdvTutari: vat
    }
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
  const isCompany = payload.buyerType === "company" || buyerIdentifier.length === 10;
  const buyerName = payload.buyerName.trim();
  const personName = splitBuyerName(buyerName);
  const grossAllocations = allocateCents(
    payload.totals.grossCents,
    payload.lines.map((line) => Math.max(line.grossCents, line.payableCents + line.discountCents))
  );
  const payableAllocations = allocateCents(
    payload.totals.payableCents,
    payload.lines.map((line) => line.payableCents || Math.max(line.grossCents, line.payableCents + line.discountCents))
  );
  const linesWithTotals = payload.lines.map((line, index) =>
    buildPortalLine(line, grossAllocations[index] ?? line.grossCents, payableAllocations[index] ?? line.payableCents, unitCode)
  );
  const serviceTotal = roundAmount(linesWithTotals.reduce((sum, line) => sum + line.numeric.fiyat, 0));
  const discountTotal = roundAmount(linesWithTotals.reduce((sum, line) => sum + line.numeric.iskontoTutari, 0));
  const taxableTotal = roundAmount(linesWithTotals.reduce((sum, line) => sum + line.numeric.malHizmetTutari, 0));
  const vatTotal = roundAmount(linesWithTotals.reduce((sum, line) => sum + line.numeric.kdvTutari, 0));
  const payableTotal = centsToAmount(payload.totals.payableCents);
  const lines = linesWithTotals.map(({ numeric: _numeric, ...line }) => line);
  const zeroAmount = "0";

  return {
    faturaUuid: ettn,
    belgeNumarasi: "",
    faturaTarihi: formatPortalDate(issuedAt),
    saat: formatPortalTime(issuedAt),
    paraBirimi: payload.totals.currency || "TRY",
    dovzTLkur: "0",
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
    vergiDairesi: payload.address.taxOffice ?? "",
    ulke: payload.address.countryCode === "TR" ? "T\u00fcrkiye" : payload.address.countryCode,
    bulvarcaddesokak: payload.address.addressLine,
    mahalleSemtIlce: payload.address.district ?? "",
    sehir: payload.address.city,
    postaKodu: "",
    tel: "",
    fax: "",
    eposta: "",
    websitesi: "",
    komisyonOrani: 0,
    navlunOrani: 0,
    hammaliyeOrani: 0,
    nakliyeOrani: 0,
    komisyonTutari: zeroAmount,
    navlunTutari: zeroAmount,
    hammaliyeTutari: zeroAmount,
    nakliyeTutari: zeroAmount,
    komisyonKDVOrani: 0,
    navlunKDVOrani: 0,
    hammaliyeKDVOrani: 0,
    nakliyeKDVOrani: 0,
    komisyonKDVTutari: zeroAmount,
    navlunKDVTutari: zeroAmount,
    hammaliyeKDVTutari: zeroAmount,
    nakliyeKDVTutari: zeroAmount,
    gelirVergisiOrani: 0,
    bagkurTevkifatiOrani: 0,
    gelirVergisiTevkifatiTutari: zeroAmount,
    bagkurTevkifatiTutari: zeroAmount,
    halRusumuOrani: 0,
    ticaretBorsasiOrani: 0,
    milliSavunmaFonuOrani: 0,
    digerOrani: 0,
    halRusumuTutari: zeroAmount,
    ticaretBorsasiTutari: zeroAmount,
    milliSavunmaFonuTutari: zeroAmount,
    digerTutari: zeroAmount,
    halRusumuKDVOrani: 0,
    ticaretBorsasiKDVOrani: 0,
    milliSavunmaFonuKDVOrani: 0,
    digerKDVOrani: 0,
    halRusumuKDVTutari: zeroAmount,
    ticaretBorsasiKDVTutari: zeroAmount,
    milliSavunmaFonuKDVTutari: zeroAmount,
    digerKDVTutari: zeroAmount,
    iadeTable: [],
    ozelMatrahTutari: zeroAmount,
    ozelMatrahOrani: 0,
    ozelMatrahVergiTutari: "0.00",
    vergiCesidi: " ",
    malHizmetTable: lines,
    tip: "\u0130skonto",
    matrah: formatPortalAmount(taxableTotal),
    malhizmetToplamTutari: formatPortalAmount(serviceTotal),
    toplamIskonto: formatPortalAmount(discountTotal),
    hesaplanankdv: formatPortalAmount(vatTotal),
    vergilerToplami: formatPortalAmount(vatTotal),
    vergilerDahilToplamTutar: formatPortalAmount(payableTotal),
    toplamMasraflar: zeroAmount,
    odenecekTutar: formatPortalAmount(payableTotal),
    not: invoiceNote(payload),
    siparisNumarasi: payload.orderNumber,
    siparisTarihi: "",
    irsaliyeNumarasi: "",
    irsaliyeTarihi: "",
    fisNo: "",
    fisTarihi: "",
    fisSaati: " ",
    fisTipi: " ",
    zRaporNo: "",
    okcSeriNo: ""
  };
}
