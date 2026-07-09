import {
  buildObjectKeyForFileName,
  buildPublicMediaUrl,
  deleteObjectKey,
  getMediaStorageConfig,
  putObjectBuffer,
  type MediaStorageConfig,
} from "@/lib/r2-media-client";

export type MagicMediaItem = {
  id: string;
  fileName: string;
  url: string;
  alt: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};

export type MagicMediaCatalog = {
  version: 1;
  updatedAt: string;
  items: MagicMediaItem[];
};

const emptyCatalog = (): MagicMediaCatalog => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  items: [],
});

let catalogLock: Promise<void> = Promise.resolve();

const withCatalogLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = catalogLock;
  catalogLock = previous.then(() => next);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
};

export const readMagicMediaCatalog = async (
  config: MediaStorageConfig = getMediaStorageConfig(),
): Promise<MagicMediaCatalog> => {
  const buffer = await getObjectBuffer(config.catalogKey, config);
  if (!buffer || buffer.byteLength === 0) {
    return emptyCatalog();
  }
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as MagicMediaCatalog;
    if (!parsed || !Array.isArray(parsed.items)) {
      return emptyCatalog();
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      items: parsed.items.filter((item) => item && typeof item.id === "string" && typeof item.fileName === "string"),
    };
  } catch {
    return emptyCatalog();
  }
};

const writeMagicMediaCatalog = async (
  catalog: MagicMediaCatalog,
  config: MediaStorageConfig = getMediaStorageConfig(),
) => {
  const payload: MagicMediaCatalog = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: catalog.items,
  };
  await putObjectBuffer(
    {
      key: config.catalogKey,
      body: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      contentType: "application/json",
      cacheControl: "no-cache",
    },
    config,
  );
  return payload;
};

export const listMagicMediaPage = async (input: {
  page: number;
  pageSize: number;
}) => {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const pageSize = Math.min(48, Math.max(1, Math.floor(input.pageSize) || 20));
  const catalog = await readMagicMediaCatalog();
  const sorted = [...catalog.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
};

export const appendMagicMediaItem = async (input: {
  id: string;
  fileName: string;
  alt?: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}) =>
  withCatalogLock(async () => {
    const config = getMediaStorageConfig();
    const catalog = await readMagicMediaCatalog(config);
    const now = new Date().toISOString();
    const item: MagicMediaItem = {
      id: input.id,
      fileName: input.fileName,
      url: buildPublicMediaUrl(input.fileName, config),
      alt: (input.alt || "").trim(),
      originalName: input.originalName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      createdAt: now,
      updatedAt: now,
    };
    catalog.items = [item, ...catalog.items.filter((existing) => existing.id !== item.id)];
    await writeMagicMediaCatalog(catalog, config);
    return item;
  });

export const updateMagicMediaItem = async (input: {
  id: string;
  alt?: string;
}) =>
  withCatalogLock(async () => {
    const config = getMediaStorageConfig();
    const catalog = await readMagicMediaCatalog(config);
    const index = catalog.items.findIndex((item) => item.id === input.id);
    if (index < 0) {
      throw new Error("Media item not found.");
    }

    const current = catalog.items[index];
    const updated: MagicMediaItem = {
      ...current,
      alt: typeof input.alt === "string" ? input.alt.trim() : current.alt,
      updatedAt: new Date().toISOString(),
    };
    catalog.items[index] = updated;
    await writeMagicMediaCatalog(catalog, config);
    return updated;
  });

export const removeMagicMediaItem = async (id: string) =>
  withCatalogLock(async () => {
    const config = getMediaStorageConfig();
    const catalog = await readMagicMediaCatalog(config);
    const existing = catalog.items.find((item) => item.id === id);
    if (!existing) {
      throw new Error("Media item not found.");
    }
    await deleteObjectKey(buildObjectKeyForFileName(existing.fileName, config), config);
    catalog.items = catalog.items.filter((item) => item.id !== id);
    await writeMagicMediaCatalog(catalog, config);
    return existing;
  });
