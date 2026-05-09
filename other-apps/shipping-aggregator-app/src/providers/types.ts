export interface ShippingRate {
  id: string;
  name: string;
  amount: number;
  currency: string;
  estimated_days?: number;
  courier_name?: string;
  provider_id: string; // "shiprocket", "delhivery" etc
}

export interface RateRequest {
  weight: number; // in kg
  country_code: string;
  pincode: string;
  city?: string;
  total_price: number;
  cod?: boolean;
}

export interface OrderDetails {
  id: string;
  number?: string;
  tracking_number?: string;
  payment_method?: "COD" | "Prepaid";
  shipping_charges?: number;
  total_price?: number;
  currency?: string;
  courier_id?: string;
  shipping_address: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
    phone: string;
    email: string;
  };
  lines: Array<{
    name: string;
    quantity: number;
    sku: string;
    unit_price?: number;
    total_price?: number;
    weight?: number;
  }>;
}

export interface ShipmentResult {
  id: string;
  tracking_number: string;
  tracking_url?: string;
  courier_name?: string;
  label_url?: string;
  provider_order_id?: string;
  provider_shipment_id?: string;
}

export interface TrackingStatus {
  status: string; // "In Transit", "Delivered"
  location?: string;
  timestamp?: string;
}

export interface ShippingProvider {
  id: string;
  name: string;
  
  /**
   * Calculate rates for a potential order
   */
  getRates(payload: RateRequest): Promise<ShippingRate[]>;
  
  /**
   * Create a shipment when order is confirmed
   */
  createShipment(order: OrderDetails): Promise<ShipmentResult>;
  
  /**
   * Cancel a shipment
   */
  cancelShipment(shipmentId: string): Promise<boolean>;
  
  /**
   * Get current tracking status
   */
  trackShipment(shipmentId: string): Promise<TrackingStatus>;
}
