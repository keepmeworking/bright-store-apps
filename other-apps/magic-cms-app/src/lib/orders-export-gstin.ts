const GSTIN_METADATA_KEY = "gstin";

type MetadataEntry = {
  key?: string | null;
  value?: string | null;
};

type AddressWithMetadata = {
  metadata?: ReadonlyArray<MetadataEntry | null> | null;
};

export const normalizeGstin = (value: string) => value.trim().toUpperCase();

export const resolveCustomerGstin = (
  billingAddress?: AddressWithMetadata | null,
): string => {
  const raw =
    billingAddress?.metadata?.find((entry) => entry?.key === GSTIN_METADATA_KEY)?.value?.trim() ||
    "";
  return normalizeGstin(raw);
};
