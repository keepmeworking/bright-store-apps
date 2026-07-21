import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import {
  type AttributeValueInput,
  GetPageTypesDocument,
  type GetWidgetsQuery,
  useCreateWidgetMutation,
  useDeleteWidgetMutation,
  useGetPageTypesQuery,
  useGetWidgetsQuery,
  useUpdateWidgetMutation,
} from "../../../generated/graphql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Edit, Link2, Upload, Video } from "lucide-react";
import { useClient } from "urql";
import {
  type ShoppableVideoFileInfo,
  SH_VIDEO_ATTR_SLUGS,
  SHOPPABLE_CORE_WIDGET_SLUGS,
  createVideoTitleFromFileName,
  formatBytes,
  formatUtcUploadLabel,
  getAttributeBySlug,
  getFileUrlBySlug,
  getReferenceValuesBySlug,
  getTextValueBySlug,
  isCoreShoppableWidgetSlug,
  parseFileInfo,
} from "@/lib/shoppable-video";
import { ensureCoreShoppableWidgets } from "@/lib/shoppable-core-widgets";
import { extractVideoAsset, uploadFileToSaleor } from "@/lib/shoppable-video-upload";
import { syncMagicRefWidgetOnModulePages } from "@/lib/module-widget-reference-sync";

type VideoNode = NonNullable<NonNullable<GetWidgetsQuery["pages"]>["edges"][number]>["node"];

type ActiveTab = "media" | "widgets" | "metafields";

type UploadItemStatus =
  | "queued"
  | "extracting"
  | "uploading_video"
  | "uploading_thumbnail"
  | "creating_entry"
  | "completed"
  | "failed";

type VideoUploadItem = {
  id: string;
  fileName: string;
  status: UploadItemStatus;
  progressPercent: number;
  error: string;
  pageId: string;
  fileInfo: ShoppableVideoFileInfo | null;
};

type VideoUploadJob = {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "partial" | "failed";
  items: VideoUploadItem[];
};

type VideoAttrIds = {
  shoppableVideoFile?: string;
  shoppableThumbnail?: string;
  shoppableProducts?: string;
  shoppableFileInfo?: string;
  legacyMedia?: string;
  legacyProducts?: string;
  legacyDisplayRules?: string;
};

const statusLabel: Record<UploadItemStatus, string> = {
  queued: "Queued",
  extracting: "Extracting metadata",
  uploading_video: "Uploading video",
  uploading_thumbnail: "Uploading thumbnail",
  creating_entry: "Creating video entry",
  completed: "Completed",
  failed: "Failed",
};

const createLocalId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const createUniqueToken = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const sanitizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildVideoUploadSlug = () => `magic-shoppable-${createUniqueToken()}`;

const buildWidgetSlug = (name: string) => {
  const normalizedName = sanitizeSlug(name);
  const base = normalizedName || "widget";
  const withPrefix = `magic-widget-shoppable-${base}-${createUniqueToken()}`;
  return withPrefix.slice(0, 96);
};

const STOREFRONT_QUERY_SNIPPET = `query MagicShoppableVideos($first: Int!, $after: String) {
  pages(
    filter: { search: "magic-shoppable-" }
    first: $first
    after: $after
    sortBy: { field: CREATED_AT, direction: DESC }
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        title
        slug
        attributes {
          attribute {
            slug
          }
          values {
            value
            reference
            file {
              url
            }
          }
        }
      }
    }
  }
}

# Required field slugs:
# - magic-shoppable-video-file
# - magic-shoppable-video-thumbnail
# - magic-shoppable-products
# - magic-shoppable-file-info
# - magic-shoppable-video-refs`;

const LIBRARY_PAGE_SIZE = 20;

const getUploaderName = (appBridgeState: unknown) => {
  const candidate = appBridgeState as {
    user?: { email?: string; firstName?: string; lastName?: string };
  };
  const fullName = `${candidate.user?.firstName || ""} ${candidate.user?.lastName || ""}`.trim();
  if (fullName) return fullName;
  if (candidate.user?.email) return candidate.user.email;
  return "Dashboard user";
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

const resolveVideoAttrIds = (attrs?: ReadonlyArray<{ id: string; slug?: string | null }> | null): VideoAttrIds => {
  const list = attrs || [];
  return {
    shoppableVideoFile: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.videoFile)?.id,
    shoppableThumbnail: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.thumbnail)?.id,
    shoppableProducts: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.products)?.id,
    shoppableFileInfo: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.fileInfo)?.id,
    legacyMedia: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.legacyVideoFile)?.id,
    legacyProducts: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.legacyProducts)?.id,
    legacyDisplayRules: list.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.legacyDisplayRules)?.id,
  };
};

export default function VideosPage() {
  const gqlClient = useClient();
  const router = useRouter();
  const { appBridge, appBridgeState } = useAppBridge();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("media");
  const [mediaNotice, setMediaNotice] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<VideoUploadJob[]>([]);
  const [isUploadingJob, setIsUploadingJob] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryPage, setLibraryPage] = useState(1);
  const [selectedLibraryVideoIds, setSelectedLibraryVideoIds] = useState<Set<string>>(new Set());
  const [isBulkDeletingVideos, setIsBulkDeletingVideos] = useState(false);
  const [isBulkDeleteConfirming, setIsBulkDeleteConfirming] = useState(false);
  const [libraryActionNotice, setLibraryActionNotice] = useState("");
  const [libraryActionError, setLibraryActionError] = useState("");

  const [selectedWidgetId, setSelectedWidgetId] = useState("");
  const [selectedVideoRefs, setSelectedVideoRefs] = useState<Set<string>>(new Set());
  const [newWidgetName, setNewWidgetName] = useState("");
  const [newWidgetVideoRefs, setNewWidgetVideoRefs] = useState<Set<string>>(new Set());
  const [widgetNotice, setWidgetNotice] = useState("");
  const [widgetError, setWidgetError] = useState("");
  const [isSavingWidgetVideos, setIsSavingWidgetVideos] = useState(false);
  const [isCreatingWidget, setIsCreatingWidget] = useState(false);
  const [isCreateWidgetPopupOpen, setIsCreateWidgetPopupOpen] = useState(false);
  const [isEnsuringCoreWidgets, setIsEnsuringCoreWidgets] = useState(false);
  const [deletingWidgetId, setDeletingWidgetId] = useState("");
  const [widgetDeleteConfirmId, setWidgetDeleteConfirmId] = useState("");

  const [{ data: videoTypeData, fetching: fetchingVideoType }, reexecuteVideoType] = useGetPageTypesQuery({
    variables: { slug: "magiccms-shoppable-video" },
  });
  const [{ data: widgetTypeData, fetching: fetchingWidgetType }, reexecuteWidgetType] = useGetPageTypesQuery({
    variables: { slug: "magic-widget-shoppable" },
  });
  const [, createWidget] = useCreateWidgetMutation();
  const [, deleteWidget] = useDeleteWidgetMutation();
  const [, updateWidget] = useUpdateWidgetMutation();

  const videoPageTypeNode = videoTypeData?.pageTypes?.edges[0]?.node;
  const videoPageTypeId = videoPageTypeNode?.id;
  const shoppableWidgetPageType = widgetTypeData?.pageTypes?.edges[0]?.node || null;
  const widgetPageTypeIds = useMemo(
    () => (shoppableWidgetPageType ? [shoppableWidgetPageType.id] : []),
    [shoppableWidgetPageType]
  );

  const [{ data: videoData, fetching: fetchingVideos }, reexecuteVideos] = useGetWidgetsQuery({
    variables: { pageTypeIds: videoPageTypeId ? [videoPageTypeId] : [], first: 100 },
    pause: !videoPageTypeId,
  });

  const [{ data: widgetData, fetching: fetchingWidgets }, reexecuteWidgets] = useGetWidgetsQuery({
    variables: { pageTypeIds: widgetPageTypeIds, first: 100 },
    pause: widgetPageTypeIds.length === 0,
  });

  const videos = useMemo(() => (videoData?.pages?.edges || []).map((edge) => edge.node), [videoData]);
  const widgets = useMemo(() => (widgetData?.pages?.edges || []).map((edge) => edge.node), [widgetData]);

  const videoAttrIds = useMemo(() => resolveVideoAttrIds(videoPageTypeNode?.attributes), [videoPageTypeNode?.attributes]);
  const liveVideoAttrIdsRef = useRef<VideoAttrIds>(videoAttrIds);

  useEffect(() => {
    liveVideoAttrIdsRef.current = videoAttrIds;
  }, [videoAttrIds]);

  const runSetupSync = useCallback(async () => {
    const token = appBridgeState?.token || "";
    const saleorApiUrl = appBridgeState?.saleorApiUrl || "";
    if (!token || !saleorApiUrl) {
      return { ok: false, message: "Missing Saleor auth context. Please reopen app and try again." };
    }

    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ saleorApiUrl }),
      });
      const payload = await response.json();
      const errors = Array.isArray(payload?.errors) ? payload.errors.filter(Boolean) : [];
      if (!response.ok) {
        return { ok: false, message: payload?.message || "Setup sync failed." };
      }
      if (errors.length > 0) {
        return { ok: false, message: errors.join(" | ") };
      }
      reexecuteVideoType({ requestPolicy: "network-only" });
      reexecuteWidgetType({ requestPolicy: "network-only" });
      return { ok: true, message: "" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Setup sync failed.",
      };
    }
  }, [appBridgeState?.saleorApiUrl, appBridgeState?.token, reexecuteVideoType, reexecuteWidgetType]);

  const fetchFreshVideoAttrIds = useCallback(async () => {
    const result = await gqlClient
      .query(
        GetPageTypesDocument,
        { slug: "magiccms-shoppable-video" },
        { requestPolicy: "network-only" }
      )
      .toPromise();
    const attrs = result.data?.pageTypes?.edges[0]?.node.attributes || [];
    const resolved = resolveVideoAttrIds(attrs);
    liveVideoAttrIdsRef.current = resolved;
    return resolved;
  }, [gqlClient]);

  const ensureVideoFileAttribute = useCallback(async () => {
    let resolved = liveVideoAttrIdsRef.current;
    if (resolved.shoppableVideoFile || resolved.legacyMedia) {
      return resolved;
    }

    const syncResult = await runSetupSync();
    resolved = await fetchFreshVideoAttrIds();
    if (resolved.shoppableVideoFile || resolved.legacyMedia) {
      return resolved;
    }

    throw new Error(
      syncResult.ok
        ? "Video file attribute missing even after schema sync. Please run initialization once from dashboard."
        : `Video file attribute missing. Auto sync failed: ${syncResult.message}`
    );
  }, [fetchFreshVideoAttrIds, runSetupSync]);

  const ensureWidgetCreateAttrs = useCallback(async () => {
    let pageType = shoppableWidgetPageType;
    let attrs = pageType?.attributes || [];
    let widgetNameAttr = attrs.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.widgetName);
    let refAttr = attrs.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
    let displayRulesAttr = attrs.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);

    if (pageType && widgetNameAttr && refAttr) {
      return { pageType, widgetNameAttr, refAttr, displayRulesAttr };
    }

    const syncResult = await runSetupSync();
    const freshResult = await gqlClient
      .query(
        GetPageTypesDocument,
        { slug: "magic-widget-shoppable" },
        { requestPolicy: "network-only" }
      )
      .toPromise();
    pageType = freshResult.data?.pageTypes?.edges[0]?.node || null;
    attrs = pageType?.attributes || [];
    widgetNameAttr = attrs.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.widgetName);
    refAttr = attrs.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
    displayRulesAttr = attrs.find((attribute) => attribute.slug === SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);

    if (!pageType) {
      throw new Error(
        syncResult.ok
          ? 'Widget page type "magic-widget-shoppable" is missing. Run One-Click Initialization first.'
          : `Widget page type is missing and auto sync failed: ${syncResult.message}`
      );
    }
    if (!widgetNameAttr || !refAttr) {
      throw new Error(
        syncResult.ok
          ? "Widget type is missing required attributes (magic-shoppable-widget-name / magic-shoppable-video-refs). Run One-Click Initialization."
          : `Widget attributes are missing and auto sync failed: ${syncResult.message}`
      );
    }
    return { pageType, widgetNameAttr, refAttr, displayRulesAttr };
  }, [gqlClient, runSetupSync, shoppableWidgetPageType]);

  const selectedWidget = useMemo(
    () => widgets.find((widget) => widget.id === selectedWidgetId) || null,
    [widgets, selectedWidgetId]
  );
  const widgetListItems = useMemo(
    () =>
      widgets.map((widget) => {
        const configuredName = getTextValueBySlug(widget, SH_VIDEO_ATTR_SLUGS.widgetName).trim();
        const refs = getReferenceValuesBySlug(widget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
        const rulesRaw = getTextValueBySlug(widget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);
        const rules = safeParseJsonObject(rulesRaw);
        const fallbackRefs = Array.isArray(rules["magic-shoppable-video-ids"])
          ? (rules["magic-shoppable-video-ids"] as unknown[]).filter(
              (value): value is string => typeof value === "string" && value.length > 0
            )
          : [];
        const linkedVideoCount = (refs.length > 0 ? refs : fallbackRefs).length;
        const isCore = isCoreShoppableWidgetSlug(widget.slug);
        return {
          id: widget.id,
          title: widget.title,
          slug: widget.slug,
          displayName: configuredName || widget.title,
          linkedVideoCount,
          isCore,
        };
      }),
    [widgets]
  );
  const coreWidgetListItems = useMemo(() => {
    const bySlug = new Map(widgetListItems.filter((item) => item.isCore).map((item) => [item.slug, item]));
    return SHOPPABLE_CORE_WIDGET_SLUGS.map((slug) => bySlug.get(slug)).filter(
      (item): item is (typeof widgetListItems)[number] => Boolean(item)
    );
  }, [widgetListItems]);
  const customWidgetListItems = useMemo(
    () => widgetListItems.filter((item) => !item.isCore),
    [widgetListItems]
  );
  const selectedWidgetListItem = useMemo(
    () => widgetListItems.find((item) => item.id === selectedWidgetId) || null,
    [widgetListItems, selectedWidgetId]
  );

  useEffect(() => {
    if (!selectedWidget) {
      setSelectedVideoRefs(new Set());
      return;
    }

    const refs = getReferenceValuesBySlug(selectedWidget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
    if (refs.length > 0) {
      setSelectedVideoRefs(new Set(refs));
      return;
    }

    const rulesRaw = getTextValueBySlug(selectedWidget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);
    const rules = safeParseJsonObject(rulesRaw);
    const fallbackRefs = Array.isArray(rules["magic-shoppable-video-ids"])
      ? (rules["magic-shoppable-video-ids"] as unknown[])
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    setSelectedVideoRefs(new Set(fallbackRefs));
  }, [selectedWidget]);

  useEffect(() => {
    if (selectedWidgetId && !widgets.some((widget) => widget.id === selectedWidgetId)) {
      setSelectedWidgetId("");
    }
  }, [selectedWidgetId, widgets]);

  useEffect(() => {
    if (activeTab !== "widgets") return;
    let cancelled = false;

    const run = async () => {
      setIsEnsuringCoreWidgets(true);
      try {
        const result = await ensureCoreShoppableWidgets(gqlClient);
        if (cancelled) return;
        if (result.errors.length > 0) {
          setWidgetError(result.errors[0]);
        } else if (result.created.length > 0) {
          setWidgetNotice(
            `Core widgets ready: created ${result.created.join(", ")}. Add videos with Manage videos.`
          );
          await reexecuteWidgets({ requestPolicy: "network-only" });
        }
      } catch (error) {
        if (!cancelled) {
          setWidgetError(error instanceof Error ? error.message : "Failed to ensure core widgets.");
        }
      } finally {
        if (!cancelled) setIsEnsuringCoreWidgets(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeTab, gqlClient, reexecuteWidgets]);

  const patchUploadJob = useCallback((jobId: string, updater: (job: VideoUploadJob) => VideoUploadJob) => {
    setUploadJobs((prev) => prev.map((job) => (job.id === jobId ? updater(job) : job)));
  }, []);

  const patchUploadItem = useCallback(
    (jobId: string, itemId: string, updater: (item: VideoUploadItem) => VideoUploadItem) => {
      patchUploadJob(jobId, (job) => ({
        ...job,
        items: job.items.map((item) => (item.id === itemId ? updater(item) : item)),
      }));
    },
    [patchUploadJob]
  );

  const uploadAndCreateEntry = useCallback(
    async (jobId: string, itemId: string, file: File, index: number) => {
      const token = appBridge?.getState().token || appBridgeState?.token || "";
      const saleorApiUrl = appBridgeState?.saleorApiUrl || "";
      if (!token || !saleorApiUrl || !videoPageTypeId) {
        throw new Error("Missing Saleor auth context or shoppable video page type.");
      }
      const resolvedVideoAttrIds = await ensureVideoFileAttribute();

      patchUploadItem(jobId, itemId, (item) => ({
        ...item,
        status: "extracting",
        progressPercent: 8,
        error: "",
      }));

      const extracted = await extractVideoAsset(file);
      const uploadedBy = getUploaderName(appBridgeState);
      const uploadedAt = new Date();
      const uploadedAtIso = uploadedAt.toISOString();
      const uploadedAtLabel = formatUtcUploadLabel(uploadedAt);

      patchUploadItem(jobId, itemId, (item) => ({
        ...item,
        status: "uploading_video",
        progressPercent: 26,
      }));

      const uploadedVideo = await uploadFileToSaleor({
        saleorApiUrl,
        token,
        file,
      });

      let thumbnailUrl = "";
      if (extracted.thumbnail) {
        patchUploadItem(jobId, itemId, (item) => ({
          ...item,
          status: "uploading_thumbnail",
          progressPercent: 58,
        }));
        const uploadedThumbnail = await uploadFileToSaleor({
          saleorApiUrl,
          token,
          file: extracted.thumbnail,
        });
        thumbnailUrl = uploadedThumbnail.url;
      }

      const fileInfo: ShoppableVideoFileInfo = {
        originalFileName: file.name,
        uploadedBy,
        uploadedAtIso,
        uploadedAtLabel,
        originalFileSizeBytes: file.size,
        optimizedFileSizeBytes: file.size,
        durationSeconds: extracted.durationSeconds,
        contentType: uploadedVideo.contentType || file.type || "video/mp4",
        width: extracted.width || undefined,
        height: extracted.height || undefined,
        optimizationMode: "lossless_passthrough",
      };

      patchUploadItem(jobId, itemId, (item) => ({
        ...item,
        status: "creating_entry",
        progressPercent: 82,
        fileInfo,
      }));

      const title = createVideoTitleFromFileName(file.name);
      const slug = buildVideoUploadSlug();
      const attributes: AttributeValueInput[] = [];

      if (resolvedVideoAttrIds.shoppableVideoFile) {
        attributes.push({ id: resolvedVideoAttrIds.shoppableVideoFile, file: uploadedVideo.url });
      }
      if (resolvedVideoAttrIds.legacyMedia) {
        attributes.push({ id: resolvedVideoAttrIds.legacyMedia, file: uploadedVideo.url });
      }
      if (resolvedVideoAttrIds.shoppableThumbnail && thumbnailUrl) {
        attributes.push({ id: resolvedVideoAttrIds.shoppableThumbnail, file: thumbnailUrl });
      }
      if (resolvedVideoAttrIds.shoppableFileInfo) {
        attributes.push({ id: resolvedVideoAttrIds.shoppableFileInfo, plainText: JSON.stringify(fileInfo) });
      }
      if (resolvedVideoAttrIds.legacyDisplayRules) {
        attributes.push({
          id: resolvedVideoAttrIds.legacyDisplayRules,
          plainText: JSON.stringify({
            "magic-shoppable-file-info": fileInfo,
            "magic-shoppable-video-id": slug,
          }),
        });
      }

      const createResult = await createWidget({
        input: {
          title,
          slug,
          pageType: videoPageTypeId,
          isPublished: true,
          attributes,
        },
      });

      const createErrors = createResult.data?.pageCreate?.errors || [];
      const createdPageId = createResult.data?.pageCreate?.page?.id || "";
      if (createResult.error || createErrors.length > 0 || !createdPageId) {
        throw new Error(
          createResult.error?.message ||
            createErrors.map((error) => error.message || error.code).filter(Boolean).join(", ") ||
            "Unable to create shoppable video entry."
        );
      }

      patchUploadItem(jobId, itemId, (item) => ({
        ...item,
        status: "completed",
        progressPercent: 100,
        pageId: createdPageId,
      }));
    },
    [appBridge, appBridgeState, createWidget, ensureVideoFileAttribute, patchUploadItem, videoPageTypeId]
  );

  const runVideoUploadJob = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isUploadingJob) {
        return;
      }

      setMediaError("");
      setMediaNotice("");
      setIsUploadingJob(true);

      const jobId = createLocalId("vjob");
      const initialItems: VideoUploadItem[] = files.map((file) => ({
        id: createLocalId("vitem"),
        fileName: file.name,
        status: "queued",
        progressPercent: 0,
        error: "",
        pageId: "",
        fileInfo: null,
      }));

      setUploadJobs((prev) => [
        {
          id: jobId,
          createdAt: new Date().toISOString(),
          status: "running",
          items: initialItems,
        },
        ...prev,
      ]);

      try {
        for (let index = 0; index < files.length; index += 1) {
          const item = initialItems[index];
          if (!item) continue;
          try {
            await uploadAndCreateEntry(jobId, item.id, files[index], index);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Upload failed.";
            patchUploadItem(jobId, item.id, (current) => ({
              ...current,
              status: "failed",
              progressPercent: 100,
              error: message,
            }));
          }
        }

        patchUploadJob(jobId, (job) => {
          const completedCount = job.items.filter((item) => item.status === "completed").length;
          const failedCount = job.items.filter((item) => item.status === "failed").length;
          const status = failedCount === 0 ? "completed" : completedCount === 0 ? "failed" : "partial";
          return { ...job, status };
        });
        await reexecuteVideos({ requestPolicy: "network-only" });
        if (widgetPageTypeIds.length > 0) {
          await reexecuteWidgets({ requestPolicy: "network-only" });
        }

        setMediaNotice(
          `Upload job completed for ${files.length} file(s). Link products to each video from the library cards.`
        );
      } finally {
        setIsUploadingJob(false);
      }
    },
    [isUploadingJob, patchUploadItem, patchUploadJob, reexecuteVideos, reexecuteWidgets, uploadAndCreateEntry, widgetPageTypeIds.length]
  );

  const onSelectFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []).filter((file) => file.type.startsWith("video/"));
    if (selected.length === 0) {
      setMediaError("Please select at least one valid video file.");
      return;
    }
    await runVideoUploadJob(selected);
    event.target.value = "";
  };

  const copyStorefrontQuery = async () => {
    try {
      await navigator.clipboard.writeText(STOREFRONT_QUERY_SNIPPET);
      setCopiedQuery(true);
      window.setTimeout(() => setCopiedQuery(false), 1800);
    } catch {
      setMediaError("Unable to copy query. Please copy manually.");
    }
  };

  const toggleWidgetVideoRef = (videoId: string) => {
    setSelectedVideoRefs((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const toggleNewWidgetVideoRef = (videoId: string) => {
    setNewWidgetVideoRefs((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const createShoppableWidget = async () => {
    const title = newWidgetName.trim();
    if (!title) {
      setWidgetError("Widget name is required.");
      return;
    }
    const refs = Array.from(newWidgetVideoRefs);
    const finalSlug = buildWidgetSlug(title);
    if (isCoreShoppableWidgetSlug(finalSlug)) {
      setWidgetError("That name would create a reserved core widget slug. Choose another name.");
      return;
    }
    let selectedPageType: NonNullable<typeof shoppableWidgetPageType> | null = null;
    let widgetNameAttr: { id: string; slug?: string | null } | undefined;
    let refAttr: { id: string; slug?: string | null } | undefined;
    let displayRulesAttr: { id: string; slug?: string | null } | undefined;

    try {
      const resolved = await ensureWidgetCreateAttrs();
      selectedPageType = resolved.pageType;
      widgetNameAttr = resolved.widgetNameAttr;
      refAttr = resolved.refAttr;
      displayRulesAttr = resolved.displayRulesAttr;
    } catch (error) {
      setWidgetError(error instanceof Error ? error.message : "Unable to prepare widget schema.");
      return;
    }
    if (!selectedPageType || !widgetNameAttr || !refAttr) {
      setWidgetError(
        "Widget type is missing required attributes (magic-shoppable-widget-name / magic-shoppable-video-refs). Run One-Click Initialization."
      );
      return;
    }

    const attributes: AttributeValueInput[] = [];
    if (widgetNameAttr) {
      attributes.push({ id: widgetNameAttr.id, plainText: title });
    }
    if (refAttr) {
      if (refs.length === 0) {
        attributes.push({ id: refAttr.id, values: [] });
      } else if (refs.length === 1) {
        attributes.push({ id: refAttr.id, reference: refs[0] });
      } else {
        attributes.push({ id: refAttr.id, references: refs });
      }
    }

    if (displayRulesAttr) {
      attributes.push({
        id: displayRulesAttr.id,
        plainText: JSON.stringify({
          "magic-shoppable-video-ids": refs,
          "magic-shoppable-widget-created-at": new Date().toISOString(),
        }),
      });
    }

    setWidgetError("");
    setWidgetNotice("");
    setIsCreatingWidget(true);

    const createResult = await createWidget({
      input: {
        title,
        slug: finalSlug,
        pageType: selectedPageType.id,
        isPublished: true,
        attributes,
      },
    });

    const createErrors = createResult.data?.pageCreate?.errors || [];
    const createdPage = createResult.data?.pageCreate?.page;
    if (createResult.error || createErrors.length > 0 || !createdPage) {
      setWidgetError(
        createResult.error?.message ||
          createErrors.map((error) => error.message || error.code).filter(Boolean).join(", ") ||
          "Unable to create widget."
      );
      setIsCreatingWidget(false);
      return;
    }

    // Custom widgets only — do not broadcast core widgets to every module page.
    const syncResult = await syncMagicRefWidgetOnModulePages(gqlClient, createdPage.id, "add");

    await reexecuteWidgets({ requestPolicy: "network-only" });
    setSelectedWidgetId(createdPage.id);
    setSelectedVideoRefs(new Set(refs));
    setNewWidgetName("");
    setNewWidgetVideoRefs(new Set());
    setIsCreateWidgetPopupOpen(false);
    setWidgetNotice(
      syncResult.errors.length > 0
        ? `Widget "${createdPage.title}" created. Warning: ${syncResult.errors[0]}`
        : `Custom widget "${createdPage.title}" created.`
    );
    setIsCreatingWidget(false);
  };

  const deleteCustomWidget = async (widgetId: string, slug: string) => {
    if (isCoreShoppableWidgetSlug(slug)) {
      setWidgetError("Core Homepage/PDP widgets cannot be deleted.");
      setWidgetDeleteConfirmId("");
      return;
    }

    setDeletingWidgetId(widgetId);
    setWidgetError("");
    setWidgetNotice("");

    const result = await deleteWidget({ id: widgetId });
    const mutationErrors = result.data?.pageDelete?.errors || [];
    if (result.error || mutationErrors.length > 0) {
      setWidgetError(
        result.error?.message ||
          mutationErrors.map((error) => error.message).filter(Boolean).join(", ") ||
          "Unable to delete widget."
      );
      setDeletingWidgetId("");
      setWidgetDeleteConfirmId("");
      return;
    }

    await syncMagicRefWidgetOnModulePages(gqlClient, widgetId, "remove");
    if (selectedWidgetId === widgetId) {
      setSelectedWidgetId("");
    }
    await reexecuteWidgets({ requestPolicy: "network-only" });
    setWidgetNotice("Custom widget deleted.");
    setDeletingWidgetId("");
    setWidgetDeleteConfirmId("");
  };

  const saveWidgetVideoRefs = async () => {
    if (!selectedWidget) {
      return;
    }
    const videoRefAttr = getAttributeBySlug(selectedWidget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
    const displayRulesAttr = getAttributeBySlug(selectedWidget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);

    if (!videoRefAttr) {
      setWidgetError("Selected widget is missing `magic-shoppable-video-refs`. Run one-click initialization first.");
      return;
    }

    setWidgetError("");
    setWidgetNotice("");
    setIsSavingWidgetVideos(true);

    const selectedRefs = Array.from(selectedVideoRefs);
    const attributes: AttributeValueInput[] = [];
    if (videoRefAttr) {
      if (selectedRefs.length === 0) {
        attributes.push({ id: videoRefAttr.attribute.id, values: [] });
      } else if (selectedRefs.length === 1) {
        attributes.push({ id: videoRefAttr.attribute.id, reference: selectedRefs[0] });
      } else {
        attributes.push({ id: videoRefAttr.attribute.id, references: selectedRefs });
      }
    }

    if (displayRulesAttr) {
      const currentRules = safeParseJsonObject(getTextValueBySlug(selectedWidget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules));
      const nextRules = {
        ...currentRules,
        "magic-shoppable-video-ids": selectedRefs,
        "magic-shoppable-widget-linked-at": new Date().toISOString(),
      };
      attributes.push({ id: displayRulesAttr.attribute.id, plainText: JSON.stringify(nextRules) });
    }

    const result = await updateWidget({
      id: selectedWidget.id,
      input: { attributes },
    });

    const mutationErrors = result.data?.pageUpdate?.errors || [];
    if (result.error || mutationErrors.length > 0) {
      setWidgetError(
        result.error?.message ||
          mutationErrors.map((error) => error.message || error.code).filter(Boolean).join(", ") ||
          "Unable to link videos with widget."
      );
      setIsSavingWidgetVideos(false);
      return;
    }

    setWidgetNotice(`Linked ${selectedRefs.length} video(s) to widget "${selectedWidget.title}".`);
    setIsSavingWidgetVideos(false);
  };

  const enrichedVideos = useMemo(
    () =>
      videos.map((video) => {
        const videoUrl =
          getFileUrlBySlug(video, SH_VIDEO_ATTR_SLUGS.videoFile) ||
          getFileUrlBySlug(video, SH_VIDEO_ATTR_SLUGS.legacyVideoFile);
        const thumbnailUrl = getFileUrlBySlug(video, SH_VIDEO_ATTR_SLUGS.thumbnail);
        const fileInfo = parseFileInfo(getTextValueBySlug(video, SH_VIDEO_ATTR_SLUGS.fileInfo));
        const linkedProducts =
          getReferenceValuesBySlug(video, SH_VIDEO_ATTR_SLUGS.products).length ||
          getReferenceValuesBySlug(video, SH_VIDEO_ATTR_SLUGS.legacyProducts).length;

        return {
          node: video,
          videoUrl,
          thumbnailUrl,
          fileInfo,
          linkedProducts,
        };
      }),
    [videos]
  );

  const filteredVideos = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    if (!query) return enrichedVideos;
    return enrichedVideos.filter((video) => {
      const haystack = `${video.node.title} ${video.node.slug}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [enrichedVideos, librarySearch]);

  const libraryTotalPages = Math.max(1, Math.ceil(filteredVideos.length / LIBRARY_PAGE_SIZE));
  const normalizedLibraryPage = Math.min(libraryPage, libraryTotalPages);
  const paginatedVideos = useMemo(() => {
    const startIndex = (normalizedLibraryPage - 1) * LIBRARY_PAGE_SIZE;
    return filteredVideos.slice(startIndex, startIndex + LIBRARY_PAGE_SIZE);
  }, [filteredVideos, normalizedLibraryPage]);

  useEffect(() => {
    setLibraryPage(1);
  }, [librarySearch]);

  useEffect(() => {
    if (libraryPage !== normalizedLibraryPage) {
      setLibraryPage(normalizedLibraryPage);
    }
  }, [libraryPage, normalizedLibraryPage]);

  const currentLibraryPageVideoIds = useMemo(
    () => paginatedVideos.map((video) => video.node.id),
    [paginatedVideos]
  );

  const allCurrentPageSelected =
    currentLibraryPageVideoIds.length > 0 &&
    currentLibraryPageVideoIds.every((videoId) => selectedLibraryVideoIds.has(videoId));

  const toggleLibraryVideoSelection = (videoId: string) => {
    setSelectedLibraryVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const toggleSelectAllCurrentLibraryPage = () => {
    setSelectedLibraryVideoIds((prev) => {
      const next = new Set(prev);
      if (allCurrentPageSelected) {
        currentLibraryPageVideoIds.forEach((videoId) => next.delete(videoId));
      } else {
        currentLibraryPageVideoIds.forEach((videoId) => next.add(videoId));
      }
      return next;
    });
  };

  useEffect(() => {
    setIsBulkDeleteConfirming(false);
  }, [selectedLibraryVideoIds, normalizedLibraryPage, librarySearch]);

  const unlinkVideosFromWidgets = useCallback(
    async (videoIds: string[]) => {
      let failed = 0;
      if (videoIds.length === 0 || widgets.length === 0) {
        return { failed };
      }

      for (const widget of widgets) {
        const refs = getReferenceValuesBySlug(widget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
        const rulesRaw = getTextValueBySlug(widget, SH_VIDEO_ATTR_SLUGS.legacyDisplayRules);
        const rules = safeParseJsonObject(rulesRaw);
        const legacyRefs = Array.isArray(rules["magic-shoppable-video-ids"])
          ? (rules["magic-shoppable-video-ids"] as unknown[]).filter(
              (value): value is string => typeof value === "string" && value.length > 0
            )
          : [];

        const nextRefs = refs.filter((ref) => !videoIds.includes(ref));
        const nextLegacyRefs = legacyRefs.filter((ref) => !videoIds.includes(ref));
        const refsChanged = nextRefs.length !== refs.length;
        const legacyChanged = nextLegacyRefs.length !== legacyRefs.length;

        if (!refsChanged && !legacyChanged) continue;

        const attrs: AttributeValueInput[] = [];
        const refsAttr = getAttributeBySlug(widget, SH_VIDEO_ATTR_SLUGS.widgetVideoRefs);
        if (refsAttr && refsChanged) {
          if (nextRefs.length === 0) {
            attrs.push({ id: refsAttr.attribute.id, values: [] });
          } else if (nextRefs.length === 1) {
            attrs.push({ id: refsAttr.attribute.id, reference: nextRefs[0] });
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

        const result = await updateWidget({
          id: widget.id,
          input: { attributes: attrs },
        });

        const mutationErrors = result.data?.pageUpdate?.errors || [];
        if (result.error || mutationErrors.length > 0) {
          failed += 1;
        }
      }

      return { failed };
    },
    [updateWidget, widgets]
  );

  const handleBulkDeleteVideos = async () => {
    if (selectedLibraryVideoIds.size === 0) return;
    const selectedIds = Array.from(selectedLibraryVideoIds);
    if (!isBulkDeleteConfirming) {
      setLibraryActionError("");
      setLibraryActionNotice(
        `Press "Delete selected" again to confirm removing ${selectedIds.length} video(s).`
      );
      setIsBulkDeleteConfirming(true);
      return;
    }

    setIsBulkDeletingVideos(true);
    setIsBulkDeleteConfirming(false);
    setLibraryActionNotice("");
    setLibraryActionError("");
    setMediaNotice("");
    setMediaError("");

    const unlinkSummary = await unlinkVideosFromWidgets(selectedIds);
    let deleted = 0;
    let failed = 0;
    const failedReasons: string[] = [];
    for (const videoId of selectedIds) {
      const result = await deleteWidget({ id: videoId });
      const mutationErrors = result.data?.pageDelete?.errors || [];
      if (result.error || mutationErrors.length > 0) {
        failed += 1;
        const reason =
          result.error?.message ||
          mutationErrors.map((item) => item.message || item.field).filter(Boolean).join(", ") ||
          "Unknown delete error";
        failedReasons.push(`${videoId}: ${reason}`);
      } else {
        deleted += 1;
      }
    }

    setSelectedLibraryVideoIds(new Set());
    await reexecuteVideos({ requestPolicy: "network-only" });
    if (widgetPageTypeIds.length > 0) {
      await reexecuteWidgets({ requestPolicy: "network-only" });
    }

    if (failed > 0) {
      setLibraryActionError(
        `Deleted: ${deleted}, failed: ${failed}.` +
          (unlinkSummary.failed > 0 ? ` Widget unlink updates failed: ${unlinkSummary.failed}.` : "") +
          (failedReasons.length > 0 ? ` ${failedReasons.slice(0, 2).join(" | ")}` : "")
      );
    } else {
      setLibraryActionNotice(
        `Deleted ${deleted} video(s) successfully.` +
          (unlinkSummary.failed > 0 ? ` Widget unlink updates failed: ${unlinkSummary.failed}.` : "")
      );
    }
    setIsBulkDeletingVideos(false);
  };

  if (fetchingVideoType || fetchingWidgetType || (videoPageTypeId && fetchingVideos)) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (!videoPageTypeId) {
    return (
      <Box padding={8}>
        <Text as="h1" size={7} fontWeight="bold">
          Video module is not initialized
        </Text>
        <Text as="p" color="default2" marginTop={2}>
          Run "One-Click Initialization" on dashboard to create shoppable video schema and attributes.
        </Text>
        <Box marginTop={4}>
          <Button variant="secondary" onClick={() => router.push("/")}>
            Go to Dashboard
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box padding={8} display="grid" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 10 }}>
        <Text as="h1" size={9} fontWeight="bold">
          Shoppable Videos
        </Text>
      </Box>

      <Box display="flex" gap={4} style={{ borderBottom: "1px solid #E5E7EB", flexWrap: "wrap" }}>
        {([
          ["media", "Media"],
          ["widgets", "Widgets"],
          ["metafields", "Metafields"],
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

      {activeTab === "media" ? (
        <Box display="grid" gap={4}>
          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={5}
            display="grid"
            gap={3}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 10 }}>
              <Text as="h3" size={6} fontWeight="bold">
                Media Upload
              </Text>
              <Button variant="primary" onClick={() => uploadInputRef.current?.click()} disabled={isUploadingJob}>
                <Upload size={14} /> {isUploadingJob ? "Processing..." : "Upload video files"}
              </Button>
              <input
                ref={uploadInputRef}
                type="file"
                accept="video/*"
                multiple
                onChange={onSelectFiles}
                style={{ display: "none" }}
              />
            </Box>

            <Text size={2} color="default2">
              Workflow: upload video (single/bulk), then run lossless passthrough upload job, then thumbnail
              extraction and metadata capture, then create shoppable video entries. Product linking is done after
              upload.
            </Text>

            {mediaError ? (
              <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
                <Text color="critical1">{mediaError}</Text>
              </Box>
            ) : null}
            {mediaNotice ? (
              <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
                <Text color="default2">{mediaNotice}</Text>
              </Box>
            ) : null}
          </Box>

          {uploadJobs.length === 0 ? (
            <Box
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={5}
              textAlign="center"
            >
              <Text size={2} color="default2">
                No upload jobs yet.
              </Text>
            </Box>
          ) : (
            uploadJobs.map((job) => {
              const completedCount = job.items.filter((item) => item.status === "completed").length;
              const failedCount = job.items.filter((item) => item.status === "failed").length;
              const totalProgress =
                job.items.length === 0
                  ? 0
                  : Math.round(job.items.reduce((sum, item) => sum + item.progressPercent, 0) / job.items.length);
              const statusColor =
                job.status === "failed" ? "#B42318" : job.status === "partial" ? "#B54708" : "#155EEF";

              return (
                <Box
                  key={job.id}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  padding={4}
                  display="grid"
                  gap={3}
                >
                  <Text size={3} fontWeight="bold">
                    Upload job {job.id}
                  </Text>
                  <Text size={2} color="default2">
                    Status: {job.status} | Imported: {completedCount} | Failed: {failedCount}
                  </Text>
                  <Box style={{ height: 8, borderRadius: 999, background: "#E4E7EC", overflow: "hidden" }}>
                    <Box
                      style={{
                        width: `${Math.max(2, totalProgress)}%`,
                        height: "100%",
                        background: statusColor,
                        transition: "width 200ms ease",
                      }}
                    />
                  </Box>

                  <Box style={{ overflowX: "auto" }}>
                    <Box style={{ minWidth: 860 }}>
                      {job.items.map((item) => (
                        <Box
                          key={item.id}
                          padding={3}
                          display="grid"
                          __gridTemplateColumns="2.2fr 1fr 1fr auto"
                          borderTopStyle="solid"
                          borderTopWidth={1}
                          borderColor="default1"
                          style={{ gap: 10, alignItems: "center" }}
                        >
                          <Text size={2} fontWeight="bold" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.fileName}
                          </Text>
                          <Text size={2} color="default2">
                            {statusLabel[item.status]}
                          </Text>
                          <Text size={2} color="default2">
                            {item.progressPercent}%
                          </Text>
                          {item.pageId ? (
                            <Button size="small" variant="secondary" onClick={() => router.push(`/videos/${item.pageId}`)}>
                              Edit
                            </Button>
                          ) : (
                            <Text size={1} color="critical1">
                              {item.error}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              );
            })
          )}

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 10 }}>
              <Text as="h3" size={6} fontWeight="bold">
                Video library
              </Text>
              <Input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search by title or slug"
                style={{ minWidth: 260, maxWidth: 360 }}
              />
            </Box>
            {libraryActionError ? (
              <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
                <Text color="critical1">{libraryActionError}</Text>
              </Box>
            ) : null}
            {libraryActionNotice ? (
              <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
                <Text color="default2">{libraryActionNotice}</Text>
              </Box>
            ) : null}

            {filteredVideos.length === 0 ? (
              <Box padding={6} textAlign="center">
                <Text size={2} color="default2">
                  {enrichedVideos.length === 0 ? "No videos found yet." : "No videos match your search."}
                </Text>
              </Box>
            ) : (
              <Box display="grid" gap={3} style={{ minHeight: 380 }}>
                <Box
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  padding={3}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  style={{ flexWrap: "wrap", gap: 10 }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      onChange={toggleSelectAllCurrentLibraryPage}
                    />
                    <Text size={2} color="default2">
                      Select all on this page ({currentLibraryPageVideoIds.length})
                    </Text>
                  </label>
                  <Box display="flex" gap={2} alignItems="center" style={{ flexWrap: "wrap" }}>
                    <Text size={2} color="default2">
                      Selected: {selectedLibraryVideoIds.size}
                    </Text>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => setSelectedLibraryVideoIds(new Set())}
                      disabled={selectedLibraryVideoIds.size === 0 || isBulkDeletingVideos}
                    >
                      Clear
                    </Button>
                    <Button
                      size="small"
                      variant="tertiary"
                      onClick={() => void handleBulkDeleteVideos()}
                      disabled={selectedLibraryVideoIds.size === 0 || isBulkDeletingVideos}
                      style={{ color: "#B42318" }}
                    >
                      {isBulkDeletingVideos
                        ? "Deleting..."
                        : isBulkDeleteConfirming
                          ? "Confirm delete"
                          : "Delete selected"}
                    </Button>
                  </Box>
                </Box>

                <Box
                  display="grid"
                  gap={4}
                  __gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))"
                  style={{ alignContent: "start" }}
                >
                  {paginatedVideos.map((video) => (
                    <Box
                      key={video.node.id}
                      borderStyle="solid"
                      borderWidth={1}
                      borderColor="default1"
                      borderRadius={4}
                      overflow="hidden"
                      display="grid"
                      style={{ gridTemplateRows: "auto 1fr" }}
                    >
                      <Box
                        style={{
                          aspectRatio: "1 / 1",
                          minHeight: 220,
                          background: "#F5F7FA",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {video.thumbnailUrl ? (
                          <img
                            src={video.thumbnailUrl}
                            alt={video.node.title}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : video.videoUrl ? (
                          <video
                            src={video.videoUrl}
                            preload="metadata"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <Video size={42} color="#667085" />
                        )}
                      </Box>

                      <Box padding={4} display="grid" gap={2} style={{ alignContent: "start" }}>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" style={{ gap: 8 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                            <input
                              type="checkbox"
                              checked={selectedLibraryVideoIds.has(video.node.id)}
                              onChange={() => toggleLibraryVideoSelection(video.node.id)}
                            />
                            <Text as="h4" size={4} fontWeight="bold">
                              {video.node.title}
                            </Text>
                          </label>
                        </Box>
                        <Text size={2} color="default2">
                          {video.linkedProducts} product(s) linked
                        </Text>
                        {video.fileInfo ? (
                          <Box display="grid" gap={1} marginTop={1}>
                            <Text size={1} color="default2">
                              Uploaded by: {video.fileInfo.uploadedBy}
                            </Text>
                            <Text size={1} color="default2">
                              Uploaded on: {video.fileInfo.uploadedAtLabel}
                            </Text>
                            <Text size={1} color="default2">
                              Optimized file size: {formatBytes(video.fileInfo.optimizedFileSizeBytes)}
                            </Text>
                          </Box>
                        ) : null}
                        <Box marginTop={2} display="flex" gap={2}>
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => router.push(`/videos/${video.node.id}?tab=products`)}
                            style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}
                          >
                            <Link2 size={15} /> Link products
                          </Button>
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => router.push(`/videos/${video.node.id}`)}
                            style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}
                          >
                            <Edit size={16} /> Edit
                          </Button>
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </Box>

                <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 10 }}>
                  <Text size={2} color="default2">
                    Showing {(normalizedLibraryPage - 1) * LIBRARY_PAGE_SIZE + 1}-
                    {Math.min(normalizedLibraryPage * LIBRARY_PAGE_SIZE, filteredVideos.length)} of {filteredVideos.length}
                  </Text>
                  <Box display="flex" gap={2} alignItems="center">
                    <Text size={1} color="default2">
                      Page {normalizedLibraryPage} of {libraryTotalPages} • {LIBRARY_PAGE_SIZE} per page
                    </Text>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => setLibraryPage((prev) => Math.max(1, prev - 1))}
                      disabled={normalizedLibraryPage <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => setLibraryPage((prev) => Math.min(libraryTotalPages, prev + 1))}
                      disabled={normalizedLibraryPage >= libraryTotalPages}
                    >
                      Next
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      ) : null}

      {activeTab === "widgets" ? (
        <Box display="grid" gap={4}>
          {widgetError ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
              <Text color="critical1">{widgetError}</Text>
            </Box>
          ) : null}
          {widgetNotice ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
              <Text color="default2">{widgetNotice}</Text>
            </Box>
          ) : null}

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ gap: 12 }}>
              <Box display="grid" gap={1}>
                <Text as="h3" size={6} fontWeight="bold">
                  Core widgets (locked)
                </Text>
                <Text size={2} color="default2">
                  Homepage and PDP carousels. Always available — edit videos only, cannot delete.
                </Text>
              </Box>
              {isEnsuringCoreWidgets ? <Spinner /> : null}
            </Box>

            {!shoppableWidgetPageType ? (
              <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
                <Text color="critical1">
                  Page type `magic-widget-shoppable` not found. Run One-Click Initialization first.
                </Text>
              </Box>
            ) : fetchingWidgets && coreWidgetListItems.length === 0 ? (
              <Box display="flex" justifyContent="center" padding={4}>
                <Spinner />
              </Box>
            ) : coreWidgetListItems.length === 0 ? (
              <Text size={2} color="default2">
                Core widgets are being prepared… reopen this tab if they do not appear.
              </Text>
            ) : (
              <Box display="grid" gap={2}>
                {coreWidgetListItems.map((widget) => {
                  const isActive = widget.id === selectedWidgetId;
                  return (
                    <Box
                      key={widget.id}
                      borderStyle="solid"
                      borderWidth={1}
                      borderColor="default1"
                      borderRadius={4}
                      padding={3}
                      display="grid"
                      __gridTemplateColumns="minmax(0, 1.4fr) minmax(0, 1fr) auto auto"
                      alignItems="center"
                      style={{ gap: 10, background: isActive ? "#F8FAFC" : "#fff" }}
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Text size={2} fontWeight="bold">
                          {widget.displayName}{" "}
                          <Text as="span" size={1} color="default2">
                            · Core
                          </Text>
                        </Text>
                      </Box>
                      <Text
                        size={1}
                        color="default2"
                        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {widget.slug}
                      </Text>
                      <Text size={1} color="default2">
                        {widget.linkedVideoCount} videos
                      </Text>
                      <Button
                        size="small"
                        variant={isActive ? "primary" : "secondary"}
                        onClick={() => setSelectedWidgetId(widget.id)}
                      >
                        {isActive ? "Selected" : "Manage videos"}
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ gap: 12 }}>
              <Box display="grid" gap={1}>
                <Text as="h3" size={6} fontWeight="bold">
                  Custom widgets
                </Text>
                <Text size={2} color="default2">
                  Optional playlists for other CMS pages. Create and delete via the popup.
                </Text>
              </Box>
              <Button
                variant="primary"
                onClick={() => {
                  setWidgetError("");
                  setIsCreateWidgetPopupOpen(true);
                }}
                disabled={!shoppableWidgetPageType}
              >
                Add custom widget
              </Button>
            </Box>

            {fetchingWidgets && customWidgetListItems.length === 0 ? (
              <Box display="flex" justifyContent="center" padding={4}>
                <Spinner />
              </Box>
            ) : customWidgetListItems.length === 0 ? (
              <Text size={2} color="default2">
                No custom widgets yet.
              </Text>
            ) : (
              <Box display="grid" gap={2}>
                {customWidgetListItems.map((widget) => {
                  const isActive = widget.id === selectedWidgetId;
                  const confirmingDelete = widgetDeleteConfirmId === widget.id;
                  return (
                    <Box
                      key={widget.id}
                      borderStyle="solid"
                      borderWidth={1}
                      borderColor="default1"
                      borderRadius={4}
                      padding={3}
                      display="grid"
                      __gridTemplateColumns="minmax(0, 1.2fr) minmax(0, 1fr) auto auto auto"
                      alignItems="center"
                      style={{ gap: 10, background: isActive ? "#F8FAFC" : "#fff" }}
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Text size={2} fontWeight="bold">
                          {widget.displayName}
                        </Text>
                      </Box>
                      <Text
                        size={1}
                        color="default2"
                        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {widget.slug}
                      </Text>
                      <Text size={1} color="default2">
                        {widget.linkedVideoCount} videos
                      </Text>
                      <Button
                        size="small"
                        variant={isActive ? "primary" : "secondary"}
                        onClick={() => setSelectedWidgetId(widget.id)}
                      >
                        {isActive ? "Selected" : "Manage videos"}
                      </Button>
                      {confirmingDelete ? (
                        <Box display="flex" style={{ gap: 6 }}>
                          <Button
                            size="small"
                            variant="secondary"
                            disabled={deletingWidgetId === widget.id}
                            onClick={() => void deleteCustomWidget(widget.id, widget.slug)}
                          >
                            {deletingWidgetId === widget.id ? "Deleting…" : "Confirm"}
                          </Button>
                          <Button size="small" variant="secondary" onClick={() => setWidgetDeleteConfirmId("")}>
                            Cancel
                          </Button>
                        </Box>
                      ) : (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => setWidgetDeleteConfirmId(widget.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          {selectedWidgetId ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
              {fetchingWidgets ? (
                <Box display="flex" justifyContent="center">
                  <Spinner />
                </Box>
              ) : enrichedVideos.length === 0 ? (
                <Text size={2} color="default2">
                  Upload videos first in Media tab.
                </Text>
              ) : (
                <>
                  <Text as="h4" size={4} fontWeight="bold">
                    Edit videos for {selectedWidgetListItem?.displayName || selectedWidget?.title || "selected widget"}
                    {selectedWidgetListItem?.isCore ? " (Core)" : ""}
                  </Text>
                  <Text size={2} color="default2">
                    Selected videos: {selectedVideoRefs.size}
                  </Text>
                  <Box display="grid" gap={2}>
                    {enrichedVideos.map((video) => (
                      <label
                        key={video.node.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          border: "1px solid #E4E7EC",
                          borderRadius: 8,
                          padding: "8px 10px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedVideoRefs.has(video.node.id)}
                          onChange={() => toggleWidgetVideoRef(video.node.id)}
                        />
                        <Text size={2} style={{ flex: 1 }}>
                          {video.node.title}
                        </Text>
                        <Text size={1} color="default2">
                          {video.linkedProducts} products
                        </Text>
                      </label>
                    ))}
                  </Box>
                  <Box display="flex" justifyContent="flex-end">
                    <Button variant="primary" onClick={() => void saveWidgetVideoRefs()} disabled={isSavingWidgetVideos}>
                      <Link2 size={14} /> {isSavingWidgetVideos ? "Saving..." : "Save widget video references"}
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          ) : null}

          {isCreateWidgetPopupOpen ? (
            <Box
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "rgba(15, 23, 42, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
              onClick={() => {
                if (!isCreatingWidget) setIsCreateWidgetPopupOpen(false);
              }}
            >
              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                padding={4}
                display="grid"
                gap={3}
                style={{ width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "#fff" }}
                onClick={(event) => event.stopPropagation()}
              >
                <Text as="h3" size={6} fontWeight="bold">
                  Add custom widget
                </Text>
                <Text size={2} color="default2">
                  Core Homepage/PDP widgets stay locked. This creates an optional custom playlist.
                </Text>

                <Box display="grid" gap={1}>
                  <Text size={1} color="default2">
                    Widget name
                  </Text>
                  <Input
                    value={newWidgetName}
                    onChange={(event) => setNewWidgetName(event.target.value)}
                    placeholder="Campaign reels"
                  />
                </Box>

                {enrichedVideos.length === 0 ? (
                  <Text size={2} color="default2">
                    Upload videos first in Media tab.
                  </Text>
                ) : (
                  <Box display="grid" gap={2}>
                    <Text size={2} color="default2">
                      Select videos (optional): {newWidgetVideoRefs.size}
                    </Text>
                    <Box display="grid" gap={2} style={{ maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
                      {enrichedVideos.map((video) => (
                        <label
                          key={`new_${video.node.id}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            border: "1px solid #E4E7EC",
                            borderRadius: 8,
                            padding: "8px 10px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={newWidgetVideoRefs.has(video.node.id)}
                            onChange={() => toggleNewWidgetVideoRef(video.node.id)}
                          />
                          <Text size={2} style={{ flex: 1 }}>
                            {video.node.title}
                          </Text>
                          <Text size={1} color="default2">
                            {video.linkedProducts} products
                          </Text>
                        </label>
                      ))}
                    </Box>
                  </Box>
                )}

                <Box display="flex" justifyContent="flex-end" style={{ gap: 8 }}>
                  <Button
                    variant="secondary"
                    disabled={isCreatingWidget}
                    onClick={() => {
                      setIsCreateWidgetPopupOpen(false);
                      setNewWidgetName("");
                      setNewWidgetVideoRefs(new Set());
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void createShoppableWidget()}
                    disabled={isCreatingWidget || !shoppableWidgetPageType}
                  >
                    {isCreatingWidget ? "Creating..." : "Create widget"}
                  </Button>
                </Box>
              </Box>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {activeTab === "metafields" ? (
        <Box display="grid" gap={4}>
          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
            <Text as="h3" size={6} fontWeight="bold">
              Shoppable Video Fields
            </Text>
            <Text size={2} color="default2">
              Use these fields for storefront integration and widget mapping.
            </Text>

            <Box style={{ overflowX: "auto" }}>
              <Box style={{ minWidth: 780 }}>
                <Box
                  padding={3}
                  display="grid"
                  __gridTemplateColumns="1.3fr 1.1fr 1.8fr"
                  style={{ backgroundColor: "#f8fafc", gap: 10 }}
                >
                  <Text size={2} fontWeight="bold">
                    Field
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Source
                  </Text>
                  <Text size={2} fontWeight="bold">
                    Purpose
                  </Text>
                </Box>

                {[
                  ["magic-shoppable-video-file", "Attribute (file)", "Primary video file URL"],
                  ["magic-shoppable-video-thumbnail", "Attribute (file)", "Extracted video thumbnail URL"],
                  ["magic-shoppable-products", "Attribute (reference)", "Linked Saleor product IDs for shoppable tags"],
                  ["magic-shoppable-file-info", "Attribute (plain text JSON)", "Uploaded by/on, size, duration, mime, resolution"],
                  ["magic-shoppable-widget-name", "Widget attribute (plain text)", "Widget display name identifier"],
                  ["magic-shoppable-video-refs", "Widget attribute (reference)", "Selected video references in widget"],
                  ["widget page type", "PageType.slug", "Fixed: magic-widget-shoppable"],
                  ["video slug", "Page.slug", "Auto-generated: magic-shoppable-{unique_id}"],
                  ["widget slug", "Page.slug", "Auto-generated/prefixed: magic-widget-shoppable-*"],
                ].map((row) => (
                  <Box
                    key={row[0]}
                    padding={3}
                    display="grid"
                    __gridTemplateColumns="1.3fr 1.1fr 1.8fr"
                    borderTopStyle="solid"
                    borderTopWidth={1}
                    borderColor="default1"
                    style={{ gap: 10 }}
                  >
                    <Text size={2} fontWeight="bold">
                      {row[0]}
                    </Text>
                    <Text size={2}>{row[1]}</Text>
                    <Text size={2} color="default2">
                      {row[2]}
                    </Text>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} display="grid" gap={3}>
            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ gap: 10, flexWrap: "wrap" }}>
              <Text as="h3" size={6} fontWeight="bold">
                Storefront query
              </Text>
              <Button variant="secondary" onClick={() => void copyStorefrontQuery()}>
                {copiedQuery ? <Check size={14} /> : <Copy size={14} />}
                {copiedQuery ? "Copied" : "Copy query"}
              </Button>
            </Box>
            <Box
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={3}
              style={{ background: "#F8FAFC", overflowX: "auto" }}
            >
              <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: "pre" }}>{STOREFRONT_QUERY_SNIPPET}</pre>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
