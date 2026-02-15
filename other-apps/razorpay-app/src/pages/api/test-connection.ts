/**
 * Test Connection API
 *
 * Verifies Razorpay API keys by making a test API call.
 * Returns connection status, mode, and basic account info.
 */

import { type NextApiRequest, type NextApiResponse } from "next";
import { createProtectedHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { getDocClient } from "@/modules/dynamodb-helpers";

import Razorpay from "razorpay";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: { authData: { saleorApiUrl: string } }
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const saleorApiUrl = ctx.authData.saleorApiUrl;
  const docClient = getDocClient();
  const { keyId, keySecret } = req.body || {};

  try {
    let client;
    let mode;

    if (keyId && keySecret) {
      // Use provided keys for testing
      client = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
      mode = keyId.startsWith("rzp_test") ? "test" : "live";
    } else {
      // Fallback to saved settings
      const result = await getRazorpayClient(docClient, saleorApiUrl);
      client = result.client;
      mode = result.settings.mode;
    }

    // Test the connection by fetching a small list of payments
    // This validates the API keys are correct
    const payments = await client.payments.all({
      count: 1,
    });

    return res.status(200).json({
      success: true,
      mode: mode,
      message: `Successfully connected to Razorpay (${mode} mode)`,
      details: {
        totalPayments: payments.count ?? 0,
        // actions: keyId ? undefined : settings.paymentAction, 
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Check for specific Razorpay auth errors
    if (error.statusCode === 401) {
       return res.status(200).json({
        success: false,
        message: "Authentication failed. Please check your Key ID and Secret.",
      });
    }

    console.error("Razorpay connection test failed:", error);

    return res.status(200).json({
      success: false,
      error: message,
      message: error.description || message || "Failed to connect to Razorpay.",
    });
  }
}

export default createProtectedHandler(handler, saleorApp.apl, ["MANAGE_APPS"]);
