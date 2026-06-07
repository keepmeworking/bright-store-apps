import { describe, expect, it } from "vitest";

import { formatCustomerGstinLine, readGstinFromAddress } from "./gstin";

describe("invoice gstin helpers", () => {
  it("reads gstin from billing address metadata", () => {
    expect(
      readGstinFromAddress({
        metadata: [{ key: "gstin", value: "09abcde1234f1z5" }],
      }),
    ).toBe("09ABCDE1234F1Z5");
  });

  it("returns empty string when gstin metadata is missing", () => {
    expect(readGstinFromAddress({ metadata: [{ key: "other", value: "x" }] })).toBe("");
  });

  it("formats customer gstin line for invoice pdf", () => {
    expect(formatCustomerGstinLine("09ABCDE1234F1Z5")).toBe("GSTIN: 09ABCDE1234F1Z5");
    expect(formatCustomerGstinLine("")).toBeUndefined();
  });
});
