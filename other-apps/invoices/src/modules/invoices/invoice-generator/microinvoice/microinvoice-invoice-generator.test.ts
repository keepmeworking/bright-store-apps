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
      { label: "Tax", value: "3,721.73 INR" },
      { label: "TOTAL", value: "24,398.00 INR", bold: true, tall: true },
    ]);
    expect(summaryRows.map((row: { label: string }) => row.label)).not.toContain("Goods Subtotal");
    expect(summaryRows.map((row: { label: string }) => row.label)).not.toContain("Additional Service");
  });

  it("reads customer gstin from billing address metadata", () => {
    expect(readGstinFromAddress(mockOrder.billingAddress)).toBe("07ABCDE1234F1Z5");
  });
});
