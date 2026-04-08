import type { AuthData } from "@saleor/app-sdk/APL";
import { saleorApp } from "@/saleor-app";
import { getDocClient } from "@/modules/dynamodb-helpers";
import { findRecentInitializeLogByReference } from "@/modules/transaction-log";

type GraphQLErrorShape = {
  message?: string;
  extensions?: {
    code?: string;
  };
};

type TaxedMoney = {
  gross?: {
    amount?: number | null;
    currency?: string | null;
  } | null;
};

type Money = {
  amount?: number | null;
  currency?: string | null;
};

type ShippingMethodShape = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  message?: string | null;
  minimumDeliveryDays?: number | null;
  maximumDeliveryDays?: number | null;
  price?: Money | null;
};

type CheckoutShape = {
  id: string;
  channel?: {
    slug?: string | null;
  } | null;
  email?: string | null;
  voucherCode?: string | null;
  discountName?: string | null;
  discount?: Money | null;
  shippingAddress?: {
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    streetAddress1?: string | null;
    streetAddress2?: string | null;
    city?: string | null;
    countryArea?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    country?: {
      code?: string | null;
      country?: string | null;
    } | null;
  } | null;
  shippingMethods?: ShippingMethodShape[] | null;
  deliveryMethod?: {
    __typename?: string;
    id?: string | null;
    name?: string | null;
  } | null;
  shippingPrice?: TaxedMoney | null;
  subtotalPrice?: TaxedMoney | null;
  totalPrice?: TaxedMoney | null;
};

type VoucherCandidate = {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  discountValue?: number | null;
  discountValueType?: string | null;
  minSpent?: Money | null;
};

const CHECKOUT_QUERY = /* GraphQL */ `
  query MagicCheckoutById($id: ID!) {
    checkout(id: $id) {
      id
      email
      voucherCode
      discountName
      discount {
        amount
        currency
      }
      channel {
        slug
      }
      shippingAddress {
        firstName
        lastName
        companyName
        streetAddress1
        streetAddress2
        city
        countryArea
        postalCode
        phone
        country {
          code
          country
        }
      }
      shippingMethods {
        id
        name
        description
        active
        message
        minimumDeliveryDays
        maximumDeliveryDays
        price {
          amount
          currency
        }
      }
      deliveryMethod {
        __typename
        ... on ShippingMethod {
          id
          name
        }
      }
      shippingPrice {
        gross {
          amount
          currency
        }
      }
      subtotalPrice {
        gross {
          amount
          currency
        }
      }
      totalPrice {
        gross {
          amount
          currency
        }
      }
    }
  }
`;

const APPLY_PROMO_MUTATION = /* GraphQL */ `
  mutation MagicCheckoutAddPromo($id: ID!, $promoCode: String!) {
    checkoutAddPromoCode(id: $id, promoCode: $promoCode) {
      checkout {
        id
        voucherCode
        discountName
        discount {
          amount
          currency
        }
        shippingPrice {
          gross {
            amount
            currency
          }
        }
        subtotalPrice {
          gross {
            amount
            currency
          }
        }
        totalPrice {
          gross {
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

const UPDATE_SHIPPING_ADDRESS_MUTATION = /* GraphQL */ `
  mutation MagicCheckoutShippingAddressUpdate($id: ID!, $shippingAddress: AddressInput!) {
    checkoutShippingAddressUpdate(id: $id, shippingAddress: $shippingAddress) {
      checkout {
        id
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

const UPDATE_DELIVERY_METHOD_MUTATION = /* GraphQL */ `
  mutation MagicCheckoutDeliveryMethodUpdate($id: ID!, $deliveryMethodId: ID) {
    checkoutDeliveryMethodUpdate(id: $id, deliveryMethodId: $deliveryMethodId) {
      checkout {
        id
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

const LIST_VOUCHERS_QUERY = /* GraphQL */ `
  query MagicCheckoutVoucherList($channel: String!) {
    vouchers(channel: $channel, first: 20, filter: { status: [ACTIVE] }) {
      edges {
        node {
          id
          name
          code
          discountValue
          discountValueType
          minSpent {
            amount
            currency
          }
        }
      }
    }
  }
`;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function toMinorUnits(amount?: number | null) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.round(amount * 100));
}

function normalizeGraphQLError(error: GraphQLErrorShape) {
  return error.extensions?.code
    ? `${error.extensions.code}: ${error.message || "GraphQL error"}`
    : error.message || "GraphQL error";
}

async function saleorGraphQL<TData>(
  authData: AuthData,
  query: string,
  variables: Record<string, unknown>
): Promise<TData> {
  const response = await fetch(authData.saleorApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization-Bearer": authData.token,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const payload = (await response.json()) as {
    data?: TData;
    errors?: GraphQLErrorShape[];
  };

  if (!response.ok || payload.errors?.length) {
    const errorMessage = payload.errors?.map(normalizeGraphQLError).join(" | ") || `Saleor request failed with ${response.status}`;
    throw new Error(errorMessage);
  }

  if (!payload.data) {
    throw new Error("Saleor response did not include data");
  }

  return payload.data;
}

export async function getMagicSaleorAuth(saleorApiUrl: string) {
  const resolvedSaleorApiUrl =
    saleorApiUrl ||
    process.env.SALEOR_API_URL ||
    process.env.NEXT_PUBLIC_SALEOR_API_URL ||
    "";

  if (!resolvedSaleorApiUrl) {
    throw new Error("saleorApiUrl is required");
  }

  const authData = await saleorApp.apl.get(resolvedSaleorApiUrl);

  if (!authData?.token) {
    throw new Error("Unable to resolve Razorpay app auth for the configured Saleor API URL");
  }

  return {
    ...authData,
    saleorApiUrl: resolvedSaleorApiUrl,
  };
}

export async function getCheckoutSnapshot(authData: AuthData, checkoutId: string) {
  const data = await saleorGraphQL<{ checkout: CheckoutShape | null }>(authData, CHECKOUT_QUERY, {
    id: checkoutId,
  });

  return data.checkout;
}

export async function resolveCheckoutIdForMagicRequest(
  saleorApiUrl: string,
  checkoutReference: string
) {
  const authData = await getMagicSaleorAuth(saleorApiUrl);

  if (checkoutReference) {
    try {
      const directCheckout = await getCheckoutSnapshot(authData, checkoutReference);
      if (directCheckout?.id) {
        return {
          authData,
          checkoutId: directCheckout.id,
          checkout: directCheckout,
        };
      }
    } catch {
      // fall through to transaction log lookup
    }
  }

  const docClient = getDocClient();
  const initializeLog = await findRecentInitializeLogByReference(docClient, saleorApiUrl, {
    receipt: checkoutReference,
    razorpayOrderId: checkoutReference,
  });

  const resolvedCheckoutId = initializeLog?.saleorCheckoutId || initializeLog?.saleorOrderId;

  if (!resolvedCheckoutId) {
    throw new Error("Unable to resolve the Saleor checkout for this Magic Checkout request");
  }

  const checkout = await getCheckoutSnapshot(authData, resolvedCheckoutId);

  if (!checkout?.id) {
    throw new Error("Resolved checkout could not be loaded from Saleor");
  }

  return {
    authData,
    checkoutId: checkout.id,
    checkout,
  };
}

export async function applyPromotionToCheckout(authData: AuthData, checkoutId: string, promoCode: string) {
  const data = await saleorGraphQL<{
    checkoutAddPromoCode: {
      checkout: CheckoutShape | null;
      errors: { field?: string | null; message?: string | null; code?: string | null }[];
    };
  }>(authData, APPLY_PROMO_MUTATION, {
    id: checkoutId,
    promoCode,
  });

  return data.checkoutAddPromoCode;
}

export async function updateCheckoutShippingAddress(
  authData: AuthData,
  checkout: CheckoutShape,
  patch: {
    city?: string;
    postalCode?: string;
    countryArea?: string;
    country?: string;
  }
) {
  if (!patch.city && !patch.postalCode && !patch.countryArea && !patch.country) {
    return null;
  }

  const currentAddress = checkout.shippingAddress;

  if (!currentAddress) {
    return null;
  }

  const data = await saleorGraphQL<{
    checkoutShippingAddressUpdate: {
      errors: { field?: string | null; message?: string | null; code?: string | null }[];
    };
  }>(authData, UPDATE_SHIPPING_ADDRESS_MUTATION, {
    id: checkout.id,
    shippingAddress: {
      firstName: currentAddress.firstName,
      lastName: currentAddress.lastName,
      companyName: currentAddress.companyName,
      streetAddress1: currentAddress.streetAddress1,
      streetAddress2: currentAddress.streetAddress2,
      city: patch.city || currentAddress.city,
      postalCode: patch.postalCode || currentAddress.postalCode,
      countryArea: patch.countryArea || currentAddress.countryArea,
      country: patch.country || currentAddress.country?.code,
      phone: currentAddress.phone,
    },
  });

  return data.checkoutShippingAddressUpdate;
}

export async function updateCheckoutDeliveryMethod(
  authData: AuthData,
  checkoutId: string,
  deliveryMethodId: string | null
) {
  const data = await saleorGraphQL<{
    checkoutDeliveryMethodUpdate: {
      errors: { field?: string | null; message?: string | null; code?: string | null }[];
    };
  }>(authData, UPDATE_DELIVERY_METHOD_MUTATION, {
    id: checkoutId,
    deliveryMethodId,
  });

  return data.checkoutDeliveryMethodUpdate;
}

export async function listVoucherPromotions(authData: AuthData, channelSlug?: string | null) {
  if (!channelSlug) {
    return [] as VoucherCandidate[];
  }

  try {
    const data = await saleorGraphQL<{
      vouchers: {
        edges: Array<{
          node: VoucherCandidate;
        }>;
      } | null;
    }>(authData, LIST_VOUCHERS_QUERY, {
      channel: channelSlug,
    });

    return data.vouchers?.edges.map((edge) => edge.node).filter(Boolean) || [];
  } catch (error) {
    console.warn("Voucher listing for Magic Checkout unavailable:", getErrorMessage(error));
    return [];
  }
}

export function serializeCheckoutSummary(checkout: CheckoutShape) {
  return {
    checkout_id: checkout.id,
    customer_email: checkout.email || "",
    coupon_code: checkout.voucherCode || "",
    discount_name: checkout.discountName || "",
    discount_amount: toMinorUnits(checkout.discount?.amount),
    subtotal_amount: toMinorUnits(checkout.subtotalPrice?.gross?.amount),
    shipping_amount: toMinorUnits(checkout.shippingPrice?.gross?.amount),
    total_amount: toMinorUnits(checkout.totalPrice?.gross?.amount),
    currency:
      checkout.totalPrice?.gross?.currency ||
      checkout.subtotalPrice?.gross?.currency ||
      checkout.shippingPrice?.gross?.currency ||
      checkout.discount?.currency ||
      "INR",
  };
}

export function serializeShippingMethods(checkout: CheckoutShape) {
  const selectedDeliveryId = checkout.deliveryMethod?.id || "";

  return (checkout.shippingMethods || [])
    .filter((method) => method?.id)
    .map((method) => ({
      id: method.id,
      label: method.name,
      description: method.description || "",
      amount: toMinorUnits(method.price?.amount),
      currency: method.price?.currency || checkout.totalPrice?.gross?.currency || "INR",
      minimum_delivery_days: method.minimumDeliveryDays ?? undefined,
      maximum_delivery_days: method.maximumDeliveryDays ?? undefined,
      is_selected: selectedDeliveryId === method.id,
      is_available: method.active !== false,
      message: method.message || "",
    }));
}

export function serializeVoucherPromotions(vouchers: VoucherCandidate[], checkout: CheckoutShape) {
  return vouchers
    .filter((voucher) => voucher.code)
    .map((voucher) => ({
      id: voucher.id || voucher.code || "",
      code: voucher.code || "",
      title: voucher.name || voucher.code || "",
      description: voucher.name || voucher.code || "",
      discount_type: voucher.discountValueType || "",
      discount_value:
        typeof voucher.discountValue === "number" && Number.isFinite(voucher.discountValue)
          ? voucher.discountValue
          : 0,
      minimum_order_value: voucher.minSpent?.amount || 0,
      currency: voucher.minSpent?.currency || checkout.totalPrice?.gross?.currency || "INR",
      is_applied: checkout.voucherCode === voucher.code,
    }));
}
