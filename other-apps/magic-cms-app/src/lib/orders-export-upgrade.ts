export const ORDER_UPGRADE_SKU = "ORDER-UPGRADE";
export const ORDER_UPGRADE_METADATA_KEY = "is_upgraded";
export const ORDER_UPGRADE_AMOUNT_KEY = "upgrade_amount";
export const ORDER_UPGRADE_PSP_KEY = "upgrade_psp_reference";
export const ORDER_UPGRADE_DESCRIPTION_KEY = "upgrade_description";

type MetadataEntry = {
  key?: string | null;
  value?: string | null;
};

type ExportOrderLine = {
  variant?: { sku?: string | null } | null;
  totalPrice?: { gross?: { amount?: number | null } | null } | null;
};

export type ExportOrderUpgradeSource = {
  chargeStatus?: string | null;
  metadata?: ReadonlyArray<MetadataEntry | null> | null;
  lines?: ReadonlyArray<ExportOrderLine | null> | null;
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

export const orderHasUpgradeLine = (order: ExportOrderUpgradeSource) =>
  (order.lines ?? []).some(line => line?.variant?.sku === ORDER_UPGRADE_SKU);

export const orderHasUpgradeMetadata = (order: ExportOrderUpgradeSource) =>
  pickMetadataValue(order.metadata, ORDER_UPGRADE_METADATA_KEY) === "true";

export const orderIsUpgraded = (order: ExportOrderUpgradeSource) =>
  orderHasUpgradeLine(order) || orderHasUpgradeMetadata(order);

export const resolveUpgradeLineAmount = (order: ExportOrderUpgradeSource) =>
  (order.lines ?? [])
    .filter(line => line?.variant?.sku === ORDER_UPGRADE_SKU)
    .reduce((sum, line) => sum + (line?.totalPrice?.gross?.amount ?? 0), 0);

export const resolveUpgradeMetadataAmount = (order: ExportOrderUpgradeSource) =>
  parseAmount(pickMetadataValue(order.metadata, ORDER_UPGRADE_AMOUNT_KEY));

export const resolveUpgradeAmount = (order: ExportOrderUpgradeSource) => {
  const lineAmount = resolveUpgradeLineAmount(order);
  if (lineAmount > 0) {
    return lineAmount;
  }

  return resolveUpgradeMetadataAmount(order);
};

export const resolveUpgradeDescription = (order: ExportOrderUpgradeSource) =>
  pickMetadataValue(order.metadata, ORDER_UPGRADE_DESCRIPTION_KEY);

export const resolveUpgradePspReference = (order: ExportOrderUpgradeSource) =>
  pickMetadataValue(order.metadata, ORDER_UPGRADE_PSP_KEY);

export const resolveFinalAmount = (order: ExportOrderUpgradeSource) => {
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

export const resolveChargeStatusDisplay = (order: ExportOrderUpgradeSource) => {
  if (!orderIsUpgraded(order)) {
    return order.chargeStatus ?? "";
  }

  const chargeStatus = (order.chargeStatus ?? "").toUpperCase();
  if (chargeStatus === "OVERCHARGED" || chargeStatus === "FULL") {
    return "Upgraded";
  }

  return order.chargeStatus ?? "";
};
