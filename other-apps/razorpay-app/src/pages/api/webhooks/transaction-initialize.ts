
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import {
  TransactionInitializeSessionDocument,
  TransactionInitializeSessionEventFragment,
} from "../../../../generated/graphql";
import { saleorApp } from "@/saleor-app";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { logTransaction } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";
import {
  buildRazorpayReceipt,
  mergeRazorpayOrderNotes,
  readStorefrontGatewayNotes,
} from "@/modules/razorpay-order-notes";

function readStandardCheckoutGstin(data: unknown) {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const notes = (data as { notes?: unknown }).notes;
  if (!notes || typeof notes !== "object") {
    return undefined;
  }

  const gstin = (notes as { gstin?: unknown }).gstin;
  if (typeof gstin !== "string") {
    return undefined;
  }

  const normalized = gstin.trim().toUpperCase();
  return normalized || undefined;
}

function normalizeMagicCheckoutData(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    checkout_flow?: unknown;
    line_items_total?: unknown;
    line_items?: unknown;
    shipping_fee?: unknown;
    customer_details?: unknown;
  };

  const checkoutFlow = payload.checkout_flow === "magic" ? "magic" : undefined;

  if (checkoutFlow !== "magic" || !Array.isArray(payload.line_items) || payload.line_items.length === 0) {
    return null;
  }

  const sanitizeText = (value: unknown, maxLength = 128) => {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  };

  const sanitizeLineItems = payload.line_items
    .map((lineItem) => {
      if (!lineItem || typeof lineItem !== "object") {
        return null;
      }

      const rawLineItem = lineItem as Record<string, unknown>;
      const quantity =
        typeof rawLineItem.quantity === "number" && Number.isFinite(rawLineItem.quantity)
          ? Math.max(1, Math.round(rawLineItem.quantity))
          : 1;
      const offerPrice =
        typeof rawLineItem.offer_price === "number" && Number.isFinite(rawLineItem.offer_price)
          ? Math.max(0, Math.round(rawLineItem.offer_price))
          : 0;
      const price =
        typeof rawLineItem.price === "number" && Number.isFinite(rawLineItem.price)
          ? Math.max(0, Math.round(rawLineItem.price))
          : offerPrice;

      if (!offerPrice) {
        return null;
      }

      return {
        ...rawLineItem,
        quantity,
        offer_price: offerPrice,
        price,
        tax_amount:
          typeof rawLineItem.tax_amount === "number" && Number.isFinite(rawLineItem.tax_amount)
            ? Math.max(0, Math.round(rawLineItem.tax_amount))
            : undefined,
        name: sanitizeText(rawLineItem.name),
        description: sanitizeText(rawLineItem.description),
      };
    })
    .filter(Boolean);

  if (!sanitizeLineItems.length) {
    return null;
  }

  const customerDetails =
    payload.customer_details && typeof payload.customer_details === "object"
      ? (payload.customer_details as Record<string, unknown>)
      : undefined;

  const shippingAddress =
    customerDetails?.shipping_address && typeof customerDetails.shipping_address === "object"
      ? (customerDetails.shipping_address as Record<string, unknown>)
      : undefined;

  return {
    checkout_flow: "magic" as const,
    line_items_total:
      typeof payload.line_items_total === "number" ? Math.max(0, Math.round(payload.line_items_total)) : undefined,
    line_items: sanitizeLineItems,
    shipping_fee:
      typeof payload.shipping_fee === "number" ? Math.max(0, Math.round(payload.shipping_fee)) : undefined,
    customer_details: customerDetails
      ? {
          ...(typeof customerDetails.contact === "string" && customerDetails.contact.trim()
            ? { contact: customerDetails.contact.trim() }
            : {}),
          ...(typeof customerDetails.email === "string" && customerDetails.email.trim()
            ? { email: customerDetails.email.trim() }
            : {}),
          ...(shippingAddress
            ? {
                shipping_address: {
                  ...(sanitizeText(shippingAddress.name) ? { name: sanitizeText(shippingAddress.name) } : {}),
                  ...(typeof shippingAddress.contact === "string" && shippingAddress.contact.trim()
                    ? { contact: shippingAddress.contact.trim() }
                    : {}),
                  ...(sanitizeText(shippingAddress.line1) ? { line1: sanitizeText(shippingAddress.line1) } : {}),
                  ...(sanitizeText(shippingAddress.line2) ? { line2: sanitizeText(shippingAddress.line2) } : {}),
                  ...(sanitizeText(shippingAddress.city) ? { city: sanitizeText(shippingAddress.city) } : {}),
                  ...(sanitizeText(shippingAddress.state) ? { state: sanitizeText(shippingAddress.state) } : {}),
                  ...(sanitizeText(shippingAddress.country, 8)
                    ? { country: sanitizeText(shippingAddress.country, 8) }
                    : {}),
                },
              }
            : {}),
        }
      : undefined,
  };
}

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
  const magicCheckoutData = normalizeMagicCheckoutData(payload.data);
  const standardCheckoutGstin = readStandardCheckoutGstin(payload.data);

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
    const receipt = buildRazorpayReceipt(orderId || "");
    const storefrontNotes = readStorefrontGatewayNotes(payload.data);
    const orderNotes = mergeRazorpayOrderNotes(
      {
        cart_id: orderId,
        checkout_id: orderId,
        saleor_api_url: saleorApiUrl,
      },
      storefrontNotes,
    );

    const useMagicCheckout = settings.magicCheckout && magicCheckoutData?.checkout_flow === "magic";

    if (!useMagicCheckout && standardCheckoutGstin) {
      orderNotes.gstin = standardCheckoutGstin;
    }

    const sanitizedOrderNotes = mergeRazorpayOrderNotes(orderNotes);

    const razorpayOrder = await client.orders.create({
      amount: Math.round(amount * 100), // convert to paise
      currency,
      receipt,
      payment_capture: paymentCapture,
      ...(Object.keys(sanitizedOrderNotes).length ? { notes: sanitizedOrderNotes } : {}),
      ...(useMagicCheckout && magicCheckoutData?.line_items?.length
        ? {
            line_items_total: magicCheckoutData.line_items_total ?? Math.round(amount * 100),
            line_items: magicCheckoutData.line_items,
            ...(typeof magicCheckoutData.shipping_fee === "number"
              ? { shipping_fee: magicCheckoutData.shipping_fee }
              : {}),
            ...(magicCheckoutData.customer_details
              ? { customer_details: magicCheckoutData.customer_details }
              : {}),
          }
        : {}),
    } as any);

    if (settings.debugMode) {
      console.log("[Razorpay Init] Order created:", razorpayOrder.id);
    }

    const customerEmail =
      typeof magicCheckoutData?.customer_details?.email === "string"
        ? magicCheckoutData.customer_details.email
        : undefined;
    const customerPhone =
      typeof magicCheckoutData?.customer_details?.contact === "string"
        ? magicCheckoutData.customer_details.contact
        : typeof magicCheckoutData?.customer_details?.shipping_address?.contact === "string"
          ? magicCheckoutData.customer_details.shipping_address.contact
          : undefined;

    // 2. Log the transaction
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "initialize",
      status: "success",
      amount,
      currency,
      razorpayOrderId: razorpayOrder.id,
      receipt,
      saleorCheckoutId: orderId,
      saleorOrderId: orderId,
      customerEmail,
      customerPhone,
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
      // Test mode — use test key from app settings
      keyId = settings.testKeyId || "";
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
        magic_checkout: useMagicCheckout,
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
        receipt: buildRazorpayReceipt(orderId || ""),
        saleorCheckoutId: orderId,
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
