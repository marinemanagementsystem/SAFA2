import { describe, expect, it } from "vitest";
import { payableAmountInTurkishWords } from "../src/invoice/invoice-note";

describe("payableAmountInTurkishWords", () => {
  it("writes invoice totals in Turkish words with lira and kurus", () => {
    expect(payableAmountInTurkishWords(19990)).toBe("yüzdoksandokuztürklirasıdoksankuruş.");
  });

  it("keeps zero kurus visible", () => {
    expect(payableAmountInTurkishWords(12000)).toBe("yüzyirmitürklirasısıfırkuruş.");
  });
});
