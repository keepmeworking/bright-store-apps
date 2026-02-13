
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionInitializeSessionDocument,
  TransactionInitializeSessionEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { logTransaction } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

export const transactionInitializeWebhook = new SaleorSyncWebhook<
  TransactionInitializeSessionEventFragment
>({
  name: "Transaction Initialize",
  webhookPath: "/api/webhooks/transaction-initialize",
  event: "TRANSACTION_INITIALIZE_SESSION" as any,
  apl: saleorApp.apl,
  query: TransactionInitializeSessionDocument,
});

export default transactionInitializeWebhook.createHandler(async (req, res, ctx) => {
  const { payload } = ctx;
  const saleorApiUrl = ctx.authData.saleorApiUrl;

  const orderId = payload.sourceObject?.id;
  const amount = payload.action?.amount || 0;
  const currency = payload.action?.currency || "INR";

  const docClient = getDocClient();
  let mode: "test" | "live" = "test";

  try {
    if (!docClient) {
      throw new Error("DynamoDB not configured");
    }

    const { client, settings } = await getRazorpayClient(docClient, saleorApiUrl);
    mode = settings.mode;

    if (!settings.enabled) {
      throw new Error("Razorpay payment gateway is disabled");
    }

    // Determine capture behavior from settings
    const paymentCapture = settings.paymentAction === "authorize_capture";

    // 1. Create Razorpay Order
    const razorpayOrder = await client.orders.create({
      amount: Math.round(amount * 100), // convert to paise
      currency,
      receipt: orderId,
      payment_capture: paymentCapture,
    });

    if (settings.debugMode) {
      console.log("[Razorpay Init] Order created:", razorpayOrder.id);
    }

    // 2. Log the transaction
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "initialize",
      status: "success",
      amount,
      currency,
      razorpayOrderId: razorpayOrder.id,
      saleorOrderId: orderId,
      mode,
      rawResponse: settings.debugMode
        ? JSON.stringify(razorpayOrder)
        : undefined,
    });

    // 3. Respond to Saleor with data for the frontend
    // Include key_id so storefront can open Razorpay modal
    const keyId = settings.mode === "live" && settings.liveKeyId
      ? settings.liveKeyId
      : settings.testKeyId || process.env.RAZORPAY_KEY_ID || "";

    return res.status(200).json({
      data: {
        razorpay_order_id: razorpayOrder.id,
        razorpay_key_id: keyId,
        amount: Math.round(amount * 100),
        currency,
        magic_checkout: settings.magicCheckout,
        payment_action: settings.paymentAction,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Razorpay Order Creation Failed:", error);

    // Log failure
    if (docClient) {
      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "initialize",
        status: "failed",
        amount,
        currency,
        saleorOrderId: orderId,
        error: message,
        mode,
      });
    }

    return res.status(400).json({
      errors: [{ message: `Failed to initialize Razorpay order: ${message}` }],
    });
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
