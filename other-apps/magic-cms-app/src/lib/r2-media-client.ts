import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "@/env";

export type MediaStorageConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  customDomain: string;
  catalogKey: string;
  uploadPrefix: string;
};

export const getMediaStorageConfig = (): MediaStorageConfig => {
  const bucket = env.MEDIA_BUCKET_NAME?.trim() || "";
  const endpoint = env.MEDIA_S3_ENDPOINT_URL?.trim() || "";
  const region = env.MEDIA_S3_REGION_NAME?.trim() || "auto";
  const accessKeyId = env.MEDIA_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = env.MEDIA_SECRET_ACCESS_KEY?.trim() || "";
  const customDomain = (env.MEDIA_CUSTOM_DOMAIN?.trim() || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const catalogKey = env.MAGIC_MEDIA_CATALOG_KEY?.trim() || "magic-media/magic-media.json";
  const uploadPrefix = (env.MAGIC_MEDIA_UPLOAD_PREFIX?.trim() || "file_upload/").replace(/^\/+/, "");

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey || !customDomain) {
    throw new Error(
      "Media storage is not configured. Set MEDIA_BUCKET_NAME, MEDIA_S3_ENDPOINT_URL, MEDIA_ACCESS_KEY_ID, MEDIA_SECRET_ACCESS_KEY, MEDIA_CUSTOM_DOMAIN.",
    );
  }

  return {
    bucket,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    customDomain,
    catalogKey,
    uploadPrefix: uploadPrefix.endsWith("/") ? uploadPrefix : `${uploadPrefix}/`,
  };
};

let cachedClient: S3Client | null = null;
let cachedConfigKey = "";

export const getMediaS3Client = (config = getMediaStorageConfig()) => {
  const key = `${config.endpoint}|${config.region}|${config.accessKeyId}|${config.bucket}`;
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }
  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
  cachedConfigKey = key;
  return cachedClient;
};

export const buildPublicMediaUrl = (fileName: string, config = getMediaStorageConfig()) =>
  `https://${config.customDomain}/${config.uploadPrefix}${fileName}`;

export const buildObjectKeyForFileName = (fileName: string, config = getMediaStorageConfig()) =>
  `${config.uploadPrefix}${fileName}`;

const streamToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export const getObjectBuffer = async (key: string, config = getMediaStorageConfig()) => {
  const client = getMediaS3Client(config);
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
    return await streamToBuffer(result.Body);
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    const code = error?.name || error?.Code;
    if (status === 404 || code === "NoSuchKey" || code === "NotFound") {
      return null;
    }
    throw error;
  }
};

export const putObjectBuffer = async (input: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}, config = getMediaStorageConfig()) => {
  const client = getMediaS3Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl || "public, max-age=31536000, immutable",
    }),
  );
};

export const deleteObjectKey = async (key: string, config = getMediaStorageConfig()) => {
  const client = getMediaS3Client(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
};

export const copyObjectKey = async (fromKey: string, toKey: string, config = getMediaStorageConfig()) => {
  const client = getMediaS3Client(config);
  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      CopySource: `${config.bucket}/${fromKey}`,
      Key: toKey,
    }),
  );
};
