import { NextApiRequest, NextApiResponse } from "next";
import { normalizeSaleorApiUrl } from "@/lib/saleor-api-url";
import {
  createReviewImportJob,
  listReviewImportJobs,
  startReviewImportWorker,
  type ReviewImportPreparedRow,
} from "@/lib/review-import-jobs";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

const parseNumber = (value: string | string[] | undefined, fallback: number) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    startReviewImportWorker();
    const page = parseNumber(req.query.page, 1);
    const pageSize = parseNumber(req.query.pageSize, 10);
    const data = await listReviewImportJobs(page, pageSize);
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Missing authorization token" });
    }

    const saleorApiUrl = normalizeSaleorApiUrl(req.body?.saleorApiUrl || "");
    if (!saleorApiUrl) {
      return res.status(400).json({ message: "Missing saleorApiUrl in body" });
    }

    const rows = (req.body?.rows || []) as ReviewImportPreparedRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "Missing import rows" });
    }

    const pageTypeId = req.body?.pageTypeId as string;
    if (!pageTypeId) {
      return res.status(400).json({ message: "Missing pageTypeId" });
    }

    const reviewAttrIds = req.body?.reviewAttrIds || {};
    const productIdentifier = req.body?.productIdentifier === "product_id" ? "product_id" : "product_handle";
    const fileName = (req.body?.fileName as string) || "reviews-upload";

    const job = await createReviewImportJob({
      token,
      saleorApiUrl,
      fileName,
      pageTypeId,
      reviewAttrIds,
      productIdentifier,
      rows,
    });

    startReviewImportWorker();
    return res.status(200).json({ job });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
