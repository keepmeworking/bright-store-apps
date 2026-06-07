export const GSTIN_METADATA_KEY = "gstin";

export type MetadataEntry = {
  key?: string | null;
  value?: string | null;
};

export type AddressWithMetadata = {
  metadata?: ReadonlyArray<MetadataEntry | null> | null;
};

export const normalizeGstin = (value: string) => value.trim().toUpperCase();

export const readGstinFromAddress = (address?: AddressWithMetadata | null) => {
  const rawValue =
    address?.metadata?.find((entry) => entry?.key === GSTIN_METADATA_KEY)?.value?.trim() || "";

  return normalizeGstin(rawValue);
};

export const formatCustomerGstinLine = (gstin: string) => {
  const normalized = normalizeGstin(gstin);
  return normalized ? `GSTIN: ${normalized}` : undefined;
};
