import type { NextApiRequest, NextApiResponse } from "next";
import Busboy from "busboy";
import { getErrorMessage, getErrorStatus, requireMediaAuth } from "@/lib/magic-media-api";
import { assertAllowedImageUpload, convertImageToWebp } from "@/lib/magic-media-image";
import { buildMagicMediaFileName } from "@/lib/magic-media-name";
import { appendMagicMediaItem } from "@/lib/magic-media-catalog";
import {
  buildObjectKeyForFileName,
  getMediaStorageConfig,
  putObjectBuffer,
} from "@/lib/r2-media-client";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "15mb",
  },
};

type ParsedUpload = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  alt: string;
};

const parseMultipartUpload = (req: NextApiRequest): Promise<ParsedUpload> =>
  new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(Object.assign(new Error("Expected multipart/form-data upload."), { statusCode: 400 }));
      return;
    }

    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: { files: 1, fileSize: 12 * 1024 * 1024 },
    });

    let fileName = "";
    let mimeType = "";
    let alt = "";
    const chunks: Buffer[] = [];
    let fileSeen = false;
    let limited = false;

    busboy.on("file", (_name, file, info) => {
      fileSeen = true;
      fileName = info.filename || "image";
      mimeType = info.mimeType || "";
      file.on("data", (data: Buffer) => chunks.push(data));
      file.on("limit", () => {
        limited = true;
      });
    });

    busboy.on("field", (name, value) => {
      if (name === "alt") alt = String(value || "");
    });

    busboy.on("error", (error) => reject(error));
    busboy.on("finish", () => {
      if (limited) {
        reject(Object.assign(new Error("Image is too large (max 12MB)."), { statusCode: 400 }));
        return;
      }
      if (!fileSeen) {
        reject(Object.assign(new Error("No image file provided."), { statusCode: 400 }));
        return;
      }
      resolve({
        fileName,
        mimeType,
        buffer: Buffer.concat(chunks),
        alt,
      });
    });

    req.pipe(busboy);
  });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    requireMediaAuth(req);
    const parsed = await parseMultipartUpload(req);
    assertAllowedImageUpload({
      mimeType: parsed.mimeType,
      sizeBytes: parsed.buffer.byteLength,
      fileName: parsed.fileName,
    });

    const converted = await convertImageToWebp(parsed.buffer);
    const named = buildMagicMediaFileName(parsed.fileName);
    const config = getMediaStorageConfig();
    const objectKey = buildObjectKeyForFileName(named.fileName, config);

    await putObjectBuffer(
      {
        key: objectKey,
        body: converted.buffer,
        contentType: converted.contentType,
      },
      config,
    );

    const item = await appendMagicMediaItem({
      id: named.id,
      fileName: named.fileName,
      alt: parsed.alt,
      originalName: parsed.fileName,
      contentType: converted.contentType,
      sizeBytes: converted.sizeBytes,
      width: converted.width,
      height: converted.height,
    });

    return res.status(200).json({ item });
  } catch (error) {
    return res.status(getErrorStatus(error)).json({
      message: getErrorMessage(error, "Unable to upload media."),
    });
  }
}
