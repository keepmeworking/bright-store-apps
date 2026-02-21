import { NextApiRequest, NextApiResponse } from "next";
import {
  type GetWidgetsQuery,
  GetWidgetsDocument,
} from "../../../../generated/graphql";
import { normalizeSaleorApiUrl } from "@/lib/saleor-api-url";
import { createClient as createSafeGraphQLClient } from "@/lib/create-graphql-client";

type ReviewStatusFilter = "all" | "pending" | "approved" | "rejected";
type ReviewListItem = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  rating: number;
  status: "pending" | "approved" | "rejected";
  productId: string;
};
type ReviewListPayload = {
  items: ReviewListItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
};

const RESPONSE_CACHE_TTL_MS = 15_000;
const LIST_CACHE = globalThis as typeof globalThis & {
  __magicCmsReviewsListCache?: Map<string, { expiresAt: number; payload: ReviewListPayload }>;
};

const parseIntSafe = (value: string | string[] | undefined, fallback: number) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const getStringParam = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
};

const normalizeStatusFilter = (value: string): ReviewStatusFilter => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pending" || normalized === "approved" || normalized === "rejected") {
    return normalized;
  }
  return "all";
};

const getListCache = () => {
  if (!LIST_CACHE.__magicCmsReviewsListCache) {
    LIST_CACHE.__magicCmsReviewsListCache = new Map();
  }
  return LIST_CACHE.__magicCmsReviewsListCache;
};

const getCacheKey = (input: {
  saleorApiUrl: string;
  pageTypeId: string;
  statusFilter: ReviewStatusFilter;
  search: string;
  limit: number;
  after: string | null;
  cacheBust: string;
}) =>
  JSON.stringify([
    input.saleorApiUrl,
    input.pageTypeId,
    input.statusFilter,
    input.search,
    input.limit,
    input.after || "",
    input.cacheBust || "",
  ]);

const toCompactMessage = (message: string) => {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "Unable to load reviews from Saleor.";
  if (normalized.includes("returned HTML") || normalized.includes("DOCTYPE html")) {
    return "Saleor returned non-JSON response. Check API URL (/graphql/) and refresh auth token.";
  }
  return normalized.length > 260 ? `${normalized.slice(0, 257)}...` : normalized;
};

type PageNode = NonNullable<NonNullable<GetWidgetsQuery["pages"]>["edges"][number]>["node"];

const getAttributeValue = (review: PageNode, slug: string) => {
  const attribute = review.attributes.find((item) => item.attribute.slug === slug);
  const value = attribute?.values[0];
  if (!value) return "";
  return value.name || value.value || value.slug || "";
};

const getStatusFromReview = (review: PageNode) => {
  const normalized = getAttributeValue(review, "magic-status").trim().toLowerCase();
  if (normalized === "approved" || normalized === "rejected" || normalized === "pending") {
    return normalized;
  }
  return "pending";
};

const getRatingFromReview = (review: PageNode) => {
  const parsed = Number.parseInt(getAttributeValue(review, "magic-rating"), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
};

const getLinkedProductFromReview = (review: PageNode) =>
  review.attributes.find((item) => item.attribute.slug === "magic-linked-products")?.values[0]?.reference || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Missing authorization token" });
  }

  const saleorApiUrl = normalizeSaleorApiUrl(getStringParam(req.query.saleorApiUrl));
  const pageTypeId = getStringParam(req.query.pageTypeId);
  if (!saleorApiUrl || !pageTypeId) {
    return res.status(400).json({ message: "Missing saleorApiUrl or pageTypeId" });
  }

  const statusFilter = normalizeStatusFilter(getStringParam(req.query.status));
  const search = getStringParam(req.query.search).trim();
  const limit = Math.max(1, Math.min(100, parseIntSafe(req.query.limit, 20)));
  const initialAfter = getStringParam(req.query.after) || null;
  const cacheBust = getStringParam(req.query.cacheBust);

  const cacheKey = getCacheKey({
    saleorApiUrl,
    pageTypeId,
    statusFilter,
    search,
    limit,
    after: initialAfter,
    cacheBust,
  });
  const cache = getListCache();
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return res.status(200).json(cached.payload);
  }

  const client = createSafeGraphQLClient(saleorApiUrl, () => token);

  const batchSize = 100;
  const maxBatchRequests = statusFilter === "all" ? 1 : 20;
  let afterCursor: string | null = initialAfter;
  let hasNextPage = true;
  let nextCursor: string | null = null;
  let totalCount = 0;
  let batchRequests = 0;

  const items: ReviewListItem[] = [];

  while (items.length < limit && hasNextPage && batchRequests < maxBatchRequests) {
    batchRequests += 1;

    const result = await client
      .query(GetWidgetsDocument, {
        pageTypeIds: [pageTypeId],
        first: batchSize,
        after: afterCursor,
        search: search || undefined,
      })
      .toPromise();

    if (result.error) {
      return res.status(400).json({ message: toCompactMessage(result.error.message || "") });
    }

    const connection = result.data?.pages;
    if (!connection) {
      break;
    }

    totalCount = connection.totalCount || 0;
    const edges = connection.edges || [];
    if (edges.length === 0) {
      hasNextPage = false;
      nextCursor = null;
      break;
    }

    let reachedLimit = false;
    let lastProcessedIndex = -1;

    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index];
      lastProcessedIndex = index;
      afterCursor = edge.cursor || afterCursor;

      const node = edge.node;
      const rowStatus = getStatusFromReview(node);
      if (statusFilter !== "all" && rowStatus !== statusFilter) {
        continue;
      }

      items.push({
        id: node.id,
        title: node.title || "",
        slug: node.slug || "",
        isPublished: Boolean(node.isPublished),
        rating: getRatingFromReview(node),
        status: rowStatus,
        productId: getLinkedProductFromReview(node),
      });

      if (items.length >= limit) {
        reachedLimit = true;
        break;
      }
    }

    if (reachedLimit) {
      const hasRemainingInBatch = lastProcessedIndex < edges.length - 1;
      hasNextPage = hasRemainingInBatch || connection.pageInfo.hasNextPage;
      nextCursor = afterCursor;
      break;
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    nextCursor = hasNextPage ? connection.pageInfo.endCursor || null : null;
    afterCursor = connection.pageInfo.endCursor || afterCursor;
  }

  const payload: ReviewListPayload = {
    items,
    nextCursor,
    hasNextPage,
    totalCount,
  };

  cache.set(cacheKey, { payload, expiresAt: now + RESPONSE_CACHE_TTL_MS });
  return res.status(200).json(payload);
}
