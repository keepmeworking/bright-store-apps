import { afterEach, beforeEach, describe, it, expect } from "vitest";
import * as invoiceGeneratorModule from "./microinvoice-invoice-generator";
import { MicroinvoiceInvoiceGenerator } from "./microinvoice-invoice-generator";
import { readFile } from "fs/promises";
import { join } from "path";
import rimraf from "rimraf";
import { mockOrder } from "../../../../fixtures/mock-order";
import { getMockAddress } from "../../../../fixtures/mock-address";
import { readGstinFromAddress } from "../../gstin";

const dirToSet = process.env.TEMP_PDF_STORAGE_DIR as string;
const filePath = join(dirToSet || "_temp", "test-invoice.pdf");

const cleanup = () => rimraf.sync(filePath);

describe("MicroinvoiceInvoiceGenerator", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * For some reason it fails in Github Actions
   * @todo fixme
   */
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  it.runIf(process.env.CI !== "true")("Generates invoice file from Order", async () => {
    const instance = new MicroinvoiceInvoiceGenerator();

    await instance.generate({
      order: mockOrder,
      filename: filePath,
      invoiceNumber: "test-123/123",
      companyAddressData: getMockAddress(),
    });

    return expect(readFile(filePath)).resolves.toBeDefined();
  });

  it("splits selected installation into an additional service row", () => {
    const buildInvoiceRows = (invoiceGeneratorModule as any).buildInvoiceRows;
    const orderWithInstallation = {
      ...mockOrder,
      lines: [
        {
          ...mockOrder.lines[0],
          quantity: 2,
          totalPrice: {
            ...mockOrder.lines[0].totalPrice,
            gross: {
              amount: 10998,
              currency: "INR",
            },
          },
          metadata: [
            {
              key: "installation_label",
              value: "Installation: With installation (+499.00 INR)",
            },
          ],
        },
      ],
    };

    const result = buildInvoiceRows(orderWithInstallation, "INR", "en-US");

    expect(result.rows).toEqual([
      expect.objectContaining({
        serial: "1",
        quantity: "2",
        unitPrice: "5,000.00 INR",
        amount: "10,000.00 INR",
      }),
      expect.objectContaining({
        serial: "2",
        description: "Additional Service Cost - Installation",
        quantity: "2",
        unitPrice: "499.00 INR",
        amount: "998.00 INR",
      }),
      expect.objectContaining({
        serial: "3",
        description: "Free Shipping",
      }),
    ]);
    expect(result.goodsSubtotalAmount).toBe(10000);
    expect(result.additionalServiceAmount).toBe(998);
    expect(result.subtotalAmount).toBe(10998);
  });

  it("detects selected installation from variant attributes when metadata is missing", () => {
    const buildInvoiceRows = (invoiceGeneratorModule as any).buildInvoiceRows;
    const orderWithInstallationAttribute = {
      ...mockOrder,
      lines: [
        {
          ...mockOrder.lines[0],
          quantity: 1,
          totalPrice: {
            ...mockOrder.lines[0].totalPrice,
            gross: {
              amount: 5499,
              currency: "INR",
            },
          },
          variant: {
            attributes: [
              {
                attribute: {
                  slug: "installation",
                  name: "Installation",
                },
                values: [
                  {
                    slug: "yes",
                    name: "Yes",
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const result = buildInvoiceRows(orderWithInstallationAttribute, "INR", "en-US");

    expect(result.rows).toEqual([
      expect.objectContaining({
        serial: "1",
        unitPrice: "5,000.00 INR",
        amount: "5,000.00 INR",
      }),
      expect.objectContaining({
        serial: "2",
        description: "Additional Service Cost - Installation",
        unitPrice: "499.00 INR",
        amount: "499.00 INR",
      }),
      expect.objectContaining({
        serial: "3",
      }),
    ]);
  });

  it("keeps installation amount inside subtotal summary without a separate service breakdown", () => {
    const buildInvoiceRows = (invoiceGeneratorModule as any).buildInvoiceRows;
    const buildInvoiceSummaryRows = (invoiceGeneratorModule as any).buildInvoiceSummaryRows;
    const orderWithInstallation = {
      ...mockOrder,
      shippingMethodName: "Free Shipping rate",
      lines: [
        {
          ...mockOrder.lines[0],
          quantity: 1,
          totalPrice: {
            ...mockOrder.lines[0].totalPrice,
            gross: {
              amount: 24398,
              currency: "INR",
            },
          },
          metadata: [
            {
              key: "installation_label",
              value: "Installation: With installation (+₹499)",
            },
          ],
        },
      ],
      total: {
        ...mockOrder.total,
        gross: {
          amount: 24398,
          currency: "INR",
        },
        tax: {
          amount: 3721.73,
          currency: "INR",
        },
      },
    };
    const invoiceRows = buildInvoiceRows(orderWithInstallation, "INR", "en-US");

    const summaryRows = buildInvoiceSummaryRows(
      orderWithInstallation,
      invoiceRows,
      "INR",
      "en-US",
    );

    expect(summaryRows).toEqual([
      { label: "Subtotal", value: "24,398.00 INR" },
      { label: "Shipping", value: "0.00 INR" },
      { label: "Tax (18%)", value: "3,721.73 INR" },
      { label: "TOTAL", value: "24,398.00 INR", bold: true, tall: true },
    ]);
    expect(summaryRows.map((row: { label: string }) => row.label)).not.toContain("Goods Subtotal");
    expect(summaryRows.map((row: { label: string }) => row.label)).not.toContain("Additional Service");
  });

  it("adds metadata-only upgrade row and final total", () => {
    const buildInvoiceRows = (invoiceGeneratorModule as any).buildInvoiceRows;
    const buildInvoiceSummaryRows = (invoiceGeneratorModule as any).buildInvoiceSummaryRows;
    const orderWithMetadataUpgrade = {
      ...mockOrder,
      metadata: [
        { key: "is_upgraded", value: "true" },
        { key: "upgrade_amount", value: "43498" },
        { key: "upgrade_description", value: "Extra payment for larger capacity" },
      ],
      total: {
        ...mockOrder.total,
        gross: {
          amount: 100000,
          currency: "INR",
        },
      },
    };

    const invoiceRows = buildInvoiceRows(orderWithMetadataUpgrade, "INR", "en-US");
    const summaryRows = buildInvoiceSummaryRows(
      orderWithMetadataUpgrade,
      invoiceRows,
      "INR",
      "en-US",
    );

    expect(invoiceRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "Extra payment for larger capacity",
          quantity: "1",
          amount: "43,498.00 INR",
        }),
      ]),
    );
    expect(summaryRows.at(-1)).toEqual({
      label: "TOTAL",
      value: "143,498.00 INR",
      bold: true,
      tall: true,
    });
  });

  it("includes state and country in order address lines", () => {
    const buildOrderAddressLines = (invoiceGeneratorModule as any).buildOrderAddressLines;
    const lines = buildOrderAddressLines({
      streetAddress1: "AT - Jangalpur",
      city: "JAMTARA",
      postalCode: "815352",
      countryArea: "Jharkhand",
      country: { country: "India", code: "IN" },
      phone: "+919122414994",
    }, ["Mukesh BASKEY"]);

    expect(lines).toEqual([
      "Mukesh BASKEY",
      "AT - Jangalpur",
      "JAMTARA, 815352",
      "Jharkhand",
      "India",
      "+919122414994",
    ]);
  });

  it("reads customer gstin from billing address metadata", () => {
    expect(readGstinFromAddress(mockOrder.billingAddress)).toBe("07ABCDE1234F1Z5");
  });

  it("shows the shared line tax rate in the summary label", () => {
    const buildInvoiceRows = (invoiceGeneratorModule as any).buildInvoiceRows;
    const buildInvoiceSummaryRows = (invoiceGeneratorModule as any).buildInvoiceSummaryRows;

    const invoiceRows = buildInvoiceRows(mockOrder, "INR", "en-US");
    const summaryRows = buildInvoiceSummaryRows(mockOrder, invoiceRows, "INR", "en-US");

    expect(summaryRows.find((row: { label: string }) => row.label.startsWith("Tax"))).toEqual({
      label: "Tax (18%)",
      value: "7,626.81 INR",
    });
  });

  it("formats fractional tax rates without trailing zeros", () => {
    const formatTaxLabel = (invoiceGeneratorModule as any).formatTaxLabel;

    expect(formatTaxLabel(18)).toBe("Tax (18%)");
    expect(formatTaxLabel(18.5)).toBe("Tax (18.5%)");
    expect(formatTaxLabel(5.25)).toBe("Tax (5.25%)");
    expect(formatTaxLabel(0)).toBe("Tax");
    expect(formatTaxLabel(null)).toBe("Tax");
  });

  it("falls back to blended rate from totals when line rates are mixed", () => {
    const resolveTaxPercent = (invoiceGeneratorModule as any).resolveTaxPercent;
    const orderWithMixedRates = {
      ...mockOrder,
      total: {
        ...mockOrder.total,
        net: { amount: 1000, currency: "INR" },
        tax: { amount: 150, currency: "INR" },
      },
      lines: [
        { ...mockOrder.lines[0], quantity: 1, taxRate: 18 },
        { ...mockOrder.lines[0], quantity: 1, taxRate: 12 },
      ],
    };

    expect(resolveTaxPercent(orderWithMixedRates)).toBe(15);
  });

  it("falls back to plain Tax label when no tax data is available", () => {
    const resolveTaxPercent = (invoiceGeneratorModule as any).resolveTaxPercent;
    const orderWithoutRates = {
      ...mockOrder,
      total: {
        ...mockOrder.total,
        net: { amount: 0, currency: "INR" },
        tax: { amount: 0, currency: "INR" },
      },
      lines: [{ ...mockOrder.lines[0], taxRate: undefined as unknown as number }],
    };

    expect(resolveTaxPercent(orderWithoutRates)).toBeNull();
  });
});
