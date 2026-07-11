import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, fetchExchange } from "urql";
import {
  type AttributeValueInput,
  CreateWidgetDocument,
  GetProductsByHandlesDocument,
} from "../../generated/graphql";
import { normalizeSaleorApiUrl } from "./saleor-api-url";
import { parseImportReviewDateToIso } from "./review-date";

export type ReviewImportJobStatus = "queued" | "running" | "completed" | "partial" | "failed";

export type ReviewImportPreparedRow = {
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
  status: "pending" | "approved" | "rejected";
  published: boolean;
};

type ReviewImportPayload = {
  fileName: string;
  saleorApiUrl: string;
  token: string;
  pageTypeId: string;
  reviewAttrIds: {
    ratingAttrId?: string;
    statusAttrId?: string;
    linkedProductsAttrId?: string;
    mediaAttrId?: string;
    imagesAttrId?: string;
  };
  productIdentifier: "product_id" | "product_handle";
  rows: ReviewImportPreparedRow[];
};

export type ReviewImportJobSummary = {
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

type ReviewImportJobStore = {
  jobs: ReviewImportJobSummary[];
};

const DATA_ROOT = path.join(process.cwd(), ".data", "review-import-jobs");
const STORE_FILE = path.join(DATA_ROOT, "jobs.json");
const PAYLOAD_DIR = path.join(DATA_ROOT, "payloads");

const WORKER_STATE = globalThis as typeof globalThis & {
  __magicReviewImportWorkerRunning?: boolean;
};

const ensureStoreReady = async () => {
  await mkdir(DATA_ROOT, { recursive: true });
  await mkdir(PAYLOAD_DIR, { recursive: true });
  try {
    await readFile(STORE_FILE, "utf8");
  } catch {
    const initial: ReviewImportJobStore = { jobs: [] };
    await writeFile(STORE_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
};

const readStore = async (): Promise<ReviewImportJobStore> => {
  await ensureStoreReady();
  const raw = await readFile(STORE_FILE, "utf8");
  try {
    return JSON.parse(raw) as ReviewImportJobStore;
  } catch {
    return { jobs: [] };
  }
};

const writeStore = async (store: ReviewImportJobStore) => {
  await ensureStoreReady();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
};

const payloadFilePath = (jobId: string) => path.join(PAYLOAD_DIR, `${jobId}.json`);

const nowIso = () => new Date().toISOString();

const createJobId = () => `rj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

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

const buildReviewBodyContent = (row: ReviewImportPreparedRow) => {
  const parts: string[] = [];
  parts.push(row.body);

  const meta: string[] = [];
  if (row.reviewerName) meta.push(`Reviewer: ${row.reviewerName}`);
  if (row.reviewerEmail) meta.push(`Email: ${row.reviewerEmail}`);
  if (row.reviewDate) meta.push(`Review date: ${row.reviewDate}`);
  if (meta.length > 0) parts.push(meta.join(" | "));
  if (row.reply) parts.push(`Admin reply: ${row.reply}`);

  return parts.join("\n\n");
};

const toEditorJsContent = (text: string) =>
  JSON.stringify({
    time: Date.now(),
    blocks: text.split("\n\n").map((part) => ({ type: "paragraph", data: { text: part } })),
    version: "2.28.0",
  });

const extractProductHandleFromUrl = (urlOrPath: string) => {
  const raw = urlOrPath.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const productIndex = segments.findIndex((segment) => segment.toLowerCase() === "products");
    const candidate = productIndex >= 0 ? segments[productIndex + 1] : segments[segments.length - 1];
    return candidate ? decodeURIComponent(candidate) : "";
  } catch {
    const noQuery = raw.split("?")[0].split("#")[0];
    const segments = noQuery.split("/").filter(Boolean);
    const productIndex = segments.findIndex((segment) => segment.toLowerCase() === "products");
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

export const createReviewImportJob = async (payload: ReviewImportPayload) => {
  const store = await readStore();
  const id = createJobId();
  const createdAt = nowIso();
  const summary: ReviewImportJobSummary = {
    id,
    createdAt,
    updatedAt: createdAt,
    source: "wizard",
    fileName: payload.fileName,
    totalRows: payload.rows.length,
    processedRows: 0,
    successCount: 0,
    failedCount: 0,
    status: "queued",
    failures: [],
  };

  store.jobs.unshift(summary);
  await writeStore(store);
  await writeFile(payloadFilePath(id), JSON.stringify(payload), "utf8");
  return summary;
};

export const listReviewImportJobs = async (page: number, pageSize: number) => {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(50, Math.max(1, pageSize));
  const store = await readStore();
  const sorted = [...store.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = sorted.length;
  const offset = (safePage - 1) * safePageSize;
  const items = sorted.slice(offset, offset + safePageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
};

export const getReviewImportJob = async (id: string) => {
  const store = await readStore();
  return store.jobs.find((job) => job.id === id) || null;
};

const updateJob = async (
  id: string,
  updater: (current: ReviewImportJobSummary) => ReviewImportJobSummary
) => {
  const store = await readStore();
  const nextJobs = store.jobs.map((job) => {
    if (job.id !== id) {
      return job;
    }
    return updater(job);
  });
  await writeStore({ jobs: nextJobs });
};

const processReviewImportJob = async (summary: ReviewImportJobSummary) => {
  const payloadRaw = await readFile(payloadFilePath(summary.id), "utf8");
  const payload = JSON.parse(payloadRaw) as ReviewImportPayload;

  await updateJob(summary.id, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt || nowIso(),
    updatedAt: nowIso(),
  }));

  const client = createClient({
    url: normalizeSaleorApiUrl(payload.saleorApiUrl),
    fetchOptions: {
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    },
    exchanges: [fetchExchange],
  });

  const handlesToResolve = Array.from(
    new Set(
      payload.rows
        .map((row) => normalizeProductHandle(row.productHandle || extractProductHandleFromUrl(row.productUrl)))
        .filter(Boolean)
    )
  );
  const handleToProductId = new Map<string, string>();

  if (handlesToResolve.length > 0) {
    const chunkSize = 100;
    for (let offset = 0; offset < handlesToResolve.length; offset += chunkSize) {
      const chunk = handlesToResolve.slice(offset, offset + chunkSize);
      const lookup = await client
        .query(GetProductsByHandlesDocument, { slugs: chunk, first: chunk.length })
        .toPromise();
      lookup.data?.products?.edges.forEach((edge) => {
        handleToProductId.set(edge.node.slug.toLowerCase(), edge.node.id);
      });
    }
  }

  let processedRows = 0;
  let successCount = 0;
  let failedCount = 0;
  const failures: Array<{ rowNumber: number; title: string; reason: string }> = [];
  const usedTokens = new Set<string>();
  const progressUpdateInterval = Math.max(5, Math.floor(payload.rows.length / 200));

  for (const row of payload.rows) {
    processedRows += 1;
    const title = row.title || "(missing title)";

    if (!row.title) {
      failedCount += 1;
      failures.push({ rowNumber: row.rowNumber, title, reason: "Title is required." });
      continue;
    }
    if (!row.body) {
      failedCount += 1;
      failures.push({ rowNumber: row.rowNumber, title, reason: "Body is required." });
      continue;
    }
    if (!Number.isFinite(row.rating) || row.rating < 1 || row.rating > 5) {
      failedCount += 1;
      failures.push({ rowNumber: row.rowNumber, title, reason: "Rating must be between 1 and 5." });
      continue;
    }

    const normalizedHandle = normalizeProductHandle(
      row.productHandle || extractProductHandleFromUrl(row.productUrl)
    );
    let resolvedProductId = row.productId || "";
    if (!resolvedProductId && normalizedHandle) {
      resolvedProductId = handleToProductId.get(normalizedHandle) || "";
    }
    const hasProductInput = Boolean(row.productId || row.productHandle || row.productUrl);
    if (hasProductInput && !resolvedProductId) {
      failedCount += 1;
      failures.push({
        rowNumber: row.rowNumber,
        title,
        reason:
          payload.productIdentifier === "product_id"
            ? "Product ID not found/invalid."
            : `Product handle not found: ${normalizedHandle || "unknown"}`,
      });
      continue;
    }

    let token = sanitizeUniqueToken(buildReviewExternalId(generateUniqueToken()));
    while (usedTokens.has(token)) {
      token = generateUniqueToken();
    }
    usedTokens.add(token);
    const reviewExternalId = buildReviewExternalId(token);
    const reviewSlug = buildReviewSlug(token);

    const attributes: AttributeValueInput[] = [];
    if (payload.reviewAttrIds.ratingAttrId) {
      attributes.push({ id: payload.reviewAttrIds.ratingAttrId, numeric: String(Math.round(row.rating)) });
    }
    if (payload.reviewAttrIds.statusAttrId) {
      attributes.push({ id: payload.reviewAttrIds.statusAttrId, dropdown: { value: "approved" } });
    }
    if (payload.reviewAttrIds.linkedProductsAttrId && resolvedProductId) {
      attributes.push({ id: payload.reviewAttrIds.linkedProductsAttrId, references: [resolvedProductId] });
    }
    if (payload.reviewAttrIds.mediaAttrId && row.pictureUrls?.[0]) {
      attributes.push({ id: payload.reviewAttrIds.mediaAttrId, file: row.pictureUrls[0] });
    }
    if (payload.reviewAttrIds.imagesAttrId && row.pictureUrls?.length) {
      attributes.push({
        id: payload.reviewAttrIds.imagesAttrId,
        plainText: JSON.stringify(row.pictureUrls),
      });
    }

    const content = buildReviewBodyContent(row);
    const result = await client
      .mutation(CreateWidgetDocument, {
        input: {
          title: row.title,
          slug: reviewSlug,
          pageType: payload.pageTypeId,
          isPublished: row.published,
          publishedAt: parseImportReviewDateToIso(row.reviewDate),
          content: content ? toEditorJsContent(content) : undefined,
          attributes,
        },
      })
      .toPromise();

    const mutationErrors = result.data?.pageCreate?.errors || [];
    if (result.error || mutationErrors.length > 0 || !result.data?.pageCreate?.page?.id) {
      failedCount += 1;
      const reason =
        result.error?.message ||
        mutationErrors.map((error) => error.message || error.code).filter(Boolean).join(", ") ||
        `Unknown create error (${reviewExternalId})`;
      failures.push({ rowNumber: row.rowNumber, title, reason });
    } else {
      successCount += 1;
    }

    if (
      processedRows === 1 ||
      processedRows % progressUpdateInterval === 0 ||
      processedRows === payload.rows.length
    ) {
      await updateJob(summary.id, (current) => ({
        ...current,
        processedRows,
        successCount,
        failedCount,
        failures: failures.slice(0, 200),
        updatedAt: nowIso(),
      }));
    }
  }

  const finalStatus: ReviewImportJobStatus =
    failedCount === 0 ? "completed" : successCount === 0 ? "failed" : "partial";

  await updateJob(summary.id, (current) => ({
    ...current,
    status: finalStatus,
    processedRows,
    successCount,
    failedCount,
    failures: failures.slice(0, 200),
    finishedAt: nowIso(),
    updatedAt: nowIso(),
    lastError: failures[0]?.reason,
  }));
};

const processImportQueue = async () => {
  if (WORKER_STATE.__magicReviewImportWorkerRunning) {
    return;
  }
  WORKER_STATE.__magicReviewImportWorkerRunning = true;

  try {
    while (true) {
      const store = await readStore();
      const nextJob = store.jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

      if (!nextJob) {
        break;
      }

      try {
        await processReviewImportJob(nextJob);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Import crashed unexpectedly.";
        await updateJob(nextJob.id, (current) => ({
          ...current,
          status: "failed",
          updatedAt: nowIso(),
          finishedAt: nowIso(),
          lastError: message,
          failures: [
            ...current.failures,
            { rowNumber: 0, title: "System", reason: message },
          ].slice(0, 200),
        }));
      }
    }
  } finally {
    WORKER_STATE.__magicReviewImportWorkerRunning = false;
  }
};

export const startReviewImportWorker = () => {
  void processImportQueue();
};
