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

  if (!docClient) {
    return res.status(500).json({
      success: false,
      error: "DynamoDB not configured",
    });
  }

  try {
    const { client, settings } = await getRazorpayClient(docClient, saleorApiUrl);

    // Test the connection by fetching a small list of payments
    // This validates the API keys are correct
    const payments = await client.payments.all({
      count: 1,
    });

    return res.status(200).json({
      success: true,
      mode: settings.mode,
      message: `Successfully connected to Razorpay (${settings.mode} mode)`,
      details: {
        totalPayments: payments.count ?? 0,
        enabled: settings.enabled,
        paymentAction: settings.paymentAction,
        magicCheckout: settings.magicCheckout,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Razorpay connection test failed:", error);

    return res.status(200).json({
      success: false,
      error: message,
      message: "Failed to connect to Razorpay. Please check your API keys.",
    });
  }
}

export default createProtectedHandler(handler, saleorApp.apl, ["MANAGE_APPS"]);
