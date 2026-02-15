
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import crypto from "crypto";
import { saleorApp } from "@/saleor-app";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { logTransaction } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

import {
  TransactionProcessSessionDocument,
} from "../../../../generated/graphql";

/**
 * Transaction Process Session Webhook
 *
 * Called by Saleor when the storefront calls `transactionProcess` mutation.
 * Receives the Razorpay payment details (payment_id, order_id, signature)
 * from the frontend, verifies the signature, and confirms the charge to Saleor.
 */
export const transactionProcessSessionWebhook = new SaleorSyncWebhook<any>({
  name: "Transaction Process Session",
  webhookPath: "/api/webhooks/transaction-process-session",
  event: "TRANSACTION_PROCESS_SESSION" as any,
  apl: saleorApp.apl,
  query: TransactionProcessSessionDocument,
});

export default transactionProcessSessionWebhook.createHandler(async (req, res, ctx) => {
  console.log("=== [Razorpay Process] Webhook HIT ===");
  const { payload } = ctx;
  const saleorApiUrl = ctx.authData.saleorApiUrl;

  console.log("[Razorpay Process] Payload:", JSON.stringify({
    amount: payload.action?.amount,
    currency: payload.action?.currency,
    data: payload.data,
    transactionId: payload.transaction?.id,
  }));

  const amount = payload.action?.amount || 0;
  const currency = payload.action?.currency || "INR";

  // The data sent from storefront's transactionProcess({ data: { ... } })
  const processData = payload.data as {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  } | null;

  const docClient = getDocClient();

  try {
    if (!processData?.razorpay_payment_id || !processData?.razorpay_order_id || !processData?.razorpay_signature) {
      throw new Error("Missing Razorpay payment verification data");
    }

    // Get Razorpay client to access the settings for this Saleor instance
    const { settings } = await getRazorpayClient(docClient, saleorApiUrl);

    // Get the key secret for HMAC verification strictly based on active mode
    let keySecret = "";
    if (settings.mode === "live") {
      if (!settings.liveKeySecret) {
        throw new Error("Razorpay Live Key Secret is missing while in Live mode");
      }
      keySecret = settings.liveKeySecret;
    } else {
      // Test mode — use test secret or fallback to env for local dev
      keySecret = settings.testKeySecret || process.env.RAZORPAY_KEY_SECRET || "";
    }

    if (!keySecret) {
      throw new Error(`Razorpay Key Secret is missing for ${settings.mode} mode`);
    }

    // Verify Razorpay payment signature
    // signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret)
    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${processData.razorpay_order_id}|${processData.razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== processData.razorpay_signature) {
      console.error("[Razorpay Process] Signature verification failed");

      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "process",
        status: "failed",
        amount,
        currency,
        razorpayPaymentId: processData.razorpay_payment_id,
        razorpayOrderId: processData.razorpay_order_id,
        error: "Signature verification failed",
        mode: settings.mode,
      });

      return res.status(200).json({
        pspReference: processData.razorpay_order_id,
        result: "CHARGE_FAILURE",
        amount,
        message: "Payment signature verification failed",
      });
    }

    // Signature verified — payment is authentic
    if (settings.debugMode) {
      console.log("[Razorpay Process] Signature verified successfully for payment:", processData.razorpay_payment_id);
    }

    // Log successful verification
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "process",
      status: "success",
      amount,
      currency,
      razorpayPaymentId: processData.razorpay_payment_id,
      razorpayOrderId: processData.razorpay_order_id,
      mode: settings.mode,
    });

    // Important: Ensure amount is exactly what Saleor expects
    const preciseAmount = Number(amount.toFixed(2));

    // Build Razorpay dashboard URL for this payment
    const razorpayDashboardBase = settings.mode === "live"
      ? "https://dashboard.razorpay.com/app/payments"
      : "https://dashboard.razorpay.com/app/payments";
    const externalUrl = `${razorpayDashboardBase}/${processData.razorpay_payment_id}`;

    // Return CHARGE_SUCCESS to Saleor
    return res.status(200).json({
      pspReference: processData.razorpay_payment_id,
      result: "CHARGE_SUCCESS",
      amount: preciseAmount,
      actions: ["REFUND"],
      externalUrl,
      message: "Payment verified and charged successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Razorpay Process] Error:", error);

    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "process",
      status: "failed",
      amount,
      currency,
      error: message,
      mode: "test",
    });

    return res.status(200).json({
      pspReference: processData?.razorpay_order_id || "unknown",
      result: "CHARGE_FAILURE",
      amount,
      message: `Payment processing failed: ${message}`,
    });
  }
});

/**
 * Disable body parser for this endpoint, so signature can be verified
 */
export const config = {
  api: {
    bodyParser: false,
  },
};
