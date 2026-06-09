import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildRazorpayReceipt,
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
