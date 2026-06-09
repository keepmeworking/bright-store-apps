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

export const backfillRazorpayOrderWithSaleorOrder = async (
  client: Razorpay,
  razorpayOrderId: string,
  args: { orderNumber: string; orderId?: string },
) => {
  const orderNumber = args.orderNumber.trim();
  if (!razorpayOrderId.trim() || !orderNumber) {
    return;
  }

  let existingNotes: Record<string, string> = {};

  try {
    const existingOrder = await client.orders.fetch(razorpayOrderId);
    existingNotes = sanitizeRazorpayNotes((existingOrder.notes || {}) as RazorpayOrderNoteInput);
  } catch {
    existingNotes = {};
  }

  await client.orders.edit(razorpayOrderId, {
    notes: sanitizeRazorpayNotes({
      ...existingNotes,
      saleor_order_number: orderNumber,
      ...(args.orderId ? { saleor_order_id: args.orderId } : {}),
    }),
  });
};
