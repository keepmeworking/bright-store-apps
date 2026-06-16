import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OperationResult } from "urql";
import {
  GetOrdersExportPageDocument,
  OrderStatusFilter,
  type GetOrdersExportPageQuery,
  type GetOrdersExportPageQueryVariables,
} from "../generated/graphql.js";
import { createClient as createSafeGraphQLClient } from "../src/lib/create-graphql-client.ts";
import { resolveLastInvoiceUrl } from "../src/lib/orders-export-invoice.ts";
import { resolvePaymentId, resolvePaymentProvider } from "../src/lib/orders-export-payment.ts";
import {
  orderIsUpgraded,
  resolveChargeStatusDisplay,
  resolveFinalAmount,
  resolveUpgradeAmount,
  resolveUpgradeDescription,
  resolveUpgradePspReference,
} from "../src/lib/orders-export-upgrade.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ExportRow = Record<string, string | number>;

const EXPORT_PAGE_SIZE = 100;
const COMPLETED_ORDER_STATUSES: OrderStatusFilter[] = [
  OrderStatusFilter.Fulfilled,
  OrderStatusFilter.PartiallyFulfilled,
  OrderStatusFilter.ReadyToCapture,
  OrderStatusFilter.ReadyToFulfill,
  OrderStatusFilter.Unfulfilled,
];

const formatAddress = (
  address?:
    | {
        firstName?: string | null;
        lastName?: string | null;
        phone?: string | null;
        streetAddress1?: string | null;
        streetAddress2?: string | null;
        city?: string | null;
        postalCode?: string | null;
        country?: { country?: string | null; code?: string | null } | null;
      }
    | null,
) =>
  [
    [address?.firstName, address?.lastName].filter(Boolean).join(" ").trim(),
    address?.streetAddress1,
    address?.streetAddress2,
    address?.city,
    address?.postalCode,
    address?.country?.country || address?.country?.code,
  ]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");

const formatLineItems = (
  lines: NonNullable<
    NonNullable<NonNullable<GetOrdersExportPageQuery["orders"]>["edges"][number]>["node"]
  >["lines"],
) =>
  lines
    .map((line) => {
      const parts = [
        line.productName,
        line.variantName && line.variantName !== line.productName ? line.variantName : "",
        line.variant?.sku ? `SKU: ${line.variant.sku}` : "",
        `Qty: ${line.quantity}`,
        `Unit: ${line.unitPrice.gross.amount} ${line.unitPrice.gross.currency}`,
        `Line Total: ${line.totalPrice.gross.amount} ${line.totalPrice.gross.currency}`,
      ].filter(Boolean);

      return parts.join(" | ");
    })
    .join("\n");

const sanitizeCsvValue = (value: string | number) => {
  const normalized = String(value ?? "");
  return /^[=\-+@]/.test(normalized) ? `'${normalized}` : normalized;
};

const toCsvCell = (value: string | number) =>
  `"${sanitizeCsvValue(value).replace(/"/g, '""')}"`;

const saleorApiUrl = process.env.SALEOR_API_URL || "";
const token = process.env.SALEOR_TOKEN || "";
const channelId = process.env.CHANNEL_ID || "";
const startDate = process.env.START_DATE || "";
const endDate = process.env.END_DATE || "";
const outputPath = process.env.OUTPUT_PATH || path.join(__dirname, "../../../out/orders-export-last-5-days.csv");

if (!saleorApiUrl || !token || !channelId || !startDate || !endDate) {
  console.error(
    "Missing env: SALEOR_API_URL, SALEOR_TOKEN, CHANNEL_ID, START_DATE, END_DATE",
  );
  process.exit(1);
}

const client = createSafeGraphQLClient(saleorApiUrl, () => token);
const rows: ExportRow[] = [];
let after: string | null = null;

while (true) {
  const result: OperationResult<GetOrdersExportPageQuery, GetOrdersExportPageQueryVariables> =
    await client
      .query<GetOrdersExportPageQuery, GetOrdersExportPageQueryVariables>(
        GetOrdersExportPageDocument,
        {
          createdAfter: startDate,
          createdBefore: endDate,
          channels: [channelId],
          first: EXPORT_PAGE_SIZE,
          after,
          status: COMPLETED_ORDER_STATUSES,
        },
      )
      .toPromise();

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  const connection = result.data?.orders;
  if (!connection?.edges?.length) {
    break;
  }

  for (const edge of connection.edges) {
    const order = edge.node;
    rows.push({
      "Order Number": order.number,
      "Order ID": order.id,
      "Created At": order.created,
      "Order Status": order.statusDisplay || order.status,
      "Charge Status": resolveChargeStatusDisplay(order) || order.chargeStatus,
      "Payment Status": order.paymentStatus,
      "Payment Provider": resolvePaymentProvider(order),
      "Payment ID": resolvePaymentId(order),
      "Channel Name": order.channel.name,
      "Channel Slug": order.channel.slug,
      Currency: order.total.gross.currency || order.channel.currencyCode,
      "Customer Name":
        [order.billingAddress?.firstName, order.billingAddress?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim(),
      "Customer Email": order.userEmail || "",
      "Customer Phone": order.billingAddress?.phone || order.shippingAddress?.phone || "",
      "Billing Name":
        [order.billingAddress?.firstName, order.billingAddress?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim(),
      "Billing Phone": order.billingAddress?.phone || "",
      "Billing Address": formatAddress(order.billingAddress),
      "Shipping Name":
        [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim(),
      "Shipping Phone": order.shippingAddress?.phone || "",
      "Shipping Address": formatAddress(order.shippingAddress),
      "Shipping State": order.shippingAddress?.countryArea || "",
      "Shipping Pincode": order.shippingAddress?.postalCode || "",
      "Line Items": formatLineItems(order.lines),
      "Subtotal Amount": order.subtotal.gross.amount,
      "Shipping Amount": order.shippingPrice.gross.amount,
      "Total Amount": order.total.gross.amount,
      "Final Amount": resolveFinalAmount(order),
      "Is Upgrade Order": orderIsUpgraded(order) ? "Yes" : "No",
      "Upgrade Amount": orderIsUpgraded(order) ? resolveUpgradeAmount(order) : "",
      "Upgrade Description": orderIsUpgraded(order) ? resolveUpgradeDescription(order) : "",
      "Upgrade Payment Ref": orderIsUpgraded(order) ? resolveUpgradePspReference(order) : "",
      "Customer Note": order.customerNote || "",
      invoice_url: resolveLastInvoiceUrl(order.invoices),
    });
  }

  if (!connection.pageInfo.hasNextPage) {
    break;
  }

  after = connection.pageInfo.endCursor || null;
  if (!after) {
    break;
  }
}

const headers = Object.keys(rows[0] || { invoice_url: "" });
const csvHeader = headers.map((column) => toCsvCell(column)).join(",");
const csvRows = rows.map((row) =>
  headers.map((column) => toCsvCell(row[column] ?? "")).join(","),
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, [csvHeader, ...csvRows].join("\n"), "utf8");

console.log(
  JSON.stringify({
    outputPath,
    rowCount: rows.length,
    withInvoiceUrl: rows.filter((row) => row.invoice_url).length,
    startDate,
    endDate,
    channelId,
  }),
);
