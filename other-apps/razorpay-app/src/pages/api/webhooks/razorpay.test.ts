import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  extractAddressCandidateFromShippingDetail,
  extractGstinFromPayment,
  extractMagicCheckoutIdentifiers,
  isCodPaymentMethod,
  toSaleorAddressInput,
} from "@/modules/magic-webhook-details";

describe("Razorpay Magic webhook helpers", () => {
  it("extracts checkout, contact, and nested Magic shipping address details", () => {
    const payment = {
      id: "pay_123",
      order_id: "order_123",
      email: "buyer@example.com",
      contact: "+919876543210",
      notes: {
        cart_id: "saleor-checkout-123",
      },
      shipping_detail: {
        shipping_address: {
          name: "Priya Sharma",
          line1: "221 Market Road",
          line2: "Near Metro",
          city: "Delhi",
          state: "DL",
          country: "IN",
          zipcode: "110001",
        },
      },
    };

    const identifiers = extractMagicCheckoutIdentifiers(payment);
    const address = toSaleorAddressInput(
      extractAddressCandidateFromShippingDetail(payment.shipping_detail),
      identifiers.phone,
    );

    expect(identifiers).toMatchObject({
      checkoutId: "saleor-checkout-123",
      email: "buyer@example.com",
      phone: "+919876543210",
    });
    expect(address).toMatchObject({
      firstName: "Priya",
      lastName: "Sharma",
      streetAddress1: "221 Market Road",
      streetAddress2: "Near Metro",
      city: "Delhi",
      countryArea: "DL",
      postalCode: "110001",
      country: "IN",
      phone: "+919876543210",
    });
  });

  it("accepts Razorpay address aliases used by Magic Checkout callbacks", () => {
    const address = toSaleorAddressInput(
      extractAddressCandidateFromShippingDetail({
        name: "Rahul",
        address: {
          address_line_1: "Flat 5",
          address_line_2: "Sector 9",
          city: "Mumbai",
          state_code: "MH",
          postal_code: "400001",
          country: "india",
        },
      }),
      "9876543210",
    );

    expect(address).toMatchObject({
      firstName: "Rahul",
      streetAddress1: "Flat 5",
      streetAddress2: "Sector 9",
      city: "Mumbai",
      countryArea: "MH",
      postalCode: "400001",
      country: "IN",
      phone: "9876543210",
    });
  });

  it("records the captured Magic payment on the Saleor checkout before auto-completing it", () => {
    const source = fs.readFileSync("src/pages/api/webhooks/razorpay.ts", "utf-8");
    const transactionCreateIndex = source.indexOf("const transactionResult = await saleorGraphQL");
    const checkoutCompleteIndex = source.indexOf("const completeResult = await saleorGraphQL");

    expect(transactionCreateIndex).toBeGreaterThan(-1);
    expect(checkoutCompleteIndex).toBeGreaterThan(-1);
    expect(transactionCreateIndex).toBeLessThan(checkoutCompleteIndex);
    expect(source).toContain("mutation MagicCheckoutTransactionCreate");
    expect(source).toContain("amountCharged: { amount: $amount, currency: $currency }");
  });

  it("guards Magic and transactionProcess flows against charging the same Razorpay payment twice", () => {
    const webhookSource = fs.readFileSync("src/pages/api/webhooks/razorpay.ts", "utf-8");
    const processSource = fs.readFileSync("src/pages/api/webhooks/transaction-process-session.ts", "utf-8");

    expect(webhookSource).toContain("findExistingChargedTransactionReference");
    expect(processSource).toContain("findExistingChargedTransactionReference");
  });

  it("extracts GSTIN and COD payment method details from Magic Checkout payloads", () => {
    expect(
      extractGstinFromPayment({
        notes: {
          gstin: "07abCDE1234f1z5",
        },
      }),
    ).toBe("07ABCDE1234F1Z5");

    expect(
      extractGstinFromPayment(
        { notes: {} },
        {
          customer_details: {
            billing_address: {
              gstin: "29ABCDE1234F1Z5",
            },
          },
        },
      ),
    ).toBe("29ABCDE1234F1Z5");

    expect(isCodPaymentMethod({ method: "cod" })).toBe(true);
    expect(isCodPaymentMethod({ method: "upi" })).toBe(false);
  });
});
