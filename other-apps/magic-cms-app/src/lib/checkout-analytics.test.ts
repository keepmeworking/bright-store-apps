import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  hasCheckoutContact,
  isCompletedCheckout,
  isOpenCheckout,
  isOpenLead,
  isRecoverableCart,
} from "./checkout-analytics";

test("treats uncompleted checkout with contact as open checkout", () => {
  const checkout = {
    email: "user@example.com",
    chargeStatus: "NONE",
  };

  assert.equal(hasCheckoutContact(checkout), true);
  assert.equal(isCompletedCheckout(checkout), false);
  assert.equal(isOpenCheckout(checkout), true);
});

test("treats contact checkout with items and non-zero subtotal as recoverable even without authorization", () => {
  const checkout = {
    email: "user@example.com",
    chargeStatus: "NONE",
    quantity: 2,
    subtotalPrice: {
      gross: {
        amount: 4999,
      },
    },
  };

  assert.equal(isRecoverableCart(checkout), true);
  assert.equal(isOpenLead(checkout), false);
});

test("treats uncompleted contact checkout with zero subtotal as open lead", () => {
  const checkout = {
    email: "lead@example.com",
    chargeStatus: "NONE",
    quantity: 1,
    subtotalPrice: {
      gross: {
        amount: 0,
      },
    },
  };

  assert.equal(isRecoverableCart(checkout), false);
  assert.equal(isOpenLead(checkout), true);
});

test("does not count fully charged checkouts as open", () => {
  const checkout = {
    email: "paid@example.com",
    chargeStatus: "FULL",
    quantity: 1,
    subtotalPrice: {
      gross: {
        amount: 1200,
      },
    },
  };

  assert.equal(isOpenCheckout(checkout), false);
  assert.equal(isRecoverableCart(checkout), false);
  assert.equal(isOpenLead(checkout), false);
});
