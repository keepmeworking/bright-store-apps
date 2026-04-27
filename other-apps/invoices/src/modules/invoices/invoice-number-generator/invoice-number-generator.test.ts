import { describe, it, expect } from "vitest";
import { InvoiceNumberGenerationStrategy } from "./invoice-number-generator";

describe("InvoiceNumberGenerationStrategies", () => {
  describe("orderNumber strategy", () => {
    it("uses the Saleor order number as the invoice number", () => {
      const strategy = InvoiceNumberGenerationStrategy.orderNumber();

      expect(strategy({ number: "45224", created: new Date(2020, 5, 1).toISOString() })).toBe("45224");
    });
  });

  describe("localizedDate strategy", () => {
    it("Generates proper name for US locale", () => {
      const strategy = InvoiceNumberGenerationStrategy.localizedDate("en-US");

      /**
       * Javascript starts counting months from 0
       */
      expect(strategy({ created: new Date(2020, 5, 1).toISOString() })).toBe("6/1/2020");
    });
    it("Generates proper name for PL locale", () => {
      const strategy = InvoiceNumberGenerationStrategy.localizedDate("pl-PL");

      /**
       * Javascript starts counting months from 0
       */
      expect(strategy({ created: new Date(2020, 5, 1).toISOString() })).toBe("1.06.2020");
    });
  });
});
