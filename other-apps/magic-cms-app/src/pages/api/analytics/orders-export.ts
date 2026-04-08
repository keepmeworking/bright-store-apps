import { NextApiRequest, NextApiResponse } from "next";
import * as XLSX from "xlsx";
import type { OperationResult } from "urql";
import {
  GetOrdersExportPageDocument,
  OrderStatusFilter,
  type GetOrdersExportPageQuery,
  type GetOrdersExportPageQueryVariables,
} from "../../../../generated/graphql";
import { createClient as createSafeGraphQLClient } from "@/lib/create-graphql-client";
import { normalizeSaleorApiUrl } from "@/lib/saleor-api-url";

type ExportFormat = "csv" | "xlsx";

type ExportBody = {
  saleorApiUrl?: string;
  channelId?: string;
  startDate?: string;
  endDate?: string;
  format?: ExportFormat;
};

type ExportRow = {
  "Order Number": string;
  "Order ID": string;
  "Created At": string;
  "Order Status": string;
  "Charge Status": string;
  "Payment Status": string;
  "Channel Name": string;
  "Channel Slug": string;
  Currency: string;
  "Customer Name": string;
  "Customer Email": string;
  "Customer Phone": string;
  "Billing Name": string;
  "Billing Phone": string;
  "Billing Address": string;
  "Shipping Name": string;
  "Shipping Phone": string;
  "Shipping Address": string;
  "Line Items": string;
  "Subtotal Amount": number;
  "Shipping Amount": number;
  "Total Amount": number;
  "Customer Note": string;
};

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_ORDERS = 10_000;
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

const PHONE_COLUMN_KEYS = ["Customer Phone", "Billing Phone", "Shipping Phone"] as const;

const parseToken = (authorizationHeader?: string) => {
  const authHeader = (authorizationHeader || "").trim();
  if (!authHeader) {
    return "";
  }
  const authParts = authHeader.split(/\s+/);
  return authParts.length === 2 ? authParts[1] : authHeader;
};

const toCompactMessage = (message: string) => {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "Unable to export orders.";
  if (normalized.includes("returned HTML") || normalized.includes("DOCTYPE html")) {
    return "Saleor returned non-JSON response. Check API URL (/graphql/) and refresh auth token.";
  }
  return normalized.length > 260 ? `${normalized.slice(0, 257)}...` : normalized;
};

const normalizeDate = (value: string, boundary: "start" | "end") => {
  if (!value) {
    return "";
  }
  return value;
};

const buildFileName = ({
  channelSlug,
  startDate,
  endDate,
  format,
}: {
  channelSlug: string;
  startDate: string;
  endDate: string;
  format: ExportFormat;
}) => {
  const safeChannel = (channelSlug || "all-channels").replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
  return `orders-export-${safeChannel}-${startDate}-to-${endDate}.${format}`;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const token = parseToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: "Missing authorization token" });
  }

  const body = (req.body || {}) as ExportBody;
  const saleorApiUrl = normalizeSaleorApiUrl(body.saleorApiUrl || "");
  const channelId = (body.channelId || "").trim();
  const startDate = (body.startDate || "").trim();
  const endDate = (body.endDate || "").trim();
  const format = body.format === "xlsx" ? "xlsx" : "csv";

  if (!saleorApiUrl || !channelId || !startDate || !endDate) {
    return res.status(400).json({ message: "Missing saleorApiUrl, channelId, startDate, or endDate" });
  }

  const client = createSafeGraphQLClient(saleorApiUrl, () => token);
  const rows: ExportRow[] = [];
  let after: string | null = null;
  let totalCount = 0;

  while (rows.length < MAX_EXPORT_ORDERS) {
    const result: OperationResult<GetOrdersExportPageQuery, GetOrdersExportPageQueryVariables> = await client
      .query<GetOrdersExportPageQuery, GetOrdersExportPageQueryVariables>(GetOrdersExportPageDocument, {
        createdAfter: normalizeDate(startDate, "start"),
        createdBefore: normalizeDate(endDate, "end"),
        channels: [channelId],
        first: EXPORT_PAGE_SIZE,
        after,
        status: COMPLETED_ORDER_STATUSES,
      })
      .toPromise();

    if (result.error) {
      return res.status(400).json({ message: toCompactMessage(result.error.message || "") });
    }

    const connection: GetOrdersExportPageQuery["orders"] = result.data?.orders;
    if (!connection) {
      break;
    }

    totalCount = connection.totalCount || 0;
    const edges = connection.edges || [];
    if (edges.length === 0) {
      break;
    }

    for (const edge of edges) {
      const order = edge.node;
      rows.push({
        "Order Number": order.number,
        "Order ID": order.id,
        "Created At": order.created,
        "Order Status": order.statusDisplay || order.status,
        "Charge Status": order.chargeStatus,
        "Payment Status": order.paymentStatus,
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
        "Customer Phone":
          order.billingAddress?.phone || order.shippingAddress?.phone || "",
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
        "Line Items": formatLineItems(order.lines),
        "Subtotal Amount": order.subtotal.gross.amount,
        "Shipping Amount": order.shippingPrice.gross.amount,
        "Total Amount": order.total.gross.amount,
        "Customer Note": order.customerNote || "",
      });

      if (rows.length >= MAX_EXPORT_ORDERS) {
        break;
      }
    }

    if (!connection.pageInfo.hasNextPage || rows.length >= MAX_EXPORT_ORDERS) {
      break;
    }

    after = connection.pageInfo.endCursor || null;
    if (!after) {
      break;
    }
  }

  if (totalCount > MAX_EXPORT_ORDERS) {
    return res.status(413).json({
      message: `This export matches ${totalCount} orders. Please narrow the date range or channel to keep exports under ${MAX_EXPORT_ORDERS} orders.`,
    });
  }

  const csvRowsData = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "number" ? value : sanitizeCsvValue(value),
      ]),
    ),
  );

  const fileName = buildFileName({
    channelSlug: rows[0]?.["Channel Slug"] || channelId,
    startDate,
    endDate,
    format,
  });

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const columnWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch:
        key === "Line Items"
          ? 60
          : Math.min(
              36,
              Math.max(
                key.length + 2,
                ...rows.map((row) => String(row[key as keyof typeof row] ?? "").slice(0, 80).length + 2),
              ),
            ),
    }));
    worksheet["!cols"] = columnWidths;
    const headers = Object.keys(rows[0] || {});
    PHONE_COLUMN_KEYS.forEach((columnKey) => {
      const columnIndex = headers.indexOf(columnKey);
      if (columnIndex === -1) {
        return;
      }

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const cellAddress = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex + 1 });
        const cell = worksheet[cellAddress];
        if (!cell) {
          continue;
        }

        cell.t = "s";
        cell.z = "@";
      }
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    return res.status(200).send(buffer);
  }

  const headers = Object.keys(rows[0] || {
    "Order Number": "",
    "Order ID": "",
    "Created At": "",
    "Order Status": "",
    "Charge Status": "",
    "Payment Status": "",
    "Channel Name": "",
    "Channel Slug": "",
    Currency: "",
    "Customer Name": "",
    "Customer Email": "",
    "Customer Phone": "",
    "Billing Name": "",
    "Billing Phone": "",
    "Billing Address": "",
    "Shipping Name": "",
    "Shipping Phone": "",
    "Shipping Address": "",
    "Line Items": "",
    "Subtotal Amount": "",
    "Shipping Amount": "",
    "Total Amount": "",
    "Customer Note": "",
  });
  const csvHeader = headers.map((column) => toCsvCell(column)).join(",");
  const csvRows = csvRowsData.map((row) =>
    headers.map((column) => toCsvCell(row[column as keyof typeof row] ?? "")).join(","),
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
  return res.status(200).send([csvHeader, ...csvRows].join("\n"));
}
