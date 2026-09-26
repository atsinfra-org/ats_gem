import { describe, expect, it } from "vitest";
import { formatMoney } from "./utils";

describe("formatMoney", () => {
  it("formats INR in lakh/crore", () => {
    expect(formatMoney({ amount: "1000000.00", currency: "INR" })).toBe("₹10.00 Lakh");
    expect(formatMoney({ amount: "15000000.00", currency: "INR" })).toBe("₹1.50 Cr");
  });
  it("shows Not disclosed for null or invalid", () => {
    expect(formatMoney(null)).toBe("Not disclosed");
    expect(formatMoney({ amount: "abc", currency: "INR" })).toBe("Not disclosed");
  });
});
