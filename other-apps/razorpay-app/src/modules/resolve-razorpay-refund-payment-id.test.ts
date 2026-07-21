import { describe, expect, it, vi } from "vitest";

import {
  normalizeRazorpayPspReference,
  pickRefundablePaymentFromOrderPayments,
  resolveRazorpayRefundPaymentId,
  type RazorpayOrderPayment,
} from "./resolve-razorpay-refund-payment-id";

describe("normalizeRazorpayPspReference", () => {
  it("keeps pay_ and order_ references", () => {
    expect(normalizeRazorpayPspReference("pay_ABC123")).toEqual({
      kind: "payment",
      id: "pay_ABC123",
    });
    expect(normalizeRazorpayPspReference("order_T9JbxBnhCGViG5")).toEqual({
      kind: "order",
      id: "order_T9JbxBnhCGViG5",
    });
  });

  it("rejects empty, refund ids, and unknown prefixes", () => {
    expect(normalizeRazorpayPspReference("")).toEqual({ kind: "invalid", id: "" });
    expect(normalizeRazorpayPspReference("  ")).toEqual({ kind: "invalid", id: "" });
    expect(normalizeRazorpayPspReference("rfnd_xxx")).toEqual({ kind: "invalid", id: "rfnd_xxx" });
    expect(normalizeRazorpayPspReference("razorpay-magic-abc")).toEqual({
      kind: "invalid",
      id: "razorpay-magic-abc",
    });
  });
});

describe("pickRefundablePaymentFromOrderPayments", () => {
  const payments: RazorpayOrderPayment[] = [
    { id: "pay_failed", status: "failed", amount: 49900 },
    { id: "pay_auth", status: "authorized", amount: 49900 },
    { id: "pay_captured", status: "captured", amount: 49900, amount_refunded: 0 },
  ];

  it("prefers captured payments over authorized", () => {
    expect(pickRefundablePaymentFromOrderPayments(payments)).toBe("pay_captured");
  });

  it("falls back to authorized when no captured payment exists", () => {
    expect(
      pickRefundablePaymentFromOrderPayments([
        { id: "pay_failed", status: "failed", amount: 100 },
        { id: "pay_auth", status: "authorized", amount: 49900 },
      ]),
    ).toBe("pay_auth");
  });

  it("skips fully refunded captured payments", () => {
    expect(
      pickRefundablePaymentFromOrderPayments([
        { id: "pay_done", status: "captured", amount: 49900, amount_refunded: 49900 },
        { id: "pay_open", status: "captured", amount: 49900, amount_refunded: 100 },
      ]),
    ).toBe("pay_open");
  });

  it("returns undefined when no refundable payment exists", () => {
    expect(
      pickRefundablePaymentFromOrderPayments([
        { id: "pay_done", status: "captured", amount: 49900, amount_refunded: 49900 },
        { id: "pay_failed", status: "failed", amount: 49900 },
      ]),
    ).toBeUndefined();
  });

  it("accepts Razorpay { items } envelope", () => {
    expect(pickRefundablePaymentFromOrderPayments({ items: payments, count: 3 })).toBe("pay_captured");
  });
});

describe("resolveRazorpayRefundPaymentId", () => {
  it("returns pay_ references without calling Razorpay", async () => {
    const fetchOrderPayments = vi.fn();
    await expect(
      resolveRazorpayRefundPaymentId("pay_TG8SuYkCPPBCgR", { fetchOrderPayments }),
    ).resolves.toEqual({
      paymentId: "pay_TG8SuYkCPPBCgR",
      resolvedFrom: "pspReference",
    });
    expect(fetchOrderPayments).not.toHaveBeenCalled();
  });

  it("resolves order_ references via order payments (the Jul 21 failure case)", async () => {
    const fetchOrderPayments = vi.fn().mockResolvedValue({
      items: [
        { id: "pay_TG8SuYkCPPBCgR", status: "captured", amount: 49900, amount_refunded: 0 },
      ],
    });

    await expect(
      resolveRazorpayRefundPaymentId("order_T9JbxBnhCGViG5", { fetchOrderPayments }),
    ).resolves.toEqual({
      paymentId: "pay_TG8SuYkCPPBCgR",
      resolvedFrom: "orderPayments",
      orderId: "order_T9JbxBnhCGViG5",
    });

    expect(fetchOrderPayments).toHaveBeenCalledWith("order_T9JbxBnhCGViG5");
  });

  it("prefers a sibling pay_ reference when provided for an order_ pspReference", async () => {
    const fetchOrderPayments = vi.fn();
    await expect(
      resolveRazorpayRefundPaymentId("order_T9JbxBnhCGViG5", {
        fetchOrderPayments,
        siblingPspReferences: ["order_T9JbxBnhCGViG5", "pay_SiblingPayId"],
      }),
    ).resolves.toEqual({
      paymentId: "pay_SiblingPayId",
      resolvedFrom: "siblingTransaction",
      orderId: "order_T9JbxBnhCGViG5",
    });
    expect(fetchOrderPayments).not.toHaveBeenCalled();
  });

  it("throws a clear error when order has no refundable payment", async () => {
    const fetchOrderPayments = vi.fn().mockResolvedValue({ items: [] });
    await expect(
      resolveRazorpayRefundPaymentId("order_T9JbxBnhCGViG5", { fetchOrderPayments }),
    ).rejects.toThrow(/No refundable Razorpay payment found for order_T9JbxBnhCGViG5/);
  });

  it("throws for missing or invalid pspReference", async () => {
    const fetchOrderPayments = vi.fn();
    await expect(resolveRazorpayRefundPaymentId("", { fetchOrderPayments })).rejects.toThrow(
      /Missing Razorpay Payment ID/,
    );
    await expect(
      resolveRazorpayRefundPaymentId("razorpay-magic-checkout", { fetchOrderPayments }),
    ).rejects.toThrow(/not a valid Razorpay payment or order id/i);
  });
});
