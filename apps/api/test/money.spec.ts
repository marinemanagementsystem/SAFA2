import { describe, expect, it } from "vitest";
import { toCents } from "../src/common/money";

describe("toCents", () => {
  it("normalizes Turkish decimal strings", () => {
    expect(toCents("1.234,56")).toBe(123456);
  });

  it("normalizes numbers", () => {
    expect(toCents(19.99)).toBe(1999);
  });
});
