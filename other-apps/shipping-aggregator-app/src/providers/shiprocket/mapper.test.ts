import { describe, expect, it } from "vitest";

import { mapToShiprocketOrder, stateFromPincode } from "./mapper";
import type { OrderDetails } from "../types";

const baseOrder: OrderDetails = {
  id: "order-1",
  number: "45294",
  payment_method: "Prepaid",
  shipping_charges: 0,
  total_price: 23899,
  currency: "INR",
  shipping_address: {
    name: "Akash Kakkar",
    street1: "2C/478, Sector 3",
    city: "Meerut",
    state: "",
    pincode: "231212",
    country: "IN",
    phone: "91716286389",
    email: "akash@example.com",
  },
  lines: [
    {
      name: "Stabilizer",
      quantity: 1,
      sku: "SKU-1",
      unit_price: 23899,
      total_price: 23899,
      weight: 12,
    },
  ],
};

describe("stateFromPincode", () => {
  it("maps a Meerut-region pincode to Uttar Pradesh", () => {
    expect(stateFromPincode("231212")).toBe("Uttar Pradesh");
  });
});

describe("mapToShiprocketOrder", () => {
  it("derives billing and shipping state from pincode when Saleor state is blank", () => {
    const payload = mapToShiprocketOrder(baseOrder, "Primary", {
      length: 12,
      breadth: 10,
      height: 8,
    });

    expect(payload.billing_state).toBe("Uttar Pradesh");
    expect(payload.shipping_state).toBe("Uttar Pradesh");
  });

  it("does not fall back to Delhi when state and pincode cannot resolve a state", () => {
    const payload = mapToShiprocketOrder(
      {
        ...baseOrder,
        shipping_address: {
          ...baseOrder.shipping_address,
          state: "",
          pincode: "",
        },
      },
      "Primary",
      {
        length: 12,
        breadth: 10,
        height: 8,
      },
    );

    expect(payload.billing_state).toBe("");
    expect(payload.shipping_state).toBe("");
  });

  it("omits package dimensions when none are provided", () => {
    const payload = mapToShiprocketOrder(baseOrder, "Primary");

    expect(payload).not.toHaveProperty("length");
    expect(payload).not.toHaveProperty("breadth");
    expect(payload).not.toHaveProperty("height");
  });
});
