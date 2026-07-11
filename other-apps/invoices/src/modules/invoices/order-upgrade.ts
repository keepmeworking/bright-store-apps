export const ORDER_UPGRADE_SKU = "ORDER-UPGRADE";
export const ORDER_UPGRADE_METADATA_KEY = "is_upgraded";
export const ORDER_UPGRADE_AMOUNT_KEY = "upgrade_amount";
export const ORDER_UPGRADE_DESCRIPTION_KEY = "upgrade_description";
export const ORDER_UPGRADE_PRODUCT_NAME_KEY = "upgrade_product_name";

type MetadataEntry = {
  key?: string | null;
  value?: string | null;
};

type UpgradeOrderLine = {
  variant?: { sku?: string | null } | null;
  totalPrice?: { gross?: { amount?: number | null } | null } | null;
};

export type InvoiceOrderUpgradeSource = {
  metadata?: ReadonlyArray<MetadataEntry | null> | null;
  lines?: ReadonlyArray<UpgradeOrderLine | null> | null;
  total?: { gross?: { amount?: number | null } | null } | null;
};

const pickMetadataValue = (
  metadata: ReadonlyArray<MetadataEntry | null> | null | undefined,
  key: string,
) => {
  const entry = (metadata ?? []).find(item => item?.key === key);
  return (entry?.value ?? "").trim();
};

const parseAmount = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const orderHasUpgradeLine = (order: InvoiceOrderUpgradeSource) =>
  (order.lines ?? []).some(line => line?.variant?.sku === ORDER_UPGRADE_SKU);

export const orderHasUpgradeMetadata = (order: InvoiceOrderUpgradeSource) =>
  pickMetadataValue(order.metadata, ORDER_UPGRADE_METADATA_KEY) === "true";

export const orderIsUpgraded = (order: InvoiceOrderUpgradeSource) =>
  orderHasUpgradeLine(order) || orderHasUpgradeMetadata(order);

export const resolveUpgradeLineAmount = (order: InvoiceOrderUpgradeSource) =>
  (order.lines ?? [])
    .filter(line => line?.variant?.sku === ORDER_UPGRADE_SKU)
    .reduce((sum, line) => sum + (line?.totalPrice?.gross?.amount ?? 0), 0);

export const resolveUpgradeMetadataAmount = (order: InvoiceOrderUpgradeSource) =>
  parseAmount(pickMetadataValue(order.metadata, ORDER_UPGRADE_AMOUNT_KEY));

export const resolveUpgradeAmount = (order: InvoiceOrderUpgradeSource) => {
  const lineAmount = resolveUpgradeLineAmount(order);
  if (lineAmount > 0) {
    return lineAmount;
  }

  return resolveUpgradeMetadataAmount(order);
};

export const resolveUpgradeDescription = (order: InvoiceOrderUpgradeSource) =>
  pickMetadataValue(order.metadata, ORDER_UPGRADE_DESCRIPTION_KEY);

export const resolveUpgradeProductName = (order: InvoiceOrderUpgradeSource) =>
  pickMetadataValue(order.metadata, ORDER_UPGRADE_PRODUCT_NAME_KEY);

export const resolveUpgradeLineLabel = (order: InvoiceOrderUpgradeSource) =>
  resolveUpgradeProductName(order) || resolveUpgradeDescription(order) || "Order Upgrade";

export const resolveFinalAmount = (order: InvoiceOrderUpgradeSource) => {
  const orderTotal = order.total?.gross?.amount ?? 0;

  if (!orderIsUpgraded(order)) {
    return orderTotal;
  }

  const upgradeLineAmount = resolveUpgradeLineAmount(order);
  if (upgradeLineAmount > 0) {
    return orderTotal;
  }

  const metadataAmount = resolveUpgradeMetadataAmount(order);
  return metadataAmount > 0 ? orderTotal + metadataAmount : orderTotal;
};

export const resolveMetadataOnlyUpgradeAmount = (order: InvoiceOrderUpgradeSource) => {
  if (!orderHasUpgradeMetadata(order) || resolveUpgradeLineAmount(order) > 0) {
    return 0;
  }

  return resolveUpgradeMetadataAmount(order);
};
