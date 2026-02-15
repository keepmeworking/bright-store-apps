
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionRefundRequestedDocument,
  TransactionRefundRequestedEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { logTransaction } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

export const transactionRefundRequestedWebhook = new SaleorSyncWebhook<
  TransactionRefundRequestedEventFragment
>({
  name: "Transaction Refund Requested",
  webhookPath: "/api/webhooks/transaction-refund-requested",
  event: "TRANSACTION_REFUND_REQUESTED" as any,
  apl: saleorApp.apl,
  query: TransactionRefundRequestedDocument,
});

export default transactionRefundRequestedWebhook.createHandler(async (req, res, ctx) => {
  const { payload } = ctx;
  const saleorApiUrl = ctx.authData.saleorApiUrl;

  const transactionId = payload.transaction?.id;
  const razorpayPaymentId = payload.transaction?.pspReference;
  const amount = payload.action?.amount || 0;

  const docClient = getDocClient();
  let mode: "test" | "live" = "test";

  if (!razorpayPaymentId) {
    return res.status(400).json({
      errors: [{ message: "Missing Razorpay Payment ID (pspReference) for refund" }],
    });
  }

  try {
    const { client, settings } = await getRazorpayClient(docClient, saleorApiUrl);
    mode = settings.mode;

    if (settings.debugMode) {
      console.log("[Razorpay Refund] Payment:", razorpayPaymentId, "Amount:", amount);
    }

    // 1. Process Refund via Razorpay
    const refund = await client.payments.refund(razorpayPaymentId, {
      amount: Math.round(amount * 100), // paise
    });

    if (settings.debugMode) {
      console.log("[Razorpay Refund] Success:", refund.id);
    }

    // 2. Log success
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "refund",
      status: "success",
      amount,
      currency: "INR",
      razorpayPaymentId,
      saleorTransactionId: transactionId,
      mode,
      rawResponse: JSON.stringify(refund),
    });

    // 3. Respond to Saleor
    return res.status(200).json({
      pspReference: refund.id,
      result: "REFUND_SUCCESS",
      amount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Razorpay Refund Failed:", error);

    // Log failure
    if (docClient) {
      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "refund",
        status: "failed",
        amount,
        currency: "INR",
        razorpayPaymentId,
        saleorTransactionId: transactionId,
        error: message,
        mode,
      });
    }

    return res.status(200).json({
      pspReference: razorpayPaymentId,
      result: "REFUND_FAILURE",
      amount: 0,
      message: `Refund failed: ${message}`,
    });
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
