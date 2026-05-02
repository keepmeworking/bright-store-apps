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

const GET_SOURCE_TRANSACTIONS = /* GraphQL */ `
  query GetSourceTransactions($id: ID!) {
    node(id: $id) {
      __typename
      ... on Checkout {
        id
        transactions {
          pspReference
          chargedAmount {
            amount
            currency
          }
        }
      }
      ... on Order {
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
  }
`;

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

  const result = await executeGraphQL<{
    node?: SaleorNodeWithTransactions | null;
  }>(GET_SOURCE_TRANSACTIONS, {
    id: sourceId,
  });

  const transactions = result.node?.transactions || [];

  return hasChargedTransactionWithPspReference(transactions, pspReference) ? pspReference : null;
}
