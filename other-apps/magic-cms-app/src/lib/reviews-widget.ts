export const REVIEW_WIDGET_ATTR_SLUGS = {
  widgetName: "magic-review-widget-name",
  reviewRefs: "magic-review-refs",
  location: "magic-location",
  images: "magic-review-images",
  videos: "magic-review-videos",
  media: "magic-media",
} as const;

/** Fixed Saleor page slug for homepage curated reviews (never deletable). */
export const REVIEWS_CORE_WIDGETS = [
  {
    role: "homepage" as const,
    slug: "magic-widget-reviews-homepage",
    title: "Homepage Reviews",
    widgetName: "Homepage Reviews",
  },
] as const;

export const REVIEWS_CORE_WIDGET_SLUGS = REVIEWS_CORE_WIDGETS.map((widget) => widget.slug);

export const isCoreReviewsWidgetSlug = (slug: string | null | undefined) =>
  Boolean(slug && REVIEWS_CORE_WIDGET_SLUGS.includes(slug as (typeof REVIEWS_CORE_WIDGET_SLUGS)[number]));

export const getCoreReviewsWidgetBySlug = (slug: string | null | undefined) =>
  REVIEWS_CORE_WIDGETS.find((widget) => widget.slug === slug) || null;

export type ReviewVideoEntry = {
  url: string;
  poster?: string;
  durationSeconds?: number;
};

export const parseReviewVideoEntries = (raw: string | null | undefined): ReviewVideoEntry[] => {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ReviewVideoEntry[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item === "string") {
        const url = item.trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({ url });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const url = String(record.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const poster = String(record.poster || "").trim();
      const durationRaw = Number(record.durationSeconds);
      out.push({
        url,
        ...(poster ? { poster } : {}),
        ...(Number.isFinite(durationRaw) && durationRaw > 0
          ? { durationSeconds: Math.round(durationRaw) }
          : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
};

export const serializeReviewVideoEntries = (entries: ReviewVideoEntry[]) =>
  JSON.stringify(
    entries
      .map((entry) => {
        const url = String(entry.url || "").trim();
        if (!url) return null;
        const poster = String(entry.poster || "").trim();
        const durationSeconds =
          typeof entry.durationSeconds === "number" && Number.isFinite(entry.durationSeconds)
            ? Math.round(entry.durationSeconds)
            : undefined;
        return {
          url,
          ...(poster ? { poster } : {}),
          ...(durationSeconds && durationSeconds > 0 ? { durationSeconds } : {}),
        };
      })
      .filter(Boolean),
  );

export { buildReferenceAttributeInput } from "./shoppable-video";
