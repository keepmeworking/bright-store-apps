import { describe, expect, it } from "vitest";

import { hasChargedTransactionWithPspReference } from "@/modules/razorpay-idempotency";

describe("hasChargedTransactionWithPspReference", () => {
  it("returns true when the same PSP reference is already charged", () => {
    expect(
      hasChargedTransactionWithPspReference(
        [
          {
            pspReference: "pay_existing",
            chargedAmount: {
              amount: 13999,
              currency: "INR",
            },
          },
        ],
        "pay_existing"
      )
    ).toBe(true);
  });

  it("returns false when the matching PSP reference is not charged yet", () => {
    expect(
      hasChargedTransactionWithPspReference(
        [
          {
            pspReference: "pay_existing",
            chargedAmount: {
              amount: 0,
              currency: "INR",
            },
          },
        ],
        "pay_existing"
      )
    ).toBe(false);
  });

  it("returns false when the charged transaction belongs to a different PSP reference", () => {
    expect(
      hasChargedTransactionWithPspReference(
        [
          {
            pspReference: "pay_other",
            chargedAmount: {
              amount: 13999,
              currency: "INR",
            },
          },
        ],
        "pay_existing"
      )
    ).toBe(false);
  });
});
