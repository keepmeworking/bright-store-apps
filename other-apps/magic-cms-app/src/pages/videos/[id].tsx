import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import {
  type AttributeValueInput,
  useDeleteWidgetMutation,
  useGetProductsByIdsQuery,
  useGetPublishedProductsQuery,
  useGetWidgetPageTypesQuery,
  useGetWidgetsQuery,
  useGetWidgetQuery,
  useUpdateWidgetMutation,
} from "../../../generated/graphql";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayCircle, Save, Trash, Trash2 } from "lucide-react";
import {
  SH_VIDEO_ATTR_SLUGS,
  formatBytes,
  getAttributeBySlug,
  getFileUrlBySlug,
  getReferenceValuesBySlug,
  getTextValueBySlug,
  parseFileInfo,
} from "@/lib/shoppable-video";

type ActiveTab = "video" | "products";

const multilineClampStyle: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-word",
};

const PRODUCTS_TAB_PANEL_HEIGHT = 640;
const PRODUCT_FETCH_PAGE_SIZE = 100;

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();

const tokenizeSearch = (value: string) => normalizeSearchText(value).split(" ").filter(Boolean);

const matchesSearchTokens = (source: string, tokens: string[]) => {
  if (tokens.length === 0) return true;
  const haystack = normalizeSearchText(source);
  return tokens.every((token) => haystack.includes(token));
};

const getFileNameFromUrl = (url: string) => {
  const value = url.trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const segment = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(segment);
  } catch {
    const path = value.split("?")[0].split("#")[0];
    const segment = path.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(segment);
  }
};

const guessContentTypeFromUrl = (url: string) => {
  const lower = getFileNameFromUrl(url).toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  return "Not captured";
};

const safeParseJsonObject = (raw: string) => {
  if (!raw) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {} as Record<string, unknown>;
  }
  return {} as Record<string, unknown>;
};

export default function EditVideoPage() {
  const router = useRouter();
  const { id } = router.query;
  const pageId = typeof id === "string" ? id : "";

  const [{ data, fetching, error }] = useGetWidgetQuery({
    variables: { id: pageId },
    pause: !pageId,
  });

  const [, updateWidget] = useUpdateWidgetMutation();
  const [, deleteWidget] = useDeleteWidgetMutation();

  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [allPublishedProducts, setAllPublishedProducts] = useState<
    Array<{ id: string; name: string; slug: string; thumbnailUrl: string }>
  >([]);
  const [productFetchCursor, setProductFetchCursor] = useState<string | undefined>(undefined);
  const [hasFetchedAllProducts, setHasFetchedAllProducts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("video");
  const initializedPageIdRef = useRef<string | null>(null);
  const seenPublishedCursorRef = useRef<Set<string>>(new Set());
  const normalizedProductSearch = productSearch.trim();
  const productSearchTokens = useMemo(() => tokenizeSearch(normalizedProductSearch), [normalizedProductSearch]);

  const [{ data: publishedProductsData, fetching: fetchingPublishedProducts }] = useGetPublishedProductsQuery({
    variables: {
      first: PRODUCT_FETCH_PAGE_SIZE,
      after: productFetchCursor,
    },
    pause: hasFetchedAllProducts,
  });

  const [{ data: selectedProductsData }] = useGetProductsByIdsQuery({
    variables: { ids: products, first: Math.min(Math.max(products.length, 1), 100) },
    pause: products.length === 0,
  });
  const [{ data: widgetTypesData }] = useGetWidgetPageTypesQuery();

  const widgetPageTypeIds = useMemo(
    () =>
      (widgetTypesData?.pageTypes?.edges || [])
        .map((edge) => edge.node)
        .filter((node) => node.slug.startsWith("magiccms-widget-"))
        .map((node) => node.id),
    [widgetTypesData]
  );

  const [{ data: widgetPagesData }] = useGetWidgetsQuery({
    variables: { pageTypeIds: widgetPageTypeIds, first: 100 },
    pause: widgetPageTypeIds.length === 0,
  });

  const widgetPages = useMemo(() => (widgetPagesData?.pages?.edges || []).map((edge) => edge.node), [widgetPagesData]);

  const fileInfo = useMemo(() => {
    if (!data?.page) return null;
    return parseFileInfo(getTextValueBySlug(data.page, SH_VIDEO_ATTR_SLUGS.fileInfo));
  }, [data]);

  const displayFileInfo = useMemo(() => {
    const fileName = fileInfo?.originalFileName || getFileNameFromUrl(videoUrl) || "Not captured";
    const uploadedBy = fileInfo?.uploadedBy || "Not captured";
    const uploadedOn = fileInfo?.uploadedAtLabel || "Not captured";
    const optimizedSize = fileInfo ? formatBytes(fileInfo.optimizedFileSizeBytes) : "Not captured";
    const duration = fileInfo ? `${Math.max(0, Math.round(fileInfo.durationSeconds))}s` : "Not captured";
    const contentType = fileInfo?.contentType || guessContentTypeFromUrl(videoUrl);
    const dimensions =
      fileInfo?.width && fileInfo?.height ? `${fileInfo.width} x ${fileInfo.height}` : "Not captured";
    return {
      fileName,
      uploadedBy,
      uploadedOn,
      optimizedSize,
      duration,
      contentType,
      dimensions,
      hasThumbnail: Boolean(thumbnailUrl.trim()),
    };
  }, [fileInfo, thumbnailUrl, videoUrl]);

  const publishedProducts = useMemo(() => {
    if (productSearchTokens.length === 0) {
      return allPublishedProducts;
    }
    return allPublishedProducts.filter((product) =>
      matchesSearchTokens(`${product.name} ${product.slug}`, productSearchTokens)
    );
  }, [allPublishedProducts, productSearchTokens]);

  const selectedProductLookup = useMemo(() => {
    const lookup = new Map<
      string,
      {
        id: string;
        name: string;
        slug: string;
        thumbnailUrl: string;
      }
    >();
    for (const edge of selectedProductsData?.products?.edges || []) {
      lookup.set(edge.node.id, {
        id: edge.node.id,
        name: edge.node.name,
        slug: edge.node.slug,
        thumbnailUrl: edge.node.thumbnail?.url || "",
      });
    }
    for (const product of allPublishedProducts) {
      if (!lookup.has(product.id)) {
        lookup.set(product.id, {
          id: product.id,
          name: product.name,
          slug: product.slug,
          thumbnailUrl: product.thumbnailUrl,
        });
      }
    }
    return lookup;
  }, [allPublishedProducts, selectedProductsData]);

  useEffect(() => {
    if (!data?.page || !pageId) return;
    if (initializedPageIdRef.current === pageId) return;

    const nextVideoUrl =
      getFileUrlBySlug(data.page, SH_VIDEO_ATTR_SLUGS.videoFile) ||
      getFileUrlBySlug(data.page, SH_VIDEO_ATTR_SLUGS.legacyVideoFile);
    const nextThumbnailUrl = getFileUrlBySlug(data.page, SH_VIDEO_ATTR_SLUGS.thumbnail);
    const refs =
      getReferenceValuesBySlug(data.page, SH_VIDEO_ATTR_SLUGS.products).length > 0
        ? getReferenceValuesBySlug(data.page, SH_VIDEO_ATTR_SLUGS.products)
        : getReferenceValuesBySlug(data.page, SH_VIDEO_ATTR_SLUGS.legacyProducts);

    setVideoUrl(nextVideoUrl);
    setThumbnailUrl(nextThumbnailUrl);
    setProducts(Array.from(new Set(refs)));
    initializedPageIdRef.current = pageId;
  }, [data?.page, pageId]);

  useEffect(() => {
    initializedPageIdRef.current = null;
  }, [pageId]);

  useEffect(() => {
    const tab = router.query.tab;
    const value = Array.isArray(tab) ? tab[0] : tab;
    if (value === "products" || value === "video") {
      setActiveTab(value);
      return;
    }
    if (value === "preview") {
      setActiveTab("video");
    }
  }, [router.query.tab]);

  useEffect(() => {
    setIsDeleteConfirming(false);
  }, [pageId]);

  useEffect(() => {
    seenPublishedCursorRef.current = new Set();
    setAllPublishedProducts([]);
    setProductFetchCursor(undefined);
    setHasFetchedAllProducts(false);
  }, [pageId]);

  useEffect(() => {
    const edges = publishedProductsData?.products?.edges || [];
    if (edges.length > 0) {
      setAllPublishedProducts((previous) => {
        const next = new Map(previous.map((item) => [item.id, item]));
        for (const edge of edges) {
          next.set(edge.node.id, {
            id: edge.node.id,
            name: edge.node.name,
            slug: edge.node.slug,
            thumbnailUrl: edge.node.thumbnail?.url || "",
          });
        }
        return Array.from(next.values());
      });
    }

    const pageInfo = publishedProductsData?.products?.pageInfo;
    const nextCursor = pageInfo?.endCursor || undefined;
    if (pageInfo?.hasNextPage && nextCursor && !seenPublishedCursorRef.current.has(nextCursor)) {
      seenPublishedCursorRef.current.add(nextCursor);
      setProductFetchCursor(nextCursor);
      return;
    }
    if (pageInfo) {
      setHasFetchedAllProducts(true);
    }
  }, [publishedProductsData]);

  const addProduct = (productId: string) => {
    if (!productId) return;
    setProducts((prev) => (prev.includes(productId) ? prev : [...prev, productId]));
  };

  const removeProduct = (value: string) => {
    if (!value) return;
    setProducts((prev) => prev.filter((item) => item !== value));
  };

  const unlinkCurrentVideoFromWidgets = useCallback(async () => {
    if (!pageId || widgetPages.length === 0) return { failed: 0 };

    let failed = 0;
    for (const widget of widgetPages) {
      const refs = getReferenceValuesBySlug(widget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
      const rulesRaw = getTextValueBySlug(widget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);
      const rules = safeParseJsonObject(rulesRaw);
      const legacyRefs = Array.isArray(rules["magic-shoppable-video-ids"])
        ? (rules["magic-shoppable-video-ids"] as unknown[]).filter(
            (value): value is string => typeof value === "string" && value.length > 0
          )
        : [];

      const nextRefs = refs.filter((ref) => ref !== pageId);
      const nextLegacyRefs = legacyRefs.filter((ref) => ref !== pageId);
      const refsChanged = nextRefs.length !== refs.length;
      const legacyChanged = nextLegacyRefs.length !== legacyRefs.length;
      if (!refsChanged && !legacyChanged) continue;

      const attrs: AttributeValueInput[] = [];
      const refsAttr = getAttributeBySlug(widget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
      if (refsAttr && refsChanged) {
        if (nextRefs.length === 0) {
          attrs.push({ id: refsAttr.attribute.id, values: [] });
        } else {
          attrs.push({ id: refsAttr.attribute.id, references: nextRefs });
        }
      }

      const legacyRulesAttr = getAttributeBySlug(widget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);
      if (legacyRulesAttr && legacyChanged) {
        const nextRules = {
          ...rules,
          "magic-shoppable-video-ids": nextLegacyRefs,
          "magic-shoppable-updated-at": new Date().toISOString(),
        };
        attrs.push({ id: legacyRulesAttr.attribute.id, plainText: JSON.stringify(nextRules) });
      }

      if (attrs.length === 0) continue;
      const result = await updateWidget({ id: widget.id, input: { attributes: attrs } });
      const mutationErrors = result.data?.pageUpdate?.errors || [];
      if (result.error || mutationErrors.length > 0) {
        failed += 1;
      }
    }

    return { failed };
  }, [pageId, updateWidget, widgetPages]);

  const handleSave = async () => {
    if (!data?.page) {
      return;
    }

    setLoading(true);
    setSaveError("");
    setSaveNotice("");

    const shoppableVideoAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.videoFile);
    const shoppableThumbAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.thumbnail);
    const shoppableProductsAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.products);
    const shoppableFileInfoAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.fileInfo);
    const legacyMediaAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.legacyVideoFile);
    const legacyProductsAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.legacyProducts);
    const legacyRulesAttr = getAttributeBySlug(data.page, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);

    const attrs: AttributeValueInput[] = [];
    if (shoppableVideoAttr) {
      attrs.push(
        videoUrl.trim()
          ? { id: shoppableVideoAttr.attribute.id, file: videoUrl.trim() }
          : { id: shoppableVideoAttr.attribute.id, values: [] }
      );
    }
    if (legacyMediaAttr) {
      attrs.push(
        videoUrl.trim()
          ? { id: legacyMediaAttr.attribute.id, file: videoUrl.trim() }
          : { id: legacyMediaAttr.attribute.id, values: [] }
      );
    }
    if (shoppableThumbAttr) {
      attrs.push(
        thumbnailUrl.trim()
          ? { id: shoppableThumbAttr.attribute.id, file: thumbnailUrl.trim() }
          : { id: shoppableThumbAttr.attribute.id, values: [] }
      );
    }

    const refValues = products.filter(Boolean);
    if (shoppableProductsAttr) {
      if (refValues.length === 0) {
        attrs.push({ id: shoppableProductsAttr.attribute.id, values: [] });
      } else {
        attrs.push({ id: shoppableProductsAttr.attribute.id, references: refValues });
      }
    }
    if (legacyProductsAttr) {
      if (refValues.length === 0) {
        attrs.push({ id: legacyProductsAttr.attribute.id, values: [] });
      } else {
        attrs.push({ id: legacyProductsAttr.attribute.id, references: refValues });
      }
    }

    if (shoppableFileInfoAttr && fileInfo) {
      attrs.push({ id: shoppableFileInfoAttr.attribute.id, plainText: JSON.stringify(fileInfo) });
    }

    if (legacyRulesAttr) {
      const rules = safeParseJsonObject(getTextValueBySlug(data.page, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules));
      const nextRules = {
        ...rules,
        "magic-shoppable-products": refValues,
        "magic-shoppable-updated-at": new Date().toISOString(),
      };
      attrs.push({ id: legacyRulesAttr.attribute.id, plainText: JSON.stringify(nextRules) });
    }

    const result = await updateWidget({
      id: pageId,
      input: { attributes: attrs },
    });

    const updateErrors = result.data?.pageUpdate?.errors || [];
    if (result.error || updateErrors.length > 0) {
      setSaveError(
        result.error?.message ||
          updateErrors.map((item) => item.message || item.code).filter(Boolean).join(", ") ||
          "Unable to save video."
      );
      setLoading(false);
      return;
    }

    setSaveNotice("Saved");
    setLoading(false);
    window.setTimeout(() => setSaveNotice(""), 2000);
  };

  const handleDelete = async () => {
    if (!data?.page) return;
    if (!isDeleteConfirming) {
      setSaveError("");
      setSaveNotice("Press delete again to confirm this video removal.");
      setIsDeleteConfirming(true);
      return;
    }

    setLoading(true);
    setIsDeleteConfirming(false);
    setSaveError("");
    setSaveNotice("");

    const unlinkSummary = await unlinkCurrentVideoFromWidgets();
    const result = await deleteWidget({ id: pageId });
    const deleteErrors = result.data?.pageDelete?.errors || [];
    if (result.error || deleteErrors.length > 0) {
      setSaveError(
        (result.error?.message ||
          deleteErrors.map((item) => item.message || item.field).filter(Boolean).join(", ") ||
          "Unable to delete video.") +
          (unlinkSummary.failed > 0 ? ` Widget unlink failed for ${unlinkSummary.failed} item(s).` : "")
      );
      setLoading(false);
      return;
    }

    router.push("/videos");
  };

  if (fetching) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }
  if (error) {
    return (
      <Box padding={8}>
        <Text color="critical1">Error loading video: {error.message}</Text>
      </Box>
    );
  }
  if (!data?.page) {
    return (
      <Box padding={8}>
        <Text>Video not found.</Text>
      </Box>
    );
  }

  return (
    <Box padding={8} display="grid" gap={6}>
      <Box
        marginBottom={2}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        style={{ borderBottom: "1px solid #E5E7EB", paddingBottom: 16, flexWrap: "wrap", gap: 10 }}
      >
        <Box>
          <Text as="h1" size={9} fontWeight="bold">
            {data.page.title}
          </Text>
          <Text as="p" size={3} color="default2" marginTop={2}>
            Shoppable Video
          </Text>
        </Box>
        <Box display="flex" gap={2} style={{ flexWrap: "wrap" }}>
          <Button variant="tertiary" onClick={handleDelete} disabled={loading} style={{ color: "#B42318" }}>
            <Trash2 size={14} /> {isDeleteConfirming ? "Confirm delete" : "Delete"}
          </Button>
          {isDeleteConfirming ? (
            <Button
              variant="secondary"
              onClick={() => {
                setIsDeleteConfirming(false);
                setSaveNotice("");
              }}
              disabled={loading}
            >
              Cancel
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => router.push("/videos")}>
            Back
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"} <Save size={14} />
          </Button>
        </Box>
      </Box>

      {saveError ? (
        <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
          <Text color="critical1">{saveError}</Text>
        </Box>
      ) : null}
      {saveNotice ? (
        <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
          <Text color="default2">{saveNotice}</Text>
        </Box>
      ) : null}

      <Box display="flex" gap={4} style={{ borderBottom: "1px solid #E5E7EB", flexWrap: "wrap" }}>
        {([
          ["video", "Video source"],
          ["products", "Shoppable products"],
        ] as const).map(([tabId, label]) => (
          <Button
            key={tabId}
            variant="tertiary"
            onClick={() => setActiveTab(tabId)}
            style={{
              borderBottom: activeTab === tabId ? "2px solid #28234A" : "none",
              borderRadius: 0,
              paddingBottom: 12,
            }}
          >
            {label}
          </Button>
        ))}
      </Box>

      {activeTab === "video" ? (
        <Box
          display="grid"
          gap={4}
          __gridTemplateColumns="minmax(0, 7fr) minmax(0, 3fr)"
          style={{ alignItems: "stretch" }}
        >
          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={4}
            display="grid"
            gap={4}
            style={{ alignContent: "start" }}
          >
            <Box display="grid" gap={2}>
              <Text size={2} fontWeight="bold">
                Video URL
              </Text>
              <Input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://..." />
              <Text size={1} color="default2">
                Uses `magic-shoppable-video-file` (and legacy `magic-media` for compatibility).
              </Text>
            </Box>

            <Box display="grid" gap={2}>
              <Text size={2} fontWeight="bold">
                Thumbnail URL
              </Text>
              <Input value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://..." />
              <Text size={1} color="default2">
                Uses `magic-shoppable-video-thumbnail`.
              </Text>
            </Box>

            <Box display="grid" gap={2}>
              <Text size={3} fontWeight="bold">
                File information
              </Text>
              <Text size={2} color="default2">
                File name: {displayFileInfo.fileName}
              </Text>
              <Text size={2} color="default2">
                Uploaded by: {displayFileInfo.uploadedBy}
              </Text>
              <Text size={2} color="default2">
                Uploaded on: {displayFileInfo.uploadedOn}
              </Text>
              <Text size={2} color="default2">
                Optimized file size: {displayFileInfo.optimizedSize}
              </Text>
              <Text size={2} color="default2">
                Duration: {displayFileInfo.duration}
              </Text>
              <Text size={2} color="default2">
                Content type: {displayFileInfo.contentType}
              </Text>
              <Text size={2} color="default2">
                Resolution: {displayFileInfo.dimensions}
              </Text>
              <Text size={2} color="default2">
                Thumbnail: {displayFileInfo.hasThumbnail ? "Available" : "Missing"}
              </Text>
            </Box>
          </Box>

          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={4}
            display="grid"
            gap={3}
            style={{ alignContent: "start" }}
          >
            <Text size={3} fontWeight="bold">
              Video preview
            </Text>
            <Box display="flex" justifyContent="center" alignItems="center" style={{ flex: 1, minHeight: 0 }}>
              <Box
                style={{
                  width: "100%",
                  maxWidth: 340,
                  aspectRatio: "9 / 16",
                  background: "#101828",
                  borderRadius: 16,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    poster={thumbnailUrl || undefined}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : thumbnailUrl ? (
                  <img src={thumbnailUrl} alt={data.page.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <Box display="flex" justifyContent="center" alignItems="center" style={{ width: "100%", height: "100%" }}>
                    <PlayCircle size={42} color="#98A2B3" />
                  </Box>
                )}
              </Box>
            </Box>
            <Text size={1} color="default2">
              Preview is manual-play only (no autoplay).
            </Text>
          </Box>
        </Box>
      ) : null}

      {activeTab === "products" ? (
        <Box display="grid" gap={3} __gridTemplateColumns="repeat(auto-fit, minmax(360px, 1fr))" style={{ alignItems: "start" }}>
          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={4}
            display="grid"
            style={{ gridTemplateRows: "auto auto 1fr", gap: 12, minHeight: PRODUCTS_TAB_PANEL_HEIGHT, maxHeight: PRODUCTS_TAB_PANEL_HEIGHT }}
          >
            <Text as="h3" size={4} fontWeight="bold">
              Linked products ({products.length})
            </Text>
            <Text size={2} color="default2">
              These products will appear as shoppable items for this video.
            </Text>
            {products.length === 0 ? (
              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                padding={4}
                display="flex"
                justifyContent="center"
                alignItems="center"
                style={{ minHeight: 220, height: "100%", textAlign: "center" }}
              >
                <Box display="grid" gap={1}>
                  <Text size={3} fontWeight="bold">
                    No linked products yet
                  </Text>
                  <Text size={2} color="default2">
                    Pick products from the right panel to link them here.
                  </Text>
                </Box>
              </Box>
            ) : (
              <Box display="grid" gap={2} style={{ minHeight: 0, overflowY: "auto", paddingRight: 4, alignContent: "start" }}>
                {products.map((productId) => {
                  const product = selectedProductLookup.get(productId);
                  return (
                    <Box
                      key={productId}
                      borderStyle="solid"
                      borderWidth={1}
                      borderColor="default1"
                      borderRadius={4}
                      padding={3}
                      display="grid"
                      __gridTemplateColumns="minmax(0, 1fr) auto"
                      alignItems="center"
                      style={{ gap: 8 }}
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Text size={2} fontWeight="bold" style={multilineClampStyle}>
                          {product?.name || productId}
                        </Text>
                      </Box>
                      <Button size="small" variant="secondary" onClick={() => removeProduct(productId)}>
                        Remove
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={4}
            display="grid"
            style={{ gridTemplateRows: "auto auto 1fr auto", gap: 12, minHeight: PRODUCTS_TAB_PANEL_HEIGHT, maxHeight: PRODUCTS_TAB_PANEL_HEIGHT }}
          >
            <Text as="h3" size={4} fontWeight="bold">
              Published products (
              {normalizedProductSearch
                ? `${publishedProducts.length}/${allPublishedProducts.length}`
                : allPublishedProducts.length}
              )
            </Text>
            <Input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Search published products (word-by-word, name/slug)"
            />

            {fetchingPublishedProducts ? (
              <Box display="flex" justifyContent="center" padding={4}>
                <Spinner />
              </Box>
            ) : publishedProducts.length === 0 ? (
              <Text size={2} color="default2">
                No published products found.
              </Text>
            ) : (
              <Box display="grid" gap={2} style={{ minHeight: 0, overflowY: "auto", paddingRight: 4, alignContent: "start" }}>
                {publishedProducts.map((product) => {
                  const isLinked = products.includes(product.id);
                  return (
                    <Box
                      key={product.id}
                      borderStyle="solid"
                      borderWidth={1}
                      borderColor="default1"
                      borderRadius={4}
                      padding={3}
                      display="grid"
                      __gridTemplateColumns="minmax(0, 1fr) auto"
                      alignItems="center"
                      style={{ gap: 8 }}
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Text size={2} fontWeight="bold" style={multilineClampStyle}>
                          {product.name}
                        </Text>
                      </Box>
                      <Button
                        size="small"
                        variant={isLinked ? "secondary" : "primary"}
                        onClick={() => (isLinked ? removeProduct(product.id) : addProduct(product.id))}
                      >
                        {isLinked ? "Remove" : "Link"}
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Text size={1} color="default2">
                {hasFetchedAllProducts
                  ? `Loaded all products • ${allPublishedProducts.length} total`
                  : `Loading product catalog... ${allPublishedProducts.length} loaded`}
              </Text>
              {fetchingPublishedProducts && !hasFetchedAllProducts ? <Spinner /> : null}
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
