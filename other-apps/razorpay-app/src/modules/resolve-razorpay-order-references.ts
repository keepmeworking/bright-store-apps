type OrderTransaction = {
  pspReference?: string | null;
  chargedAmount?: { amount?: number | null } | null;
};

export const resolveRazorpayReferencesFromTransactions = (transactions: OrderTransaction[] = []) => {
  let razorpayPaymentId: string | undefined;
  let razorpayOrderId: string | undefined;

  for (const transaction of transactions) {
    const reference = transaction.pspReference?.trim();
    if (!reference) {
      continue;
    }

    if (reference.startsWith("pay_")) {
      const isCharged = (transaction.chargedAmount?.amount ?? 0) > 0;
      if (isCharged || !razorpayPaymentId) {
        razorpayPaymentId = reference;
      }
    }

    if (reference.startsWith("order_")) {
      razorpayOrderId = reference;
    }
  }

  return { razorpayPaymentId, razorpayOrderId };
};
