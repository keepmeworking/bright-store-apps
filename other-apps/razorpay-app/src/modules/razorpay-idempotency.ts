type Money = {
  amount?: number | null;
  currency?: string | null;
};

export type SaleorTransactionLike = {
  pspReference?: string | null;
  chargedAmount?: Money | null;
};

type SaleorNodeWithTransactions = {
  transactions?: SaleorTransactionLike[] | null;
};

type SaleorGraphQLExecutor = <TData>(query: string, variables: Record<string, unknown>) => Promise<TData>;

const GET_CHECKOUT_TRANSACTIONS = /* GraphQL */ `
  query GetCheckoutTransactions($id: ID!) {
    checkout(id: $id) {
      id
      transactions {
        pspReference
        chargedAmount {
          amount
          currency
        }
      }
    }
  }
`;

const GET_ORDER_TRANSACTIONS = /* GraphQL */ `
  query GetOrderTransactions($id: ID!) {
    order(id: $id) {
      id
      transactions {
        pspReference
        chargedAmount {
          amount
          currency
        }
      }
    }
  }
`;

function detectSourceType(id: string): "checkout" | "order" | "unknown" {
  try {
    const decoded = Buffer.from(id, "base64").toString("utf8");
    if (decoded.startsWith("Checkout:")) return "checkout";
    if (decoded.startsWith("Order:")) return "order";
  } catch {
    // ignore decode errors
  }
  return "unknown";
}

export function hasChargedTransactionWithPspReference(
  transactions: SaleorTransactionLike[] = [],
  pspReference?: string | null
) {
  if (!pspReference) {
    return false;
  }

  return transactions.some((transaction) => {
    if (transaction.pspReference !== pspReference) {
      return false;
    }

    return (transaction.chargedAmount?.amount || 0) > 0;
  });
}

export async function findExistingChargedTransactionReference(
  executeGraphQL: SaleorGraphQLExecutor,
  sourceId?: string | null,
  pspReference?: string | null
) {
  if (!sourceId || !pspReference) {
    return null;
  }

  const sourceType = detectSourceType(sourceId);

  let transactions: SaleorTransactionLike[] = [];

  if (sourceType === "checkout") {
    const result = await executeGraphQL<{
      checkout?: SaleorNodeWithTransactions | null;
    }>(GET_CHECKOUT_TRANSACTIONS, { id: sourceId });
    transactions = result.checkout?.transactions || [];
  } else if (sourceType === "order") {
    const result = await executeGraphQL<{
      order?: SaleorNodeWithTransactions | null;
    }>(GET_ORDER_TRANSACTIONS, { id: sourceId });
    transactions = result.order?.transactions || [];
  } else {
    // Unknown type — try checkout first, then order
    try {
      const result = await executeGraphQL<{
        checkout?: SaleorNodeWithTransactions | null;
      }>(GET_CHECKOUT_TRANSACTIONS, { id: sourceId });
      transactions = result.checkout?.transactions || [];
    } catch {
      try {
        const result = await executeGraphQL<{
          order?: SaleorNodeWithTransactions | null;
        }>(GET_ORDER_TRANSACTIONS, { id: sourceId });
        transactions = result.order?.transactions || [];
      } catch {
        return null;
      }
    }
  }

  return hasChargedTransactionWithPspReference(transactions, pspReference) ? pspReference : null;
}
