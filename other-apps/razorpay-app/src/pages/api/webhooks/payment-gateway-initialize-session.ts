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
    const settings = await getSettings(docClient, saleorApiUrl);

    if (!settings.enabled) {
      // Returning null or empty data often causes Saleor to hide the gateway
      // but to be safe, we can return null as initially intended. 
      // If the user says it's still showing, maybe Saleor needs an empty data object.
      return res.status(200).json(null);
    }

    const keyId = settings.mode === "live" && settings.liveKeyId
      ? settings.liveKeyId
      : settings.testKeyId || process.env.RAZORPAY_KEY_ID || "";

    return res.status(200).json({
      data: {
        razorpay_key_id: keyId,
        mode: settings.mode,
        is_key_missing: !keyId,
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
