import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Spinner, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import {
  type GetWidgetsQuery,
  useDeleteWidgetMutation,
  useGetReviewPageTypeQuery,
  useUpdateWidgetMutation,
} from "../../../generated/graphql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Edit, Lock, Star, Upload } from "lucide-react";
import { parseImportReviewDateToIso } from "@/lib/review-date";
import { ensureCoreReviewsWidget } from "@/lib/reviews-core-widgets";
import { useClient } from "urql";

type ReviewNode = NonNullable<NonNullable<GetWidgetsQuery["pages"]>["edges"][number]>["node"];
type ReviewStatus = "pending" | "approved" | "rejected";
type ImportStep = 1 | 2 | 3 | 4;
type ProductIdentifier = "product_id" | "product_handle";

type ImportColumnKey =
  | "title"
  | "body"
  | "rating"
  | "review_date"
  | "reviewer_name"
  | "reviewer_email"
  | "product_id"
  | "product_handle"
  | "product_url"
  | "reply"
  | "picture_urls"
  | "status"
  | "published";

type ImportColumnMap = Partial<Record<ImportColumnKey, string>>;

type ImportPreparedRow = {
  rowNumber: number;
  title: string;
  body: string;
  rating: number;
  reviewDate: string;
  reviewerName: string;
  reviewerEmail: string;
  productId: string;
  productHandle: string;
  productUrl: string;
  reply: string;
  pictureUrls: string[];
  status: ReviewStatus;
  published: boolean;
};

type ReviewExportRow = {
  review_id: string;
  slug: string;
  title: string;
  rating: number;
  status: ReviewStatus;
  product_id: string;
  published: "true" | "false";
};

type ReviewListItem = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  rating: number;
  status: ReviewStatus;
  productId: string;
};

type ReviewListResponse = {
  items: ReviewListItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
};

const STEP_ITEMS: Array<{ id: ImportStep; label: string }> = [
  { id: 1, label: "Upload file" },
  { id: 2, label: "Map file columns" },
  { id: 3, label: "Select product identifier" },
  { id: 4, label: "Map products & import" },
];

const IMPORT_FIELD_CONFIG: Array<{ key: ImportColumnKey; label: string; required: boolean }> = [
  { key: "title", label: "Title", required: true },
  { key: "body", label: "Body", required: true },
  { key: "rating", label: "Rating", required: true },
  { key: "review_date", label: "Review date", required: false },
  { key: "reviewer_name", label: "Reviewer name", required: false },
  { key: "reviewer_email", label: "Reviewer email", required: false },
  { key: "product_id", label: "Product ID", required: false },
  { key: "product_handle", label: "Product handle", required: false },
  { key: "product_url", label: "Product URL", required: false },
  { key: "reply", label: "Reply", required: false },
  { key: "picture_urls", label: "Picture URLs", required: false },
  { key: "published", label: "Published", required: false },
];

const FIELD_ALIASES: Record<ImportColumnKey, string[]> = {
  title: ["title", "review title", "review_title", "subject"],
  body: ["body", "review", "content", "message"],
  rating: ["rating", "stars", "star"],
  review_date: ["review_date", "review date", "date"],
  reviewer_name: ["reviewer_name", "reviewer name", "name"],
  reviewer_email: ["reviewer_email", "reviewer email", "email"],
  product_id: ["product_id", "product id"],
  product_handle: ["product_handle", "product handle", "handle"],
  product_url: ["product_url", "product url", "url"],
  reply: ["reply", "admin reply"],
  picture_urls: ["picture_urls", "picture urls", "images", "image_urls", "photos"],
  status: ["status", "review status"],
  published: ["published", "is_published", "publish"],
};

const EXPORT_COLUMNS: ReadonlyArray<keyof ReviewExportRow> = [
  "review_id",
  "slug",
  "title",
  "rating",
  "status",
  "product_id",
  "published",
];

const SAMPLE_TEMPLATE_CSV =
  'title,body,rating,review_date,reviewer_name,reviewer_email,product_id,product_handle,reply,picture_urls\nGreat Product!,"This review body has a comma in it, so it is wrapped in quotes to avoid messing up the CSV.",5,2026-02-10 15:30:40 UTC,John Smith,john@example.com,,not-a-real-product-handle-so-this-review-wont-import,This is a reply by the admin,';

const normalizeHeader = (value: string) => value.trim().toLowerCase();

const textFromCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
};

const toReviewStatus = (value: string): ReviewStatus => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "approved" || normalized === "rejected" || normalized === "pending") {
    return normalized;
  }
  return "pending";
};

const parsePublished = (value: string) => !["false", "0", "no", "n"].includes(value.trim().toLowerCase());

const toCsvCell = (value: string | number) => {
  const normalized = String(value ?? "");
  const sanitizedForFormula = /^[=\-+@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${sanitizedForFormula.replace(/"/g, '""')}"`;
};

const downloadTextFile = (fileName: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
};

const sanitizeUniqueToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^magic_/, "")
    .replace(/^magic-rw-/, "")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);

const generateUniqueToken = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const buildReviewExternalId = (token: string) => `magic_${token}`;
const buildReviewSlug = (token: string) => `magic-rw-${token}`;

const parseTokenFromExistingReview = (review: ReviewNode) => {
  if (review.slug?.startsWith("magic-rw-")) {
    const fromSlug = sanitizeUniqueToken(review.slug.replace(/^magic-rw-/, ""));
    if (fromSlug) return fromSlug;
  }
  const fallback = sanitizeUniqueToken(review.id.split("/").pop() || review.id);
  return fallback || generateUniqueToken();
};

const PRODUCT_PATH_SEGMENTS = new Set(["product", "products"]);

const extractProductHandleFromUrl = (urlOrPath: string) => {
  const raw = urlOrPath.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const productIndex = segments.findIndex((segment) => PRODUCT_PATH_SEGMENTS.has(segment.toLowerCase()));
    const candidate = productIndex >= 0 ? segments[productIndex + 1] : segments[segments.length - 1];
    return candidate ? decodeURIComponent(candidate) : "";
  } catch {
    const noQuery = raw.split("?")[0].split("#")[0];
    const segments = noQuery.split("/").filter(Boolean);
    if (segments.length === 0) return "";
    const productIndex = segments.findIndex((segment) => PRODUCT_PATH_SEGMENTS.has(segment.toLowerCase()));
    const candidate = productIndex >= 0 ? segments[productIndex + 1] : segments[segments.length - 1];
    return candidate || "";
  }
};

const normalizeProductHandle = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9-_]/g, "");

const coerceProductHandle = (handleRaw: string, urlRaw = "") => {
  const handle = handleRaw.trim();
  const url = urlRaw.trim();
  if (handle) {
    if (/^https?:\/\//i.test(handle) || handle.includes("/")) {
      return normalizeProductHandle(extractProductHandleFromUrl(handle));
    }
    return normalizeProductHandle(handle);
  }
  if (url) {
    return normalizeProductHandle(extractProductHandleFromUrl(url));
  }
  return "";
};

const parsePictureUrls = (value: string) =>
  value
    .split(/[,\n|]/)
    .map((url) => url.trim())
    .filter(Boolean);

const getReviewAttribute = (review: ReviewNode, slug: string) =>
  review.attributes.find((attribute) => attribute.attribute.slug === slug);

const getReviewAttributeValue = (review: ReviewNode, slug: string) => {
  const value = getReviewAttribute(review, slug)?.values[0];
  if (!value) return "";
  return value.name || value.value || "";
};

const getReviewRating = (review: ReviewNode) => {
  const parsed = Number.parseInt(getReviewAttributeValue(review, "magic-rating"), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
};

const getReviewStatus = (review: ReviewNode): ReviewStatus =>
  toReviewStatus(getReviewAttributeValue(review, "magic-status"));

const getReviewLinkedProduct = (review: ReviewNode) =>
  getReviewAttribute(review, "magic-linked-products")?.values[0]?.reference || "";

const toExportRows = (reviews: ReviewNode[]): ReviewExportRow[] =>
  reviews.map((review) => {
    const token = parseTokenFromExistingReview(review);
    return {
      review_id: buildReviewExternalId(token),
      slug: buildReviewSlug(token),
      title: review.title || "",
      rating: getReviewRating(review),
      status: getReviewStatus(review),
      product_id: getReviewLinkedProduct(review),
      published: review.isPublished ? "true" : "false",
    };
  });

const toExportRowsFromList = (reviews: ReviewListItem[]): ReviewExportRow[] =>
  reviews.map((review) => {
    const token = sanitizeUniqueToken(review.slug.replace(/^magic-rw-/, "")) || sanitizeUniqueToken(review.id);
    return {
      review_id: buildReviewExternalId(token || generateUniqueToken()),
      slug: review.slug,
      title: review.title,
      rating: review.rating,
      status: review.status,
      product_id: review.productId,
      published: review.isPublished ? "true" : "false",
    };
  });

const findHeaderByAliases = (headers: string[], aliases: string[]) => {
  const normalizedHeaderMap = new Map(headers.map((header) => [normalizeHeader(header), header]));
  for (const alias of aliases) {
    const matched = normalizedHeaderMap.get(normalizeHeader(alias));
    if (matched) return matched;
  }
  return "";
};

const createDefaultColumnMap = (headers: string[]): ImportColumnMap => {
  const mapping: ImportColumnMap = {};
  (Object.keys(FIELD_ALIASES) as ImportColumnKey[]).forEach((field) => {
    const header = findHeaderByAliases(headers, FIELD_ALIASES[field]);
    if (header) {
      mapping[field] = header;
    }
  });
  return mapping;
};

const readSpreadsheetRows = async (file: File) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [] as string[], rows: [] as Record<string, unknown>[] };
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
    defval: "",
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
};

const getMappedValue = (
  row: Record<string, unknown>,
  columnMap: ImportColumnMap,
  field: ImportColumnKey
) => {
  const header = columnMap[field];
  if (!header) return "";
  return textFromCell(row[header]);
};

const toPreparedRows = (rows: Record<string, unknown>[], columnMap: ImportColumnMap): ImportPreparedRow[] =>
  rows
    .map((row, index) => {
      const title = getMappedValue(row, columnMap, "title");
      const body = getMappedValue(row, columnMap, "body");
      const ratingRaw = getMappedValue(row, columnMap, "rating");
      const reviewDateRaw = getMappedValue(row, columnMap, "review_date");
      const reviewerName = getMappedValue(row, columnMap, "reviewer_name");
      const reviewerEmail = getMappedValue(row, columnMap, "reviewer_email");
      const productId = getMappedValue(row, columnMap, "product_id");
      const productHandleRaw = getMappedValue(row, columnMap, "product_handle");
      const productUrl = getMappedValue(row, columnMap, "product_url");
      const reply = getMappedValue(row, columnMap, "reply");
      const pictureUrls = parsePictureUrls(getMappedValue(row, columnMap, "picture_urls"));
      const published = parsePublished(getMappedValue(row, columnMap, "published"));

      const ratingParsed = Number.parseInt(ratingRaw || "5", 10);
      const productHandle = coerceProductHandle(productHandleRaw, productUrl);
      const reviewDate = parseImportReviewDateToIso(reviewDateRaw) || reviewDateRaw;

      const hasAnyData = Boolean(
        title ||
          body ||
          ratingRaw ||
          reviewDate ||
          reviewerName ||
          reviewerEmail ||
          productId ||
          productHandle ||
          productUrl ||
          reply ||
          pictureUrls.length
      );

      if (!hasAnyData) {
        return null;
      }

      return {
        rowNumber: index + 2,
        title,
        body,
        rating: Number.isFinite(ratingParsed) ? ratingParsed : Number.NaN,
        reviewDate,
        reviewerName,
        reviewerEmail,
        productId,
        productHandle,
        productUrl,
        reply,
        pictureUrls,
        status: "approved" as ReviewStatus,
        published,
      } satisfies ImportPreparedRow;
    })
    .filter((row): row is ImportPreparedRow => Boolean(row));

type ReviewImportJobStatus = "queued" | "running" | "completed" | "partial" | "failed";

type ReviewImportJobSummary = {
  id: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  source: "wizard";
  fileName: string;
  totalRows: number;
  processedRows: number;
  successCount: number;
  failedCount: number;
  status: ReviewImportJobStatus;
  lastError?: string;
  failures: Array<{ rowNumber: number; title: string; reason: string }>;
};

type ReviewImportJobListResponse = {
  items: ReviewImportJobSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ReviewTab = ReviewStatus | "settings" | "metafields";

const IMPORT_LOGS_PAGE_SIZE = 10;
const REVIEW_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatDuration = (totalSeconds: number) => {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0s";
  }
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
};

const truncateWithEllipsis = (value: string, maxLength: number) => {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
};

const STOREFRONT_QUERY_HINT = `query StorefrontReviews($pageTypeIds: [ID!], $first: Int!, $after: String) {
  pages(
    filter: { pageTypes: $pageTypeIds }
    first: $first
    after: $after
    sortBy: { field: CREATED_AT, direction: DESC }
  ) {
    totalCount
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        title
        slug
        content
        isPublished
        publishedAt
        created
        attributes {
          attribute {
            slug
          }
          values {
            name
            value
            reference
            file {
              url
              contentType
            }
          }
        }
      }
    }
  }
}

# storefront filtering guide:
# 1) Keep only pages where attribute "magic-status" == "approved"
# 2) For product page, keep rows where "magic-linked-products" reference == productId
# 3) Use "magic-rating" for stars and "magic-review-images" / "magic-media" for photos
# 4) Show "magic-admin-reply" (or content line "Admin reply:") under the customer comment`;

export default function ReviewsPage() {
  const router = useRouter();
  const { appBridge, appBridgeState } = useAppBridge();
  const gqlClient = useClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [coreSectionNotice, setCoreSectionNotice] = useState("");
  const [coreSectionError, setCoreSectionError] = useState("");
  const [isEnsuringCoreSection, setIsEnsuringCoreSection] = useState(false);

  const [activeStatus, setActiveStatus] = useState<ReviewTab>("pending");
  const [importStep, setImportStep] = useState<ImportStep>(1);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadHeaders, setUploadHeaders] = useState<string[]>([]);
  const [uploadRows, setUploadRows] = useState<Record<string, unknown>[]>([]);
  const [columnMap, setColumnMap] = useState<ImportColumnMap>({});
  const [productIdentifier, setProductIdentifier] = useState<ProductIdentifier>("product_handle");
  const [isStartingImport, setIsStartingImport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");

  const [activeImportJobId, setActiveImportJobId] = useState<string | null>(null);
  const [activeImportJob, setActiveImportJob] = useState<ReviewImportJobSummary | null>(null);
  const [importLogsPage, setImportLogsPage] = useState(1);
  const [isImportLogsLoading, setIsImportLogsLoading] = useState(false);
  const [importLogs, setImportLogs] = useState<ReviewImportJobListResponse>({
    items: [],
    page: 1,
    pageSize: IMPORT_LOGS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const [reviewSearchInput, setReviewSearchInput] = useState("");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewPageSize, setReviewPageSize] = useState<number>(20);
  const [reviewItems, setReviewItems] = useState<ReviewListItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewReloadTick, setReviewReloadTick] = useState(0);
  const [reviewCursorHistory, setReviewCursorHistory] = useState<Array<string | null>>([null]);
  const [reviewCursorIndex, setReviewCursorIndex] = useState(0);
  const [reviewNextCursor, setReviewNextCursor] = useState<string | null>(null);
  const [reviewHasNextPage, setReviewHasNextPage] = useState(false);
  const [reviewTotalCount, setReviewTotalCount] = useState(0);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [isBulkMutating, setIsBulkMutating] = useState(false);
  const [isBulkDeleteConfirming, setIsBulkDeleteConfirming] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  const [queryCopied, setQueryCopied] = useState(false);
  const [importPerfTick, setImportPerfTick] = useState(0);
  const reviewRouteRefreshToken = Array.isArray(router.query.refresh)
    ? router.query.refresh[0] || ""
    : router.query.refresh || "";

  const normalizedUploadHeaders = useMemo(
    () => new Set(uploadHeaders.map((header) => normalizeHeader(header))),
    [uploadHeaders]
  );

  const visibleImportFields = useMemo(() => {
    if (uploadHeaders.length === 0) {
      return IMPORT_FIELD_CONFIG;
    }

    return IMPORT_FIELD_CONFIG.filter((field) => {
      if (field.required) {
        return true;
      }

      if (columnMap[field.key]) {
        return true;
      }

      return FIELD_ALIASES[field.key].some((alias) => normalizedUploadHeaders.has(normalizeHeader(alias)));
    });
  }, [uploadHeaders, columnMap, normalizedUploadHeaders]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setReviewSearch(reviewSearchInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [reviewSearchInput]);

  const [{ data: typeData, fetching: fetchingType }] = useGetReviewPageTypeQuery({
    requestPolicy: "network-only",
  });
  const pageTypeNode = typeData?.pageTypes?.edges[0]?.node;
  const pageTypeId = pageTypeNode?.id;
  const [, updateWidget] = useUpdateWidgetMutation();
  const [, deleteWidget] = useDeleteWidgetMutation();
  const reviewRequestIdRef = useRef(0);

  const refetchReviews = useCallback(() => {
    if (activeStatus === "settings" || activeStatus === "metafields") {
      return;
    }
    const resetHistory: Array<string | null> = [null];
    setReviewCursorHistory(resetHistory);
    setReviewCursorIndex(0);
    setReviewReloadTick((prev) => prev + 1);
  }, [activeStatus]);

  const loadReviewPage = useCallback(
    async (afterCursor: string | null) => {
      if (!pageTypeId) return;
      if (activeStatus === "settings" || activeStatus === "metafields") return;

      const token = appBridge?.getState().token ?? appBridgeState?.token ?? "";
      const saleorApiUrl = appBridgeState?.saleorApiUrl ?? "";
      if (!token || !saleorApiUrl) {
        setReviewError("Missing Saleor authentication context. Refresh app and try again.");
        return;
      }

      const statusParam =
        activeStatus === "pending" || activeStatus === "approved" || activeStatus === "rejected"
          ? activeStatus
          : "all";

      setReviewLoading(true);
      setReviewError("");
      const requestId = reviewRequestIdRef.current + 1;
      reviewRequestIdRef.current = requestId;
      try {
        const params = new URLSearchParams();
        params.set("saleorApiUrl", saleorApiUrl);
        params.set("pageTypeId", pageTypeId);
        params.set("status", statusParam);
        params.set("search", reviewSearch);
        params.set("limit", String(reviewPageSize));
        params.set(
          "cacheBust",
          `${reviewReloadTick}-${reviewRouteRefreshToken}-${activeStatus}`
        );
        if (afterCursor) {
          params.set("after", afterCursor);
        }

        const response = await fetch(`/api/reviews/list?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as ReviewListResponse | { message?: string };
        if (!response.ok || !("items" in payload)) {
          throw new Error(("message" in payload ? payload.message : "") || "Unable to load reviews.");
        }
        if (reviewRequestIdRef.current !== requestId) {
          return;
        }

        setReviewItems(payload.items);
        setReviewNextCursor(payload.nextCursor);
        setReviewHasNextPage(payload.hasNextPage);
        setReviewTotalCount(payload.totalCount);
        setSelectedReviewIds(new Set());
      } catch (error) {
        if (reviewRequestIdRef.current !== requestId) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to load reviews.";
        setReviewError(message);
      } finally {
        if (reviewRequestIdRef.current === requestId) {
          setReviewLoading(false);
        }
      }
    },
    [
      activeStatus,
      appBridge,
      appBridgeState?.saleorApiUrl,
      appBridgeState?.token,
      pageTypeId,
      reviewPageSize,
      reviewReloadTick,
      reviewRouteRefreshToken,
      reviewSearch,
    ]
  );

  useEffect(() => {
    if (!pageTypeId || activeStatus === "settings" || activeStatus === "metafields") {
      return;
    }
    const resetHistory: Array<string | null> = [null];
    setReviewCursorHistory(resetHistory);
    setReviewCursorIndex(0);
    void loadReviewPage(null);
  }, [pageTypeId, activeStatus, reviewSearch, reviewPageSize, reviewReloadTick, reviewRouteRefreshToken, loadReviewPage]);

  const visibleReviewIds = useMemo(() => reviewItems.map((review) => review.id), [reviewItems]);
  const selectedCount = selectedReviewIds.size;
  const isAllVisibleSelected =
    visibleReviewIds.length > 0 && visibleReviewIds.every((reviewId) => selectedReviewIds.has(reviewId));
  const reviewVisibleStart = reviewItems.length === 0 ? 0 : reviewCursorIndex * reviewPageSize + 1;
  const reviewVisibleEnd = reviewCursorIndex * reviewPageSize + reviewItems.length;

  const toggleReviewSelection = (reviewId: string) => {
    setSelectedReviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(reviewId)) {
        next.delete(reviewId);
      } else {
        next.add(reviewId);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedReviewIds((prev) => {
      const next = new Set(prev);
      if (isAllVisibleSelected) {
        visibleReviewIds.forEach((reviewId) => next.delete(reviewId));
      } else {
        visibleReviewIds.forEach((reviewId) => next.add(reviewId));
      }
      return next;
    });
  };

  useEffect(() => {
    setIsBulkDeleteConfirming(false);
  }, [selectedReviewIds, activeStatus, reviewCursorIndex]);

  const goToNextReviewPage = async () => {
    if (!reviewHasNextPage || !reviewNextCursor) {
      return;
    }
    const nextHistory = [...reviewCursorHistory.slice(0, reviewCursorIndex + 1), reviewNextCursor];
    setReviewCursorHistory(nextHistory);
    const nextIndex = reviewCursorIndex + 1;
    setReviewCursorIndex(nextIndex);
    await loadReviewPage(reviewNextCursor);
  };

  const goToPreviousReviewPage = async () => {
    if (reviewCursorIndex <= 0) {
      return;
    }
    const previousIndex = reviewCursorIndex - 1;
    const previousAfter = reviewCursorHistory[previousIndex] ?? null;
    setReviewCursorIndex(previousIndex);
    await loadReviewPage(previousAfter);
  };

  const reviewAttrIds = useMemo(() => {
    const attrs = pageTypeNode?.attributes || [];
    return {
      ratingAttrId: attrs.find((attribute) => attribute.slug === "magic-rating")?.id,
      statusAttrId: attrs.find((attribute) => attribute.slug === "magic-status")?.id,
      adminReplyAttrId: attrs.find((attribute) => attribute.slug === "magic-admin-reply")?.id,
      linkedProductsAttrId: attrs.find((attribute) => attribute.slug === "magic-linked-products")?.id,
      mediaAttrId: attrs.find((attribute) => attribute.slug === "magic-media")?.id,
      imagesAttrId: attrs.find((attribute) => attribute.slug === "magic-review-images")?.id,
    };
  }, [pageTypeNode]);

  const exportRows = useMemo(() => toExportRowsFromList(reviewItems), [reviewItems]);
  const preparedRowsPreview = useMemo(() => toPreparedRows(uploadRows, columnMap), [uploadRows, columnMap]);
  const isImportProcessing =
    isStartingImport || activeImportJob?.status === "queued" || activeImportJob?.status === "running";
  const importProgressPercent = activeImportJob
    ? Math.min(100, Math.round((activeImportJob.processedRows / Math.max(1, activeImportJob.totalRows)) * 100))
    : 0;
  const importProgressColor = activeImportJob
    ? activeImportJob.status === "failed"
      ? "#B42318"
      : activeImportJob.status === "partial"
        ? "#B54708"
        : activeImportJob.status === "completed"
          ? "#067647"
          : "#155EEF"
    : "#155EEF";
  const importPerformance = useMemo(() => {
    if (!activeImportJob) {
      return null;
    }

    const startedAtMs = Date.parse(activeImportJob.startedAt || activeImportJob.createdAt);
    const endedAtMs = Date.parse(activeImportJob.finishedAt || "");
    const nowMs = Date.now();
    const effectiveEndMs = Number.isFinite(endedAtMs) ? endedAtMs : nowMs;

    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      return null;
    }

    const elapsedSeconds = Math.max(0, (effectiveEndMs - startedAtMs) / 1000);
    const speedRowsPerSecond =
      elapsedSeconds > 0 ? activeImportJob.processedRows / elapsedSeconds : 0;
    const remainingRows = Math.max(0, activeImportJob.totalRows - activeImportJob.processedRows);
    const etaSeconds = speedRowsPerSecond > 0 ? remainingRows / speedRowsPerSecond : null;

    return {
      elapsedSeconds,
      speedRowsPerSecond,
      etaSeconds,
    };
  }, [activeImportJob, importPerfTick]);

  useEffect(() => {
    if (!activeImportJob || activeImportJob.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      setImportPerfTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeImportJob]);

  const exportCsv = (rows: ReviewExportRow[], fileName: string) => {
    const csvHeader = EXPORT_COLUMNS.map((column) => toCsvCell(column)).join(",");
    const csvRows = rows.map((row) =>
      EXPORT_COLUMNS.map((column) => toCsvCell(row[column] ?? "")).join(",")
    );
    downloadTextFile(fileName, [csvHeader, ...csvRows].join("\n"), "text/csv;charset=utf-8");
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const stamp = new Date().toISOString().slice(0, 10);
      exportCsv(exportRows, `reviews-export-${stamp}.csv`);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadSampleTemplate = () => {
    downloadTextFile("reviews-import-sample.csv", SAMPLE_TEMPLATE_CSV, "text/csv;charset=utf-8");
  };

  const handleUploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError("");
    setImportNotice("");
    try {
      const { headers, rows } = await readSpreadsheetRows(file);
      if (rows.length === 0) {
        setImportError("Uploaded file has no data rows.");
        return;
      }

      const defaultMap = createDefaultColumnMap(headers);
      setUploadedFileName(file.name);
      setUploadHeaders(headers);
      setUploadRows(rows);
      setColumnMap(defaultMap);
      if (!defaultMap.product_handle && !defaultMap.product_id && defaultMap.product_url) {
        setProductIdentifier("product_handle");
      }
      setImportStep(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to parse file.";
      setImportError(message);
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const validateStep2 = () => {
    const requiredFields: ImportColumnKey[] = ["title", "body", "rating"];
    const missing = requiredFields.filter((field) => !columnMap[field]);
    if (missing.length > 0) {
      setImportError(`Map required fields first: ${missing.join(", ")}`);
      return false;
    }
    setImportError("");
    return true;
  };

  const fetchImportLogs = useCallback(
    async (page: number, silent = false) => {
      if (!silent) {
        setIsImportLogsLoading(true);
      }

      try {
        const response = await fetch(`/api/reviews/import-jobs?page=${page}&pageSize=${IMPORT_LOGS_PAGE_SIZE}`);
        const payload = (await response.json()) as ReviewImportJobListResponse | { message?: string };
        if (!response.ok || !("items" in payload)) {
          throw new Error(("message" in payload ? payload.message : "") || "Unable to fetch import logs.");
        }

        setImportLogs(payload);
        if (!activeImportJobId) {
          const latestActive = payload.items.find((job) => job.status === "queued" || job.status === "running");
          if (latestActive) {
            setActiveImportJobId(latestActive.id);
            setActiveImportJob(latestActive);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to fetch import logs.";
        setImportError(message);
      } finally {
        if (!silent) {
          setIsImportLogsLoading(false);
        }
      }
    },
    [activeImportJobId]
  );

  const fetchImportJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/reviews/import-jobs/${jobId}`);
    const payload = (await response.json()) as { job?: ReviewImportJobSummary; message?: string };
    if (!response.ok || !payload.job) {
      throw new Error(payload.message || "Unable to fetch import job status.");
    }
    return payload.job;
  }, []);

  useEffect(() => {
    if (activeStatus !== "settings") {
      return;
    }
    void fetchImportLogs(importLogsPage);
  }, [activeStatus, importLogsPage, fetchImportLogs]);

  useEffect(() => {
    if (activeStatus !== "settings" || !activeImportJobId) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const job = await fetchImportJob(activeImportJobId);
        if (cancelled) return;
        setActiveImportJob(job);

        if (job.status === "completed" || job.status === "partial" || job.status === "failed") {
          setActiveImportJobId(null);
          setImportNotice(`Import ${job.status}: ${job.successCount} imported, ${job.failedCount} failed.`);
          await fetchImportLogs(1, true);
          setImportLogsPage(1);
          refetchReviews();
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to poll import job.";
          setImportError(message);
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeStatus, activeImportJobId, fetchImportJob, fetchImportLogs, refetchReviews]);

  const startImport = async () => {
    if (isImportProcessing) {
      return;
    }
    if (!pageTypeId) return;

    const parsedRows = toPreparedRows(uploadRows, columnMap);
    if (parsedRows.length === 0) {
      setImportError("No valid rows after column mapping.");
      return;
    }

    const token = appBridge?.getState().token ?? appBridgeState?.token ?? "";
    const saleorApiUrl = appBridgeState?.saleorApiUrl ?? "";
    if (!token || !saleorApiUrl) {
      setImportError("Missing Saleor authentication context. Refresh app and try again.");
      return;
    }

    setImportError("");
    setImportNotice("");
    setIsStartingImport(true);

    try {
      const response = await fetch("/api/reviews/import-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          saleorApiUrl,
          fileName: uploadedFileName || "reviews-upload",
          pageTypeId,
          reviewAttrIds,
          productIdentifier,
          rows: parsedRows,
        }),
      });

      const payload = (await response.json()) as { job?: ReviewImportJobSummary; message?: string };
      if (!response.ok || !payload.job) {
        throw new Error(payload.message || "Unable to start import job.");
      }

      setActiveImportJob(payload.job);
      setActiveImportJobId(payload.job.id);
      setImportNotice(
        `Import job queued for ${payload.job.totalRows} rows. You can continue using the app while it runs.`
      );
      setImportStep(1);
      setUploadedFileName("");
      setUploadHeaders([]);
      setUploadRows([]);
      setColumnMap({});
      setProductIdentifier("product_handle");
      setImportLogsPage(1);
      void fetchImportLogs(1, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start import job.";
      setImportError(message);
    } finally {
      setIsStartingImport(false);
    }
  };

  const handleBulkStatusUpdate = async (nextStatus: ReviewStatus) => {
    if (selectedReviewIds.size === 0) {
      return;
    }
    if (!reviewAttrIds.statusAttrId) {
      setImportError("Review status attribute not found. Run setup again.");
      return;
    }

    setIsBulkMutating(true);
    setBulkNotice("");
    setImportError("");

    let successCount = 0;
    let failedCount = 0;
    for (const reviewId of selectedReviewIds) {
      const result = await updateWidget({
        id: reviewId,
        input: {
          attributes: [
            {
              id: reviewAttrIds.statusAttrId,
              dropdown: { value: nextStatus },
            },
          ],
        },
      });

      const mutationErrors = result.data?.pageUpdate?.errors || [];
      if (result.error || mutationErrors.length > 0) {
        failedCount += 1;
      } else {
        successCount += 1;
      }
    }

    setBulkNotice(`Bulk status update complete. Updated: ${successCount}, failed: ${failedCount}.`);
    setSelectedReviewIds(new Set());
    refetchReviews();
    setIsBulkMutating(false);
  };

  const handleBulkDelete = async () => {
    if (selectedReviewIds.size === 0) {
      return;
    }

    if (!isBulkDeleteConfirming) {
      setBulkNotice(`Press "Delete selected" again to confirm removing ${selectedReviewIds.size} review(s).`);
      setImportError("");
      setIsBulkDeleteConfirming(true);
      return;
    }

    setIsBulkMutating(true);
    setIsBulkDeleteConfirming(false);
    setBulkNotice("");
    setImportError("");

    let successCount = 0;
    let failedCount = 0;
    const failedMessages: string[] = [];
    for (const reviewId of selectedReviewIds) {
      const result = await deleteWidget({ id: reviewId });
      const mutationErrors = result.data?.pageDelete?.errors || [];
      if (result.error || mutationErrors.length > 0) {
        failedCount += 1;
        const reason =
          result.error?.message ||
          mutationErrors.map((error) => error.message || error.field).filter(Boolean).join(", ") ||
          "Unknown delete error";
        failedMessages.push(`${reviewId}: ${reason}`);
      } else {
        successCount += 1;
      }
    }

    setBulkNotice(`Bulk delete complete. Deleted: ${successCount}, failed: ${failedCount}.`);
    if (failedMessages.length > 0) {
      setImportError(`Delete failed for ${failedMessages.length} review(s): ${failedMessages.slice(0, 3).join(" | ")}`);
    }
    setSelectedReviewIds(new Set());
    refetchReviews();
    setIsBulkMutating(false);
  };

  const handleCopyStorefrontQuery = async () => {
    try {
      await navigator.clipboard.writeText(STOREFRONT_QUERY_HINT);
      setQueryCopied(true);
      window.setTimeout(() => setQueryCopied(false), 1800);
    } catch {
      setImportError("Unable to copy query. Clipboard permission blocked.");
    }
  };

  if (fetchingType) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (!pageTypeId) {
    return (
      <Box padding={8}>
        <Text as="h1" size={7} fontWeight="bold">
          Review module is not initialized
        </Text>
        <Text as="p" color="default2" marginTop={2}>
          Run "One-Click Initialization" on the dashboard page to create the review page type and attributes.
        </Text>
        <Box marginTop={4}>
          <Button variant="secondary" onClick={() => router.push("/")}>
            Go to Dashboard
          </Button>
        </Box>
      </Box>
    );
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setIsEnsuringCoreSection(true);
      setCoreSectionError("");
      try {
        const result = await ensureCoreReviewsWidget(gqlClient);
        if (cancelled) return;
        if (result.errors.length > 0) {
          setCoreSectionError(result.errors[0]);
        } else if (result.created.length > 0) {
          setCoreSectionNotice(`Core section ready: ${result.created.join(", ")}`);
        }
      } catch (error) {
        if (!cancelled) {
          setCoreSectionError(
            error instanceof Error ? error.message : "Failed to ensure Homepage Reviews section.",
          );
        }
      } finally {
        if (!cancelled) setIsEnsuringCoreSection(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [gqlClient]);

  return (
    <Box padding={8} display="grid" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 12 }}>
        <Text as="h1" size={9} fontWeight="bold">
          Product Reviews
        </Text>
      </Box>

      <Box
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        padding={4}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        style={{ flexWrap: "wrap", gap: 12, background: "#f8fafc" }}
      >
        <Box>
          <Box display="flex" alignItems="center" gap={2} marginBottom={1}>
            <Lock size={16} />
            <Text size={4} fontWeight="bold">
              Homepage Reviews
            </Text>
            <Text size={2} color="default2">
              (locked · not deletable)
            </Text>
          </Box>
          <Text size={2} color="default2">
            Select approved reviews for the homepage carousel. Empty selection keeps the default marquee.
          </Text>
          {isEnsuringCoreSection ? (
            <Text size={2} color="default2" marginTop={1}>
              Ensuring core section…
            </Text>
          ) : null}
          {coreSectionNotice ? (
            <Text size={2} color="default2" marginTop={1}>
              {coreSectionNotice}
            </Text>
          ) : null}
          {coreSectionError ? (
            <Text size={2} color="critical1" marginTop={1}>
              {coreSectionError} (Run Magic CMS Update if page type is missing.)
            </Text>
          ) : null}
        </Box>
        <Button variant="primary" onClick={() => router.push("/reviews/homepage")}>
          Manage homepage reviews
        </Button>
      </Box>

      <Box display="flex" gap={4} marginBottom={2} style={{ borderBottom: "1px solid #E6E6E6", flexWrap: "wrap" }}>
        {(["pending", "approved", "rejected", "settings", "metafields"] as const).map((tab) => (
          <Button
            key={tab}
            variant="tertiary"
            onClick={() => setActiveStatus(tab)}
            style={{
              borderBottom: activeStatus === tab ? "2px solid #28234A" : "none",
              borderRadius: 0,
              paddingBottom: 12,
              textTransform: "capitalize",
            }}
          >
            {tab}
          </Button>
        ))}
      </Box>

      {activeStatus === "settings" ? (
        <Box display="grid" gap={5}>
          <Box
            display="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            {STEP_ITEMS.map((step) => {
              const isActive = importStep === step.id;
              const isDone = importStep > step.id;
              return (
                <Box
                  key={step.id}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  padding={3}
                  display="flex"
                  alignItems="center"
                  gap={2}
                  style={{ background: isActive ? "#f8fafc" : "#fff" }}
                >
                  <Box
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      border: isDone || isActive ? "1px solid #28234A" : "1px solid #c7d0dd",
                      background: isDone || isActive ? "#28234A" : "#fff",
                      color: isDone || isActive ? "#fff" : "#28234A",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {step.id}
                  </Box>
                  <Text size={3} fontWeight={isActive ? "bold" : "medium"}>
                    {step.label}
                  </Text>
                </Box>
              );
            })}
          </Box>

          <Box
            padding={5}
            borderRadius={4}
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            display="grid"
            gap={4}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 8 }}>
              <Text as="h3" size={6} fontWeight="bold">
                Import Reviews
              </Text>
              <Button variant="secondary" onClick={downloadSampleTemplate}>
                <Download size={14} /> Download CSV sample
              </Button>
            </Box>

            {importStep === 1 ? (
              <Box display="grid" gap={4}>
                <Text size={2} color="default2" style={{ lineHeight: 1.5 }}>
                  Sample headers: title, body, rating, review_date, reviewer_name, reviewer_email, product_id,
                  product_handle, reply, picture_urls.
                </Text>
                <Text size={2} color="default2" style={{ lineHeight: 1.5 }}>
                  `review_id` and `slug` are auto-generated as `magic_{"{unique_id}"}` and
                  `magic-rw-{"{unique_id}"}`.
                </Text>
                <Text size={2} color="default2" style={{ lineHeight: 1.5 }}>
                  Imported reviews are auto-set to `approved` status.
                </Text>
                <Box
                  borderRadius={4}
                  padding={8}
                  display="grid"
                  gap={3}
                  style={{ textAlign: "center", border: "1px dashed #c7d0dd" }}
                >
                  <Text size={4} fontWeight="bold">
                    Upload file
                  </Text>
                  <Text size={2} color="default2">
                    Accepts .csv, .xls, .xlsx
                  </Text>
                  <Box display="flex" justifyContent="center">
                    <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                      <Upload size={14} /> Select file
                    </Button>
                  </Box>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleUploadFile}
                    style={{ display: "none" }}
                  />
                </Box>
              </Box>
            ) : null}

            {importStep === 2 ? (
              <Box display="grid" gap={4}>
                <Text size={2} color="default2">
                  File: {uploadedFileName} | Headers: {uploadHeaders.length} | Rows: {uploadRows.length}
                </Text>
                <Box
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  style={{ overflowX: "auto" }}
                >
                  <Box style={{ minWidth: 720 }}>
                    {visibleImportFields.map((field) => (
                      <Box
                        key={field.key}
                        display="grid"
                        __gridTemplateColumns="1fr 1.2fr"
                        padding={3}
                        borderBottomStyle="solid"
                        borderBottomWidth={1}
                        borderColor="default1"
                        alignItems="center"
                        style={{ columnGap: 14 }}
                      >
                        <Text size={2} fontWeight={field.required ? "bold" : "medium"}>
                          {field.label} {field.required ? "*" : ""}
                        </Text>
                        <select
                          value={columnMap[field.key] || ""}
                          onChange={(event) =>
                            setColumnMap((prev) => ({ ...prev, [field.key]: event.target.value || undefined }))
                          }
                          style={{
                            width: "100%",
                            minHeight: 36,
                            borderRadius: 8,
                            border: "1px solid #c7d0dd",
                            padding: "6px 10px",
                          }}
                        >
                          <option value="">Not mapped</option>
                          {uploadHeaders.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box display="flex" justifyContent="space-between" gap={2}>
                  <Button variant="tertiary" onClick={() => setImportStep(1)}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (validateStep2()) {
                        setImportStep(3);
                      }
                    }}
                  >
                    Continue
                  </Button>
                </Box>
              </Box>
            ) : null}

            {importStep === 3 ? (
              <Box display="grid" gap={4}>
                <Text size={2} color="default2">
                  Select product identifier priority for mapping.
                </Text>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="radio"
                    checked={productIdentifier === "product_id"}
                    onChange={() => setProductIdentifier("product_id")}
                  />
                  <Text size={2}>Use `product_id`</Text>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="radio"
                    checked={productIdentifier === "product_handle"}
                    onChange={() => setProductIdentifier("product_handle")}
                  />
                  <Text size={2}>Use `product_handle` (or derive from `product_url`)</Text>
                </label>
                <Box display="flex" justifyContent="space-between" gap={2}>
                  <Button variant="tertiary" onClick={() => setImportStep(2)}>
                    Back
                  </Button>
                  <Button variant="primary" onClick={() => setImportStep(4)}>
                    Continue
                  </Button>
                </Box>
              </Box>
            ) : null}

            {importStep === 4 ? (
              <Box display="grid" gap={4}>
                <Text size={2} color="default2">
                  Ready to import {preparedRowsPreview.length} rows from {uploadedFileName}.
                </Text>
                <Text size={2} color="default2">
                  Product mapping mode: {productIdentifier === "product_id" ? "product_id" : "product_handle"}.
                  Status will be auto-approved.
                </Text>
                <Box
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  padding={3}
                  display="grid"
                  gap={1}
                >
                  {preparedRowsPreview.slice(0, 5).map((row) => (
                    <Text key={`${row.rowNumber}-${row.title}`} size={2} color="default2">
                      Row {row.rowNumber}: {row.title} ({row.rating} stars)
                    </Text>
                  ))}
                  {preparedRowsPreview.length > 5 ? (
                    <Text size={2} color="default2">
                      +{preparedRowsPreview.length - 5} more rows
                    </Text>
                  ) : null}
                </Box>
                <Box display="flex" justifyContent="space-between" gap={2}>
                  <Button variant="tertiary" onClick={() => setImportStep(3)}>
                    Back
                  </Button>
                  <Button variant="primary" onClick={startImport} disabled={isImportProcessing}>
                    {isImportProcessing ? "Processing..." : "Start import"}
                  </Button>
                </Box>
              </Box>
            ) : null}

            {importError ? (
              <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
                <Text color="critical1">{importError}</Text>
              </Box>
            ) : null}

            {importNotice ? (
              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                padding={3}
                backgroundColor="default1"
              >
                <Text color="default2">{importNotice}</Text>
              </Box>
            ) : null}

            {activeImportJob ? (
              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                padding={4}
                display="grid"
                gap={2}
              >
                <Text size={3} fontWeight="bold">
                  Background import job ({activeImportJob.id})
                </Text>
                <Text size={2} color="default2">
                  Status: {activeImportJob.status} | {activeImportJob.processedRows}/{activeImportJob.totalRows} rows
                </Text>
                <Text size={2} color="default2">
                  Progress: {importProgressPercent}%
                </Text>
                <Text size={2} color="default2">
                  Speed:{" "}
                  {importPerformance && importPerformance.speedRowsPerSecond > 0
                    ? `${importPerformance.speedRowsPerSecond >= 10 ? importPerformance.speedRowsPerSecond.toFixed(1) : importPerformance.speedRowsPerSecond.toFixed(2)} rows/s`
                    : "Calculating..."}
                </Text>
                <Text size={2} color="default2">
                  {activeImportJob.status === "queued"
                    ? "ETA: Waiting in queue"
                    : activeImportJob.status === "running"
                      ? `ETA: ${
                          importPerformance?.etaSeconds !== null && importPerformance?.etaSeconds !== undefined
                            ? formatDuration(importPerformance.etaSeconds)
                            : "Calculating..."
                        }`
                      : `Duration: ${formatDuration(importPerformance?.elapsedSeconds || 0)}`}
                </Text>
                <Box
                  style={{
                    height: 8,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "#E4E7EC",
                  }}
                >
                  <Box
                    style={{
                      width: `${
                        isImportProcessing && importProgressPercent === 0
                          ? 4
                          : Math.max(0, Math.min(100, importProgressPercent))
                      }%`,
                      height: "100%",
                      background: importProgressColor,
                      transition: "width 240ms ease",
                    }}
                  />
                </Box>
                <Text size={2} color="default2">
                  Imported: {activeImportJob.successCount}
                </Text>
                <Text size={2} color="default2">
                  Failed: {activeImportJob.failedCount}
                </Text>
                {activeImportJob.failures.length > 0 ? (
                  <Box marginTop={2} display="grid" gap={1}>
                    {activeImportJob.failures.slice(0, 6).map((failure) => (
                      <Text key={`${failure.rowNumber}-${failure.title}`} size={2} color="default2">
                        Row {failure.rowNumber}: {failure.title} - {failure.reason}
                      </Text>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Box>

          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={4}
            display="grid"
            gap={3}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 8 }}>
              <Text as="h3" size={5} fontWeight="bold">
                Reviews import log
              </Text>
              <Button
                variant="tertiary"
                size="small"
                onClick={() => void fetchImportLogs(importLogsPage)}
                disabled={isImportLogsLoading}
              >
                Refresh
              </Button>
            </Box>

            <Box style={{ overflowX: "auto" }}>
              <Box style={{ minWidth: 760 }}>
                <Box
                  padding={3}
                  display="grid"
                  __gridTemplateColumns="1.4fr 1fr 1fr 1fr 1fr 1fr"
                  style={{ background: "#f8fafc", gap: 10 }}
                >
                  <Text size={2} fontWeight="bold">
                    Import date
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Source
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Rows in file
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Successful
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Failed
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Status
                  </Text>
                </Box>

                {importLogs.items.length === 0 && !isImportLogsLoading ? (
                  <Box padding={4}>
                    <Text size={2} color="default2">
                      No import jobs yet.
                    </Text>
                  </Box>
                ) : null}

                {importLogs.items.map((job) => (
                  <Box
                    key={job.id}
                    padding={3}
                    display="grid"
                    __gridTemplateColumns="1.4fr 1fr 1fr 1fr 1fr 1fr"
                    borderTopStyle="solid"
                    borderTopWidth={1}
                    borderColor="default1"
                    style={{ gap: 10 }}
                  >
                    <Text size={2}>{formatDateTime(job.createdAt)}</Text>
                    <Text size={2}>{job.source}</Text>
                    <Text size={2}>{job.totalRows}</Text>
                    <Text size={2} color="default2">{job.successCount}</Text>
                    <Text size={2} color="default2">{job.failedCount}</Text>
                    <Text size={2} style={{ textTransform: "capitalize" }}>
                      {job.status}
                    </Text>
                  </Box>
                ))}
              </Box>
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 10 }}>
              <Text size={2} color="default2">
                Showing {(importLogs.page - 1) * importLogs.pageSize + (importLogs.items.length > 0 ? 1 : 0)}-
                {(importLogs.page - 1) * importLogs.pageSize + importLogs.items.length} of {importLogs.total}
              </Text>
              <Box display="flex" gap={2}>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={importLogs.page <= 1 || isImportLogsLoading}
                  onClick={() => setImportLogsPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={importLogs.page >= importLogs.totalPages || isImportLogsLoading}
                  onClick={() => setImportLogsPage((prev) => Math.min(importLogs.totalPages, prev + 1))}
                >
                  Next
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      ) : activeStatus === "metafields" ? (
        <Box
          borderStyle="solid"
          borderWidth={1}
          borderColor="default1"
          borderRadius={4}
          padding={5}
          display="grid"
          gap={4}
        >
          <Text as="h3" size={6} fontWeight="bold">
            Metafields & Storefront Integration
          </Text>
          <Text size={2} color="default2" style={{ lineHeight: 1.5 }}>
            Use these review fields in storefront. Imported reviews are auto-approved and use these attributes.
          </Text>

          <Box style={{ overflowX: "auto" }}>
            <Box style={{ minWidth: 780 }}>
              <Box
                padding={3}
                display="grid"
                __gridTemplateColumns="1.2fr 1fr 1.8fr"
                style={{ backgroundColor: "#f8fafc", gap: 10 }}
              >
                <Text size={2} fontWeight="bold">
                  Field
                </Text>
                <Text size={2} fontWeight="bold">
                  Source
                </Text>
                <Text size={2} fontWeight="bold">
                  Purpose
                </Text>
              </Box>

              {[
                ["title", "Page.title", "Review title/headline"],
                ["content", "Page.content", "Review body + reviewer/reply metadata"],
                ["magic-rating", "Attribute (numeric)", "Rating value (1-5)"],
                ["magic-status", "Attribute (dropdown)", "Moderation status (approved/rejected/pending)"],
                ["magic-admin-reply", "Attribute (plain text)", "Store/admin reply shown on storefront"],
                ["magic-linked-products", "Attribute (reference)", "Linked Saleor product ID"],
                ["magic-media", "Attribute (file)", "Primary review photo (first URL)"],
                ["magic-review-images", "Attribute (plain text JSON)", "All review photo URLs as JSON array"],
                ["slug", "Page.slug", "Auto-generated: magic-rw-{unique_id}"],
              ].map((item) => (
                <Box
                  key={item[0]}
                  padding={3}
                  display="grid"
                  __gridTemplateColumns="1.2fr 1fr 1.8fr"
                  borderTopStyle="solid"
                  borderTopWidth={1}
                  borderColor="default1"
                  style={{ gap: 10 }}
                >
                  <Text size={2} fontWeight="bold">
                    {item[0]}
                  </Text>
                  <Text size={2}>{item[1]}</Text>
                  <Text size={2} color="default2">
                    {item[2]}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ gap: 10, flexWrap: "wrap" }}>
              <Text as="h3" size={6} fontWeight="bold">
                Storefront query
              </Text>
              <Button variant="secondary" onClick={handleCopyStorefrontQuery}>
                {queryCopied ? <Check size={14} /> : <Copy size={14} />}
                {queryCopied ? "Copied" : "Copy query"}
              </Button>
            </Box>
            <Box
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={3}
              style={{ background: "#F8FAFC", overflowX: "auto" }}
            >
              <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: "pre" }}>{STOREFRONT_QUERY_HINT}</pre>
            </Box>
          </Box>
        </Box>
      ) : (
        <Box display="grid" gap={4}>
          {bulkNotice ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
              <Text size={2}>{bulkNotice}</Text>
            </Box>
          ) : null}

          <Box
            padding={4}
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            style={{ flexWrap: "wrap", gap: 10 }}
          >
            <Box display="flex" gap={2} alignItems="center" style={{ flexWrap: "wrap" }}>
              <input
                value={reviewSearchInput}
                onChange={(event) => setReviewSearchInput(event.target.value)}
                placeholder="Search review title or text"
                style={{
                  minWidth: 260,
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid #c7d0dd",
                  padding: "0 10px",
                }}
              />
              <select
                value={String(reviewPageSize)}
                onChange={(event) => setReviewPageSize(Number.parseInt(event.target.value, 10))}
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid #c7d0dd",
                  padding: "0 10px",
                }}
              >
                {REVIEW_TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} rows
                  </option>
                ))}
              </select>
            </Box>

            <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
              <Download size={14} /> {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </Box>

          <Box
            padding={3}
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            style={{ flexWrap: "wrap", gap: 10 }}
          >
      <Text size={2} color="default2">
        Selected: {selectedCount}
      </Text>
      <Box display="flex" gap={2} style={{ flexWrap: "wrap" }}>
              <Button
                size="small"
                variant="secondary"
                onClick={() => void handleBulkStatusUpdate("approved")}
                disabled={selectedCount === 0 || isBulkMutating}
              >
                Approve selected
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => void handleBulkStatusUpdate("pending")}
                disabled={selectedCount === 0 || isBulkMutating}
              >
                Move to pending
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => void handleBulkStatusUpdate("rejected")}
                disabled={selectedCount === 0 || isBulkMutating}
              >
                Reject selected
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => void handleBulkDelete()}
                disabled={selectedCount === 0 || isBulkMutating}
                style={{ color: "#b91c1c" }}
              >
                {isBulkMutating
                  ? "Deleting..."
                  : isBulkDeleteConfirming
                    ? "Confirm delete"
                    : "Delete selected"}
              </Button>
            </Box>
          </Box>

          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            style={{ overflowX: "auto" }}
          >
            <Box style={{ minWidth: 980 }}>
              <Box
                padding={3}
                display="grid"
                __gridTemplateColumns="40px 1.6fr 0.8fr 1.4fr 0.8fr 0.8fr auto"
                style={{ backgroundColor: "#f8fafc", gap: 12 }}
              >
                <Box display="flex" justifyContent="center">
                  <input
                    type="checkbox"
                    checked={isAllVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible reviews"
                  />
                </Box>
                <Text size={2} fontWeight="bold">
                  Review
                </Text>
                <Text size={2} fontWeight="bold">
                  Rating
                </Text>
                <Text size={2} fontWeight="bold">
                  Product
                </Text>
                <Text size={2} fontWeight="bold">
                  Status
                </Text>
                <Text size={2} fontWeight="bold">
                  Published
                </Text>
                <Text size={2} fontWeight="bold">
                  Actions
                </Text>
              </Box>

              {reviewLoading ? (
                <Box padding={8} display="flex" justifyContent="center">
                  <Spinner />
                </Box>
              ) : reviewItems.length === 0 ? (
                <Box padding={8} display="flex" justifyContent="center">
                  <Text size={3} color="default2">
                    No {activeStatus} reviews found.
                  </Text>
                </Box>
              ) : (
                reviewItems.map((review) => (
                  <Box
                    key={review.id}
                    padding={3}
                    display="grid"
                    __gridTemplateColumns="40px 1.6fr 0.8fr 1.4fr 0.8fr 0.8fr auto"
                    borderTopStyle="solid"
                    borderTopWidth={1}
                    borderColor="default1"
                    alignItems="center"
                    style={{ gap: 12 }}
                  >
                    <Box display="flex" justifyContent="center">
                      <input
                        type="checkbox"
                        checked={selectedReviewIds.has(review.id)}
                        onChange={() => toggleReviewSelection(review.id)}
                        aria-label={`Select review ${review.title}`}
                      />
                    </Box>
                    <Text
                      size={2}
                      fontWeight="bold"
                      style={{
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        lineHeight: 1.35,
                      }}
                      title={review.title}
                    >
                      {truncateWithEllipsis(review.title || "", 90) || "(Untitled review)"}
                    </Text>
                    <Box display="flex" gap={1}>
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star
                          key={index}
                          size={14}
                          fill={index < review.rating ? "orange" : "none"}
                          color={index < review.rating ? "orange" : "#94a3b8"}
                        />
                      ))}
                    </Box>
                    <Text
                      size={2}
                      color="default2"
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={review.productId || "General"}
                    >
                      {review.productId || "General"}
                    </Text>
                    <Text
                      size={2}
                      fontWeight="bold"
                      color={
                        review.status === "approved"
                          ? "success1"
                          : review.status === "rejected"
                            ? "critical1"
                            : "warning1"
                      }
                      style={{ textTransform: "capitalize" }}
                    >
                      {review.status}
                    </Text>
                    <Text size={2}>{review.isPublished ? "Yes" : "No"}</Text>
                    <Button variant="secondary" size="small" onClick={() => router.push(`/reviews/${review.id}`)}>
                      <Edit size={14} />
                    </Button>
                  </Box>
                ))
              )}
            </Box>
          </Box>

          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            padding={3}
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            style={{ flexWrap: "wrap", gap: 10 }}
          >
            <Box display="grid" gap={1}>
              <Text size={2} color="default2">
                Showing {reviewVisibleStart}-{reviewVisibleEnd}
              </Text>
              {reviewTotalCount > 0 ? (
                <Text size={1} color="default2">
                  Base dataset size: {reviewTotalCount} reviews. Results are fetched per request.
                </Text>
              ) : null}
              {reviewError ? (
                <Text size={1} color="critical1">
                  {reviewError}
                </Text>
              ) : null}
            </Box>

            <Box display="flex" gap={2} alignItems="center">
              <Button
                size="small"
                variant="secondary"
                disabled={reviewCursorIndex <= 0 || reviewLoading}
                onClick={() => void goToPreviousReviewPage()}
              >
                Previous
              </Button>
              <Button size="small" variant="tertiary" disabled>
                {reviewCursorIndex + 1}
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={!reviewHasNextPage || reviewLoading}
                onClick={() => void goToNextReviewPage()}
              >
                Next
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
