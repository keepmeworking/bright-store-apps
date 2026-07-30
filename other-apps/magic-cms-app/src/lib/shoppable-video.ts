export const SH_VIDEO_ATTR_SLUGS = {
  videoFile: "magic-shoppable-video-file",
  thumbnail: "magic-shoppable-video-thumbnail",
  products: "magic-shoppable-products",
  fileInfo: "magic-shoppable-file-info",
  widgetName: "magic-shoppable-widget-name",
  widgetVideoRefs: "magic-shoppable-video-refs",
  widgetViewBy: "magic-shoppable-view-by",
  legacyVideoFile: "magic-media",
  legacyProducts: "magic-linked-products",
  legacyDisplayRules: "magic-display-rules",
} as const;

export const SHOPPABLE_VIEW_BY_OPTIONS = ["carousel", "auto-grid"] as const;
export type ShoppableViewBy = (typeof SHOPPABLE_VIEW_BY_OPTIONS)[number];

export const normalizeShoppableViewBy = (raw: string | null | undefined): ShoppableViewBy => {
  const value = (raw || "").trim().toLowerCase();
  return value === "auto-grid" ? "auto-grid" : "carousel";
};

/** Fixed Saleor page slugs for Home + PDP shoppable carousels (never deletable). */
export const SHOPPABLE_CORE_WIDGETS = [
  {
    role: "homepage" as const,
    slug: "magic-widget-shoppable-homepage",
    title: "Homepage Shoppable Videos",
    widgetName: "Homepage Shoppable Videos",
  },
  {
    role: "pdp" as const,
    slug: "magic-widget-shoppable-pdp",
    title: "PDP Shoppable Videos",
    widgetName: "PDP Shoppable Videos",
  },
] as const;

export const SHOPPABLE_CORE_WIDGET_SLUGS = SHOPPABLE_CORE_WIDGETS.map((widget) => widget.slug);

export const isCoreShoppableWidgetSlug = (slug: string | null | undefined) =>
  Boolean(slug && SHOPPABLE_CORE_WIDGET_SLUGS.includes(slug as (typeof SHOPPABLE_CORE_WIDGET_SLUGS)[number]));

export const getCoreShoppableWidgetBySlug = (slug: string | null | undefined) =>
  SHOPPABLE_CORE_WIDGETS.find((widget) => widget.slug === slug) || null;

export type ShoppableVideoFileInfo = {
  originalFileName: string;
  uploadedBy: string;
  uploadedAtIso: string;
  uploadedAtLabel: string;
  originalFileSizeBytes: number;
  optimizedFileSizeBytes: number;
  durationSeconds: number;
  contentType: string;
  width?: number;
  height?: number;
  optimizationMode: "lossless_passthrough";
};

type AttributeValue = {
  name?: string | null;
  value?: string | null;
  reference?: string | null;
  file?: { url: string; contentType?: string | null } | null;
};

type AttributeEntry = {
  attribute: { id: string; slug?: string | null };
  values: ReadonlyArray<AttributeValue>;
};

export type AttributedNode = {
  attributes: ReadonlyArray<AttributeEntry>;
};

export const getAttributeBySlug = (node: AttributedNode, slug: string) =>
  node.attributes.find((entry) => entry.attribute.slug === slug);

export const getFileUrlBySlug = (node: AttributedNode, slug: string) =>
  getAttributeBySlug(node, slug)?.values[0]?.file?.url || "";

export const getTextValueBySlug = (node: AttributedNode, slug: string) => {
  const first = getAttributeBySlug(node, slug)?.values[0];
  if (!first) return "";
  return first.value || first.name || "";
};

export const getReferenceValuesBySlug = (node: AttributedNode, slug: string) =>
  (getAttributeBySlug(node, slug)?.values || [])
    .map((value) => value.reference || "")
    .filter(Boolean);

/**
 * Build Saleor AttributeValueInput for PAGE/PRODUCT REFERENCE attributes.
 * Multi REFERENCE must always use `references` (even for 1 id). Singular `reference`
 * is only for SINGLE_REFERENCE — using it on multi REFERENCE silently drops the value.
 */
export const buildReferenceAttributeInput = (
  attributeId: string,
  referenceIds: string[],
  inputType?: string | null,
): { id: string; reference?: string; references?: string[]; values?: string[] } => {
  const refs = Array.from(new Set(referenceIds.filter(Boolean)));
  if (refs.length === 0) {
    return { id: attributeId, references: [] };
  }
  if (inputType === "SINGLE_REFERENCE") {
    return { id: attributeId, reference: refs[0] };
  }
  return { id: attributeId, references: refs };
};

export const parseFileInfo = (raw: string): ShoppableVideoFileInfo | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShoppableVideoFileInfo;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.originalFileName || !parsed.uploadedAtIso) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"] as const;
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const value = bytes / 1024 ** order;
  return `${value.toFixed(order === 0 ? 0 : 2)}${sizes[order]}`;
};

export const formatUtcUploadLabel = (date: Date) => {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} at ${hours}:${minutes} UTC`;
};

export const createVideoTitleFromFileName = (fileName: string) => {
  const base = fileName.replace(/\.[^/.]+$/, "");
  const normalized = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || "Shoppable Video";
};

export const createVideoSlugFromTitle = (title: string, seed: string) => {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `${normalized || "shoppable-video"}-${seed}`;
};
