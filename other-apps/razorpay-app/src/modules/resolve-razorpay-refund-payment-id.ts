export type RazorpayOrderPayment = {
  id?: string | null;
  status?: string | null;
  /** Razorpay typings allow string | number for money fields. */
  amount?: string | number | null;
  amount_refunded?: string | number | null;
};

export type RazorpayOrderPaymentsResponse =
  | RazorpayOrderPayment[]
  | {
      items?: RazorpayOrderPayment[] | null;
      count?: number | null;
    }
  | null
  | undefined;

export type NormalizedRazorpayPspReference =
  | { kind: "payment"; id: string }
  | { kind: "order"; id: string }
  | { kind: "invalid"; id: string };

export type ResolveRazorpayRefundPaymentIdResult = {
  paymentId: string;
  resolvedFrom: "pspReference" | "siblingTransaction" | "orderPayments";
  orderId?: string;
};

export type ResolveRazorpayRefundPaymentIdOptions = {
  fetchOrderPayments: (orderId: string) => Promise<RazorpayOrderPaymentsResponse>;
  siblingPspReferences?: Array<string | null | undefined>;
};

const asPaymentsList = (response: RazorpayOrderPaymentsResponse): RazorpayOrderPayment[] => {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return Array.isArray(response.items) ? response.items : [];
};

export const normalizeRazorpayPspReference = (
  pspReference: string | null | undefined,
): NormalizedRazorpayPspReference => {
  const id = String(pspReference || "").trim();
  if (!id) {
    return { kind: "invalid", id: "" };
  }
  if (id.startsWith("pay_")) {
    return { kind: "payment", id };
  }
  if (id.startsWith("order_")) {
    return { kind: "order", id };
  }
  return { kind: "invalid", id };
};

export const pickRefundablePaymentFromOrderPayments = (
  response: RazorpayOrderPaymentsResponse,
): string | undefined => {
  const payments = asPaymentsList(response).filter(
    (payment): payment is RazorpayOrderPayment & { id: string } =>
      Boolean(payment?.id && String(payment.id).startsWith("pay_")),
  );

  const isRefundable = (payment: RazorpayOrderPayment) => {
    const amount = Number(payment.amount ?? 0);
    const refunded = Number(payment.amount_refunded ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (Number.isFinite(refunded) && refunded >= amount) return false;
    return true;
  };

  const captured = payments.find(
    (payment) => payment.status === "captured" && isRefundable(payment),
  );
  if (captured) return captured.id;

  const authorized = payments.find(
    (payment) => payment.status === "authorized" && isRefundable(payment),
  );
  if (authorized) return authorized.id;

  return undefined;
};

/**
 * Razorpay refunds require a payment id (`pay_…`).
 * Saleor/Magic Checkout sometimes stores the order id (`order_…`) as pspReference —
 * resolve that to a refundable payment before calling payments.refund.
 */
export async function resolveRazorpayRefundPaymentId(
  pspReference: string | null | undefined,
  options: ResolveRazorpayRefundPaymentIdOptions,
): Promise<ResolveRazorpayRefundPaymentIdResult> {
  const normalized = normalizeRazorpayPspReference(pspReference);

  if (normalized.kind === "invalid") {
    if (!normalized.id) {
      throw new Error("Missing Razorpay Payment ID (pspReference) for refund");
    }
    throw new Error(
      `pspReference "${normalized.id}" is not a valid Razorpay payment or order id for refund`,
    );
  }

  if (normalized.kind === "payment") {
    return { paymentId: normalized.id, resolvedFrom: "pspReference" };
  }

  const siblingPayment = (options.siblingPspReferences || [])
    .map((value) => String(value || "").trim())
    .find((value) => value.startsWith("pay_"));

  if (siblingPayment) {
    return {
      paymentId: siblingPayment,
      resolvedFrom: "siblingTransaction",
      orderId: normalized.id,
    };
  }

  const orderPayments = await options.fetchOrderPayments(normalized.id);
  const paymentId = pickRefundablePaymentFromOrderPayments(orderPayments);
  if (!paymentId) {
    throw new Error(`No refundable Razorpay payment found for ${normalized.id}`);
  }

  return {
    paymentId,
    resolvedFrom: "orderPayments",
    orderId: normalized.id,
  };
}
