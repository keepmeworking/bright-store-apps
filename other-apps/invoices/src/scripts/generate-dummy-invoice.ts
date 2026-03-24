import { mkdir } from "fs/promises";
import { resolve, join } from "path";
import { getMockAddress } from "../fixtures/mock-address";
import { mockOrder } from "../fixtures/mock-order";
import { MicroinvoiceInvoiceGenerator } from "../modules/invoices/invoice-generator/microinvoice/microinvoice-invoice-generator";

const sanitizeFilenamePart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

async function main() {
  const outputDir = process.env.DUMMY_INVOICE_OUTPUT_DIR
    ? resolve(process.env.DUMMY_INVOICE_OUTPUT_DIR)
    : resolve(process.cwd(), "_temp");
  const invoiceNumber =
    process.env.DUMMY_INVOICE_NUMBER ?? `dummy-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const filename = join(outputDir, `${sanitizeFilenamePart(invoiceNumber)}.pdf`);

  await mkdir(outputDir, { recursive: true });

  await new MicroinvoiceInvoiceGenerator().generate({
    order: mockOrder,
    invoiceNumber,
    filename,
    companyAddressData: getMockAddress(),
  });

  // eslint-disable-next-line no-console
  console.log(`Dummy invoice generated: ${filename}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to generate dummy invoice", error);
  process.exit(1);
});
