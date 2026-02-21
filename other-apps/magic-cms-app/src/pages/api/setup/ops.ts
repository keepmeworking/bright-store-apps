import { NextApiRequest, NextApiResponse } from "next";
import {
  createSetupOpsJob,
  listSetupOpsJobs,
  startSetupOpsWorker,
  type SetupOpsJobType,
} from "@/lib/setup-ops-jobs";
import { normalizeSaleorApiUrl } from "@/lib/saleor-api-url";

const parseNumber = (value: string | string[] | undefined, fallback: number) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAuthToken = (authorizationHeader?: string) => {
  const authHeader = (authorizationHeader || "").trim();
  if (!authHeader) {
    return "";
  }
  const authParts = authHeader.split(/\s+/);
  return authParts.length === 2 ? authParts[1] : authHeader;
};

const isSetupOpsType = (value: unknown): value is SetupOpsJobType =>
  value === "backup" || value === "restore" || value === "cleanup";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    startSetupOpsWorker();
    const page = parseNumber(req.query.page, 1);
    const pageSize = parseNumber(req.query.pageSize, 10);
    const data = await listSetupOpsJobs(page, pageSize);
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const token = normalizeAuthToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ message: "Missing authorization token" });
    }

    const saleorApiUrl = normalizeSaleorApiUrl(req.body?.saleorApiUrl || "");
    if (!saleorApiUrl) {
      return res.status(400).json({ message: "Missing saleorApiUrl in body" });
    }

    const type = req.body?.type;
    if (!isSetupOpsType(type)) {
      return res.status(400).json({ message: "Invalid type. Supported: backup | restore | cleanup" });
    }

    const job = await createSetupOpsJob({
      saleorApiUrl,
      token,
      type,
      dryRun: Boolean(req.body?.dryRun),
      snapshotJobId: typeof req.body?.snapshotJobId === "string" ? req.body.snapshotJobId : undefined,
    });

    startSetupOpsWorker();
    return res.status(200).json({ job });
  }

  return res.status(405).json({ message: "Method not allowed" });
}

