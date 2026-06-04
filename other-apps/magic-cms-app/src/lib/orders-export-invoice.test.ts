import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolveLastInvoiceUrl } from "./orders-export-invoice";

test("returns empty string when order has no invoices", () => {
  assert.equal(resolveLastInvoiceUrl([]), "");
  assert.equal(resolveLastInvoiceUrl(undefined), "");
});

test("returns empty string when invoices have no url", () => {
  assert.equal(
    resolveLastInvoiceUrl([
      {
        url: "",
        externalUrl: null,
        createdAt: "2026-01-01T10:00:00Z",
        updatedAt: "2026-01-01T10:00:00Z",
      },
    ]),
    "",
  );
});

test("returns the most recently created invoice url", () => {
  assert.equal(
    resolveLastInvoiceUrl([
      {
        url: "https://example.com/invoices/old.pdf",
        createdAt: "2026-01-01T10:00:00Z",
        updatedAt: "2026-01-01T10:00:00Z",
      },
      {
        url: "https://example.com/invoices/latest.pdf",
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T10:05:00Z",
      },
    ]),
    "https://example.com/invoices/latest.pdf",
  );
});

test("falls back to externalUrl when url is missing", () => {
  assert.equal(
    resolveLastInvoiceUrl([
      {
        url: null,
        externalUrl: "https://example.com/invoices/legacy.pdf",
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T10:00:00Z",
      },
    ]),
    "https://example.com/invoices/legacy.pdf",
  );
});

test("uses updatedAt as tie-breaker when createdAt matches", () => {
  assert.equal(
    resolveLastInvoiceUrl([
      {
        url: "https://example.com/invoices/a.pdf",
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T10:00:00Z",
      },
      {
        url: "https://example.com/invoices/b.pdf",
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T12:00:00Z",
      },
    ]),
    "https://example.com/invoices/b.pdf",
  );
});
