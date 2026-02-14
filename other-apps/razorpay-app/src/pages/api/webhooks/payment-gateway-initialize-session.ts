import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  PaymentGatewayInitializeSessionDocument,
  PaymentGatewayInitializeSessionEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import { getDocClient } from "@/modules/dynamodb-helpers";
import { getSettings } from "@/modules/razorpay-settings";

export const paymentGatewayInitializeSessionWebhook = new SaleorSyncWebhook<
  PaymentGatewayInitializeSessionEventFragment
>({
  name: "Payment Gateway Initialize Session",
  webhookPath: "/api/webhooks/payment-gateway-initialize-session",
  event: "PAYMENT_GATEWAY_INITIALIZE_SESSION" as any,
  apl: saleorApp.apl,
  query: PaymentGatewayInitializeSessionDocument,
});

export default paymentGatewayInitializeSessionWebhook.createHandler(async (req, res, ctx) => {
  const saleorApiUrl = ctx.authData.saleorApiUrl;
  const docClient = getDocClient();

  try {
    if (!docClient) {
      throw new Error("DynamoDB not configured");
    }

    const settings = await getSettings(docClient, saleorApiUrl);

    if (!settings.enabled) {
      return res.status(200).json(null); // Gateway disabled
    }

    const keyId = settings.mode === "live" && settings.liveKeyId
      ? settings.liveKeyId
      : settings.testKeyId || process.env.RAZORPAY_KEY_ID || "";

    return res.status(200).json({
      data: {
        razorpay_key_id: keyId,
      },
    });
  } catch (error) {
    console.error("Payment Gateway Initialize Failed:", error);
    return res.status(200).json(null);
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
