import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolvePaymentId, resolvePaymentProvider } from "./orders-export-payment";

test("resolvePaymentProvider returns Razorpay for razorpay.app transactions", () => {
  assert.equal(
    resolvePaymentProvider({
      transactions: [
        {
          createdBy: { identifier: "razorpay.app", name: "Razorpay" },
          pspReference: "order_Sabc123",
          chargedAmount: { amount: 1000 },
          events: [{ type: "CHARGE_SUCCESS", pspReference: "pay_Sabc123" }],
        },
      ],
    }),
    "Razorpay",
  );
});

test("resolvePaymentId prefers CHARGE_SUCCESS event reference", () => {
  assert.equal(
    resolvePaymentId({
      transactions: [
        {
          pspReference: "order_Sabc123",
          chargedAmount: { amount: 1000 },
          events: [{ type: "CHARGE_SUCCESS", pspReference: "pay_Sabc123" }],
        },
      ],
    }),
    "pay_Sabc123",
  );
});

test("resolvePaymentProvider returns Snapmint for snapmint gateway payments", () => {
  assert.equal(
    resolvePaymentProvider({
      payments: [{ gateway: "mirumee.payments.snapmint", pspReference: "snap_123", isActive: true }],
    }),
    "Snapmint",
  );
});

test("resolvePaymentProvider returns Manual when no gateway match exists", () => {
  assert.equal(
    resolvePaymentProvider({
      payments: [{ gateway: "mirumee.payments.dummy", pspReference: "", isActive: true }],
    }),
    "Manual",
  );
});
