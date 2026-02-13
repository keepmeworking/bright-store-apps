/**
 * DynamoDB Helpers
 *
 * Creates a shared DynamoDB Document Client for use across
 * settings, logs, and other modules.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let cachedDocClient: DynamoDBDocumentClient | null = null;

/**
 * Get a DynamoDB Document Client instance.
 * Returns null if DynamoDB is not configured.
 */
export function getDocClient(): DynamoDBDocumentClient | null {
  if (cachedDocClient) return cachedDocClient;

  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    console.warn("DynamoDB not configured: Missing AWS credentials");
    return null;
  }

  const client = new DynamoDBClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  cachedDocClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return cachedDocClient;
}
