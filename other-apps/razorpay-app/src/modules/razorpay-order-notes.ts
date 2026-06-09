import type Razorpay from "razorpay";

const NOTE_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;
const NOTE_VALUE_MAX_LENGTH = 256;
const RECEIPT_MAX_LENGTH = 40;

export type RazorpayOrderNoteInput = Record<string, string | undefined | null>;

export const sanitizeRazorpayNotes = (notes: RazorpayOrderNoteInput): Record<string, string> => {
  const sanitized: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(notes)) {
    if (!NOTE_KEY_PATTERN.test(key)) {
      continue;
    }

    if (typeof rawValue !== "string") {
      continue;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    sanitized[key] =
      trimmed.length > NOTE_VALUE_MAX_LENGTH ? trimmed.slice(0, NOTE_VALUE_MAX_LENGTH) : trimmed;
  }

  return sanitized;
};

export const buildRazorpayReceipt = (checkoutId: string) => {
  const normalizedCheckoutId = checkoutId.trim();
  if (!normalizedCheckoutId) {
    return "dc-checkout";
  }

  try {
    const decoded = Buffer.from(normalizedCheckoutId, "base64").toString("utf-8");
    const token = decoded.split(":").pop()?.replace(/[^a-zA-Z0-9]/g, "");
    if (token) {
      return `dc-${token}`.slice(0, RECEIPT_MAX_LENGTH);
    }
  } catch {
    // Fall back to truncated checkout id below.
  }

  return normalizedCheckoutId.slice(0, RECEIPT_MAX_LENGTH);
};

export const mergeRazorpayOrderNotes = (
  baseNotes: RazorpayOrderNoteInput,
  storefrontNotes?: RazorpayOrderNoteInput,
): Record<string, string> => sanitizeRazorpayNotes({ ...storefrontNotes, ...baseNotes });

export const readStorefrontGatewayNotes = (data: unknown): Record<string, string> => {
  if (!data || typeof data !== "object") {
    return {};
  }

  const notes = (data as { notes?: unknown }).notes;
  if (!notes || typeof notes !== "object") {
    return {};
  }

  return sanitizeRazorpayNotes(notes as RazorpayOrderNoteInput);
};

export const buildSaleorOrderNotePayload = (
  orderNumber: string,
  orderId?: string,
): Record<string, string> => {
  const normalizedOrderNumber = orderNumber.trim().replace(/^#+/, "");
  if (!normalizedOrderNumber) {
    return {};
  }

  return sanitizeRazorpayNotes({
    saleor_order_number: normalizedOrderNumber,
    order_ref: `#${normalizedOrderNumber}`,
    ...(orderId ? { saleor_order_id: orderId } : {}),
  });
};

const mergeExistingNotes = (
  existingNotes: RazorpayOrderNoteInput | undefined,
  saleorOrderNotes: Record<string, string>,
): Record<string, string> =>
  sanitizeRazorpayNotes({
    ...sanitizeRazorpayNotes(existingNotes || {}),
    ...saleorOrderNotes,
  });

export const backfillRazorpayOrderWithSaleorOrder = async (
  client: Razorpay,
  razorpayOrderId: string,
  args: { orderNumber: string; orderId?: string; razorpayPaymentId?: string },
) => {
  const orderNumber = args.orderNumber.trim();
  if (!razorpayOrderId.trim() || !orderNumber) {
    return;
  }

  const saleorOrderNotes = buildSaleorOrderNotePayload(orderNumber, args.orderId);
  if (!Object.keys(saleorOrderNotes).length) {
    return;
  }

  let existingOrderNotes: Record<string, string> = {};

  try {
    const existingOrder = await client.orders.fetch(razorpayOrderId);
    existingOrderNotes = sanitizeRazorpayNotes((existingOrder.notes || {}) as RazorpayOrderNoteInput);
  } catch {
    existingOrderNotes = {};
  }

  await client.orders.edit(razorpayOrderId, {
    notes: mergeExistingNotes(existingOrderNotes, saleorOrderNotes),
  });

  const razorpayPaymentId = args.razorpayPaymentId?.trim();
  if (!razorpayPaymentId) {
    return;
  }

  let existingPaymentNotes: Record<string, string> = {};

  try {
    const existingPayment = await client.payments.fetch(razorpayPaymentId);
    existingPaymentNotes = sanitizeRazorpayNotes(
      (existingPayment.notes || {}) as RazorpayOrderNoteInput,
    );
  } catch {
    existingPaymentNotes = {};
  }

  await client.payments.edit(razorpayPaymentId, {
    notes: mergeExistingNotes(existingPaymentNotes, saleorOrderNotes),
  });
};

export const syncSaleorOrderToRazorpayNotes = async (
  client: Razorpay,
  args: {
    orderNumber: string;
    orderId: string;
    razorpayPaymentId?: string;
    razorpayOrderId?: string;
  },
) => {
  let razorpayOrderId = args.razorpayOrderId?.trim();
  const razorpayPaymentId = args.razorpayPaymentId?.trim();

  if (razorpayPaymentId && !razorpayOrderId) {
    try {
      const payment = await client.payments.fetch(razorpayPaymentId);
      if (typeof payment.order_id === "string" && payment.order_id.trim()) {
        razorpayOrderId = payment.order_id.trim();
      }
    } catch {
      // Non-fatal: order notes can still be updated when order id is known.
    }
  }

  if (!razorpayOrderId) {
    return { synced: false as const, reason: "missing_razorpay_order_id" as const };
  }

  await backfillRazorpayOrderWithSaleorOrder(client, razorpayOrderId, {
    orderNumber: args.orderNumber,
    orderId: args.orderId,
    razorpayPaymentId,
  });

  return { synced: true as const };
};
