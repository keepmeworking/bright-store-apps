import { ShippingProvider, RateRequest, OrderDetails, ShipmentResult, TrackingStatus, ShippingRate } from "../types";
import { ShiprocketClient } from "./client";
import { mapToShiprocketOrder } from "./mapper";

export class ShiprocketProvider implements ShippingProvider {
  id = "shiprocket";
  name = "Shiprocket";
  private client: ShiprocketClient;

  constructor() {
    this.client = new ShiprocketClient();
  }

  async getRates(payload: RateRequest): Promise<ShippingRate[]> {
    console.log("Fetching rates from Shiprocket", payload);
    
    try {
        const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE || "110001"; // Fallback/Default
        
        const response = await this.client.getServiceability({
            pickup_postcode: pickupPincode,
            delivery_postcode: payload.pincode,
            weight: payload.weight.toString(),
            cod: "0" // 0 for Prepaid, 1 for COD. Assume Prepaid for checkout rates for now.
        });

        if (response?.data?.available_courier_companies) {
            return response.data.available_courier_companies.map((courier: any) => ({
                id: courier.courier_company_id.toString(),
                name: `${courier.courier_name} (${courier.estimated_delivery_days} days)`,
                amount: courier.rate, // Ensure this is the correct field from Shiprocket response
                currency: "INR",
                estimated_days: Number(courier.estimated_delivery_days),
                courier_name: courier.courier_name,
                provider_id: this.id
            }));
        }
        return [];
    } catch (e) {
        console.error("Shiprocket getRates error:", e);
        return [];
    }
  }

  async createShipment(order: OrderDetails): Promise<ShipmentResult> {
     console.log("Creating shipment in Shiprocket", order);
     
     try {
         const orderPayload = mapToShiprocketOrder(order);
         const response = await this.client.createOrder(orderPayload);
         
         if (response.order_id) {
             return {
                 id: response.shipment_id.toString(),
                 tracking_number: "PENDING", // AWB is assigned in a separate step usually, or returned if auto-assigned
                 courier_name: "Shiprocket",
                 label_url: ""
             };
         }
         
         throw new Error(response.message || "Failed to create Shiprocket order");
     } catch (e) {
         console.error("Shiprocket createShipment error:", e);
         throw e;
     }
  }

  async cancelShipment(shipmentId: string): Promise<boolean> {
     console.log("Cancelling shipment", shipmentId);
     // TODO: Implement actual API call
     return true;
  }

  async trackShipment(shipmentId: string): Promise<TrackingStatus> {
     console.log("Tracking shipment", shipmentId);
     // TODO: Implement actual API call
     return { status: "Unknown" };
  }
}
