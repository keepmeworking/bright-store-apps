/**
 * Transaction Log Module
 *
 * Stores and retrieves transaction logs in DynamoDB.
 * Captures all Razorpay operations: initialize, charge, refund, webhook.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type TransactionType = "initialize" | "process" | "charge" | "refund" | "webhook";
export type TransactionStatus = "success" | "failed" | "pending";

export interface TransactionLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Type of transaction */
  type: TransactionType;

  /** Outcome status */
  status: TransactionStatus;

  /** Amount in major currency unit (e.g., 100.00) */
  amount: number;

  /** Currency code (e.g., "INR") */
  currency: string;

  /** Razorpay-side identifiers */
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  receipt?: string;

  /** Saleor-side identifiers */
  saleorOrderId?: string;
  saleorCheckoutId?: string;
  saleorTransactionId?: string;

  /** Error message if failed */
  error?: string;

  /** Raw Razorpay API response (stored only in debug mode) */
  rawResponse?: string;

  /** Customer details captured during initialize/webhook (if available) */
  customerEmail?: string;
  customerPhone?: string;

  /** Payment mode at the time of transaction */
  mode: "test" | "live";
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const TABLE_NAME = process.env.DYNAMODB_MAIN_TABLE_NAME || "razorpay-settings";
const LOGS_FILE_PATH = path.resolve(process.cwd(), ".data", "transaction-logs.json");
const PAYMENT_CAPTURE_STATE_FILE_PATH = path.resolve(process.cwd(), ".data", "payment-capture-state.json");
const PAYMENT_CAPTURE_LOCK_MS = 10 * 60 * 1000;
const PAYMENT_CAPTURE_COMPLETED_MS = 90 * 24 * 60 * 60 * 1000;

function getPK(saleorApiUrl: string): string {
  return `RAZORPAY_LOG#${saleorApiUrl}`;
}

function getPaymentCapturePK(saleorApiUrl: string): string {
  return `RAZORPAY_CAPTURE#${saleorApiUrl}`;
}

function getPaymentCaptureSK(razorpayPaymentId: string): string {
  return `PAYMENT#${razorpayPaymentId}`;
}

type PaymentCaptureState = "processing" | "completed";

type PaymentCaptureStateEntry = {
  status: PaymentCaptureState;
  expiresAt: number;
  updatedAt: string;
};

type PaymentCaptureStateStore = Record<string, Record<string, PaymentCaptureStateEntry>>;

export type PaymentCaptureGuardState = "acquired" | "in_progress" | "already_completed";

// ═══════════════════════════════════════════════════════════════════════════════
// FILE-BASED LOGGING (Local Dev Fallback)
// ═══════════════════════════════════════════════════════════════════════════════

async function logToFile(saleorApiUrl: string, entry: TransactionLogEntry): Promise<void> {
  try {
    const dir = path.dirname(LOGS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let logs: Record<string, TransactionLogEntry[]> = {};
    if (fs.existsSync(LOGS_FILE_PATH)) {
      logs = JSON.parse(fs.readFileSync(LOGS_FILE_PATH, "utf-8"));
    }

    if (!logs[saleorApiUrl]) {
      logs[saleorApiUrl] = [];
    }

    logs[saleorApiUrl].unshift(entry); // Newest first
    
    // Keep only last 100 logs per store in file
    logs[saleorApiUrl] = logs[saleorApiUrl].slice(0, 100);

    fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(logs, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to log to file:", error);
  }
}

function getLogsFromFile(saleorApiUrl: string): TransactionLogEntry[] {
  try {
    if (fs.existsSync(LOGS_FILE_PATH)) {
      const logs = JSON.parse(fs.readFileSync(LOGS_FILE_PATH, "utf-8"));
      return logs[saleorApiUrl] || [];
    }
  } catch (error) {
    console.warn("Failed to read logs from file:", error);
  }
  return [];
}

function readPaymentCaptureStateFromFile(): PaymentCaptureStateStore {
  try {
    if (!fs.existsSync(PAYMENT_CAPTURE_STATE_FILE_PATH)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(PAYMENT_CAPTURE_STATE_FILE_PATH, "utf-8"));
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed as PaymentCaptureStateStore;
  } catch (error) {
    console.warn("Failed to read payment capture state file:", error);
    return {};
  }
}

function writePaymentCaptureStateToFile(store: PaymentCaptureStateStore) {
  try {
    const dir = path.dirname(PAYMENT_CAPTURE_STATE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(PAYMENT_CAPTURE_STATE_FILE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to write payment capture state file:", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log a transaction event to DynamoDB
 */
export async function logTransaction(
  docClient: DynamoDBDocumentClient | null,
  saleorApiUrl: string,
  entry: TransactionLogEntry
): Promise<void> {
  if (!docClient) {
    console.log(`[Transaction Log] ${entry.type} | ${entry.status} | ${entry.amount} ${entry.currency}`);
    await logToFile(saleorApiUrl, entry);
    return;
  }

  try {
    // SK = timestamp for natural ordering (latest first with reverse sort)
    const sk = `${entry.timestamp}#${entry.type}#${crypto.randomUUID().slice(0, 8)}`;

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: getPK(saleorApiUrl),
          SK: sk,
          ...entry,
          // TTL: auto-delete logs after 90 days (optional)
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        },
      })
    );
  } catch (error) {
    console.error("Failed to log transaction:", error);
    // Don't throw — logging failures shouldn't break payment flow
  }
}

/**
 * Get paginated transaction logs
 */
export async function getTransactionLogs(
  docClient: DynamoDBDocumentClient | null,
  saleorApiUrl: string,
  options: {
    limit?: number;
    startKey?: Record<string, unknown>;
    type?: TransactionType;
  } = {}
): Promise<{
  logs: TransactionLogEntry[];
  nextKey?: Record<string, unknown>;
  count: number;
}> {
  const { limit = 25, startKey } = options;
  
  if (!docClient) {
    let logs = getLogsFromFile(saleorApiUrl);
    if (options.type) {
      logs = logs.filter((l) => l.type === options.type);
    }
    return { logs: logs.slice(0, limit), count: logs.length };
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": getPK(saleorApiUrl),
        },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      })
    );

    let logs = (result.Items || []) as TransactionLogEntry[];

    // Client-side filter by type (if needed)
    if (options.type) {
      logs = logs.filter((l) => l.type === options.type);
    }

    return {
      logs,
      nextKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
      count: result.Count || 0,
    };
  } catch (error) {
    console.error("Failed to fetch transaction logs:", error);
    return { logs: [], count: 0 };
  }
}

export async function findRecentInitializeLogByReference(
  docClient: DynamoDBDocumentClient | null,
  saleorApiUrl: string,
  reference: {
    razorpayOrderId?: string;
    receipt?: string;
  }
): Promise<TransactionLogEntry | null> {
  const { razorpayOrderId, receipt } = reference;

  if (!razorpayOrderId && !receipt) {
    return null;
  }

  const matchesReference = (entry: TransactionLogEntry) =>
    entry.type === "initialize" &&
    ((receipt && entry.receipt === receipt) || (razorpayOrderId && entry.razorpayOrderId === razorpayOrderId));

  if (!docClient) {
    return getLogsFromFile(saleorApiUrl).find(matchesReference) || null;
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": getPK(saleorApiUrl),
        },
        ScanIndexForward: false,
        Limit: 100,
      })
    );

    return ((result.Items || []) as TransactionLogEntry[]).find(matchesReference) || null;
  } catch (error) {
    console.error("Failed to resolve transaction log by reference:", error);
    return null;
  }
}

export async function beginPaymentCapturedProcessing(
  docClient: DynamoDBDocumentClient | null,
  saleorApiUrl: string,
  razorpayPaymentId?: string
): Promise<PaymentCaptureGuardState> {
  if (!razorpayPaymentId) {
    return "acquired";
  }

  const now = Date.now();
  const updatedAt = new Date(now).toISOString();

  if (!docClient) {
    const store = readPaymentCaptureStateFromFile();
    const byStore = store[saleorApiUrl] || {};
    const existing = byStore[razorpayPaymentId];

    if (existing?.status === "completed" && existing.expiresAt > now) {
      return "already_completed";
    }

    if (existing?.status === "processing" && existing.expiresAt > now) {
      return "in_progress";
    }

    byStore[razorpayPaymentId] = {
      status: "processing",
      expiresAt: now + PAYMENT_CAPTURE_LOCK_MS,
      updatedAt,
    };
    store[saleorApiUrl] = byStore;
    writePaymentCaptureStateToFile(store);

    return "acquired";
  }

  const key = {
    PK: getPaymentCapturePK(saleorApiUrl),
    SK: getPaymentCaptureSK(razorpayPaymentId),
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...key,
          status: "processing" as const,
          expiresAt: now + PAYMENT_CAPTURE_LOCK_MS,
          updatedAt,
          ttl: Math.floor((now + 2 * 24 * 60 * 60 * 1000) / 1000),
        },
        ConditionExpression: "attribute_not_exists(PK) OR (#status = :processing AND #expiresAt < :now)",
        ExpressionAttributeNames: {
          "#status": "status",
          "#expiresAt": "expiresAt",
        },
        ExpressionAttributeValues: {
          ":processing": "processing",
          ":now": now,
        },
      })
    );

    return "acquired";
  } catch (error) {
    const errorName = (error as { name?: string })?.name;
    if (errorName !== "ConditionalCheckFailedException") {
      console.warn("Failed to acquire payment capture processing guard:", error);
      return "acquired";
    }
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: key,
      })
    );

    const item = result.Item as PaymentCaptureStateEntry | undefined;
    if (item?.status === "completed" && item.expiresAt > now) {
      return "already_completed";
    }

    if (item?.status === "processing" && item.expiresAt > now) {
      return "in_progress";
    }
  } catch (error) {
    console.warn("Failed to inspect payment capture guard state:", error);
  }

  return "in_progress";
}

export async function markPaymentCapturedCompleted(
  docClient: DynamoDBDocumentClient | null,
  saleorApiUrl: string,
  razorpayPaymentId?: string
): Promise<void> {
  if (!razorpayPaymentId) {
    return;
  }

  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  const expiresAt = now + PAYMENT_CAPTURE_COMPLETED_MS;

  if (!docClient) {
    const store = readPaymentCaptureStateFromFile();
    const byStore = store[saleorApiUrl] || {};
    byStore[razorpayPaymentId] = {
      status: "completed",
      expiresAt,
      updatedAt,
    };
    store[saleorApiUrl] = byStore;
    writePaymentCaptureStateToFile(store);
    return;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: getPaymentCapturePK(saleorApiUrl),
          SK: getPaymentCaptureSK(razorpayPaymentId),
        },
        UpdateExpression:
          "SET #status = :completed, #updatedAt = :updatedAt, #expiresAt = :expiresAt, #ttl = :ttl",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updatedAt": "updatedAt",
          "#expiresAt": "expiresAt",
          "#ttl": "ttl",
        },
        ExpressionAttributeValues: {
          ":completed": "completed",
          ":updatedAt": updatedAt,
          ":expiresAt": expiresAt,
          ":ttl": Math.floor(expiresAt / 1000),
        },
      })
    );
  } catch (error) {
    console.warn("Failed to mark payment capture as completed:", error);
  }
}

export async function releasePaymentCapturedProcessing(
  docClient: DynamoDBDocumentClient | null,
  saleorApiUrl: string,
  razorpayPaymentId?: string
): Promise<void> {
  if (!razorpayPaymentId) {
    return;
  }

  if (!docClient) {
    const store = readPaymentCaptureStateFromFile();
    if (!store[saleorApiUrl]) {
      return;
    }

    delete store[saleorApiUrl][razorpayPaymentId];

    if (!Object.keys(store[saleorApiUrl]).length) {
      delete store[saleorApiUrl];
    }

    writePaymentCaptureStateToFile(store);
    return;
  }

  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: getPaymentCapturePK(saleorApiUrl),
          SK: getPaymentCaptureSK(razorpayPaymentId),
        },
      })
    );
  } catch (error) {
    console.warn("Failed to release payment capture processing guard:", error);
  }
}
