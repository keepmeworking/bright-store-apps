type ExportTransaction = {
  id?: string | null;
  pspReference?: string | null;
  name?: string | null;
  chargedAmount?: { amount?: number | null } | null;
  createdBy?:
    | {
        identifier?: string | null;
        name?: string | null;
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
      }
    | null;
  events?: ReadonlyArray<{
    type?: string | null;
    pspReference?: string | null;
  } | null> | null;
};

type ExportPayment = {
  id?: string | null;
  gateway?: string | null;
  pspReference?: string | null;
  isActive?: boolean | null;
  chargeStatus?: string | null;
};

type ExportOrderPaymentSource = {
  transactions?: ReadonlyArray<ExportTransaction | null> | null;
  payments?: ReadonlyArray<ExportPayment | null> | null;
};

const RAZORPAY_APP_IDENTIFIERS = new Set(["razorpay.app", "saleor.app.razorpay"]);
const SNAPMINT_GATEWAY_MARKERS = ["snapmint", "cardless_emi"];

const pickString = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const resolveCreatedByIdentifier = (transaction: ExportTransaction) => {
  const createdBy = transaction.createdBy;
  if (!createdBy) {
    return "";
  }

  return pickString(createdBy.identifier);
};

const resolveCreatedByLabel = (transaction: ExportTransaction) => {
  const createdBy = transaction.createdBy;
  if (!createdBy) {
    return "";
  }

  return (
    pickString(createdBy.name) ||
    pickString(createdBy.email) ||
    [pickString(createdBy.firstName), pickString(createdBy.lastName)].filter(Boolean).join(" ")
  );
};

const isChargeSuccessEvent = (eventType: string) => {
  const normalized = eventType.toUpperCase();
  return normalized.includes("CHARGE_SUCCESS") || normalized.includes("AUTHORIZATION_SUCCESS");
};

const scoreTransaction = (transaction: ExportTransaction) => {
  const chargedAmount = transaction.chargedAmount?.amount ?? 0;
  const chargeEvent = (transaction.events || []).find((event) =>
    isChargeSuccessEvent(pickString(event?.type)),
  );
  const hasPaymentReference = Boolean(
    pickString(chargeEvent?.pspReference) || pickString(transaction.pspReference),
  );

  return chargedAmount * 10 + (hasPaymentReference ? 5 : 0) + (chargeEvent ? 2 : 0);
};

export const resolvePaymentId = (order: ExportOrderPaymentSource) => {
  const transactions = (order.transactions || []).filter(Boolean) as ExportTransaction[];
  const sortedTransactions = [...transactions].sort((left, right) => scoreTransaction(right) - scoreTransaction(left));

  for (const transaction of sortedTransactions) {
    const chargeEvent = (transaction.events || []).find((event) =>
      isChargeSuccessEvent(pickString(event?.type)),
    );
    const eventReference = pickString(chargeEvent?.pspReference);
    if (eventReference) {
      return eventReference;
    }

    const transactionReference = pickString(transaction.pspReference);
    if (transactionReference) {
      return transactionReference;
    }
  }

  const activePayment = (order.payments || []).find((payment) => payment?.isActive !== false);
  const legacyReference = pickString(activePayment?.pspReference);
  if (legacyReference) {
    return legacyReference;
  }

  return pickString(order.payments?.[0]?.pspReference);
};

export const resolvePaymentProvider = (order: ExportOrderPaymentSource) => {
  const transactions = (order.transactions || []).filter(Boolean) as ExportTransaction[];
  const sortedTransactions = [...transactions].sort((left, right) => scoreTransaction(right) - scoreTransaction(left));
  const primaryTransaction = sortedTransactions[0];

  if (primaryTransaction) {
    const identifier = resolveCreatedByIdentifier(primaryTransaction).toLowerCase();
    const createdByLabel = resolveCreatedByLabel(primaryTransaction).toLowerCase();
    const transactionName = pickString(primaryTransaction.name).toLowerCase();

    if (
      RAZORPAY_APP_IDENTIFIERS.has(identifier) ||
      identifier.includes("razorpay") ||
      createdByLabel.includes("razorpay") ||
      transactionName.includes("razorpay")
    ) {
      return "Razorpay";
    }

    if (
      SNAPMINT_GATEWAY_MARKERS.some(
        (marker) =>
          identifier.includes(marker) ||
          createdByLabel.includes(marker) ||
          transactionName.includes(marker),
      )
    ) {
      return "Snapmint";
    }
  }

  const gateway = pickString(
    (order.payments || []).find((payment) => payment?.isActive !== false)?.gateway ||
      order.payments?.[0]?.gateway,
  ).toLowerCase();

  if (!gateway) {
    return transactions.length > 0 || (order.payments?.length || 0) > 0 ? "Manual" : "Manual";
  }

  if (gateway.includes("razorpay")) {
    return "Razorpay";
  }

  if (SNAPMINT_GATEWAY_MARKERS.some((marker) => gateway.includes(marker))) {
    return "Snapmint";
  }

  if (gateway.includes("manual") || gateway.includes("dummy")) {
    return "Manual";
  }

  return "Manual";
};
