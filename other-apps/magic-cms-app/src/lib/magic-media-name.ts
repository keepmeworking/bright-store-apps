const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const createMediaToken = (length = 8) => {
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return token;
};

/** Strip extension and produce a clean slug from a display/original name. */
export const slugifyMediaBaseName = (value: string) => {
  const withoutExt = value.replace(/\.[^.]+$/, "");
  const slug = withoutExt
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
  return slug || "image";
};

/**
 * Build Saleor-style cleaned filename.
 * Example: "My Photo (1).PNG" + token → "bymagic-media-my-photo-1_k9x2m1ab.webp"
 */
export const buildMagicMediaFileName = (originalOrDisplayName: string, token?: string) => {
  const id = token || createMediaToken();
  const slug = slugifyMediaBaseName(originalOrDisplayName);
  return {
    id,
    fileName: `bymagic-media-${slug}_${id}.webp`,
  };
};

export const isMagicMediaFileName = (fileName: string) =>
  /^bymagic-media-[a-z0-9-]+_[a-z0-9]+\.webp$/i.test(fileName);
