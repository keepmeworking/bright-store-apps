import type { NextApiRequest, NextApiResponse } from "next";
import { getErrorMessage, getErrorStatus, requireMediaAuth } from "@/lib/magic-media-api";
import { removeMagicMediaItem, updateMagicMediaItem } from "@/lib/magic-media-catalog";

type PatchBody = {
  id?: string;
  alt?: string;
  displayName?: string;
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
        displayName: body.displayName,
      });
      return res.status(200).json({ item });
    }

    if (req.method === "DELETE") {
      const idFromQuery = typeof req.query.id === "string" ? req.query.id : "";
      const idFromBody = typeof (req.body as { id?: string } | undefined)?.id === "string"
        ? (req.body as { id: string }).id
        : "";
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
