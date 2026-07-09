import sharp from "sharp";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/jpg"]);

const MAX_INPUT_BYTES = 12 * 1024 * 1024; // 12MB
const MAX_EDGE_PX = 2560;
const QUALITY_STEPS = [78, 70, 62, 55];

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

const encodeWebp = async (input: Buffer, quality: number) => {
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
      quality,
      alphaQuality: Math.min(100, quality + 10),
      smartSubsample: true,
      effort: 6,
    })
    .toBuffer();

  const outMeta = await sharp(buffer).metadata();
  return {
    buffer,
    contentType: "image/webp" as const,
    width: outMeta.width || width,
    height: outMeta.height || height,
    sizeBytes: buffer.byteLength,
  };
};

/**
 * Convert to WebP and keep the smallest candidate that stays visually strong.
 * Prefer output smaller than the original upload when possible.
 */
export const convertImageToWebp = async (input: Buffer): Promise<ConvertedMagicMediaImage> => {
  let best: ConvertedMagicMediaImage | null = null;

  for (const quality of QUALITY_STEPS) {
    const candidate = await encodeWebp(input, quality);
    if (!best || candidate.sizeBytes < best.sizeBytes) {
      best = candidate;
    }
    // Stop once we beat the original size (or get close enough on already-small files).
    if (candidate.sizeBytes <= input.byteLength) {
      return candidate;
    }
  }

  if (!best) {
    throw new Error("Unable to convert image.");
  }
  return best;
};
