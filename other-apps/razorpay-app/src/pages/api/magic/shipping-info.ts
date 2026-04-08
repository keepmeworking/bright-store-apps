import type { NextApiRequest, NextApiResponse } from "next";
import {
  resolveCheckoutIdForMagicRequest,
  serializeCheckoutSummary,
  serializeShippingMethods,
  updateCheckoutDeliveryMethod,
  updateCheckoutShippingAddress,
  getCheckoutSnapshot,
} from "@/modules/magic-checkout";

function getRequestValue(req: NextApiRequest, keys: string[]) {
  for (const key of keys) {
    const bodyValue = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>)[key] : undefined;
    if (typeof bodyValue === "string" && bodyValue.trim()) {
      return bodyValue.trim();
    }

    const queryValue = req.query[key];
    if (typeof queryValue === "string" && queryValue.trim()) {
      return queryValue.trim();
    }
  }

  return "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const saleorApiUrl = getRequestValue(req, ["saleorApiUrl"]);
    const checkoutReference = getRequestValue(req, ["order_id", "orderId", "checkout_id", "checkoutId"]);
    const deliveryMethodId = getRequestValue(req, [
      "delivery_method_id",
      "deliveryMethodId",
      "shipping_method_id",
      "shippingMethodId",
    ]);

    const city = getRequestValue(req, ["city"]);
    const postalCode = getRequestValue(req, ["postal_code", "postalCode", "pincode"]);
    const countryArea = getRequestValue(req, ["state", "country_area", "countryArea"]);
    const country = getRequestValue(req, ["country"]);

    const { authData, checkoutId, checkout } = await resolveCheckoutIdForMagicRequest(
      saleorApiUrl,
      checkoutReference
    );

    const shippingAddressResult = await updateCheckoutShippingAddress(authData, checkout, {
      city,
      postalCode,
      countryArea,
      country,
    });

    if (shippingAddressResult?.errors.length) {
      return res.status(400).json({
        success: false,
        error: shippingAddressResult.errors
          .map((entry) => entry.message || entry.code || "Unknown shipping address error")
          .join(" | "),
      });
    }

    if (deliveryMethodId) {
      const deliveryResult = await updateCheckoutDeliveryMethod(authData, checkoutId, deliveryMethodId);

      if (deliveryResult.errors.length) {
        return res.status(400).json({
          success: false,
          error: deliveryResult.errors
            .map((entry) => entry.message || entry.code || "Unknown delivery method error")
            .join(" | "),
        });
      }
    }

    const refreshedCheckout = await getCheckoutSnapshot(authData, checkoutId);

    if (!refreshedCheckout) {
      throw new Error("Updated checkout could not be loaded");
    }

    return res.status(200).json({
      success: true,
      shipping_methods: serializeShippingMethods(refreshedCheckout),
      selected_delivery_method_id: refreshedCheckout.deliveryMethod?.id || "",
      summary: serializeCheckoutSummary(refreshedCheckout),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch shipping info",
    });
  }
}
