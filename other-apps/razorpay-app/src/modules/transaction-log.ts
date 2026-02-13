/**
 * Transaction Log Module
 *
 * Stores and retrieves transaction logs in DynamoDB.
 * Captures all Razorpay operations: initialize, charge, refund, webhook.
 */

import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type TransactionType = "initialize" | "charge" | "refund" | "webhook";
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

  /** Saleor-side identifiers */
  saleorOrderId?: string;
  saleorTransactionId?: string;

  /** Error message if failed */
  error?: string;

  /** Raw Razorpay API response (stored only in debug mode) */
  rawResponse?: string;

  /** Payment mode at the time of transaction */
  mode: "test" | "live";
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const TABLE_NAME = process.env.DYNAMODB_MAIN_TABLE_NAME || "razorpay-settings";

function getPK(saleorApiUrl: string): string {
  return `RAZORPAY_LOG#${saleorApiUrl}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log a transaction event to DynamoDB
 */
export async function logTransaction(
  docClient: DynamoDBDocumentClient,
  saleorApiUrl: string,
  entry: TransactionLogEntry
): Promise<void> {
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
  docClient: DynamoDBDocumentClient,
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
