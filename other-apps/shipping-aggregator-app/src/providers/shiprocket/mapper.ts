import { OrderDetails } from "@/providers/types";

export function mapToShiprocketOrder(order: OrderDetails) {
  const address = order.shipping_address;
  const date = new Date();
  const orderDate = date.toISOString().split('T')[0] + " " + date.toTimeString().split(' ')[0]; // YYYY-MM-DD HH:MM:SS

  // Calculate total weight (default to 0.5kg if missing)
  const totalWeight = order.lines.reduce((acc: number, line: any) => acc + (line.weight || 0.5), 0);

  return {
    order_id: order.id,
    order_date: orderDate,
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
    
    // Billing Info (Required)
    billing_customer_name: address.name.split(" ")[0],
    billing_last_name: address.name.split(" ").slice(1).join(" ") || "",
    billing_address: address.street1,
    billing_address_2: address.street2 || "",
    billing_city: address.city,
    billing_pincode: Number(address.pincode),
    billing_state: address.state,
    billing_country: "India", // Shiprocket primarily supports India logic/mapped names
    billing_email: address.email,
    billing_phone: address.phone,
    
    // Shipping Info (Same as billing for now)
    shipping_is_billing: true,
    
    order_items: order.lines.map((line: any) => ({
      name: line.name,
      sku: line.sku,
      units: line.quantity,
      selling_price: 100, // TODO: Pass actual price in OrderDetails interface
      discount: 0,
      tax: 0,
      hsn: "" 
    })),
    
    payment_method: "Prepaid", // TODO: Detect COD from Saleor payment status
    shipping_charges: 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: 100 * order.lines.length, // Placeholder
    length: 10,
    breadth: 10,
    height: 10,
    weight: totalWeight
  };
}
