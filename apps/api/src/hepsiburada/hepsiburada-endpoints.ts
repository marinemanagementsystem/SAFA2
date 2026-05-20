import type { HepsiburadaConnection, HepsiburadaEnvironment } from "../settings/connection-types";

export function defaultHepsiburadaUrls(environment: HepsiburadaEnvironment) {
  const suffix = environment === "test" ? "-sit" : "";

  return {
    productBaseUrl: `https://mpop${suffix}.hepsiburada.com`,
    listingBaseUrl: `https://listing-external${suffix}.hepsiburada.com`,
    orderBaseUrl: `https://oms-external${suffix}.hepsiburada.com`,
    supplierBaseUrl: `https://supplier-api-external${suffix}.hepsiburada.com`
  };
}

export function normalizeHepsiburadaBaseUrls(input: Partial<HepsiburadaConnection>) {
  const environment: HepsiburadaEnvironment = input.environment === "prod" ? "prod" : "test";
  const defaults = defaultHepsiburadaUrls(environment);

  return {
    environment,
    productBaseUrl: String(input.productBaseUrl || defaults.productBaseUrl).replace(/\/+$/, ""),
    listingBaseUrl: String(input.listingBaseUrl || defaults.listingBaseUrl).replace(/\/+$/, ""),
    orderBaseUrl: String(input.orderBaseUrl || defaults.orderBaseUrl).replace(/\/+$/, ""),
    supplierBaseUrl: String(input.supplierBaseUrl || defaults.supplierBaseUrl).replace(/\/+$/, "")
  };
}
