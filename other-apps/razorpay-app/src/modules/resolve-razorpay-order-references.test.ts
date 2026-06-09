import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolveRazorpayReferencesFromTransactions } from "./resolve-razorpay-order-references";

test("resolveRazorpayReferencesFromTransactions finds payment and order ids", () => {
  assert.deepEqual(
    resolveRazorpayReferencesFromTransactions([
      { pspReference: "order_SzbX87SQV99O1p", chargedAmount: { amount: 0 } },
      { pspReference: "pay_SzbXfQmPtCsirs", chargedAmount: { amount: 13499 } },
    ]),
    {
      razorpayPaymentId: "pay_SzbXfQmPtCsirs",
      razorpayOrderId: "order_SzbX87SQV99O1p",
    },
  );
});

test("resolveRazorpayReferencesFromTransactions ignores non-razorpay transactions", () => {
  assert.deepEqual(resolveRazorpayReferencesFromTransactions([{ pspReference: "stripe_pi_123" }]), {
    razorpayPaymentId: undefined,
    razorpayOrderId: undefined,
  });
});
