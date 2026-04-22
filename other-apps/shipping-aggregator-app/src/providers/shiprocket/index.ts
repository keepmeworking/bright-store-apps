import { ShippingProvider, RateRequest, OrderDetails, ShipmentResult, TrackingStatus, ShippingRate } from "../types";
import { ShiprocketClient } from "./client";
import { mapToShiprocketOrder } from "./mapper";

type ShiprocketProviderOptions = {
  email?: string;
  password?: string;
  pickupPincode?: string;
  pickupLocation?: string;
  enableCod?: boolean;
};

function toNumeric(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function resolveShipmentId(response: Record<string, any>) {
  return (
    response.shipment_id ||
    response.shipmentId ||
    response.data?.shipment_id ||
    response.data?.shipmentId ||
    response.data?.shipment_details?.shipment_id
  );
}

function resolveShiprocketOrderId(response: Record<string, any>) {
  return response.order_id || response.orderId || response.data?.order_id || response.data?.orderId;
}

function resolveAwbCode(payload: Record<string, any>) {
  return (
    payload.awb_code ||
    payload.awbCode ||
    payload.data?.awb_code ||
    payload.response?.data?.awb_code ||
    payload.data?.awb_assign_status?.awb_code
  );
}

export class ShiprocketProvider implements ShippingProvider {
  id = "shiprocket";
  name = "Shiprocket";
  private client: ShiprocketClient;
  private pickupPincode: string;
  private pickupLocation: string;
  private enableCod: boolean;

  constructor(options: ShiprocketProviderOptions = {}) {
    this.client = new ShiprocketClient(options.email, options.password);
    this.pickupPincode = options.pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE || "110001";
    this.pickupLocation = options.pickupLocation || process.env.SHIPROCKET_PICKUP_LOCATION || "Primary";
    this.enableCod = options.enableCod ?? false;
  }

  async getRates(payload: RateRequest): Promise<ShippingRate[]> {
    console.log("Fetching rates from Shiprocket", payload);
    
    try {
        const response = (await this.client.getServiceability({
            pickup_postcode: this.pickupPincode,
            delivery_postcode: payload.pincode,
            weight: payload.weight.toString(),
            cod: this.enableCod && payload.cod ? "1" : "0"
        })) as Record<string, any>;

        if (response?.data?.available_courier_companies) {
            return response.data.available_courier_companies.map((courier: any) => ({
                id: courier.courier_company_id.toString(),
                name: `${courier.courier_name} (${courier.estimated_delivery_days} days)`,
                amount: toNumeric(courier.rate, 0),
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
         const orderPayload = mapToShiprocketOrder(order, this.pickupLocation);
         const response = (await this.client.createOrder(orderPayload)) as Record<string, any>;

         const shipmentId = resolveShipmentId(response);
         const providerOrderId = resolveShiprocketOrderId(response);

         if (!shipmentId && !providerOrderId) {
            const errorMessage =
              typeof response?.message === "string" && response.message
                ? response.message
                : "Shiprocket order was not created";
            throw new Error(errorMessage);
         }

         let awbCode = resolveAwbCode(response);

         if (!awbCode && shipmentId) {
            try {
              const awbResponse = await this.client.assignAwb(shipmentId);
              awbCode = resolveAwbCode(awbResponse);
            } catch (awbError) {
              console.warn("Shiprocket AWB assignment failed, continuing with shipment id", awbError);
            }
         }

         const fallbackTracking = awbCode || String(shipmentId || providerOrderId || order.id);

         return {
           id: String(shipmentId || providerOrderId || order.id),
           provider_shipment_id: shipmentId ? String(shipmentId) : undefined,
           provider_order_id: providerOrderId ? String(providerOrderId) : undefined,
           tracking_number: fallbackTracking,
           courier_name: "Shiprocket",
           label_url: response?.label_url || response?.data?.label_url || "",
           tracking_url: awbCode
             ? `https://www.shiprocket.in/shipment-tracking/?tracking_id=${encodeURIComponent(String(awbCode))}`
             : undefined,
         };
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
