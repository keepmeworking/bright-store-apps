import { test } from "node:test";
import * as assert from "node:assert/strict";

import { normalizeGstin, resolveCustomerGstin } from "./orders-export-gstin.ts";

test("normalizeGstin uppercases and trims", () => {
  assert.equal(normalizeGstin(" 09abcde1234f1z5 "), "09ABCDE1234F1Z5");
});

test("resolveCustomerGstin reads gstin from billing address metadata", () => {
  assert.equal(
    resolveCustomerGstin({
      metadata: [
        { key: "other", value: "x" },
        { key: "gstin", value: "09abcde1234f1z5" },
      ],
    }),
    "09ABCDE1234F1Z5",
  );
});

test("resolveCustomerGstin returns empty string when missing", () => {
  assert.equal(resolveCustomerGstin({ metadata: [{ key: "foo", value: "bar" }] }), "");
  assert.equal(resolveCustomerGstin(null), "");
  assert.equal(resolveCustomerGstin(undefined), "");
});
