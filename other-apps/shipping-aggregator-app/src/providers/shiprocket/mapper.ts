import { OrderDetails } from "@/providers/types";

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return {
      firstName: "Customer",
      lastName: "",
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function toValidPincode(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return 110001;
  }

  return Number(digits.slice(0, 6));
}

function toPositiveNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  return fallback;
}

export function mapToShiprocketOrder(order: OrderDetails, pickupLocation: string) {
  const address = order.shipping_address;
  const { firstName, lastName } = splitName(address.name || "Customer");
  const now = new Date();
  const orderDate = now.toISOString().slice(0, 19).replace("T", " ");

  const totalWeight = order.lines.reduce((acc, line) => {
    const lineWeight = toPositiveNumber(line.weight, 0.5);
    return acc + lineWeight * Math.max(1, line.quantity);
  }, 0);

  const orderItems = order.lines.map((line) => {
    const unitPrice = toPositiveNumber(line.unit_price, toPositiveNumber(line.total_price, 0));

    return {
      name: line.name,
      sku: line.sku,
      units: Math.max(1, line.quantity),
      selling_price: Number(unitPrice.toFixed(2)),
      discount: 0,
      tax: 0,
      hsn: "",
    };
  });

  const computedSubtotal = orderItems.reduce((acc, line) => acc + line.selling_price * line.units, 0);
  const shippingCharges = toPositiveNumber(order.shipping_charges, 0);
  const orderTotal = toPositiveNumber(order.total_price, computedSubtotal + shippingCharges);

  return {
    order_id: order.number || order.id,
    order_date: orderDate,
    pickup_location: pickupLocation,
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: address.street1,
    billing_address_2: address.street2 || "",
    billing_city: address.city,
    billing_pincode: toValidPincode(address.pincode),
    billing_state: address.state,
    billing_country: "India",
    billing_email: address.email,
    billing_phone: address.phone,
    shipping_is_billing: true,
    order_items: orderItems,
    payment_method: order.payment_method || "Prepaid",
    shipping_charges: Number(shippingCharges.toFixed(2)),
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: Number(Math.max(computedSubtotal, orderTotal - shippingCharges).toFixed(2)),
    length: 10,
    breadth: 10,
    height: 10,
    weight: Number(Math.max(totalWeight, 0.5).toFixed(3)),
  };
}
