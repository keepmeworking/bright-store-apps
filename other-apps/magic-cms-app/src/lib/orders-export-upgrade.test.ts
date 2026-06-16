import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  ORDER_UPGRADE_AMOUNT_KEY,
  ORDER_UPGRADE_METADATA_KEY,
  ORDER_UPGRADE_SKU,
  resolveChargeStatusDisplay,
  resolveFinalAmount,
  resolveUpgradeAmount,
  resolveUpgradeDescription,
  resolveUpgradePspReference,
} from "./orders-export-upgrade.ts";

test("resolveFinalAmount adds metadata upgrade amount for confirmed orders", () => {
  assert.equal(
    resolveFinalAmount({
      total: { gross: { amount: 43498 } },
      metadata: [
        { key: ORDER_UPGRADE_METADATA_KEY, value: "true" },
        { key: ORDER_UPGRADE_AMOUNT_KEY, value: "3000" },
      ],
      lines: [{ variant: { sku: "PHONE-1" }, totalPrice: { gross: { amount: 43498 } } }],
    }),
    46498,
  );
});

test("resolveFinalAmount uses order total when upgrade line exists", () => {
  assert.equal(
    resolveFinalAmount({
      total: { gross: { amount: 23000 } },
      metadata: [{ key: ORDER_UPGRADE_METADATA_KEY, value: "true" }],
      lines: [
        { variant: { sku: "PHONE-1" }, totalPrice: { gross: { amount: 20000 } } },
        { variant: { sku: ORDER_UPGRADE_SKU }, totalPrice: { gross: { amount: 3000 } } },
      ],
    }),
    23000,
  );
});

test("resolveUpgradeAmount prefers upgrade line over metadata", () => {
  assert.equal(
    resolveUpgradeAmount({
      metadata: [{ key: ORDER_UPGRADE_AMOUNT_KEY, value: "999" }],
      lines: [{ variant: { sku: ORDER_UPGRADE_SKU }, totalPrice: { gross: { amount: 3000 } } }],
    }),
    3000,
  );
});

test("resolveChargeStatusDisplay returns Upgraded for upgraded overcharged orders", () => {
  assert.equal(
    resolveChargeStatusDisplay({
      chargeStatus: "OVERCHARGED",
      metadata: [{ key: ORDER_UPGRADE_METADATA_KEY, value: "true" }],
    }),
    "Upgraded",
  );
});

test("resolveUpgradeDescription and psp reference read metadata", () => {
  assert.equal(
    resolveUpgradeDescription({
      metadata: [{ key: "upgrade_description", value: "Extra storage" }],
    }),
    "Extra storage",
  );
  assert.equal(
    resolveUpgradePspReference({
      metadata: [{ key: "upgrade_psp_reference", value: "pay_abc123" }],
    }),
    "pay_abc123",
  );
});
