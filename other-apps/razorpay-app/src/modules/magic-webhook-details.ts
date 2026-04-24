export type SaleorAddressInput = {
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

export type RazorpayPaymentLike = {
  email?: string;
  contact?: string;
  notes?: Record<string, unknown>;
};

export type AddressCandidate = {
  name?: string;
  contact?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function pickString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    const picked = pickString(value);
    if (picked) {
      return picked;
    }
  }

  return undefined;
}

export function extractMagicCheckoutIdentifiers(
  payment: RazorpayPaymentLike | null | undefined,
  fallback?: {
    saleorCheckoutId?: string;
    saleorOrderId?: string;
    customerEmail?: string;
    customerPhone?: string;
  } | null
) {
  const notes = asRecord(payment?.notes);

  return {
    checkoutId:
      pickFirstString(notes?.cart_id, notes?.checkout_id, notes?.checkoutId) ||
      fallback?.saleorCheckoutId ||
      fallback?.saleorOrderId,
    email: pickString(payment?.email) || fallback?.customerEmail,
    phone: pickString(payment?.contact) || fallback?.customerPhone,
  };
}

export function splitName(fullName?: string) {
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

export function normalizeCountry(country?: string) {
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

export function extractAddressCandidateFromShippingDetail(shippingDetail?: Record<string, unknown> | null) {
  if (!shippingDetail) {
    return null;
  }

  const nestedAddress =
    asRecord(shippingDetail.address) ||
    asRecord(shippingDetail.shipping_address) ||
    asRecord(shippingDetail.billing_address);

  return {
    name: pickFirstString(shippingDetail.name, nestedAddress?.name),
    contact: pickFirstString(shippingDetail.contact, nestedAddress?.contact, nestedAddress?.phone),
    line1: pickFirstString(
      shippingDetail.line1,
      shippingDetail.address,
      nestedAddress?.line1,
      nestedAddress?.address,
      nestedAddress?.address_line_1,
      nestedAddress?.streetAddress1
    ),
    line2: pickFirstString(
      shippingDetail.line2,
      nestedAddress?.line2,
      nestedAddress?.address_line_2,
      nestedAddress?.streetAddress2
    ),
    city: pickFirstString(shippingDetail.city, nestedAddress?.city),
    state: pickFirstString(
      shippingDetail.state,
      shippingDetail.state_code,
      shippingDetail.countryArea,
      nestedAddress?.state,
      nestedAddress?.state_code,
      nestedAddress?.countryArea
    ),
    country: pickFirstString(shippingDetail.country, nestedAddress?.country),
    zipcode: pickFirstString(
      shippingDetail.zipcode,
      shippingDetail.postal_code,
      shippingDetail.postalCode,
      nestedAddress?.zipcode,
      nestedAddress?.postal_code,
      nestedAddress?.postalCode
    ),
  };
}

export function toSaleorAddressInput(
  candidate: AddressCandidate | null,
  fallbackPhone?: string
): SaleorAddressInput | null {
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
