/**
 * Razorpay Settings Module
 *
 * Manages encrypted API keys and configuration in DynamoDB.
 * Supports test/live mode, payment action, and magic checkout settings.
 *
 * Security:
 * - API keys are encrypted at rest using AES-256-GCM
 * - Keys are never returned unmasked via the API
 * - SECRET_KEY env var is used as the encryption key
 */

import crypto from "crypto";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import Razorpay from "razorpay";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PaymentMode = "test" | "live";
export type PaymentAction = "authorize" | "authorize_capture";

export interface RazorpaySettings {
  /** Master enable/disable switch */
  enabled: boolean;

  /** Customer-facing title */
  title: string;

  /** Customer-facing description */
  description: string;

  /** Test or Live mode */
  mode: PaymentMode;

  /** Test mode credentials (encrypted at rest) */
  testKeyId: string;
  testKeySecret: string;
  testWebhookSecret: string;

  /** Live mode credentials (encrypted at rest) */
  liveKeyId: string;
  liveKeySecret: string;
  liveWebhookSecret: string;

  /** Payment action: authorize only or authorize + capture */
  paymentAction: PaymentAction;

  /** Enable Razorpay Magic Checkout */
  magicCheckout: boolean;

  /** Enable detailed debug logging */
  debugMode: boolean;

  /** Last updated timestamp */
  updatedAt: string;
}

/** Settings returned to the dashboard (keys masked) */
export interface MaskedRazorpaySettings
  extends Omit<
    RazorpaySettings,
    | "testKeyId"
    | "testKeySecret"
    | "testWebhookSecret"
    | "liveKeyId"
    | "liveKeySecret"
    | "liveWebhookSecret"
  > {
  testKeyId: string; // e.g., "rzp_test_****1234"
  testKeySecret: string; // e.g., "****"
  testWebhookSecret: string; // e.g., "****"
  liveKeyId: string;
  liveKeySecret: string;
  liveWebhookSecret: string;
  /** Whether keys are configured */
  hasTestKeys: boolean;
  hasLiveKeys: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENCRYPTION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) {
    throw new Error("SECRET_KEY environment variable is required for encryption");
  }
  // Derive a 32-byte key from the secret
  return crypto.createHash("sha256").update(secretKey).digest();
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return "";

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";

  const key = getEncryptionKey();
  const parts = ciphertext.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASKING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function maskValue(value: string, showLast = 4): string {
  if (!value) return "";
  if (value.length <= showLast) return "****";
  return "****" + value.slice(-showLast);
}

function maskKeyId(value: string): string {
  if (!value) return "";
  // Razorpay key IDs look like "rzp_test_abcd1234" — show prefix + last 4
  const parts = value.split("_");
  if (parts.length >= 3) {
    return `${parts[0]}_${parts[1]}_****${value.slice(-4)}`;
  }
  return maskValue(value);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS: RazorpaySettings = {
  enabled: false,
  title: "Credit Card / Debit Card / UPI / Net Banking",
  description: "Pay securely using Razorpay",
  mode: "test",
  testKeyId: "",
  testKeySecret: "",
  testWebhookSecret: "",
  liveKeyId: "",
  liveKeySecret: "",
  liveWebhookSecret: "",
  paymentAction: "authorize_capture",
  magicCheckout: false,
  debugMode: false,
  updatedAt: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMODB OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

const TABLE_NAME = process.env.DYNAMODB_MAIN_TABLE_NAME || "razorpay-settings";

function getPK(saleorApiUrl: string): string {
  return `RAZORPAY#${saleorApiUrl}`;
}

const SK = "SETTINGS";

/**
 * Get settings from DynamoDB
 */
export async function getSettings(
  docClient: DynamoDBDocumentClient,
  saleorApiUrl: string
): Promise<RazorpaySettings> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: getPK(saleorApiUrl), SK },
      })
    );

    if (!result.Item) {
      return { ...DEFAULT_SETTINGS };
    }

    const item = result.Item;

    // Decrypt sensitive fields
    return {
      enabled: item.enabled ?? DEFAULT_SETTINGS.enabled,
      title: item.title ?? DEFAULT_SETTINGS.title,
      description: item.description ?? DEFAULT_SETTINGS.description,
      mode: item.mode ?? DEFAULT_SETTINGS.mode,
      testKeyId: item.testKeyId ? decrypt(item.testKeyId) : "",
      testKeySecret: item.testKeySecret ? decrypt(item.testKeySecret) : "",
      testWebhookSecret: item.testWebhookSecret ? decrypt(item.testWebhookSecret) : "",
      liveKeyId: item.liveKeyId ? decrypt(item.liveKeyId) : "",
      liveKeySecret: item.liveKeySecret ? decrypt(item.liveKeySecret) : "",
      liveWebhookSecret: item.liveWebhookSecret ? decrypt(item.liveWebhookSecret) : "",
      paymentAction: item.paymentAction ?? DEFAULT_SETTINGS.paymentAction,
      magicCheckout: item.magicCheckout ?? DEFAULT_SETTINGS.magicCheckout,
      debugMode: item.debugMode ?? DEFAULT_SETTINGS.debugMode,
      updatedAt: item.updatedAt ?? DEFAULT_SETTINGS.updatedAt,
    };
  } catch (error) {
    console.error("Failed to get Razorpay settings:", error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to DynamoDB (encrypts sensitive fields)
 */
export async function saveSettings(
  docClient: DynamoDBDocumentClient,
  saleorApiUrl: string,
  settings: Partial<RazorpaySettings>
): Promise<RazorpaySettings> {
  // Get existing settings to merge
  const existing = await getSettings(docClient, saleorApiUrl);

  const merged: RazorpaySettings = {
    ...existing,
    ...settings,
    updatedAt: new Date().toISOString(),
  };

  // Encrypt sensitive fields before storing
  const itemToStore = {
    PK: getPK(saleorApiUrl),
    SK,
    enabled: merged.enabled,
    title: merged.title,
    description: merged.description,
    mode: merged.mode,
    testKeyId: merged.testKeyId ? encrypt(merged.testKeyId) : "",
    testKeySecret: merged.testKeySecret ? encrypt(merged.testKeySecret) : "",
    testWebhookSecret: merged.testWebhookSecret ? encrypt(merged.testWebhookSecret) : "",
    liveKeyId: merged.liveKeyId ? encrypt(merged.liveKeyId) : "",
    liveKeySecret: merged.liveKeySecret ? encrypt(merged.liveKeySecret) : "",
    liveWebhookSecret: merged.liveWebhookSecret ? encrypt(merged.liveWebhookSecret) : "",
    paymentAction: merged.paymentAction,
    magicCheckout: merged.magicCheckout,
    debugMode: merged.debugMode,
    updatedAt: merged.updatedAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: itemToStore,
    })
  );

  return merged;
}

/**
 * Get masked settings for dashboard display
 */
export function maskSettings(settings: RazorpaySettings): MaskedRazorpaySettings {
  return {
    enabled: settings.enabled,
    title: settings.title,
    description: settings.description,
    mode: settings.mode,
    testKeyId: maskKeyId(settings.testKeyId),
    testKeySecret: maskValue(settings.testKeySecret, 0),
    testWebhookSecret: maskValue(settings.testWebhookSecret, 0),
    liveKeyId: maskKeyId(settings.liveKeyId),
    liveKeySecret: maskValue(settings.liveKeySecret, 0),
    liveWebhookSecret: maskValue(settings.liveWebhookSecret, 0),
    paymentAction: settings.paymentAction,
    magicCheckout: settings.magicCheckout,
    debugMode: settings.debugMode,
    updatedAt: settings.updatedAt,
    hasTestKeys: !!(settings.testKeyId && settings.testKeySecret),
    hasLiveKeys: !!(settings.liveKeyId && settings.liveKeySecret),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAZORPAY CLIENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a Razorpay client instance configured with the correct keys
 * based on the current mode (test/live).
 *
 * Falls back to env vars if no settings are stored in DynamoDB.
 */
export async function getRazorpayClient(
  docClient: DynamoDBDocumentClient,
  saleorApiUrl: string
): Promise<{ client: Razorpay; settings: RazorpaySettings }> {
  const settings = await getSettings(docClient, saleorApiUrl);

  let keyId: string;
  let keySecret: string;

  if (settings.mode === "live" && settings.liveKeyId && settings.liveKeySecret) {
    keyId = settings.liveKeyId;
    keySecret = settings.liveKeySecret;
  } else if (settings.testKeyId && settings.testKeySecret) {
    keyId = settings.testKeyId;
    keySecret = settings.testKeySecret;
  } else {
    // Fallback to env vars
    keyId = process.env.RAZORPAY_KEY_ID || "";
    keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  }

  if (!keyId || !keySecret) {
    throw new Error(
      `Razorpay API keys not configured for ${settings.mode} mode. ` +
        "Please configure keys in the Razorpay app settings."
    );
  }

  const client = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  return { client, settings };
}

/**
 * Get the webhook secret for the current mode
 */
export async function getWebhookSecret(
  docClient: DynamoDBDocumentClient,
  saleorApiUrl: string
): Promise<string> {
  const settings = await getSettings(docClient, saleorApiUrl);

  if (settings.mode === "live" && settings.liveWebhookSecret) {
    return settings.liveWebhookSecret;
  }

  if (settings.testWebhookSecret) {
    return settings.testWebhookSecret;
  }

  // Fallback to env var
  return process.env.RAZORPAY_WEBHOOK_SECRET || "";
}
