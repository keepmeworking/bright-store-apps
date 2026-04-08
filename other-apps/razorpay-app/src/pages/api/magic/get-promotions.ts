import type { NextApiRequest, NextApiResponse } from "next";
import {
  listVoucherPromotions,
  resolveCheckoutIdForMagicRequest,
  serializeCheckoutSummary,
  serializeVoucherPromotions,
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

    const { authData, checkout } = await resolveCheckoutIdForMagicRequest(saleorApiUrl, checkoutReference);
    const vouchers = await listVoucherPromotions(authData, checkout.channel?.slug);

    return res.status(200).json({
      success: true,
      promotions: serializeVoucherPromotions(vouchers, checkout),
      applied_coupon_code: checkout.voucherCode || "",
      summary: serializeCheckoutSummary(checkout),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch promotions",
    });
  }
}
