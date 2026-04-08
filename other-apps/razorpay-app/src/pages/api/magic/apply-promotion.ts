import type { NextApiRequest, NextApiResponse } from "next";
import {
  applyPromotionToCheckout,
  resolveCheckoutIdForMagicRequest,
  serializeCheckoutSummary,
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const saleorApiUrl = getRequestValue(req, ["saleorApiUrl"]);
    const checkoutReference = getRequestValue(req, ["order_id", "orderId", "checkout_id", "checkoutId"]);
    const promoCode = getRequestValue(req, ["coupon_code", "couponCode", "promo_code", "promoCode", "code"]);

    if (!promoCode) {
      return res.status(400).json({
        success: false,
        error: "coupon_code is required",
      });
    }

    const { authData, checkoutId } = await resolveCheckoutIdForMagicRequest(saleorApiUrl, checkoutReference);
    const result = await applyPromotionToCheckout(authData, checkoutId, promoCode);

    if (result.errors.length || !result.checkout) {
      return res.status(400).json({
        success: false,
        error: result.errors.map((entry) => entry.message || entry.code || "Unknown error").join(" | ") || "Promotion could not be applied",
      });
    }

    return res.status(200).json({
      success: true,
      coupon_code: result.checkout.voucherCode || promoCode,
      summary: serializeCheckoutSummary(result.checkout),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to apply promotion",
    });
  }
}
