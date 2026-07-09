const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const MAGIC_MEDIA_NAME_PREFIX = "bymagic-media-daikcell-india";

export const createMediaToken = (length = 10) => {
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return token;
};

/**
 * Build cleaned Magic Media filename.
 * Always: bymagic-media-daikcell-india-{uniqueId}.webp
 * Original upload names are never used in the stored filename.
 */
export const buildMagicMediaFileName = (token?: string) => {
  const id = token || createMediaToken();
  return {
    id,
    fileName: `${MAGIC_MEDIA_NAME_PREFIX}-${id}.webp`,
  };
};

export const isMagicMediaFileName = (fileName: string) =>
  new RegExp(`^${MAGIC_MEDIA_NAME_PREFIX}-[a-z0-9]+\\.webp$`, "i").test(fileName);
