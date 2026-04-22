import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { saleorApp } from "@/saleor-app";
import { getWebhookSecrets, getRazorpayClient } from "@/modules/razorpay-settings";
import {
  beginPaymentCapturedProcessing,
  findRecentInitializeLogByReference,
  logTransaction,
  markPaymentCapturedCompleted,
  releasePaymentCapturedProcessing,
} from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

type SaleorUserError = {
  field?: string | null;
  message?: string | null;
  code?: string | null;
};

type SaleorAddressInput = {
  firstName: string;
  lastName: string;
  streetAddress1: string;
  streetAddress2?: string;
  city: string;
  countryArea?: string;
  postalCode: string;
  country: string;
  phone?: string;
};

type ShippingMethod = {
  id: string;
  name?: string | null;
  price?: {
    amount?: number | null;
    currency?: string | null;
  } | null;
};

type RazorpayPaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  email?: string;
  contact?: string;
  notes?: Record<string, unknown>;
  shipping_detail?: Record<string, unknown>;
};

type RazorpayWebhookEvent = {
  event?: string;
  payload?: {
    payment?: {
      entity?: RazorpayPaymentEntity;
    };
    refund?: {
      entity?: {
        amount?: number;
        currency?: string;
        payment_id?: string;
      };
    };
  };
};

type AddressCandidate = {
  name?: string;
  contact?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
};

const CHECKOUT_EMAIL_UPDATE = /* GraphQL */ `
  mutation CheckoutEmailUpdate($id: ID!, $email: String!) {
    checkoutEmailUpdate(id: $id, email: $email) {
      errors {
        field
        message
        code
      }
    }
  }
`;

const CHECKOUT_SHIPPING_ADDRESS_UPDATE = /* GraphQL */ `
  mutation CheckoutShippingAddressUpdate($id: ID!, $address: AddressInput!) {
    checkoutShippingAddressUpdate(id: $id, shippingAddress: $address) {
      checkout {
        shippingMethods {
          id
          name
          price {
            amount
            currency
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

const CHECKOUT_BILLING_ADDRESS_UPDATE = /* GraphQL */ `
  mutation CheckoutBillingAddressUpdate($id: ID!, $address: AddressInput!) {
    checkoutBillingAddressUpdate(id: $id, billingAddress: $address) {
      errors {
        field
        message
        code
      }
    }
  }
`;

const CHECKOUT_DELIVERY_METHOD_UPDATE = /* GraphQL */ `
  mutation CheckoutDeliveryMethodUpdate($id: ID!, $deliveryMethodId: ID!) {
    checkoutDeliveryMethodUpdate(id: $id, deliveryMethodId: $deliveryMethodId) {
      errors {
        field
        message
        code
      }
    }
  }
`;

const CHECKOUT_COMPLETE = /* GraphQL */ `
  mutation CheckoutComplete($id: ID!) {
    checkoutComplete(id: $id) {
      order {
        id
        number
        status
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

const GET_CHECKOUT_SHIPPING_METHODS = /* GraphQL */ `
  query GetCheckoutShippingMethods($id: ID!) {
    checkout(id: $id) {
      id
      email
      shippingMethods {
        id
        name
        price {
          amount
          currency
        }
      }
    }
  }
`;

function resolveSaleorApiUrl(req: NextApiRequest) {
  const queryValue = Array.isArray(req.query.saleorApiUrl) ? req.query.saleorApiUrl[0] : req.query.saleorApiUrl;
  const headerValue = req.headers["x-saleor-api-url"];
  const normalizedHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const envSaleorApiUrl =
    process.env.NEXT_PUBLIC_SALEOR_API_URL ||
    process.env.SALEOR_API_URL ||
    "https://api.daikcell.in/graphql/";

  return queryValue || normalizedHeader || envSaleorApiUrl;
}

async function readRawBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function pickString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function inferMode(razorpayPaymentId?: string, razorpayOrderId?: string): "test" | "live" {
  const combined = `${razorpayPaymentId || ""} ${razorpayOrderId || ""}`.toLowerCase();

  return combined.includes("live") ? "live" : "test";
}

function splitName(fullName?: string) {
  if (!fullName) {
    return { firstName: "Customer", lastName: "" };
  }

  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return { firstName: "Customer", lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function normalizeCountry(country?: string) {
  const normalized = country?.trim().toUpperCase();

  if (!normalized) {
    return "IN";
  }

  if (normalized.length === 2) {
    return normalized;
  }

  if (normalized === "INDIA") {
    return "IN";
  }

  return "IN";
}

function extractAddressCandidateFromShippingDetail(shippingDetail?: Record<string, unknown> | null): AddressCandidate | null {
  if (!shippingDetail) {
    return null;
  }

  const nestedAddress = asRecord(shippingDetail.address);

  return {
    name: pickString(shippingDetail.name),
    contact: pickString(shippingDetail.contact),
    line1:
      pickString(shippingDetail.address) ||
      pickString(shippingDetail.line1) ||
      pickString(nestedAddress?.line1) ||
      pickString(nestedAddress?.address),
    line2:
      pickString(shippingDetail.line2) ||
      pickString(nestedAddress?.line2),
    city: pickString(shippingDetail.city) || pickString(nestedAddress?.city),
    state: pickString(shippingDetail.state) || pickString(nestedAddress?.state),
    country: pickString(shippingDetail.country) || pickString(nestedAddress?.country),
    zipcode:
      pickString(shippingDetail.zipcode) ||
      pickString(shippingDetail.postal_code) ||
      pickString(nestedAddress?.zipcode) ||
      pickString(nestedAddress?.postal_code),
  };
}

function toSaleorAddressInput(candidate: AddressCandidate | null, fallbackPhone?: string): SaleorAddressInput | null {
  if (!candidate) {
    return null;
  }

  const line1 = pickString(candidate.line1);
  const city = pickString(candidate.city);
  const postalCode = pickString(candidate.zipcode);

  if (!line1 || !city || !postalCode) {
    return null;
  }

  const { firstName, lastName } = splitName(candidate.name);

  return {
    firstName,
    lastName,
    streetAddress1: line1,
    ...(pickString(candidate.line2) ? { streetAddress2: pickString(candidate.line2) } : {}),
    city,
    ...(pickString(candidate.state) ? { countryArea: pickString(candidate.state) } : {}),
    postalCode,
    country: normalizeCountry(candidate.country),
    ...(pickString(candidate.contact) || pickString(fallbackPhone)
      ? { phone: pickString(candidate.contact) || pickString(fallbackPhone) }
      : {}),
  };
}

function formatSaleorErrors(errors: SaleorUserError[] = []) {
  return errors.map((entry) => entry.message || entry.code || entry.field || "Unknown error").join(" | ");
}

function isCheckoutAlreadyCompletedErrorMessage(message?: string) {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  const looksLikeCheckoutMissing =
    normalized.includes("checkout") &&
    (normalized.includes("not found") ||
      normalized.includes("does not exist") ||
      normalized.includes("could not resolve to a node"));

  return looksLikeCheckoutMissing;
}

function assertNoSaleorErrors(operation: string, errors: SaleorUserError[] = []) {
  if (errors.length) {
    throw new Error(`${operation} failed: ${formatSaleorErrors(errors)}`);
  }
}

function verifySignature(body: string, signature: string, secret: string) {
  const shasum = crypto.createHmac("sha256", secret);
  shasum.update(body);
  const digest = shasum.digest("hex");

  return signature === digest;
}

function getSaleorApiUrlFromEvent(event: RazorpayWebhookEvent) {
  const notes = asRecord(event.payload?.payment?.entity?.notes);
  return pickString(notes?.saleor_api_url);
}

async function getSaleorAuthToken(saleorApiUrl: string) {
  const authData = await saleorApp.apl.get(saleorApiUrl);

  if (!authData?.token) {
    throw new Error("Unable to resolve app auth token for Saleor checkout completion");
  }

  return authData.token;
}

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
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || payload.errors?.length) {
    const errorMessage =
      payload.errors?.map((entry) => entry.message || "GraphQL error").join(" | ") ||
      `Saleor request failed with ${response.status}`;

    throw new Error(errorMessage);
  }

  if (!payload.data) {
    throw new Error("Saleor response did not include data");
  }

  return payload.data;
}

async function handlePaymentCaptured(params: {
  saleorApiUrl: string;
  event: RazorpayWebhookEvent;
  signatureMode: "test" | "live";
}) {
  const { saleorApiUrl, event, signatureMode } = params;
  const docClient = getDocClient();
  const paymentEntity = event.payload?.payment?.entity;

  if (!paymentEntity) {
    return;
  }

  const razorpayPaymentId = pickString(paymentEntity.id);
  const razorpayOrderId = pickString(paymentEntity.order_id);
  const amount = (typeof paymentEntity.amount === "number" ? paymentEntity.amount : 0) / 100;
  const currency = pickString(paymentEntity.currency) || "INR";
  const mode = signatureMode || inferMode(razorpayPaymentId, razorpayOrderId);
  const notes = asRecord(paymentEntity.notes);

  const captureGuard = await beginPaymentCapturedProcessing(docClient, saleorApiUrl, razorpayPaymentId);

  if (captureGuard === "already_completed") {
    console.log(`[MagicCheckout] Duplicate payment.captured ignored (already completed): ${razorpayPaymentId || "unknown"}`);
    return;
  }

  if (captureGuard === "in_progress") {
    console.log(`[MagicCheckout] Duplicate payment.captured ignored (already processing): ${razorpayPaymentId || "unknown"}`);
    return;
  }

  const initializeLog = razorpayOrderId
    ? await findRecentInitializeLogByReference(docClient, saleorApiUrl, {
        razorpayOrderId,
      })
    : null;

  let checkoutId =
    pickString(notes?.cart_id) ||
    initializeLog?.saleorCheckoutId ||
    initializeLog?.saleorOrderId;
  let email = pickString(paymentEntity.email) || initializeLog?.customerEmail;
  let phone = pickString(paymentEntity.contact) || initializeLog?.customerPhone;

  await logTransaction(docClient, saleorApiUrl, {
    timestamp: new Date().toISOString(),
    type: "webhook",
    status: "pending",
    amount,
    currency,
    razorpayPaymentId,
    razorpayOrderId,
    saleorCheckoutId: checkoutId,
    customerEmail: email,
    customerPhone: phone,
    rawResponse: "payment.captured received; checkout completion processing started",
    mode,
  });

  if (!checkoutId) {
    await releasePaymentCapturedProcessing(docClient, saleorApiUrl, razorpayPaymentId);
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "webhook",
      status: "failed",
      amount,
      currency,
      razorpayPaymentId,
      razorpayOrderId,
      error: "checkout auto-complete failed: missing checkoutId",
      mode,
    });
    console.warn("[MagicCheckout] Cannot auto-complete: missing checkoutId");
    return;
  }

  let address = toSaleorAddressInput(
    extractAddressCandidateFromShippingDetail(asRecord(paymentEntity.shipping_detail)),
    phone
  );

  if ((!address || !email || !phone) && razorpayOrderId) {
    try {
      const { client } = await getRazorpayClient(docClient, saleorApiUrl);
      const razorpayOrder = await client.orders.fetch(razorpayOrderId as string);
      const customerDetails = asRecord((razorpayOrder as any)?.customer_details);

      if (!email) {
        email = pickString(customerDetails?.email) || email;
      }

      if (!phone) {
        phone = pickString(customerDetails?.contact) || phone;
      }

      if (!address) {
        address = toSaleorAddressInput(
          extractAddressCandidateFromShippingDetail(asRecord(customerDetails?.shipping_address)),
          phone
        );
      }
    } catch (error) {
      console.warn("[MagicCheckout] Could not fetch Razorpay order for fallback address:", error);
    }
  }

  if (!email) {
    await releasePaymentCapturedProcessing(docClient, saleorApiUrl, razorpayPaymentId);
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "webhook",
      status: "failed",
      amount,
      currency,
      razorpayPaymentId,
      razorpayOrderId,
      saleorCheckoutId: checkoutId,
      customerPhone: phone,
      error: "checkout auto-complete failed: missing customer email",
      mode,
    });
    console.warn(`[MagicCheckout] Cannot auto-complete ${checkoutId}: missing customer email`);
    return;
  }

  try {
    const token = await getSaleorAuthToken(saleorApiUrl);

    const emailResult = await saleorGraphQL<{
      checkoutEmailUpdate: {
        errors: SaleorUserError[];
      };
    }>(saleorApiUrl, token, CHECKOUT_EMAIL_UPDATE, {
      id: checkoutId,
      email,
    });

    assertNoSaleorErrors("checkoutEmailUpdate", emailResult.checkoutEmailUpdate.errors);

    if (address) {
      const shippingAddressResult = await saleorGraphQL<{
        checkoutShippingAddressUpdate: {
          errors: SaleorUserError[];
        };
      }>(saleorApiUrl, token, CHECKOUT_SHIPPING_ADDRESS_UPDATE, {
        id: checkoutId,
        address,
      });

      assertNoSaleorErrors("checkoutShippingAddressUpdate", shippingAddressResult.checkoutShippingAddressUpdate.errors);

      const billingAddressResult = await saleorGraphQL<{
        checkoutBillingAddressUpdate: {
          errors: SaleorUserError[];
        };
      }>(saleorApiUrl, token, CHECKOUT_BILLING_ADDRESS_UPDATE, {
        id: checkoutId,
        address,
      });

      assertNoSaleorErrors("checkoutBillingAddressUpdate", billingAddressResult.checkoutBillingAddressUpdate.errors);
    } else {
      console.warn(`[MagicCheckout] Address unavailable for checkout ${checkoutId}; checkoutComplete may fail`);
    }

    const checkoutMethodsResult = await saleorGraphQL<{
      checkout: {
        shippingMethods?: ShippingMethod[] | null;
      } | null;
    }>(saleorApiUrl, token, GET_CHECKOUT_SHIPPING_METHODS, {
      id: checkoutId,
    });

    const shippingMethods = checkoutMethodsResult.checkout?.shippingMethods || [];

    if (shippingMethods.length) {
      const cheapest = shippingMethods.reduce((current, method) => {
        const currentAmount = current.price?.amount ?? Number.MAX_SAFE_INTEGER;
        const nextAmount = method.price?.amount ?? Number.MAX_SAFE_INTEGER;

        return nextAmount < currentAmount ? method : current;
      });

      const deliveryMethodResult = await saleorGraphQL<{
        checkoutDeliveryMethodUpdate: {
          errors: SaleorUserError[];
        };
      }>(saleorApiUrl, token, CHECKOUT_DELIVERY_METHOD_UPDATE, {
        id: checkoutId,
        deliveryMethodId: cheapest.id,
      });

      assertNoSaleorErrors("checkoutDeliveryMethodUpdate", deliveryMethodResult.checkoutDeliveryMethodUpdate.errors);
    }

    const completeResult = await saleorGraphQL<{
      checkoutComplete: {
        order: {
          id?: string;
          number?: string;
          status?: string;
        } | null;
        errors: SaleorUserError[];
      };
    }>(saleorApiUrl, token, CHECKOUT_COMPLETE, {
      id: checkoutId,
    });

    const checkoutCompletePayload = completeResult.checkoutComplete;

    if (checkoutCompletePayload.errors.length) {
      const formattedErrors = formatSaleorErrors(checkoutCompletePayload.errors);

      if (isCheckoutAlreadyCompletedErrorMessage(formattedErrors)) {
        await markPaymentCapturedCompleted(docClient, saleorApiUrl, razorpayPaymentId);
        await logTransaction(docClient, saleorApiUrl, {
          timestamp: new Date().toISOString(),
          type: "webhook",
          status: "success",
          amount,
          currency,
          razorpayPaymentId,
          razorpayOrderId,
          saleorCheckoutId: checkoutId,
          customerEmail: email,
          customerPhone: phone,
          rawResponse: `checkout already completed for ${checkoutId}; treated as idempotent success`,
          mode,
        });
        console.log(`[MagicCheckout] Checkout already completed for ${checkoutId}; treated as idempotent success`);
        return;
      }

      throw new Error(formattedErrors);
    }

    if (!checkoutCompletePayload.order?.id) {
      throw new Error("checkoutComplete did not return an order");
    }

    await markPaymentCapturedCompleted(docClient, saleorApiUrl, razorpayPaymentId);
    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "webhook",
      status: "success",
      amount,
      currency,
      razorpayPaymentId,
      razorpayOrderId,
      saleorCheckoutId: checkoutId,
      customerEmail: email,
      customerPhone: phone,
      rawResponse: `order created by webhook: ${checkoutCompletePayload.order.id}`,
      mode,
    });

    console.log(
      `[MagicCheckout] Order created successfully: #${checkoutCompletePayload.order.number || ""} (${checkoutCompletePayload.order.id})`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown auto-complete error";

    if (isCheckoutAlreadyCompletedErrorMessage(errorMessage)) {
      await markPaymentCapturedCompleted(docClient, saleorApiUrl, razorpayPaymentId);
      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "webhook",
        status: "success",
        amount,
        currency,
        razorpayPaymentId,
        razorpayOrderId,
        saleorCheckoutId: checkoutId,
        customerEmail: email,
        customerPhone: phone,
        rawResponse: `checkout appears already completed for ${checkoutId}; treated as idempotent success`,
        mode,
      });
      console.warn(`[MagicCheckout] Checkout appears already completed for ${checkoutId}; treated as idempotent success`);
      return;
    }

    console.error("[MagicCheckout] Auto-complete failed:", error);

    await logTransaction(docClient, saleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "webhook",
      status: "failed",
      amount,
      currency,
      razorpayPaymentId,
      razorpayOrderId,
      saleorCheckoutId: checkoutId,
      customerEmail: email,
      customerPhone: phone,
      error: `checkout auto-complete failed: ${errorMessage}`,
      mode,
    });
    await releasePaymentCapturedProcessing(docClient, saleorApiUrl, razorpayPaymentId);
  }
}

/**
 * Razorpay Webhook Handler
 *
 * Receives webhook events directly from Razorpay (not Saleor).
 * Verifies HMAC signature and processes payment events.
 *
 * Supported events:
 * - payment.captured
 * - payment.failed
 * - refund.processed
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const docClient = getDocClient();
  const defaultSaleorApiUrl = resolveSaleorApiUrl(req);

  try {
    const signature = req.headers["x-razorpay-signature"] as string;

    if (!signature) {
      console.error("Missing Razorpay webhook signature");
      return res.status(400).json({ error: "Missing signature" });
    }

    const body = await readRawBody(req);
    const event = JSON.parse(body) as RazorpayWebhookEvent;

    const saleorApiUrlCandidates = Array.from(
      new Set([
        defaultSaleorApiUrl,
        getSaleorApiUrlFromEvent(event),
      ].filter((value): value is string => Boolean(value)))
    );

    let verifiedSaleorApiUrl = "";

    for (const candidate of saleorApiUrlCandidates) {
      const webhookSecrets = await getWebhookSecrets(docClient, candidate);
      if (webhookSecrets.some((secret) => verifySignature(body, signature, secret))) {
        verifiedSaleorApiUrl = candidate;
        break;
      }
    }

    if (!verifiedSaleorApiUrl) {
      console.error("Invalid Razorpay Webhook Signature");

      await logTransaction(docClient, defaultSaleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "webhook",
        status: "failed",
        amount: 0,
        currency: "INR",
        error: "Invalid webhook signature",
        mode: "test",
      });

      return res.status(400).json({ error: "Invalid signature" });
    }

    const saleorApiUrl = verifiedSaleorApiUrl;

    console.log("Razorpay Webhook Received:", event.event);

    if (event.event === "payment.captured") {
      const paymentEntity = event.payload?.payment?.entity;
      const signatureMode = inferMode(pickString(paymentEntity?.id), pickString(paymentEntity?.order_id));

      await handlePaymentCaptured({
        saleorApiUrl,
        event,
        signatureMode,
      });
    } else if (event.event === "payment.failed") {
      const paymentEntity = event.payload?.payment?.entity;
      const amount = (typeof paymentEntity?.amount === "number" ? paymentEntity.amount : 0) / 100;
      const razorpayPaymentId = pickString(paymentEntity?.id);
      const razorpayOrderId = pickString(paymentEntity?.order_id);

      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "webhook",
        status: "failed",
        amount,
        currency: pickString(paymentEntity?.currency) || "INR",
        razorpayPaymentId,
        razorpayOrderId,
        error: pickString(asRecord(paymentEntity)?.error_description) || "Payment failed",
        mode: inferMode(razorpayPaymentId, razorpayOrderId),
      });

      console.log(`Payment Failed: ${pickString(asRecord(paymentEntity)?.error_description) || "Payment failed"}`);
    } else if (event.event === "refund.processed") {
      const refundEntity = event.payload?.refund?.entity;
      const amount = (typeof refundEntity?.amount === "number" ? refundEntity.amount : 0) / 100;

      await logTransaction(docClient, saleorApiUrl, {
        timestamp: new Date().toISOString(),
        type: "webhook",
        status: "success",
        amount,
        currency: pickString(refundEntity?.currency) || "INR",
        razorpayPaymentId: pickString(refundEntity?.payment_id),
        mode: "test",
      });

      console.log(`Refund Processed: ${amount}`);
    }

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Razorpay Webhook Error:", error);

    await logTransaction(docClient, defaultSaleorApiUrl, {
      timestamp: new Date().toISOString(),
      type: "webhook",
      status: "failed",
      amount: 0,
      currency: "INR",
      error: message,
      mode: "test",
    });

    return res.status(500).json({ error: "Internal server error" });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
