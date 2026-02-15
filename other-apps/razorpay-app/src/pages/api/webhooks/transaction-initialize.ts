
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
  console.log("=== [Razorpay Init] Webhook HIT ===");
  const { payload } = ctx;
  const saleorApiUrl = ctx.authData.saleorApiUrl;

  const orderId = payload.sourceObject?.id;
  const amount = payload.action?.amount || 0;
  const currency = payload.action?.currency || "INR";

  const docClient = getDocClient();
  let mode: "test" | "live" = "test";

  try {
    const { client, settings } = await getRazorpayClient(docClient, saleorApiUrl);
    mode = settings.mode;

    if (!settings.enabled) {
      throw new Error("Razorpay payment gateway is disabled");
    }

    // Always capture payment immediately (auto-capture).
    // Without a TRANSACTION_PROCESS_SESSION webhook, Saleor requires charged
    // (not just authorized) funds before checkoutComplete will succeed.
    const paymentCapture = true;

    // 1. Create Razorpay Order
    // Razorpay receipt max length is 40 chars; Saleor IDs are base64 and longer
    const receipt = (orderId || "").slice(0, 40);

    const razorpayOrder = await client.orders.create({
      amount: Math.round(amount * 100), // convert to paise
      currency,
      receipt,
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
    let keyId = "";
    if (settings.mode === "live") {
      if (!settings.liveKeyId) {
        throw new Error("Razorpay Live Key ID is missing while in Live mode");
      }
      keyId = settings.liveKeyId;
    } else {
      // Test mode — use test key or fallback to env for local dev
      keyId = settings.testKeyId || process.env.RAZORPAY_KEY_ID || "";
    }

    if (!keyId) {
      throw new Error(`Razorpay Key ID is missing for ${settings.mode} mode`);
    }

    // Important: Use Number(amount.toFixed(2)) to match Saleor's PositiveDecimal exactly
    const preciseAmount = Number(amount.toFixed(2));

    // Build Razorpay dashboard URL for this order
    const externalUrl = `https://dashboard.razorpay.com/app/orders/${razorpayOrder.id}`;

    return res.status(200).json({
      pspReference: razorpayOrder.id,
      result: "CHARGE_ACTION_REQUIRED",
      amount: preciseAmount,
      actions: ["REFUND"],
      externalUrl,
      data: {
        razorpay_order_id: razorpayOrder.id,
        razorpay_key_id: keyId,
        amount: razorpayOrder.amount, // already in paise from Razorpay
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
