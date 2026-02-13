
import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionRefundRequestedDocument,
  TransactionRefundRequestedEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import Razorpay from "razorpay";

export const transactionRefundRequestedWebhook = new SaleorAsyncWebhook<
  TransactionRefundRequestedEventFragment
>({
  name: "Transaction Refund Requested",
  webhookPath: "/api/webhooks/transaction-refund-requested",
  event: "TRANSACTION_REFUND_REQUESTED" as any,
  apl: saleorApp.apl,
  query: TransactionRefundRequestedDocument,
});

import { env } from "@/env";

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export default transactionRefundRequestedWebhook.createHandler(async (req, res, ctx) => {
  const { payload } = ctx;

  const transactionId = payload.transaction?.id;
  const razorpayPaymentId = payload.transaction?.pspReference;
  const amount = payload.action?.amount || 0;

  if (!razorpayPaymentId) {
    return res.status(400).json({
      errors: [{ message: "Missing Razorpay Payment ID (externalReference) for refund" }],
    });
  }

  try {
    // 1. Process Refund via Razorpay
    await razorpay.payments.refund(razorpayPaymentId, {
      amount: Math.round(amount * 100), // paise
    });

    // 2. Respond to Saleor
    return res.status(200).json({
      transactionId,
      amount,
      status: "SUCCESS",
    });
  } catch (error) {
    console.error("Razorpay Refund Failed:", error);
    return res.status(400).json({
      errors: [{ message: "Failed to refund Razorpay payment" }],
    });
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
