import { saleorApp } from "@/saleor-app";

type MetadataInput = {
  key: string;
  value: string;
};

const UPDATE_ORDER_METADATA = /* GraphQL */ `
  mutation UpdateOrderMetadata($id: ID!, $input: [MetadataInput!]!) {
    updateMetadata(id: $id, input: $input) {
      errors {
        field
        code
        message
      }
    }
  }
`;

const ORDER_ADD_NOTE = /* GraphQL */ `
  mutation OrderAddNote($order: ID!, $message: String!) {
    orderAddNote(order: $order, input: { message: $message }) {
      errors {
        field
        code
        message
      }
    }
  }
`;

async function saleorGraphQL<TData>(
  saleorApiUrl: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<TData> {
  const response = await fetch(saleorApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization-Bearer": token,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const payload = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors?.map((entry) => entry.message || "GraphQL error").join(" | ") ||
      `Saleor GraphQL request failed: ${response.status}`;

    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("Saleor GraphQL response missing data");
  }

  return payload.data;
}

async function getAuthToken(saleorApiUrl: string) {
  const authData = await saleorApp.apl.get(saleorApiUrl);

  if (!authData?.token) {
    throw new Error("Could not resolve Saleor app auth token for metadata update");
  }

  return authData.token;
}

export async function updateOrderTrackingMetadata(
  saleorApiUrl: string,
  orderId: string,
  metadata: MetadataInput[],
  note?: string
) {
  if (!saleorApiUrl || !orderId || !metadata.length) {
    return;
  }

  const token = await getAuthToken(saleorApiUrl);

  const metadataResult = await saleorGraphQL<{
    updateMetadata: {
      errors: Array<{ field?: string | null; message?: string | null; code?: string | null }>;
    };
  }>(saleorApiUrl, token, UPDATE_ORDER_METADATA, {
    id: orderId,
    input: metadata,
  });

  if (metadataResult.updateMetadata.errors.length) {
    const message = metadataResult.updateMetadata.errors
      .map((entry) => entry.message || entry.code || entry.field || "Unknown metadata error")
      .join(" | ");

    throw new Error(`Failed to update order metadata: ${message}`);
  }

  if (!note) {
    return;
  }

  const noteResult = await saleorGraphQL<{
    orderAddNote: {
      errors: Array<{ field?: string | null; message?: string | null; code?: string | null }>;
    };
  }>(saleorApiUrl, token, ORDER_ADD_NOTE, {
    order: orderId,
    message: note,
  });

  if (noteResult.orderAddNote.errors.length) {
    const message = noteResult.orderAddNote.errors
      .map((entry) => entry.message || entry.code || entry.field || "Unknown note error")
      .join(" | ");

    throw new Error(`Failed to add order note: ${message}`);
  }
}
