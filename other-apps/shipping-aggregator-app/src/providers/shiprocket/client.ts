export class ShiprocketClient {
  private email: string;
  private password: string;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor(email?: string, password?: string) {
    this.email = email ?? process.env.SHIPROCKET_EMAIL ?? "";
    this.password = password ?? process.env.SHIPROCKET_PASSWORD ?? "";
  }

  private async authenticate() {
    if (!this.email || !this.password) {
      throw new Error("Shiprocket credentials are missing");
    }

    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const response = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shiprocket authentication failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    if (!data?.token) {
      throw new Error("Shiprocket authentication response did not include token");
    }
    this.token = data.token;
    // Token is valid for 10 days, but let's refresh every 24 hours to be safe
    this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
    return this.token;
  }

  private async request(endpoint: string, method: string, body?: any) {
    const token = await this.authenticate();
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };

    const response = await fetch(`https://apiv2.shiprocket.in${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let payload: Record<string, unknown> = {};

    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      throw new Error(`Shiprocket API ${method} ${endpoint} failed (${response.status}): ${text}`);
    }

    return payload;
  }

  async getServiceability(params: {
    pickup_postcode: string;
    delivery_postcode: string;
    weight: string;
    cod: string;
  }) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/v1/external/courier/serviceability/?${query}`, "GET");
  }

  async createOrder(orderPayload: any) {
    return this.request("/v1/external/orders/create/adhoc", "POST", orderPayload);
  }

  async assignAwb(shipmentId: string | number, courierId?: string | number) {
    const shipmentIdAsNumber = Number(shipmentId);
    const courierIdNumber = courierId !== undefined ? Number(courierId) : undefined;
    const courierPayload = courierIdNumber ? { courier_id: courierIdNumber } : {};

    const attemptPayloads = [
      { ...courierPayload, shipment_id: shipmentIdAsNumber },
      { ...courierPayload, shipment_id: [shipmentIdAsNumber] },
      { ...courierPayload, shipment_id: [String(shipmentId)] },
    ];

    let lastError: unknown;

    for (const payload of attemptPayloads) {
      try {
        return await this.request("/v1/external/courier/assign/awb", "POST", payload);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unable to assign Shiprocket AWB");
  }
}
