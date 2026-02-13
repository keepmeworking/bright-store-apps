
import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionInitializeSessionDocument,
  TransactionInitializeSessionEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import Razorpay from "razorpay";

/**
 * For Transaction API, Saleor expects a synchronous response to the webhook 
 * if it's a TransactionInitialize event.
 * Note: While Saleor usually uses Async webhooks, Transaction API often requires
 * Sync behavior for certain flows.
 */

export const transactionInitializeWebhook = new SaleorAsyncWebhook<
  TransactionInitializeSessionEventFragment
>({
  name: "Transaction Initialize",
  webhookPath: "/api/webhooks/transaction-initialize",
  event: "TRANSACTION_INITIALIZE_SESSION" as any,
  apl: saleorApp.apl,
  query: TransactionInitializeSessionDocument,
});

import { env } from "@/env";

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export default transactionInitializeWebhook.createHandler(async (req, res, ctx) => {
  const { payload } = ctx;

  const orderId = payload.sourceObject?.id;
  const amount = payload.action?.amount || 0;
  const currency = payload.action?.currency || "INR";

  try {
    // 1. Create Razorpay Order
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100), // convert to paise
      currency,
      receipt: orderId,
    });

    // 2. Respond to Saleor with the data needed for the frontend
    return res.status(200).json({
      data: {
        razorpay_order_id: razorpayOrder.id,
      },
    });
  } catch (error) {
    console.error("Razorpay Order Creation Failed:", error);
    return res.status(400).json({
      errors: [{ message: "Failed to initialize Razorpay order" }],
    });
  }
});

// Next.js config to disable body parsing for Saleor signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};
