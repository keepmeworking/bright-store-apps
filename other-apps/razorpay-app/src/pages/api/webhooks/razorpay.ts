
import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { getWebhookSecret } from "@/modules/razorpay-settings";
import { logTransaction } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

function resolveSaleorApiUrl(req: NextApiRequest) {
  const queryValue = Array.isArray(req.query.saleorApiUrl) ? req.query.saleorApiUrl[0] : req.query.saleorApiUrl;
  const headerValue = req.headers["x-saleor-api-url"];
  const normalizedHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  return queryValue || normalizedHeader || process.env.NEXT_PUBLIC_SALEOR_API_URL || "default";
}

async function readRawBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Razorpay Webhook Handler
 *
 * Receives webhook events directly from Razorpay (not Saleor).
 * Verifies HMAC signature and processes payment events.
 *
 * Supported events:
 * - payment.captured
 * - payment.failed
 * - refund.processed
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const docClient = getDocClient();
  const saleorApiUrl = resolveSaleorApiUrl(req);

  try {
    const signature = req.headers["x-razorpay-signature"] as string;

    if (!signature) {
      console.error("Missing Razorpay webhook signature");
      return res.status(400).json({ error: "Missing signature" });
    }

    // Get webhook secret from app-level settings
    const webhookSecret = await getWebhookSecret(docClient, saleorApiUrl);

    if (!webhookSecret) {
      console.error("Razorpay webhook secret not configured");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const body = await readRawBody(req);
    const shasum = crypto.createHmac("sha256", webhookSecret);
    shasum.update(body);
    const digest = shasum.digest("hex");

    if (signature !== digest) {
      console.error("Invalid Razorpay Webhook Signature");

      if (docClient) {
        await logTransaction(docClient, saleorApiUrl, {
          timestamp: new Date().toISOString(),
          type: "webhook",
          status: "failed",
          amount: 0,
          currency: "INR",
          error: "Invalid webhook signature",
          mode: "test",
        });
      }

      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(body);
    console.log("Razorpay Webhook Received:", event.event);

    // 2. Process Events
    if (event.event === "payment.captured") {
      const { payment } = event.payload;
      const amount = payment.entity.amount / 100;
      const razorpayPaymentId = payment.entity.id;

      if (docClient) {
        await logTransaction(docClient, saleorApiUrl, {
          timestamp: new Date().toISOString(),
          type: "webhook",
          status: "success",
          amount,
          currency: payment.entity.currency || "INR",
          razorpayPaymentId,
          razorpayOrderId: payment.entity.order_id,
          mode: razorpayPaymentId?.startsWith("pay_") ? "live" : "test",
        });
      }

      console.log(`Payment Captured: ${amount} ${payment.entity.currency}`);
    } else if (event.event === "payment.failed") {
      const { payment } = event.payload;
      const amount = payment.entity.amount / 100;

      if (docClient) {
        await logTransaction(docClient, saleorApiUrl, {
          timestamp: new Date().toISOString(),
          type: "webhook",
          status: "failed",
          amount,
          currency: payment.entity.currency || "INR",
          razorpayPaymentId: payment.entity.id,
          razorpayOrderId: payment.entity.order_id,
          error: payment.entity.error_description || "Payment failed",
          mode: "test",
        });
      }

      console.log(`Payment Failed: ${payment.entity.error_description}`);
    } else if (event.event === "refund.processed") {
      const { refund } = event.payload;
      const amount = refund.entity.amount / 100;

      if (docClient) {
        await logTransaction(docClient, saleorApiUrl, {
          timestamp: new Date().toISOString(),
          type: "webhook",
          status: "success",
          amount,
          currency: refund.entity.currency || "INR",
          razorpayPaymentId: refund.entity.payment_id,
          mode: "test",
        });
      }

      console.log(`Refund Processed: ${amount}`);
    }

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Razorpay Webhook Error:", error);

    if (docClient) {
      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "webhook",
        status: "failed",
        amount: 0,
        currency: "INR",
        error: message,
        mode: "test",
      });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
