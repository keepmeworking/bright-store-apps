import type { NextApiRequest, NextApiResponse } from "next";
import { getDocClient } from "@/modules/dynamodb-helpers";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { backfillRazorpayOrderWithSaleorOrder } from "@/modules/razorpay-order-notes";

function pickString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const configuredSecret = process.env.RAZORPAY_MAGIC_INTERNAL_SECRET?.trim();
  const providedSecret = pickString(req.headers["x-magic-internal-secret"]);

  if (configuredSecret && providedSecret !== configuredSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const razorpayOrderId = pickString(body.razorpayOrderId);
  const orderNumber = pickString(body.orderNumber);
  const orderId = pickString(body.orderId);
  const saleorApiUrl =
    pickString(body.saleorApiUrl) ||
    pickString(process.env.SALEOR_API_URL) ||
    pickString(process.env.NEXT_PUBLIC_SALEOR_API_URL);

  if (!razorpayOrderId || !orderNumber || !saleorApiUrl) {
    return res.status(400).json({ error: "razorpayOrderId, orderNumber, and saleorApiUrl are required" });
  }

  try {
    const docClient = getDocClient();
    const { client } = await getRazorpayClient(docClient, saleorApiUrl);
    await backfillRazorpayOrderWithSaleorOrder(client, razorpayOrderId, {
      orderNumber,
      orderId,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to sync Razorpay order notes",
    });
  }
}
