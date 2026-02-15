import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import packageJson from "@/package.json";
import { transactionInitializeWebhook } from "./webhooks/transaction-initialize";
import { transactionProcessSessionWebhook } from "./webhooks/transaction-process-session";
import { paymentGatewayInitializeSessionWebhook } from "./webhooks/payment-gateway-initialize-session";
import { transactionChargeRequestedWebhook } from "./webhooks/transaction-charge-requested";
import { transactionRefundRequestedWebhook } from "./webhooks/transaction-refund-requested";

import { env } from "@/env";

export default createManifestHandler({
  async manifestFactory({ appBaseUrl, request, schemaVersion }) {
    const apiBaseURL = env.APP_API_BASE_URL ?? appBaseUrl;
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;

    const normalizedApiBaseURL = apiBaseURL.replace(/\/$/, "");

    const manifest: AppManifest = {
      id: "razorpay.app",
      version: packageJson.version,
      name: "Razorpay",
      tokenTargetUrl: `${normalizedApiBaseURL}/api/register`,
      appUrl: iframeBaseUrl,
      permissions: [
        "MANAGE_ORDERS",
        "HANDLE_PAYMENTS",
        "MANAGE_CHECKOUTS",
      ],
      webhooks: [
        transactionInitializeWebhook.getWebhookManifest(normalizedApiBaseURL),
        transactionProcessSessionWebhook.getWebhookManifest(normalizedApiBaseURL),
        transactionChargeRequestedWebhook.getWebhookManifest(normalizedApiBaseURL),
        transactionRefundRequestedWebhook.getWebhookManifest(normalizedApiBaseURL),
        // Modern Session Webhooks (Saleor 3.x)
        paymentGatewayInitializeSessionWebhook.getWebhookManifest(normalizedApiBaseURL),
      ],
      author: "Brightcode Canvas",
      brand: {
        logo: {
          default: `${normalizedApiBaseURL}/razorpay.png`,
        },
      },
    };

    return manifest;
  },
});
