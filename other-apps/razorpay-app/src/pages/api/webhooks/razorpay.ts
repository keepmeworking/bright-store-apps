
import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

import { env } from "@/env";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const signature = req.headers["x-razorpay-signature"] as string;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

  // 1. Verify HMAC Signature
  const shasum = crypto.createHmac("sha256", webhookSecret);
  shasum.update(JSON.stringify(req.body));
  const digest = shasum.digest("hex");

  if (signature !== digest) {
    console.error("Invalid Razorpay Webhook Signature");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = req.body;
  console.log("Razorpay Webhook Received:", event.event);

  // 2. Process Capture Event
  if (event.event === "payment.captured") {
    const { payment, order } = event.payload;
    const razorpayOrderId = order.entity.id;
    const amount = payment.entity.amount / 100;

    // TODO: Link back to Saleor Transaction API
    // We will need to query Saleor for the Transaction associated with this razorpayOrderId
    console.log(`Payment Captured: ${amount} for Razorpay Order ${razorpayOrderId}`);
  }

  return res.status(200).json({ status: "ok" });
}

// Disable body parser if needed for raw body verification, 
// but crypto.createHmac usually works with JSON.stringify if the sender sends JSON.
// Razorpay sends JSON.
