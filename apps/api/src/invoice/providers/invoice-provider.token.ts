import { Provider } from "@nestjs/common";
import { envBool } from "../../common/env";
import { GibDirectInvoiceProvider } from "./gib-direct-invoice.provider";
import { MockInvoiceProvider } from "./mock-invoice.provider";

export const INVOICE_PROVIDER = "INVOICE_PROVIDER";

export type InvoiceProviderKind = "mock" | "gib-direct";

export function invoiceProviderKind(): InvoiceProviderKind {
  if (envBool("USE_MOCK_INTEGRATIONS", true)) return "mock";

  const configured = (process.env.INVOICE_PROVIDER ?? "mock").toLowerCase();
  if (configured === "gib-direct") return "gib-direct";
  return "mock";
}

export const invoiceProviderFactory: Provider = {
  provide: INVOICE_PROVIDER,
  useFactory: (mockProvider: MockInvoiceProvider, gibDirectProvider: GibDirectInvoiceProvider) => {
    return invoiceProviderKind() === "gib-direct" ? gibDirectProvider : mockProvider;
  },
  inject: [MockInvoiceProvider, GibDirectInvoiceProvider]
};
