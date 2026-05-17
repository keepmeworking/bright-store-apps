import { NextApiRequest, NextApiResponse } from "next";
import { saleorApp } from "@/saleor-app";

type OrderLine = {
  quantity?: number | null;
  variant?: {
    product?: {
      id?: string | null;
    } | null;
  } | null;
};

type OrderFullyPaidPayload = {
  order?: {
    id?: string | null;
    lines?: OrderLine[] | null;
  } | null;
};

const GET_PRODUCTS_METADATA = /* GraphQL */ `
  query GetProductsMetadata($ids: [ID!]!) {
    products(first: 100, filter: { ids: $ids }) {
      edges {
        node {
          id
          metadata { key value }
        }
      }
    }
  }
`;

const UPDATE_PRODUCT_METADATA = /* GraphQL */ `
  mutation UpdateProductMetadata($id: ID!, $input: [MetadataInput!]!) {
    updateMetadata(id: $id, input: $input) {
      errors { field code message }
    }
  }
`;

async function saleorGraphQL<T>(
  saleorApiUrl: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(saleorApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization-Bearer": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };

  if (!res.ok || json.errors?.length) {
    throw new Error(
      json.errors?.map((e) => e.message).join(" | ") || `Saleor GraphQL error ${res.status}`
    );
  }

  if (!json.data) throw new Error("Saleor GraphQL response missing data");
  return json.data;
}

function resolvePayload(body: unknown): OrderFullyPaidPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;
  const event = root.event as Record<string, unknown> | undefined;
  const order = (event?.order ?? root.order) as OrderFullyPaidPayload["order"];
  return order ? { order } : null;
}

function resolveSaleorApiUrl(req: NextApiRequest): string {
  const header = req.headers["saleor-api-url"] || req.headers["x-saleor-api-url"];
  return (Array.isArray(header) ? header[0] : header) ||
    process.env.SALEOR_API_URL ||
    process.env.NEXT_PUBLIC_SALEOR_API_URL ||
    "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const saleorApiUrl = resolveSaleorApiUrl(req);
  const payload = resolvePayload(req.body);
  const order = payload?.order;

  if (!order?.id || !order.lines?.length) {
    return res.status(200).json({ success: true, skipped: true });
  }

  // Aggregate quantity per product (one order can have same product in multiple lines)
  const quantityByProductId = new Map<string, number>();
  for (const line of order.lines) {
    const productId = line?.variant?.product?.id;
    const qty = line?.quantity;
    if (productId && typeof qty === "number" && qty > 0) {
      quantityByProductId.set(productId, (quantityByProductId.get(productId) ?? 0) + qty);
    }
  }

  if (!quantityByProductId.size) {
    return res.status(200).json({ success: true, skipped: true, reason: "no_product_ids" });
  }

  const authData = await saleorApp.apl.get(saleorApiUrl);
  if (!authData?.token) {
    console.error("[BestSellers] Could not resolve Saleor app auth token");
    return res.status(200).json({ success: true, skipped: true, reason: "no_auth_token" });
  }

  const productIds = [...quantityByProductId.keys()];

  try {
    // Batch-read current sales_count for all products in order
    const metaData = await saleorGraphQL<{
      products: { edges: Array<{ node: { id: string; metadata: Array<{ key: string; value: string }> } }> };
    }>(saleorApiUrl, authData.token, GET_PRODUCTS_METADATA, { ids: productIds });

    const currentCountMap = new Map<string, number>();
    for (const { node } of metaData.products.edges) {
      const entry = node.metadata.find((m) => m.key === "sales_count");
      currentCountMap.set(node.id, entry ? parseInt(entry.value, 10) || 0 : 0);
    }

    // Parallel increment writes
    await Promise.all(
      productIds.map((id) => {
        const current = currentCountMap.get(id) ?? 0;
        const added = quantityByProductId.get(id) ?? 0;
        return saleorGraphQL(saleorApiUrl, authData.token, UPDATE_PRODUCT_METADATA, {
          id,
          input: [{ key: "sales_count", value: String(current + added) }],
        });
      })
    );

    console.log(`[BestSellers] Updated sales_count for ${productIds.length} products (order ${order.id})`);
    return res.status(200).json({ success: true, updated: productIds.length });
  } catch (err) {
    console.error("[BestSellers] Failed to update product sales_count:", err);
    // Return 200 so Saleor doesn't retry — this is a non-critical side-effect
    return res.status(200).json({ success: false, error: String(err) });
  }
}
