
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionChargeRequestedDocument,
  TransactionChargeRequestedEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { logTransaction } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

export const transactionChargeRequestedWebhook = new SaleorSyncWebhook<
  TransactionChargeRequestedEventFragment
>({
  name: "Transaction Charge Requested",
  webhookPath: "/api/webhooks/transaction-charge-requested",
  event: "TRANSACTION_CHARGE_REQUESTED" as any,
  apl: saleorApp.apl,
  query: TransactionChargeRequestedDocument,
});

export default transactionChargeRequestedWebhook.createHandler(async (req, res, ctx) => {
  const { payload } = ctx;
  const saleorApiUrl = ctx.authData.saleorApiUrl;

  const transactionId = payload.transaction?.id;
  const razorpayPaymentId = payload.transaction?.pspReference;
  const amount = payload.action?.amount || 0;

  const docClient = getDocClient();
  let mode: "test" | "live" = "test";

  if (!razorpayPaymentId) {
    return res.status(400).json({
      errors: [{ message: "Missing Razorpay Payment ID (pspReference)" }],
    });
  }

  try {
    const { client, settings } = await getRazorpayClient(docClient, saleorApiUrl);
    mode = settings.mode;

    if (settings.debugMode) {
      console.log("[Razorpay Charge] Payment:", razorpayPaymentId, "Amount:", amount);
    }

    // 1. Fetch payment status from Razorpay
    const payment = await client.payments.fetch(razorpayPaymentId);

    // 2. Capture if needed (only for "authorize" mode where auto-capture is off)
    if (payment.status === "authorized") {
      await client.payments.capture(razorpayPaymentId, Math.round(amount * 100), "INR");
    }

    // 3. Log success
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "charge",
      status: "success",
      amount,
      currency: "INR",
      razorpayPaymentId,
      saleorTransactionId: transactionId,
      mode,
      rawResponse: settings.debugMode
        ? JSON.stringify(payment)
        : undefined,
    });

    // 4. Respond to Saleor
    return res.status(200).json({
      pspReference: razorpayPaymentId,
      result: "CHARGE_SUCCESS",
      amount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Razorpay Capture Failed:", error);

    // Log failure
    if (docClient) {
      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "charge",
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
      result: "CHARGE_FAILURE",
      amount: 0,
      message: `Capture failed: ${message}`,
    });
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
