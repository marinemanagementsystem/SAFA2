import { Provider } from "@nestjs/common";
import { GibDirectInvoiceProvider } from "./gib-direct-invoice.provider";

export const INVOICE_PROVIDER = "INVOICE_PROVIDER";

export type InvoiceProviderKind = "gib-direct";

export function invoiceProviderKind(): InvoiceProviderKind {
  return "gib-direct";
}

export const invoiceProviderFactory: Provider = {
  provide: INVOICE_PROVIDER,
  useExisting: GibDirectInvoiceProvider
};
