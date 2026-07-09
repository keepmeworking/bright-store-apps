import sharp from "sharp";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/jpg"]);

const MAX_INPUT_BYTES = 12 * 1024 * 1024; // 12MB
const MAX_EDGE_PX = 4096;

export type ConvertedMagicMediaImage = {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
};

export const assertAllowedImageUpload = (input: { mimeType?: string; sizeBytes: number; fileName?: string }) => {
  const mime = (input.mimeType || "").toLowerCase();
  const byExt = (input.fileName || "").toLowerCase().match(/\.(jpe?g|png|webp|gif)$/);
  if (!ALLOWED_MIME.has(mime) && !byExt) {
    throw new Error("Only image uploads are allowed (JPG, PNG, WebP, GIF).");
  }
  if (input.sizeBytes <= 0) {
    throw new Error("Empty file.");
  }
  if (input.sizeBytes > MAX_INPUT_BYTES) {
    throw new Error("Image is too large (max 12MB).");
  }
};

/**
 * Compress and convert to WebP at high quality without visible quality loss.
 * Keeps original dimensions unless longer edge exceeds MAX_EDGE_PX.
 */
export const convertImageToWebp = async (input: Buffer): Promise<ConvertedMagicMediaImage> => {
  const image = sharp(input, { failOn: "none", animated: false });
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  let pipeline = image.rotate();
  if (width > MAX_EDGE_PX || height > MAX_EDGE_PX) {
    pipeline = pipeline.resize({
      width: MAX_EDGE_PX,
      height: MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const buffer = await pipeline
    .webp({
      quality: 90,
      alphaQuality: 100,
      smartSubsample: true,
      effort: 4,
    })
    .toBuffer();

  const outMeta = await sharp(buffer).metadata();

  return {
    buffer,
    contentType: "image/webp",
    width: outMeta.width || width,
    height: outMeta.height || height,
    sizeBytes: buffer.byteLength,
  };
};
