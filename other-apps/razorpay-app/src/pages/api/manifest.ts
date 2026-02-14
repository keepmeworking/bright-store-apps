import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import packageJson from "@/package.json";
import { transactionInitializeWebhook } from "./webhooks/transaction-initialize";
import { paymentGatewayInitializeSessionWebhook } from "./webhooks/payment-gateway-initialize-session";
import { transactionChargeRequestedWebhook } from "./webhooks/transaction-charge-requested";
import { transactionRefundRequestedWebhook } from "./webhooks/transaction-refund-requested";

import { env } from "@/env";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl, request, schemaVersion }) {
    const apiBaseURL = env.APP_API_BASE_URL ?? appBaseUrl;
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;

    const manifest: AppManifest = {
      id: "razorpay.app",
      version: packageJson.version,
      name: "Razorpay (Daikcell)",
      tokenTargetUrl: `${apiBaseURL}/api/register`,
      appUrl: iframeBaseUrl,
      permissions: [
        "MANAGE_ORDERS",
        "HANDLE_PAYMENTS",
        "MANAGE_CHECKOUTS",
      ],
      webhooks: [
        transactionInitializeWebhook.getWebhookManifest(apiBaseURL),
        transactionChargeRequestedWebhook.getWebhookManifest(apiBaseURL),
        transactionRefundRequestedWebhook.getWebhookManifest(apiBaseURL),
        // Modern Session Webhooks (Saleor 3.x)
        paymentGatewayInitializeSessionWebhook.getWebhookManifest(apiBaseURL),
      ],
      author: "Antigravity",
      brand: {
        logo: {
          default: `${apiBaseURL}/logo.png`,
        },
      },
    };

    return manifest;
  },
});
