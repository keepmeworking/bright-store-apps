import type { NextApiRequest, NextApiResponse } from "next";
import { getErrorMessage, getErrorStatus, requireMediaAuth } from "@/lib/magic-media-api";
import { listMagicMediaPage } from "@/lib/magic-media-catalog";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    requireMediaAuth(req);
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const result = await listMagicMediaPage({ page, pageSize });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(getErrorStatus(error)).json({
      message: getErrorMessage(error, "Unable to list media."),
    });
  }
}
