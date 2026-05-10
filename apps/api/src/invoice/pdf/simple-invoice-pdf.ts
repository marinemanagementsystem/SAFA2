import QRCode from "qrcode";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ArchiveInvoicePayload } from "../invoice-provider";

interface InvoicePdfOptions {
  title: string;
  documentNumber: string;
  documentDate: Date;
}

interface InvoiceLineView {
  index: number;
  description: string;
  quantity: number;
  unitNetCents: number;
  discountNetCents: number;
  netCents: number;
  vatRate: number;
  vatCents: number;
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean) as string[];

const fallbackGibLogoDataUri = toDataUriSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 105 105">' +
    '<circle cx="52.5" cy="52.5" r="49" fill="#fff" stroke="#2a5f9f" stroke-width="3"/>' +
    '<circle cx="52.5" cy="52.5" r="40" fill="#fff" stroke="#e33" stroke-width="1"/>' +
    '<text x="52.5" y="31" text-anchor="middle" font-family="Arial" font-size="8" fill="#2a5f9f">T.C. Hazine ve Maliye Bakanligi</text>' +
    '<text x="52.5" y="84" text-anchor="middle" font-family="Arial" font-size="8" fill="#e33">Gelir Idaresi Baskanligi</text>' +
    '<text x="52.5" y="70" text-anchor="middle" font-family="Arial Black, Arial" font-size="54" font-style="italic" fill="#e11">i</text>' +
  '</svg>'
);

function imageDataUri(filePath: string) {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function gibLogoDataUri() {
  const candidates = [
    path.resolve(process.cwd(), "src/invoice/pdf/assets/gib-logo.png"),
    path.resolve(__dirname, "assets/gib-logo.png")
  ];
  const logoPath = candidates.find((candidate) => fs.existsSync(candidate));
  return logoPath ? imageDataUri(logoPath) : fallbackGibLogoDataUri;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: unknown, maxLength: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function wrapText(value: unknown, maxLength: number, maxLines: number) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function currencyLabel(currency: string) {
  return currency === "TRY" ? "TL" : currency;
}

function formatMoney(cents: number, currency: string, digits = 2) {
  return `${(cents / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })} ${currencyLabel(currency)}`;
}

function formatUnit(cents: number, currency: string) {
  return formatMoney(cents, currency, 3);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
    .format(date)
    .replace(/\./g, "-")
    .replace(",", "");
}

function formatBrowserHeaderDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function deterministicUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function findChromeExecutable() {
  const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) {
    throw new Error("Taslak PDF uretimi icin Chrome/Chromium bulunamadi. CHROME_PATH ortam degiskenini ayarlayin.");
  }
  return chromePath;
}

function makeQrSvg(value: string) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const modules = qr.modules as { size: number; get: (row: number, column: number) => boolean | number };
  const size = modules.size;
  const quiet = 2;
  const viewSize = size + quiet * 2;
  const cells: string[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (modules.get(row, column)) {
        cells.push(`<rect x="${column + quiet}" y="${row + quiet}" width="1" height="1"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`;
}

function toDataUriSvg(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function lineViews(payload: ArchiveInvoicePayload): InvoiceLineView[] {
  return payload.lines.slice(0, 18).map((line, index) => {
    const vatMultiplier = 1 + line.vatRate / 100;
    const netCents = Math.round(line.payableCents / vatMultiplier);
    const vatCents = line.payableCents - netCents;
    const discountNetCents = Math.round((line.discountCents ?? 0) / vatMultiplier);
    const unitNetCents = Math.round((netCents + discountNetCents) / Math.max(line.quantity, 1));

    return {
      index: index + 1,
      description: truncate(line.description, 34),
      quantity: line.quantity,
      unitNetCents,
      discountNetCents,
      netCents,
      vatRate: line.vatRate,
      vatCents
    };
  });
}

function amountWordsBelowThousand(value: number) {
  const ones = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
  const tens = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const ten = Math.floor(rest / 10);
  const one = rest % 10;
  return `${hundred > 1 ? ones[hundred] : ""}${hundred ? "yüz" : ""}${tens[ten]}${ones[one]}`;
}

function amountWords(value: number): string {
  if (value === 0) return "sıfır";
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  return [
    millions ? `${amountWordsBelowThousand(millions)}milyon` : "",
    thousands ? `${thousands === 1 ? "" : amountWordsBelowThousand(thousands)}bin` : "",
    rest ? amountWordsBelowThousand(rest) : ""
  ].join("");
}

function payableNote(cents: number) {
  const lira = Math.floor(cents / 100);
  const kurus = cents % 100;
  return `${amountWords(lira)}türklirası${kurus ? `${amountWords(kurus)}kuruş` : ""}.`;
}

function sellerInfo() {
  return {
    name: process.env.INVOICE_SELLER_NAME ?? "SERHAT BEBA",
    address1: process.env.INVOICE_SELLER_ADDRESS_1 ?? "HASANPAŞA MAHALLESİ MUKBİL SOKAK İLYAS APT. No:12 Kapı",
    address2: process.env.INVOICE_SELLER_ADDRESS_2 ?? "No:6",
    address3: process.env.INVOICE_SELLER_ADDRESS_3 ?? "(532) 590-4460 Kadıköy/ İstanbul / Türkiye",
    phone: process.env.INVOICE_SELLER_PHONE ?? "05385466186",
    taxOffice: process.env.INVOICE_SELLER_TAX_OFFICE ?? "KADIKÖY VERGİ DAİRESİ MÜD.",
    taxId: process.env.INVOICE_SELLER_TAX_ID ?? "30181901834"
  };
}

function buildHtml(payload: ArchiveInvoicePayload, options: InvoicePdfOptions) {
  const seller = sellerInfo();
  const currency = payload.totals.currency;
  const rows = lineViews(payload);
  const emptyRowCount = Math.max(0, 18 - rows.length);
  const buyerAddressLines = wrapText(payload.address.addressLine, 54, 3);
  const buyerCityLine = [payload.address.district, payload.address.city].filter(Boolean).join("/");
  const ettn = deterministicUuid(`${options.documentNumber}:${payload.orderNumber}:${payload.shipmentPackageId}`);
  const qrValue = JSON.stringify({
    documentNumber: options.documentNumber,
    issueDate: options.documentDate.toISOString(),
    ettn,
    buyerIdentifier: payload.buyerIdentifier,
    orderNumber: payload.orderNumber,
    shipmentPackageId: payload.shipmentPackageId,
    payableCents: payload.totals.payableCents,
    currency
  });
  const qrDataUri = toDataUriSvg(makeQrSvg(qrValue));
  const totalNetCents = rows.reduce((sum, line) => sum + line.netCents, 0);
  const totalVatCents = rows.reduce((sum, line) => sum + line.vatCents, 0);
  const totalDiscountNetCents = rows.reduce((sum, line) => sum + line.discountNetCents, 0);
  const footerPath = `file:///SAFA/${ettn}_${options.documentNumber}.html`;

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>e-Belge</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 210mm; min-height: 297mm; font-family: Arial, Helvetica, sans-serif; color: #666; }
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { position: relative; width: 210mm; height: 297mm; padding: 0; overflow: hidden; background: white; }
    .print-header { position: absolute; top: 5.5mm; left: 8mm; right: 8mm; font-size: 10.5pt; color: #000; }
    .print-header .title { position: absolute; left: 0; right: 0; text-align: center; }
    .seller { position: absolute; left: 12mm; top: 15mm; width: 75mm; font-size: 7.2pt; line-height: 1.2; }
    .seller .nowrap { white-space: nowrap; }
    .rule { border-top: 0.35mm solid #222; border-bottom: 0.18mm solid #222; height: 1.2mm; margin-bottom: 2.5mm; }
    .seller .bottom-rule, .buyer .bottom-rule { margin-top: 2.5mm; border-top: 0.35mm solid #222; border-bottom: 0.18mm solid #222; height: 1.2mm; }
    .center-brand { position: absolute; top: 25mm; left: 93mm; width: 32mm; text-align: center; }
    .center-brand img { width: 22mm; height: 22mm; object-fit: contain; display: block; margin: 0 auto 3mm; }
    .center-brand strong { font-size: 10.5pt; color: #6a6a6a; }
    .qr { position: absolute; top: 12mm; right: 8mm; width: 52mm; height: 52mm; object-fit: contain; }
    .buyer { position: absolute; left: 12mm; top: 64mm; width: 75mm; font-size: 8.4pt; line-height: 1.08; }
    .buyer strong { display: block; font-size: 8.8pt; margin: 2mm 0 1mm; }
    .ettn { position: absolute; left: 12mm; top: 108mm; font-size: 8.7pt; }
    .info-table { position: absolute; right: 8mm; top: 90mm; width: 52mm; border-collapse: collapse; font-size: 8pt; line-height: 1; }
    .info-table td { border: 0.18mm solid #777; padding: 0.6mm 1mm; height: 4mm; white-space: nowrap; }
    .info-table td:first-child { width: 27mm; font-weight: 700; }
    .items-table { position: absolute; left: 12mm; top: 117mm; width: 188mm; border-collapse: collapse; table-layout: fixed; font-size: 8.3pt; }
    .items-table th, .items-table td { border: 0.18mm solid #111; padding: 1mm 1.2mm; vertical-align: middle; height: 4.8mm; }
    .items-table th { height: 10mm; text-align: center; font-weight: 700; font-size: 8.3pt; color: #666; }
    .items-table td { color: #666; }
    .items-table .center { text-align: center; }
    .items-table .right { text-align: right; }
    .items-table .item-row td { height: 7mm; }
    .items-table .empty td { height: 3.85mm; padding: 0; }
    .totals { position: absolute; right: 8mm; top: 207mm; width: 72mm; border-collapse: collapse; font-size: 9pt; font-weight: 700; }
    .totals td { border: 0.35mm solid #222; height: 4.8mm; padding: 0.65mm 1mm; }
    .totals td:first-child { text-align: right; width: 51mm; }
    .totals td:last-child { text-align: right; font-weight: 400; width: 21mm; }
    .note-box { position: absolute; left: 12mm; right: 12mm; top: 235mm; height: 25mm; border: 0.35mm solid #111; padding: 12mm 5mm 0; font-size: 9pt; }
    .note-box strong { font-weight: 700; }
    .print-footer { position: absolute; left: 8mm; right: 8mm; bottom: 5mm; font-size: 9pt; color: #000; display: flex; justify-content: space-between; gap: 6mm; }
    .print-footer .path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 175mm; }
  </style>
</head>
<body>
  <main class="page">
    <div class="print-header"><span>${escapeHtml(formatBrowserHeaderDate(options.documentDate))}</span><span class="title">e-Belge</span></div>
    <section class="seller">
      <div class="rule"></div>
      <div>${escapeHtml(seller.name)}</div>
      <div class="nowrap">${escapeHtml(seller.address1)}</div>
      <div>${escapeHtml(seller.address2)}</div>
      <div>${escapeHtml(seller.address3)}</div>
      <div>Tel: ${escapeHtml(seller.phone)} Fax:</div>
      <div>Web Sitesi:</div>
      <div>E-Posta:</div>
      <div>Vergi Dairesi: ${escapeHtml(seller.taxOffice)}</div>
      <div>TCKN: ${escapeHtml(seller.taxId)}</div>
      <div class="bottom-rule"></div>
    </section>
    <section class="center-brand">
      <img src="${gibLogoDataUri()}" alt="" />
      <strong>${escapeHtml(options.title || "e-Arşiv Fatura")}</strong>
    </section>
    <img class="qr" src="${qrDataUri}" alt="" />
    <section class="buyer">
      <div class="rule"></div>
      <strong>SAYIN</strong>
      <div>${escapeHtml(payload.buyerName)}</div>
      ${buyerAddressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
      <div>${escapeHtml(buyerCityLine)} ${escapeHtml(payload.address.countryCode === "TR" ? "Türkiye" : payload.address.countryCode)} No:</div>
      <div>Kapı No:</div>
      <div>&nbsp;/ Türkiye</div>
      <div>Web Sitesi:</div>
      <div>E-Posta:</div>
      <div>Tel: Fax:</div>
      <div>TCKN: ${escapeHtml(payload.buyerIdentifier)}</div>
      <div class="bottom-rule"></div>
    </section>
    <div class="ettn"><strong>ETTN:</strong> ${escapeHtml(ettn)}</div>
    <table class="info-table">
      <tr><td>Özelleştirme No:</td><td>TR1.2</td></tr>
      <tr><td>Senaryo:</td><td>EARSIVFATURA</td></tr>
      <tr><td>Fatura Tipi:</td><td>SATIS</td></tr>
      <tr><td>Fatura No:</td><td>${escapeHtml(options.documentNumber)}</td></tr>
      <tr><td>Fatura Tarihi:</td><td>${escapeHtml(formatDate(options.documentDate))}</td></tr>
    </table>
    <table class="items-table">
      <colgroup>
        <col style="width: 6mm" />
        <col style="width: 35mm" />
        <col style="width: 13.5mm" />
        <col style="width: 16.5mm" />
        <col style="width: 13.2mm" />
        <col style="width: 16.5mm" />
        <col style="width: 16.5mm" />
        <col style="width: 13mm" />
        <col style="width: 18mm" />
        <col style="width: 30mm" />
        <col style="width: 10mm" />
      </colgroup>
      <thead>
        <tr>
          <th>Sıra<br/>No</th>
          <th>Mal Hizmet</th>
          <th>Miktar</th>
          <th>Birim Fiyat</th>
          <th>İskonto/<br/>Artırım<br/>Oranı</th>
          <th>İskonto/<br/>Artırım<br/>Tutarı</th>
          <th>İskonto/<br/>Artırım<br/>Nedeni</th>
          <th>KDV<br/>Oranı</th>
          <th>KDV Tutarı</th>
          <th>Diğer Vergiler</th>
          <th>Mal<br/>Hizmet<br/>Tutarı</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (line) => `<tr class="item-row">
          <td class="center">${line.index}</td>
          <td>${escapeHtml(line.description)}</td>
          <td class="right">${line.quantity.toLocaleString("tr-TR")} Adet</td>
          <td class="right">${escapeHtml(formatUnit(line.unitNetCents, currency))}</td>
          <td class="right">%0,00</td>
          <td class="right">${escapeHtml(formatMoney(line.discountNetCents, currency))}</td>
          <td class="right">İskonto -</td>
          <td class="right">%${line.vatRate.toFixed(2).replace(".", ",")}</td>
          <td class="right">${escapeHtml(formatMoney(line.vatCents, currency))}</td>
          <td></td>
          <td class="right">${escapeHtml(formatMoney(line.netCents, currency))}</td>
        </tr>`
          )
          .join("")}
        ${Array.from({ length: emptyRowCount }, () => `<tr class="empty"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")}
      </tbody>
    </table>
    <table class="totals">
      <tr><td>Mal Hizmet Toplam Tutarı</td><td>${escapeHtml(formatMoney(totalNetCents, currency))}</td></tr>
      <tr><td>Toplam İskonto</td><td>${escapeHtml(formatMoney(totalDiscountNetCents, currency))}</td></tr>
      <tr><td>Hesaplanan KDV(%20)</td><td>${escapeHtml(formatMoney(totalVatCents, currency))}</td></tr>
      <tr><td>Vergiler Dahil Toplam Tutar</td><td>${escapeHtml(formatMoney(payload.totals.payableCents, currency))}</td></tr>
      <tr><td>Ödenecek Tutar</td><td>${escapeHtml(formatMoney(payload.totals.payableCents, currency))}</td></tr>
    </table>
    <section class="note-box"><strong>Not:</strong> ${escapeHtml(payableNote(payload.totals.payableCents))}</section>
    <footer class="print-footer"><span class="path">${escapeHtml(footerPath)}</span><span>1/1</span></footer>
  </main>
</body>
</html>`;
}

export function buildInvoicePdf(payload: ArchiveInvoicePayload, options: InvoicePdfOptions) {
  const chromePath = findChromeExecutable();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "safa-invoice-pdf-"));
  const profileDir = path.join(workDir, "profile");
  const htmlPath = path.join(workDir, "invoice.html");
  const pdfPath = path.join(workDir, "invoice.pdf");

  try {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(htmlPath, buildHtml(payload, options), "utf8");

    const result = spawnSync(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profileDir}`,
        "--run-all-compositor-stages-before-draw",
        "--print-to-pdf-no-header",
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href
      ],
      { encoding: "utf8", timeout: 20000 }
    );

    if (result.status !== 0 || !fs.existsSync(pdfPath)) {
      throw new Error(result.stderr || result.stdout || "Chrome PDF ciktisi olusturulamadi.");
    }

    return fs.readFileSync(pdfPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
