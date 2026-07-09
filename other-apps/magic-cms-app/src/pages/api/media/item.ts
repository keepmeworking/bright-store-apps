import type { NextApiRequest, NextApiResponse } from "next";
import { getErrorMessage, getErrorStatus, requireMediaAuth } from "@/lib/magic-media-api";
import { removeMagicMediaItem, removeMagicMediaItems, updateMagicMediaItem } from "@/lib/magic-media-catalog";

type PatchBody = {
  id?: string;
  alt?: string;
};

type DeleteBody = {
  id?: string;
  ids?: string[];
  action?: "bulk-delete";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    requireMediaAuth(req);

    if (req.method === "PATCH") {
      const body = (req.body || {}) as PatchBody;
      const id = (body.id || "").trim();
      if (!id) {
        return res.status(400).json({ message: "Missing media id." });
      }
      const item = await updateMagicMediaItem({
        id,
        alt: body.alt,
      });
      return res.status(200).json({ item });
    }

    if (req.method === "DELETE" || req.method === "POST") {
      const body = (req.body || {}) as DeleteBody;
      if (req.method === "POST" && body.action === "bulk-delete") {
        const bulkIds = Array.isArray(body.ids) ? body.ids : [];
        if (!bulkIds.length) {
          return res.status(400).json({ message: "Missing media ids." });
        }
        const result = await removeMagicMediaItems(bulkIds);
        return res.status(200).json(result);
      }

      const idFromQuery = typeof req.query.id === "string" ? req.query.id : "";
      const idFromBody = typeof body.id === "string" ? body.id : "";
      const id = (idFromQuery || idFromBody).trim();
      if (!id) {
        return res.status(400).json({ message: "Missing media id." });
      }
      const item = await removeMagicMediaItem(id);
      return res.status(200).json({ item });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    return res.status(getErrorStatus(error)).json({
      message: getErrorMessage(error, "Unable to update media."),
    });
  }
}
