import { describe, expect, it } from "vitest";

import {
  ORDER_UPGRADE_SKU,
  orderHasUpgradeMetadata,
  orderIsUpgraded,
  resolveFinalAmount,
  resolveMetadataOnlyUpgradeAmount,
  resolveUpgradeAmount,
  resolveUpgradeLineLabel,
} from "./order-upgrade";

describe("order-upgrade", () => {
  it("detects metadata-only upgrade orders", () => {
    const order = {
      metadata: [
        { key: "is_upgraded", value: "true" },
        { key: "upgrade_amount", value: "43498" },
      ],
      lines: [],
      total: { gross: { amount: 100000 } },
    };

    expect(orderHasUpgradeMetadata(order)).toBe(true);
    expect(orderIsUpgraded(order)).toBe(true);
    expect(resolveMetadataOnlyUpgradeAmount(order)).toBe(43498);
    expect(resolveFinalAmount(order)).toBe(143498);
  });

  it("uses order total when upgrade line is present", () => {
    const order = {
      metadata: [{ key: "is_upgraded", value: "true" }],
      lines: [
        {
          variant: { sku: ORDER_UPGRADE_SKU },
          totalPrice: { gross: { amount: 5000 } },
        },
      ],
      total: { gross: { amount: 15000 } },
    };

    expect(resolveMetadataOnlyUpgradeAmount(order)).toBe(0);
    expect(resolveUpgradeAmount(order)).toBe(5000);
    expect(resolveFinalAmount(order)).toBe(15000);
  });

  it("prefers upgraded product name for invoice label", () => {
    expect(
      resolveUpgradeLineLabel({
        metadata: [
          { key: "upgrade_product_name", value: "Pixel 9 Pro" },
          { key: "upgrade_description", value: "Capacity bump" },
        ],
      }),
    ).toBe("Pixel 9 Pro");
    expect(
      resolveUpgradeLineLabel({
        metadata: [{ key: "upgrade_description", value: "Capacity bump" }],
      }),
    ).toBe("Capacity bump");
  });
});
