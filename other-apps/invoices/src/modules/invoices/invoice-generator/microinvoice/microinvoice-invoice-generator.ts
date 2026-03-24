import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { OrderPayloadFragment } from "../../../../../generated/graphql";
import { AddressV2Shape } from "../../../app-configuration/schema-v2/app-config-schema.v2";
import { InvoiceGenerator } from "../invoice-generator";

type PdfDocument = InstanceType<typeof PDFDocument>;

type InvoiceRow = {
  serial: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  marginX: 42,
  marginTop: 36,
  marginBottom: 36,
} as const;

const COLORS = {
  text: "#111111",
  muted: "#666666",
  border: "#D7D7D7",
  headerFill: "#F5F5F5",
} as const;

const TABLE = {
  serial: 44,
  description: 258,
  quantity: 56,
  unitPrice: 88,
  amount: 88,
  rowPaddingX: 8,
  rowPaddingY: 8,
} as const;

const DEFAULT_SIGNATURE_NAME = "Authorised Signatory";

function toSingleLine(value?: string | null) {
  return (value || "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value: string | Date, locale: string) {
  return Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoney(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ` ${currency}`;
}

function compactAddressLines(lines: Array<string | null | undefined>) {
  return lines.map((line) => toSingleLine(line)).filter(Boolean);
}

function wrapDescription(value: string, maxCharsPerLine = 34, maxLines = 5) {
  const words = toSingleLine(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  const trimmed = lines.slice(0, maxLines);
  const lastIndex = trimmed.length - 1;
  trimmed[lastIndex] = trimmed[lastIndex].length > maxCharsPerLine - 3
    ? `${trimmed[lastIndex].slice(0, maxCharsPerLine - 3)}...`
    : `${trimmed[lastIndex]}...`;

  return trimmed.join("\n");
}

function drawTextBlock(
  doc: PdfDocument,
  heading: string,
  lines: string[],
  x: number,
  y: number,
  width: number,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.text)
    .text(heading, x, y, { width });

  let cursorY = y + 18;

  doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted);
  for (const line of lines) {
    doc.text(line, x, cursorY, {
      width,
      lineGap: 2,
    });
    cursorY = doc.y + 2;
  }

  return Math.max(cursorY, y + 18);
}

function drawMetaList(
  doc: PdfDocument,
  rows: Array<{ label: string; value: string }>,
  x: number,
  y: number,
  width: number,
) {
  const labelWidth = 78;
  let cursorY = y;

  rows.forEach(({ label, value }) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text).text(label, x, cursorY, {
      width: labelWidth,
      align: "left",
    });

    doc.font("Helvetica").fontSize(10).fillColor(COLORS.text).text(value, x + labelWidth, cursorY, {
      width: width - labelWidth,
      align: "right",
    });

    cursorY += 22;
  });

  return cursorY;
}

function drawTableHeader(doc: PdfDocument, startX: number, startY: number) {
  const headers = ["Sr.", "Description", "Qty", "Unit Price", "Amount"];
  const widths = [TABLE.serial, TABLE.description, TABLE.quantity, TABLE.unitPrice, TABLE.amount];

  let x = startX;
  doc.save();
  widths.forEach((width, index) => {
    doc.rect(x, startY, width, 28).fillAndStroke(COLORS.headerFill, COLORS.border);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(headers[index], x + TABLE.rowPaddingX, startY + 8, {
        width: width - TABLE.rowPaddingX * 2,
        align: index === 1 ? "left" : "center",
      });
    x += width;
  });
  doc.restore();
}

function drawTableRow(doc: PdfDocument, row: InvoiceRow, startX: number, startY: number) {
  const widths = [TABLE.serial, TABLE.description, TABLE.quantity, TABLE.unitPrice, TABLE.amount];
  const values = [row.serial, row.description, row.quantity, row.unitPrice, row.amount];
  const aligns: Array<"left" | "center" | "right"> = ["center", "left", "center", "right", "right"];

  const descHeight = doc.heightOfString(row.description, {
    width: TABLE.description - TABLE.rowPaddingX * 2,
    lineGap: 2,
  });
  const rowHeight = Math.max(32, descHeight + TABLE.rowPaddingY * 2);

  let x = startX;
  doc.save();
  widths.forEach((width, index) => {
    doc.rect(x, startY, width, rowHeight).stroke(COLORS.border);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text(values[index], x + TABLE.rowPaddingX, startY + TABLE.rowPaddingY, {
        width: width - TABLE.rowPaddingX * 2,
        align: aligns[index],
        lineGap: 2,
      });
    x += width;
  });
  doc.restore();

  return rowHeight;
}

function drawSummaryBox(
  doc: PdfDocument,
  rows: Array<{ label: string; value: string; bold?: boolean; tall?: boolean }>,
  x: number,
  y: number,
  labelWidth: number,
  valueWidth: number,
) {
  let cursorY = y;
  const totalWidth = labelWidth + valueWidth;
  const fitFontSize = (text: string, preferred: number, min: number, width: number, font: string) => {
    let size = preferred;

    while (size > min) {
      doc.font(font).fontSize(size);
      if (doc.widthOfString(text) <= width) {
        return size;
      }
      size -= 0.5;
    }

    return min;
  };

  rows.forEach((row) => {
    const rowHeight = row.tall ? 34 : 24;
    const labelFont = row.tall ? 14 : 10;
    const valueFont = row.tall
      ? fitFontSize(row.value, 14, 10, valueWidth - 20, row.bold ? "Helvetica-Bold" : "Helvetica")
      : 10;

    doc.rect(x, cursorY, labelWidth, rowHeight).stroke(COLORS.border);
    doc.rect(x + labelWidth, cursorY, valueWidth, rowHeight).stroke(COLORS.border);
    doc
      .font(row.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(labelFont)
      .fillColor(COLORS.text)
      .text(row.label, x + 10, cursorY + (row.tall ? 9 : 7), {
        width: labelWidth - 20,
        align: "left",
      });
    doc
      .font(row.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(valueFont)
      .fillColor(COLORS.text)
      .text(row.value, x + labelWidth + 10, cursorY + (row.tall ? 10 : 7), {
        width: valueWidth - 20,
        align: "right",
      });
    cursorY += rowHeight;
  });

  doc.moveTo(x, y).lineTo(x + totalWidth, y).stroke(COLORS.border);

  return cursorY;
}

export class MicroinvoiceInvoiceGenerator implements InvoiceGenerator {
  constructor(
    private settings = {
      locale: "en-US",
    },
  ) {}

  async generate(input: {
    order: OrderPayloadFragment;
    invoiceNumber: string;
    filename: string;
    companyAddressData: AddressV2Shape;
  }): Promise<void> {
    const { invoiceNumber, order, companyAddressData, filename } = input;

    const currency = order.total?.currency ?? "USD";
    const companyName = toSingleLine(companyAddressData.companyName) || "Daikcell";
    const billingAddress = order.billingAddress;
    const shippingAddress = order.shippingAddress ?? order.billingAddress;
    const billingName = toSingleLine(
      `${billingAddress?.firstName ?? ""} ${billingAddress?.lastName ?? ""}`,
    ) || "Customer";
    const shippingName = toSingleLine(
      `${shippingAddress?.firstName ?? ""} ${shippingAddress?.lastName ?? ""}`,
    ) || billingName;

    const sellerLines = compactAddressLines([
      companyAddressData.companyName,
      companyAddressData.streetAddress1,
      companyAddressData.streetAddress2,
      `${companyAddressData.city ?? ""}, ${companyAddressData.postalCode ?? ""}`,
      companyAddressData.country,
      companyAddressData.countryArea,
      companyAddressData.taxId ? `GSTIN: ${toSingleLine(companyAddressData.taxId)}` : undefined,
      companyAddressData.phone ? `Phone: ${toSingleLine(companyAddressData.phone)}` : undefined,
      companyAddressData.email ? `Email: ${toSingleLine(companyAddressData.email)}` : undefined,
    ]);

    const customerLines = compactAddressLines([
      billingName,
      billingAddress?.companyName,
      billingAddress?.streetAddress1,
      billingAddress?.streetAddress2,
      `${billingAddress?.city ?? ""}, ${billingAddress?.postalCode ?? ""}`,
      billingAddress?.country?.country,
      billingAddress?.phone,
    ]);

    const shippingLines = compactAddressLines([
      shippingName,
      shippingAddress?.companyName,
      shippingAddress?.streetAddress1,
      shippingAddress?.streetAddress2,
      `${shippingAddress?.city ?? ""}, ${shippingAddress?.postalCode ?? ""}`,
      shippingAddress?.country?.country,
      shippingAddress?.phone,
    ]);

    const rows: InvoiceRow[] = [
      ...(order.lines ?? []).map((line, index) => {
        const quantity = line.quantity || 0;
        const amount = line.totalPrice?.gross?.amount ?? 0;
        const unitPrice = quantity > 0 ? amount / quantity : amount;

        return {
          serial: String(index + 1),
          description: wrapDescription(
            [toSingleLine(line.productName), toSingleLine(line.variantName)].filter(Boolean).join(" - "),
          ),
          quantity: String(quantity),
          unitPrice: formatMoney(unitPrice, currency, this.settings.locale),
          amount: formatMoney(amount, currency, this.settings.locale),
        };
      }),
      {
        serial: String((order.lines?.length ?? 0) + 1),
        description: wrapDescription(toSingleLine(order.shippingMethodName) || "Shipping"),
        quantity: "-",
        unitPrice: formatMoney(order.shippingPrice?.gross?.amount ?? 0, currency, this.settings.locale),
        amount: formatMoney(order.shippingPrice?.gross?.amount ?? 0, currency, this.settings.locale),
      },
    ];

    const subtotalAmount = (order.lines ?? []).reduce(
      (sum, line) => sum + (line.totalPrice?.gross?.amount ?? 0),
      0,
    );
    const shippingAmount = order.shippingPrice?.gross?.amount ?? 0;
    const totalAmount = order.total?.gross?.amount ?? 0;
    const taxAmount = order.total?.tax?.amount ?? 0;

    const logoPath = path.resolve(process.cwd(), "public/daikcell-light-logo.png");
    const signaturePath = path.resolve(process.cwd(), "public/signature-daikcell.png");
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
    });

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createWriteStream(filename);
      stream.on("finish", resolve);
      stream.on("error", reject);
      doc.pipe(stream);

      const left = PAGE.marginX;
      const pageWidth = PAGE.width - PAGE.marginX * 2;
      const metaWidth = 170;
      const companyWidth = pageWidth - metaWidth - 24;

      let cursorY = PAGE.marginTop;

      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, left, cursorY, {
          width: 135,
          fit: [135, 42],
        });
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(24)
        .fillColor(COLORS.text)
        .text("INVOICE", PAGE.width - PAGE.marginX - 150, cursorY + 4, {
          width: 150,
          align: "right",
        });

      cursorY += 56;

      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor(COLORS.text)
        .text(companyName, left, cursorY, { width: companyWidth });

      doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted);
      sellerLines.slice(1).forEach((line) => {
        cursorY += 16;
        doc.text(line, left, cursorY, {
          width: companyWidth,
          lineGap: 2,
        });
      });

      const metaTop = PAGE.marginTop + 60;
      drawMetaList(
        doc,
        [
          { label: "Invoice #", value: invoiceNumber },
          { label: "Order #", value: order.number },
          { label: "Invoice Date", value: formatDate(order.created, this.settings.locale) },
          {
            label: "Status",
            value: toSingleLine(order.status).replace(/_/g, " "),
          },
        ],
        PAGE.width - PAGE.marginX - metaWidth,
        metaTop,
        metaWidth,
      );

      const sectionTop = Math.max(cursorY, metaTop + 72) + 34;
      const blockWidth = 190;
      const middleGap = 24;
      const customerBottom = drawTextBlock(doc, "Bill To", customerLines, left, sectionTop, blockWidth);
      const shippingBottom = drawTextBlock(
        doc,
        "Ship To",
        shippingLines,
        left + blockWidth + middleGap,
        sectionTop,
        blockWidth,
      );
      cursorY = Math.max(customerBottom, shippingBottom) + 22;

      const tableStartX = left;
      const tableWidth = TABLE.serial + TABLE.description + TABLE.quantity + TABLE.unitPrice + TABLE.amount;
      drawTableHeader(doc, tableStartX, cursorY);
      cursorY += 28;

      rows.forEach((row) => {
        const estimatedHeight = Math.max(
          32,
          doc.heightOfString(row.description, {
            width: TABLE.description - TABLE.rowPaddingX * 2,
            lineGap: 2,
          }) + TABLE.rowPaddingY * 2,
        );

        if (cursorY + estimatedHeight + 180 > PAGE.height - PAGE.marginBottom) {
          doc.addPage({ margin: 0, size: "A4" });
          cursorY = PAGE.marginTop;
          drawTableHeader(doc, tableStartX, cursorY);
          cursorY += 28;
        }

        cursorY += drawTableRow(doc, row, tableStartX, cursorY);
      });

      const summaryX = tableStartX + TABLE.serial + TABLE.description + TABLE.quantity;
      const summaryBottom = drawSummaryBox(
        doc,
        [
          { label: "Subtotal", value: formatMoney(subtotalAmount, currency, this.settings.locale) },
          { label: "Shipping", value: formatMoney(shippingAmount, currency, this.settings.locale) },
          { label: "Tax", value: formatMoney(taxAmount, currency, this.settings.locale) },
          { label: "TOTAL", value: formatMoney(totalAmount, currency, this.settings.locale), bold: true, tall: true },
        ],
        summaryX,
        cursorY,
        TABLE.unitPrice,
        TABLE.amount,
      );

      const declarationTop = summaryBottom + 26;
      const declarationWidth = pageWidth;
      const signatureBoxWidth = 220;
      const declarationBoxHeight = 120;

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(COLORS.text)
        .text("Declaration", left + 12, declarationTop + 12, {
          width: declarationWidth - 24,
        });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(
          "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
          left + 12,
          declarationTop + 32,
          {
            width: declarationWidth - signatureBoxWidth - 30,
            lineGap: 2,
          },
        );

      const signatureX = left + declarationWidth - signatureBoxWidth;
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(COLORS.text)
        .text(`For ${companyName}`, signatureX, declarationTop + 12, {
          width: signatureBoxWidth - 12,
          align: "right",
        });

      if (fs.existsSync(signaturePath)) {
        doc.image(signaturePath, signatureX + 55, declarationTop + 40, {
          fit: [150, 54],
          align: "right",
        });
      }

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(DEFAULT_SIGNATURE_NAME, signatureX, declarationTop + 100, {
          width: signatureBoxWidth - 12,
          align: "right",
        });

      doc
        .font("Helvetica-Oblique")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text("This is a computer generated invoice", left, declarationTop + declarationBoxHeight + 14, {
          width: declarationWidth,
          align: "center",
        });

      doc.end();
    });
  }
}
