import { centsToDecimal } from "../../common/money";
import { randomUUID } from "node:crypto";
import { invoiceNote } from "../invoice-note";
import { ArchiveInvoicePayload } from "../invoice-provider";

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function amount(cents: number): string {
  return centsToDecimal(cents).toFixed(2);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface GibDraftInvoiceXmlOptions {
  invoiceId?: string;
  uuid?: string;
  issueDate?: Date;
  sellerTaxId?: string;
  unitCode?: string;
  defaultBuyerTckn?: string;
}

export function buildGibDraftInvoiceXml(payload: ArchiveInvoicePayload, options: GibDraftInvoiceXmlOptions = {}): string {
  const issueDate = dateOnly(options.issueDate ?? new Date());
  const invoiceId =
    options.invoiceId ?? `SAF${new Date().getFullYear()}${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
  const uuid = options.uuid ?? randomUUID();
  const sellerTaxId = options.sellerTaxId ?? process.env.GIB_EARSIV_TAX_ID ?? "";
  const buyerId = payload.buyerIdentifier || options.defaultBuyerTckn || process.env.GIB_EARSIV_DEFAULT_BUYER_TCKN || "11111111111";
  const unitCode = options.unitCode ?? process.env.GIB_EARSIV_UNIT_CODE ?? "C62";

  const lineXml = payload.lines
    .map((line, index) => {
      const lineExtensionCents = line.payableCents;
      const taxCents = Math.round((lineExtensionCents * line.vatRate) / 100);

      return `
    <cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${xml(unitCode)}">${line.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${xml(payload.totals.currency)}">${amount(lineExtensionCents)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${xml(payload.totals.currency)}">${amount(taxCents)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="${xml(payload.totals.currency)}">${amount(lineExtensionCents)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="${xml(payload.totals.currency)}">${amount(taxCents)}</cbc:TaxAmount>
          <cbc:Percent>${line.vatRate}</cbc:Percent>
          <cac:TaxCategory>
            <cac:TaxScheme>
              <cbc:Name>KDV</cbc:Name>
              <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${xml(line.description)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${xml(payload.totals.currency)}">${amount(line.unitPriceCents)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join("");

  const totalTaxCents = payload.lines.reduce((sum, line) => sum + Math.round((line.payableCents * line.vatRate) / 100), 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>
  <cbc:ID>${invoiceId}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:Note>${xml(invoiceNote(payload))}</cbc:Note>
  <cbc:DocumentCurrencyCode>${xml(payload.totals.currency)}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${xml(sellerTaxId)}</cbc:ID>
      </cac:PartyIdentification>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${buyerId.length === 10 ? "VKN" : "TCKN"}">${xml(buyerId)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${xml(payload.buyerName)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xml(payload.address.addressLine)}</cbc:StreetName>
        <cbc:CitySubdivisionName>${xml(payload.address.district)}</cbc:CitySubdivisionName>
        <cbc:CityName>${xml(payload.address.city)}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>${xml(payload.address.countryCode)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xml(payload.totals.currency)}">${amount(totalTaxCents)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xml(payload.totals.currency)}">${amount(payload.totals.payableCents)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xml(payload.totals.currency)}">${amount(payload.totals.payableCents)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xml(payload.totals.currency)}">${amount(payload.totals.payableCents + totalTaxCents)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${xml(payload.totals.currency)}">${amount(payload.totals.payableCents + totalTaxCents)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>`;
}
