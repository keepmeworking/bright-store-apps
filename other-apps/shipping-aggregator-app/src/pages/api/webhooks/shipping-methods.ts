import { NextApiRequest, NextApiResponse } from "next";
import { registry } from "../../../core/registry";
import { RateRequest } from "../../../providers/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { payload } = req.body;
  // TODO: Extract safe payload from Saleor event (Sync Webhook)
  
  // Mock payload extraction for now
  const rateRequest: RateRequest = {
    weight: payload?.checkout?.shippingAddress?.weight || 0.5,
    country_code: payload?.checkout?.shippingAddress?.country?.code || "IN",
    pincode: payload?.checkout?.shippingAddress?.postalCode || "",
    total_price: payload?.checkout?.totalPrice?.gross?.amount || 0
  };

  console.log("Calculated Rate Request:", rateRequest);

  // 1. Get all active providers
  const providers = registry.getAll();
  
  // 2. Query all providers in parallel
  const ratePromises = providers.map(p => p.getRates(rateRequest));
  const results = await Promise.allSettled(ratePromises);

  // 3. Aggregate results
  const shippingMethods: any[] = [];
  
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
        const rates = result.value;
        const providerName = providers[index].name;
        
        rates.forEach(rate => {
            shippingMethods.push({
                id: rate.id,
                name: `${providerName} - ${rate.name}`,
                amount: rate.amount,
                currency: rate.currency,
                // maximum_delivery_days: rate.estimated_days
            });
        });
    } else {
        console.error(`Provider ${providers[index].name} failed:`, result.reason);
    }
  });

  // 4. Return to Saleor
  return res.status(200).json(shippingMethods);
}
