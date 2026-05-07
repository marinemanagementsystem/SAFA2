import { ArchiveInvoicePayload } from "../invoice-provider";

interface InvoicePdfOptions {
  title: string;
  documentNumber: string;
  documentDate: Date;
}

const turkishAscii: Record<string, string> = {
  "ç": "c",
  "Ç": "C",
  "ğ": "g",
  "Ğ": "G",
  "ı": "i",
  "I": "I",
  "İ": "I",
  "ö": "o",
  "Ö": "O",
  "ş": "s",
  "Ş": "S",
  "ü": "u",
  "Ü": "U"
};

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => turkishAscii[char] ?? char)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfText(value: unknown) {
  return cleanText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function text(x: number, y: number, value: unknown, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`;
}

function line(x1: number, y1: number, x2: number, y2: number) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function rect(x: number, y: number, width: number, height: number) {
  return `${x} ${y} ${width} ${height} re S`;
}

function wrap(value: unknown, maxLength: number) {
  const words = cleanText(value).split(" ").filter(Boolean);
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
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function buildPdf(objects: string[]) {
  let body = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(body, "binary");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "binary");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body, "binary");
}

export function buildInvoicePdf(payload: ArchiveInvoicePayload, options: InvoicePdfOptions) {
  const width = 595;
  const height = 842;
  const content: string[] = ["0.7 w"];
  let y = 792;

  content.push(text(42, y, "SAFA", 26, "F2"));
  content.push(text(42, y - 18, options.title, 11, "F1"));
  content.push(text(360, y, "Belge No", 9, "F1"));
  content.push(text(430, y, options.documentNumber, 12, "F2"));
  content.push(text(360, y - 18, "Tarih", 9, "F1"));
  content.push(text(430, y - 18, formatDate(options.documentDate), 10, "F1"));
  content.push(line(42, 752, 553, 752));

  y = 726;
  content.push(text(42, y, "Alici", 12, "F2"));
  content.push(text(42, y - 18, payload.buyerName, 11, "F1"));
  content.push(text(42, y - 34, `TCKN/VKN: ${payload.buyerIdentifier}`, 9, "F1"));
  content.push(text(42, y - 50, payload.address.addressLine, 9, "F1"));
  content.push(text(42, y - 66, `${payload.address.district ?? ""} ${payload.address.city}`, 9, "F1"));
  content.push(text(330, y, "Trendyol", 12, "F2"));
  content.push(text(330, y - 18, `Siparis: ${payload.orderNumber}`, 10, "F1"));
  content.push(text(330, y - 34, `Paket: ${payload.shipmentPackageId}`, 10, "F1"));

  y = 628;
  content.push(rect(42, y - 18, 511, 24));
  content.push(text(50, y - 9, "Urun/Hizmet", 9, "F2"));
  content.push(text(300, y - 9, "Miktar", 9, "F2"));
  content.push(text(350, y - 9, "Birim", 9, "F2"));
  content.push(text(410, y - 9, "KDV", 9, "F2"));
  content.push(text(462, y - 9, "Tutar", 9, "F2"));

  y -= 38;
  for (const item of payload.lines.slice(0, 14)) {
    const descriptionLines = wrap(item.description, 42);
    content.push(text(50, y, descriptionLines[0], 9, "F1"));
    content.push(text(300, y, item.quantity, 9, "F1"));
    content.push(text(350, y, money(item.unitPriceCents, payload.totals.currency), 9, "F1"));
    content.push(text(410, y, `%${item.vatRate}`, 9, "F1"));
    content.push(text(462, y, money(item.payableCents, payload.totals.currency), 9, "F1"));
    y -= 16;

    for (const extraLine of descriptionLines.slice(1, 3)) {
      content.push(text(50, y, extraLine, 8, "F1"));
      y -= 13;
    }

    content.push(line(42, y + 5, 553, y + 5));
    y -= 6;
    if (y < 180) break;
  }

  y = 162;
  content.push(line(320, y + 48, 553, y + 48));
  content.push(text(330, y + 30, "Mal/Hizmet Toplami", 10, "F1"));
  content.push(text(455, y + 30, money(payload.totals.grossCents, payload.totals.currency), 10, "F1"));
  content.push(text(330, y + 14, "Indirim", 10, "F1"));
  content.push(text(455, y + 14, money(payload.totals.discountCents, payload.totals.currency), 10, "F1"));
  content.push(text(330, y - 6, "Odenecek Tutar", 12, "F2"));
  content.push(text(455, y - 6, money(payload.totals.payableCents, payload.totals.currency), 12, "F2"));

  content.push(line(42, 74, 553, 74));
  content.push(text(42, 54, "Bu PDF SAFA uygulamasindan olusturulmustur. Canli fatura gecerliligi GIB surecine baglidir.", 8, "F1"));

  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];

  return buildPdf(objects);
}
