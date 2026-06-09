import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  backfillRazorpayOrderWithSaleorOrder,
  buildRazorpayReceipt,
  buildSaleorOrderNotePayload,
  mergeRazorpayOrderNotes,
  sanitizeRazorpayNotes,
} from "./razorpay-order-notes";

test("sanitizeRazorpayNotes drops invalid keys and trims values", () => {
  assert.deepEqual(
    sanitizeRazorpayNotes({
      checkout_id: "  checkout-1  ",
      "bad-key": "ignored",
      saleor_order_number: "45571",
    }),
    {
      checkout_id: "checkout-1",
      saleor_order_number: "45571",
    },
  );
});

test("buildRazorpayReceipt creates a short searchable receipt", () => {
  const checkoutId = Buffer.from("Checkout:ed32f21b-0e85-4617-8e5a-022445335a99").toString("base64");
  const receipt = buildRazorpayReceipt(checkoutId);

  assert.ok(receipt.startsWith("dc-"));
  assert.ok(receipt.length <= 40);
});

test("buildSaleorOrderNotePayload adds searchable order refs", () => {
  assert.deepEqual(buildSaleorOrderNotePayload("#45594", "T3JkZXI6NDNkYjM5MTU="), {
    saleor_order_number: "45594",
    order_ref: "#45594",
    saleor_order_id: "T3JkZXI6NDNkYjM5MTU=",
  });
});

test("backfillRazorpayOrderWithSaleorOrder updates order and payment notes", async () => {
  const calls: Array<{ resource: string; id: string; payload: Record<string, unknown> }> = [];
  const client = {
    orders: {
      fetch: async () => ({ notes: { checkout_id: "checkout-1" } }),
      edit: async (id: string, payload: Record<string, unknown>) => {
        calls.push({ resource: "order", id, payload });
        return {};
      },
    },
    payments: {
      fetch: async () => ({ notes: { channel: "en-in" } }),
      edit: async (id: string, payload: Record<string, unknown>) => {
        calls.push({ resource: "payment", id, payload });
        return {};
      },
    },
  } as unknown as Parameters<typeof backfillRazorpayOrderWithSaleorOrder>[0];

  await backfillRazorpayOrderWithSaleorOrder(client, "order_SzbX87SQV99O1p", {
    orderNumber: "45594",
    orderId: "T3JkZXI6NDNkYjM5MTU=",
    razorpayPaymentId: "pay_SzbXfQmPtCsirs",
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    resource: "order",
    id: "order_SzbX87SQV99O1p",
    payload: {
      notes: {
        checkout_id: "checkout-1",
        saleor_order_number: "45594",
        order_ref: "#45594",
        saleor_order_id: "T3JkZXI6NDNkYjM5MTU=",
      },
    },
  });
  assert.deepEqual(calls[1], {
    resource: "payment",
    id: "pay_SzbXfQmPtCsirs",
    payload: {
      notes: {
        channel: "en-in",
        saleor_order_number: "45594",
        order_ref: "#45594",
        saleor_order_id: "T3JkZXI6NDNkYjM5MTU=",
      },
    },
  });
});

test("mergeRazorpayOrderNotes prefers base notes over storefront duplicates", () => {
  assert.deepEqual(
    mergeRazorpayOrderNotes(
      { checkout_id: "server-id", channel: "en-in" },
      { checkout_id: "client-id", storefront_id: "daikcell-storefront" },
    ),
    {
      checkout_id: "server-id",
      channel: "en-in",
      storefront_id: "daikcell-storefront",
    },
  );
});
