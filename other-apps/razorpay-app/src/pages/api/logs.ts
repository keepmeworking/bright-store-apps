/**
 * Transaction Logs API
 *
 * GET — Returns paginated transaction logs with optional filters
 */

import { type NextApiRequest, type NextApiResponse } from "next";
import { createProtectedHandler } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import { getTransactionLogs, type TransactionType } from "@/modules/transaction-log";
import { getDocClient } from "@/modules/dynamodb-helpers";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: { authData: { saleorApiUrl: string } }
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const saleorApiUrl = ctx.authData.saleorApiUrl;
  const docClient = getDocClient();

  if (!docClient) {
    return res.status(500).json({
      error: "DynamoDB not configured",
    });
  }

  try {
    const { limit, cursor, type } = req.query;

    const parsedLimit = limit ? parseInt(limit as string, 10) : 25;
    const parsedCursor = cursor
      ? JSON.parse(Buffer.from(cursor as string, "base64").toString("utf-8"))
      : undefined;

    const result = await getTransactionLogs(docClient, saleorApiUrl, {
      limit: Math.min(parsedLimit, 100), // max 100 per page
      startKey: parsedCursor,
      type: type as TransactionType | undefined,
    });

    return res.status(200).json({
      logs: result.logs,
      count: result.count,
      nextCursor: result.nextKey
        ? Buffer.from(JSON.stringify(result.nextKey)).toString("base64")
        : null,
    });
  } catch (error) {
    console.error("Failed to fetch logs:", error);
    return res.status(500).json({ error: "Failed to fetch transaction logs" });
  }
}

export default createProtectedHandler(handler, saleorApp.apl, ["MANAGE_APPS"]);
