import { NextApiRequest, NextApiResponse } from "next";
import { getSetupOpsSnapshot } from "@/lib/setup-ops-jobs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawId = req.query.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) {
    return res.status(400).json({ message: "Missing job id" });
  }

  const snapshot = await getSetupOpsSnapshot(id);
  if (!snapshot) {
    return res.status(404).json({ message: "Snapshot not found for this job" });
  }

  if (req.query.download === "1") {
    const fileName = `magic-cms-backup-${id}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(JSON.stringify(snapshot, null, 2));
  }

  return res.status(200).json({ snapshot });
}

