/**
 * Razorpay Settings API
 *
 * GET  — Returns masked settings for dashboard display
 * POST — Saves/updates settings (encrypts secrets)
 */

import { type NextApiRequest, type NextApiResponse } from "next";
import { createProtectedHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import {
  getSettings,
  saveSettings,
  maskSettings,
  type RazorpaySettings,
} from "@/modules/razorpay-settings";
import { getDocClient } from "@/modules/dynamodb-helpers";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: { authData: { saleorApiUrl: string } }
) {
  const saleorApiUrl = ctx.authData.saleorApiUrl;
  const docClient = getDocClient();

  if (!docClient) {
    return res.status(500).json({
      error: "DynamoDB not configured. Please set DynamoDB environment variables.",
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET — Return masked settings
  // ─────────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const settings = await getSettings(docClient, saleorApiUrl);
      const masked = maskSettings(settings);
      return res.status(200).json(masked);
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      return res.status(500).json({ error: "Failed to fetch settings" });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST — Save settings
  // ─────────────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const body = req.body as Partial<RazorpaySettings>;

      // Validate mode
      if (body.mode && !["test", "live"].includes(body.mode)) {
        return res.status(400).json({ error: "Invalid mode. Must be 'test' or 'live'." });
      }

      // Validate payment action
      if (body.paymentAction && !["authorize", "authorize_capture"].includes(body.paymentAction)) {
        return res.status(400).json({
          error: "Invalid paymentAction. Must be 'authorize' or 'authorize_capture'.",
        });
      }

      // Save (encryption handled internally)
      const saved = await saveSettings(docClient, saleorApiUrl, body);
      const masked = maskSettings(saved);

      return res.status(200).json({
        success: true,
        settings: masked,
      });
    } catch (error) {
      console.error("Failed to save settings:", error);
      return res.status(500).json({ error: "Failed to save settings" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default createProtectedHandler(handler, saleorApp.apl, ["MANAGE_APPS"]);
