import { NextApiRequest, NextApiResponse } from "next";
import { performSetup } from "@/lib/setup";
import { normalizeSaleorApiUrl } from "@/lib/saleor-api-url";
import { createClient as createSafeGraphQLClient } from "@/lib/create-graphql-client";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const authHeader = (req.headers.authorization || "").trim();
  const authParts = authHeader.split(/\s+/);
  const token = authParts.length === 2 ? authParts[1] : authHeader;
  
  if (!token) {
    return res.status(401).json({ message: "Missing authorization token" });
  }

  const saleorApiUrl = req.body.saleorApiUrl;
  const dryRun = Boolean(req.body?.dryRun);
  const cleanup = req.body?.cleanup !== false;
  if (!saleorApiUrl) {
    return res.status(400).json({ message: "Missing saleorApiUrl in body" });
  }
  const normalizedSaleorApiUrl = normalizeSaleorApiUrl(saleorApiUrl);

  const client = createSafeGraphQLClient(normalizedSaleorApiUrl, () => token);

  try {
    const result = await performSetup(client, { dryRun, cleanup });
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Setup error:", error);
    return res.status(500).json({ message: error.message || "Internal Service Error" });
  }
}
