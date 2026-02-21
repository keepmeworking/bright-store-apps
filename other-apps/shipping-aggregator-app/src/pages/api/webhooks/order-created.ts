import { NextApiRequest, NextApiResponse } from "next";
import { registry } from "../../../core/registry";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  
  const event = req.body;
  // TODO: Validate Saleor Event Signature
  
  if (event.event === "ORDER_CREATED" || event.event === "ORDER_FULLY_PAID") {
     const order = event.order;
     console.log("Processing Order:", order.id);

     // TODO: 
     // 1. Identify which shipping method was selected (e.g., "Shiprocket - Standard")
     // 2. Select appropriate provider
     // 3. Call provider.createShipment()
     
     // Mock logic
     const defaultProvider = registry.get("shiprocket");
     if (defaultProvider) {
         try {
            await defaultProvider.createShipment({
                id: order.id,
                shipping_address: {
                    name: "Unknown", // extraction logic needed
                    street1: "Unknown", 
                    city: "Unknown",
                    state: "Unknown", 
                    pincode: "000000",
                    country: "IN", 
                    phone: "0000000000",
                    email: "test@example.com"
                },
                lines: []
            });
         } catch (e) {
             console.error("Failed to crate shipment", e);
         }
     }
  }

  return res.status(200).json({ success: true });
}
