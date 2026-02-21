import { NextApiRequest, NextApiResponse } from "next";
import { getSetupOpsJob, startSetupOpsWorker } from "@/lib/setup-ops-jobs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawId = req.query.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) {
    return res.status(400).json({ message: "Missing job id" });
  }

  startSetupOpsWorker();
  const job = await getSetupOpsJob(id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  return res.status(200).json({ job });
}

