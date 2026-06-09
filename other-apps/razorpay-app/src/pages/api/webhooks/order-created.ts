import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import { getDocClient } from "@/modules/dynamodb-helpers";
import { getRazorpayClient } from "@/modules/razorpay-settings";
import { syncSaleorOrderToRazorpayNotes } from "@/modules/razorpay-order-notes";
import { resolveRazorpayReferencesFromTransactions } from "@/modules/resolve-razorpay-order-references";

type OrderCreatedPayload = {
  order?: {
    id: string;
    number: string;
    transactions?: Array<{
      pspReference?: string | null;
      chargedAmount?: { amount?: number | null } | null;
    }> | null;
  } | null;
};

const ORDER_CREATED_RAZORPAY_NOTES_SUBSCRIPTION = `
  subscription OrderCreatedRazorpayNotes {
    event {
      ... on OrderCreated {
        order {
          id
          number
          transactions {
            pspReference
            chargedAmount {
              amount
            }
          }
        }
      }
    }
  }
`;

export const orderCreatedWebhook = new SaleorAsyncWebhook<OrderCreatedPayload>({
  name: "Order Created Razorpay Notes Sync",
  webhookPath: "/api/webhooks/order-created",
  event: "ORDER_CREATED",
  apl: saleorApp.apl,
  query: ORDER_CREATED_RAZORPAY_NOTES_SUBSCRIPTION,
});

export default orderCreatedWebhook.createHandler(async (_req, res, ctx) => {
  const saleorApiUrl = ctx.authData.saleorApiUrl;
  const order = ctx.payload.order;

  if (!order?.id || !order.number) {
    return res.status(200).json({ ok: true, skipped: "missing_order" });
  }

  const { razorpayPaymentId, razorpayOrderId } = resolveRazorpayReferencesFromTransactions(
    order.transactions || [],
  );

  if (!razorpayPaymentId && !razorpayOrderId) {
    return res.status(200).json({ ok: true, skipped: "no_razorpay_transaction" });
  }

  try {
    const docClient = getDocClient();
    const { client } = await getRazorpayClient(docClient, saleorApiUrl);
    const result = await syncSaleorOrderToRazorpayNotes(client, {
      orderNumber: String(order.number),
      orderId: order.id,
      razorpayPaymentId,
      razorpayOrderId,
    });

    if (!result.synced) {
      console.warn(
        `[OrderCreated] Razorpay notes not synced for order #${order.number}: ${result.reason}`,
      );
      return res.status(200).json({ ok: true, skipped: result.reason });
    }

    console.log(`[OrderCreated] Razorpay notes synced for order #${order.number}`);
    return res.status(200).json({ ok: true, synced: true });
  } catch (error) {
    console.warn(
      `[OrderCreated] Failed to sync Razorpay notes for order #${order.number}:`,
      error,
    );
    return res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to sync Razorpay notes",
    });
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
