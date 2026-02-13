
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionChargeRequestedDocument,
  TransactionChargeRequestedEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import Razorpay from "razorpay";

export const transactionChargeRequestedWebhook = new SaleorSyncWebhook<
  TransactionChargeRequestedEventFragment
>({
  name: "Transaction Charge Requested",
  webhookPath: "/api/webhooks/transaction-charge-requested",
  event: "TRANSACTION_CHARGE_REQUESTED" as any,
  apl: saleorApp.apl,
  query: TransactionChargeRequestedDocument,
});

import { env } from "@/env";

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export default transactionChargeRequestedWebhook.createHandler(async (req, res, ctx) => {
  const { payload } = ctx;

  const transactionId = payload.transaction?.id;
  const razorpayPaymentId = payload.transaction?.pspReference;
  const amount = payload.action?.amount || 0;

  if (!razorpayPaymentId) {
    return res.status(400).json({
      errors: [{ message: "Missing Razorpay Payment ID (externalReference)" }],
    });
  }

  try {
    // Razorpay "Capture" is usually done via the capture endpoint
    // Note: If the payment was already captured via the frontend/webhook, 
    // we just report success to Saleor.
    
    // 1. Capture/Sync with Razorpay
    const payment = await razorpay.payments.fetch(razorpayPaymentId);
    
    if (payment.status === "authorized") {
      await razorpay.payments.capture(razorpayPaymentId, Math.round(amount * 100), "INR");
    }

    // 2. Respond to Saleor
    return res.status(200).json({
      transactionId,
      amount,
      status: "SUCCESS",
      externalReference: razorpayPaymentId,
    });
  } catch (error) {
    console.error("Razorpay Capture Failed:", error);
    return res.status(400).json({
      errors: [{ message: "Failed to capture Razorpay payment" }],
    });
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
