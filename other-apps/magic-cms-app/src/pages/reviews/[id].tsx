import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Text, Spinner } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import {
  useGetWidgetQuery,
  useGetReviewPageTypeQuery,
  useUpdateWidgetMutation,
  useDeleteWidgetMutation,
} from "../../../generated/graphql";
import { useState, useEffect, useMemo, useRef } from "react";
import { CheckCircle, XCircle, AlertCircle, Trash2 } from "lucide-react";
import { extractVideoAsset, uploadFileToSaleor } from "@/lib/shoppable-video-upload";
import {
  REVIEW_WIDGET_ATTR_SLUGS,
  parseReviewVideoEntries,
  serializeReviewVideoEntries,
  type ReviewVideoEntry,
} from "@/lib/reviews-widget";

type ParsedReviewContent = {
  bodyLines: string[];
  reviewerLine: string;
  emailLine: string;
  reviewDateLine: string;
  adminReplyLine: string;
};

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const toText = (value: unknown) => {
  if (typeof value === "string") return stripHtml(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const parseReviewContent = (content: unknown): ParsedReviewContent => {
  const fallback: ParsedReviewContent = {
    bodyLines: [],
    reviewerLine: "",
    emailLine: "",
    reviewDateLine: "",
    adminReplyLine: "",
  };

  if (!content) return fallback;

  let parsed: unknown = content;
  if (typeof content === "string") {
    let candidate: unknown = content;
    for (let pass = 0; pass < 2; pass += 1) {
      if (typeof candidate !== "string") {
        break;
      }
      try {
        candidate = JSON.parse(candidate);
      } catch {
        break;
      }
    }
    parsed = candidate;
    if (typeof parsed === "string") {
      const plain = stripHtml(content);
      return {
        ...fallback,
        bodyLines: plain ? [plain] : [],
      };
    }
  }

  if (!parsed || typeof parsed !== "object") {
    const plain = toText(parsed);
    return {
      ...fallback,
      bodyLines: plain ? [plain] : [],
    };
  }

  const structured = parsed as {
    blocks?: Array<{ data?: { text?: unknown } }>;
    body?: unknown;
    review?: unknown;
    content?: unknown;
    text?: unknown;
    reply?: unknown;
    reviewer_name?: unknown;
    reviewer_email?: unknown;
    review_date?: unknown;
  };

  const lines: string[] = [];
  const pushLine = (line: string) => {
    if (!line) return;
    lines.push(line);
  };

  if (Array.isArray(structured.blocks)) {
    for (const block of structured.blocks) {
      const text = toText(block?.data?.text);
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower.startsWith("reviewer:")) {
        fallback.reviewerLine = text.replace(/^reviewer:\s*/i, "");
      } else if (lower.startsWith("email:")) {
        fallback.emailLine = text.replace(/^email:\s*/i, "");
      } else if (lower.startsWith("review date:")) {
        fallback.reviewDateLine = text.replace(/^review date:\s*/i, "");
      } else if (lower.startsWith("admin reply:")) {
        fallback.adminReplyLine = text.replace(/^admin reply:\s*/i, "");
      } else {
        pushLine(text);
      }
    }
  }

  const directBody = toText(structured.body || structured.review || structured.content || structured.text);
  if (directBody) {
    pushLine(directBody);
  }

  if (!fallback.reviewerLine) fallback.reviewerLine = toText(structured.reviewer_name);
  if (!fallback.emailLine) fallback.emailLine = toText(structured.reviewer_email);
  if (!fallback.reviewDateLine) fallback.reviewDateLine = toText(structured.review_date);
  if (!fallback.adminReplyLine) fallback.adminReplyLine = toText(structured.reply);

  return {
    ...fallback,
    bodyLines: lines,
  };
};

type EditorJsContent = {
  time?: number;
  blocks?: Array<{ type?: string; data?: { text?: string } }>;
  version?: string;
};

const syncAdminReplyIntoContent = (content: unknown, reply: string): string => {
  const trimmedReply = reply.trim();
  let parsed: EditorJsContent | undefined;

  if (typeof content === "string" && content.trim()) {
    try {
      parsed = JSON.parse(content) as EditorJsContent;
    } catch {
      parsed = undefined;
    }
  } else if (content && typeof content === "object") {
    parsed = content as EditorJsContent;
  }

  const existingBlocks = parsed?.blocks;
  const blocks = Array.isArray(existingBlocks)
    ? existingBlocks.filter((block) => {
        const text = String(block?.data?.text || "").trim();
        return !/^admin reply:\s*/i.test(text);
      })
    : [];

  if (trimmedReply) {
    blocks.push({
      type: "paragraph",
      data: { text: `Admin reply: ${trimmedReply}` },
    });
  }

  return JSON.stringify({
    time: parsed?.time || Date.now(),
    blocks,
    version: parsed?.version || "2.28.0",
  });
};

const parseReviewImageUrls = (page: {
  attributes: ReadonlyArray<{
    attribute: { slug?: string | null };
    values: ReadonlyArray<{
      plainText?: string | null;
      name?: string | null;
      file?: { url?: string | null } | null;
    }>;
  }>;
}): string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    const url = String(raw || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const imagesAttr = page.attributes.find((a) => a.attribute.slug === REVIEW_WIDGET_ATTR_SLUGS.images);
  const imagesRaw = imagesAttr?.values[0]?.plainText || imagesAttr?.values[0]?.name || "";
  if (imagesRaw) {
    try {
      const parsed = JSON.parse(imagesRaw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) push(String(item));
      } else {
        push(String(parsed));
      }
    } catch {
      for (const part of imagesRaw.split(/[\n,]+/)) push(part);
    }
  }

  push(page.attributes.find((a) => a.attribute.slug === REVIEW_WIDGET_ATTR_SLUGS.media)?.values[0]?.file?.url);
  return urls;
};

export default function ReviewDetailsPage() {
  const router = useRouter();
  const { appBridge, appBridgeState } = useAppBridge();
  const { id } = router.query;
  const widgetId = typeof id === "string" ? id : "";
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const [{ data, fetching, error }, reexecuteGetWidget] = useGetWidgetQuery({
    variables: { id: widgetId },
    pause: !widgetId,
  });
  const [{ data: typeData }] = useGetReviewPageTypeQuery({
    requestPolicy: "network-only",
  });

  const [, updateWidget] = useUpdateWidgetMutation();
  const [, deleteWidget] = useDeleteWidgetMutation();
  const [status, setStatus] = useState("pending");
  const [adminReply, setAdminReply] = useState("");
  const [location, setLocation] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [videoEntries, setVideoEntries] = useState<ReviewVideoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [activeTab, setActiveTab] = useState<"data" | "moderation" | "reply">("moderation");

  const parsedContent = useMemo(() => parseReviewContent(data?.page?.content), [data?.page?.content]);

  const pageTypeAttrs = typeData?.pageTypes?.edges[0]?.node?.attributes || [];

  const adminReplyAttrId = useMemo(() => {
    const fromPage = data?.page?.attributes.find((a) => a.attribute.slug === "magic-admin-reply")?.attribute
      .id;
    if (fromPage) return fromPage;
    return pageTypeAttrs.find((attribute) => attribute.slug === "magic-admin-reply")?.id;
  }, [data?.page?.attributes, pageTypeAttrs]);

  const resolveAttrId = (slug: string) =>
    data?.page?.attributes.find((a) => a.attribute.slug === slug)?.attribute.id ||
    pageTypeAttrs.find((attribute) => attribute.slug === slug)?.id;

  useEffect(() => {
    if (data?.page) {
      const statusAttr = data.page.attributes.find((a) => a.attribute.slug === "magic-status");
      const val = statusAttr?.values[0]?.slug || statusAttr?.values[0]?.name || "pending";
      setStatus(val.toLowerCase());

      const replyAttr = data.page.attributes.find((a) => a.attribute.slug === "magic-admin-reply");
      const replyFromAttr =
        replyAttr?.values[0]?.plainText || replyAttr?.values[0]?.name || replyAttr?.values[0]?.value || "";
      setAdminReply(String(replyFromAttr || parsedContent.adminReplyLine || "").trim());

      const locationAttr = data.page.attributes.find((a) => a.attribute.slug === REVIEW_WIDGET_ATTR_SLUGS.location);
      setLocation(
        String(locationAttr?.values[0]?.plainText || locationAttr?.values[0]?.name || "").trim(),
      );
      setImageUrls(parseReviewImageUrls(data.page));
      const videosAttr = data.page.attributes.find((a) => a.attribute.slug === REVIEW_WIDGET_ATTR_SLUGS.videos);
      setVideoEntries(
        parseReviewVideoEntries(videosAttr?.values[0]?.plainText || videosAttr?.values[0]?.name || ""),
      );
    }
  }, [data, parsedContent.adminReplyLine]);

  useEffect(() => {
    setIsDeleteConfirming(false);
  }, [widgetId]);

  const handleUpdateStatus = async (newStatus: string) => {
    const previousStatus = status;
    setLoading(true);
    setActionError("");
    setActionNotice("");
    setStatus(newStatus); // Optimistic

    const statusAttr = data?.page?.attributes.find((a) => a.attribute.slug === "magic-status");
    if (!statusAttr) {
      setActionError("Status attribute not found.");
      setLoading(false);
      return;
    }

    const result = await updateWidget({
      id: widgetId,
      input: {
        attributes: [
          {
            id: statusAttr.attribute.id,
            dropdown: {
              value: newStatus,
            },
          },
        ],
      },
    });

    setLoading(false);
    if (result.error || result.data?.pageUpdate?.errors?.length) {
      setStatus(previousStatus);
      const msg =
        result.error?.message ||
        result.data?.pageUpdate?.errors?.map((e) => e.message).join(", ") ||
        "Unable to update status.";
      setActionError(msg);
      return;
    }
    setActionNotice(`Status updated to ${newStatus}.`);
  };

  const handleSaveAdminReply = async () => {
    setLoading(true);
    setActionError("");
    setActionNotice("");

    const trimmed = adminReply.trim();
    const nextContent = syncAdminReplyIntoContent(data?.page?.content, trimmed);
    const input: {
      content: string;
      attributes?: Array<{ id: string; plainText: string }>;
    } = {
      content: nextContent,
    };

    if (adminReplyAttrId) {
      input.attributes = [{ id: adminReplyAttrId, plainText: trimmed }];
    }

    const result = await updateWidget({
      id: widgetId,
      input,
    });

    setLoading(false);
    if (result.error || result.data?.pageUpdate?.errors?.length) {
      const msg =
        result.error?.message ||
        result.data?.pageUpdate?.errors?.map((e) => e.message).join(", ") ||
        "Unable to save admin reply.";
      setActionError(msg);
      return;
    }

    setAdminReply(trimmed);
    setActionNotice(
      trimmed
        ? "Admin reply saved. It will show on the storefront for approved reviews."
        : "Admin reply cleared.",
    );
    reexecuteGetWidget({ requestPolicy: "network-only" });
  };

  const persistMediaAndLocation = async (nextImages: string[], nextVideos: ReviewVideoEntry[], nextLocation: string) => {
    const attributes: Array<
      | { id: string; plainText: string }
      | { id: string; file: string }
    > = [];

    const locationAttrId = resolveAttrId(REVIEW_WIDGET_ATTR_SLUGS.location);
    const imagesAttrId = resolveAttrId(REVIEW_WIDGET_ATTR_SLUGS.images);
    const videosAttrId = resolveAttrId(REVIEW_WIDGET_ATTR_SLUGS.videos);
    const mediaAttrId = resolveAttrId(REVIEW_WIDGET_ATTR_SLUGS.media);

    if (locationAttrId) {
      attributes.push({ id: locationAttrId, plainText: nextLocation.trim() });
    }
    if (imagesAttrId) {
      attributes.push({ id: imagesAttrId, plainText: JSON.stringify(nextImages) });
    }
    if (videosAttrId) {
      attributes.push({ id: videosAttrId, plainText: serializeReviewVideoEntries(nextVideos) });
    }
    if (mediaAttrId && nextImages[0]) {
      attributes.push({ id: mediaAttrId, file: nextImages[0] });
    }

    if (attributes.length === 0) {
      throw new Error(
        "Review media/location attributes missing. Run Magic CMS One-Click Update, then retry.",
      );
    }

    const result = await updateWidget({
      id: widgetId,
      input: { attributes },
    });

    if (result.error || result.data?.pageUpdate?.errors?.length) {
      throw new Error(
        result.error?.message ||
          result.data?.pageUpdate?.errors?.map((e) => e.message).filter(Boolean).join(", ") ||
          "Unable to save media/location.",
      );
    }
  };

  const handleSaveLocationAndMedia = async () => {
    setLoading(true);
    setActionError("");
    setActionNotice("");
    try {
      await persistMediaAndLocation(imageUrls, videoEntries, location);
      setActionNotice("Location and media saved.");
      reexecuteGetWidget({ requestPolicy: "network-only" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  };

  const uploadAuth = () => {
    const token = appBridge?.getState().token || appBridgeState?.token || "";
    const saleorApiUrl = appBridgeState?.saleorApiUrl || "";
    if (!token || !saleorApiUrl) {
      throw new Error("Saleor auth missing. Re-open Magic CMS from the dashboard.");
    }
    return { token, saleorApiUrl };
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setMediaUploading(true);
    setActionError("");
    setActionNotice("");
    try {
      const { token, saleorApiUrl } = uploadAuth();
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          throw new Error(`Skipped non-image file: ${file.name}`);
        }
        const result = await uploadFileToSaleor({ saleorApiUrl, token, file });
        uploaded.push(result.url);
      }
      const nextImages = [...imageUrls];
      for (const url of uploaded) {
        if (!nextImages.includes(url)) nextImages.push(url);
      }
      setImageUrls(nextImages);
      await persistMediaAndLocation(nextImages, videoEntries, location);
      setActionNotice(`Uploaded ${uploaded.length} image(s).`);
      reexecuteGetWidget({ requestPolicy: "network-only" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Image upload failed.");
    } finally {
      setMediaUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleVideoUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setMediaUploading(true);
    setActionError("");
    setActionNotice("");
    try {
      const { token, saleorApiUrl } = uploadAuth();
      const uploaded: ReviewVideoEntry[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("video/")) {
          throw new Error(`Skipped non-video file: ${file.name}`);
        }
        const asset = await extractVideoAsset(file);
        const videoUpload = await uploadFileToSaleor({ saleorApiUrl, token, file });
        let poster = "";
        if (asset.thumbnail) {
          const posterUpload = await uploadFileToSaleor({
            saleorApiUrl,
            token,
            file: asset.thumbnail,
          });
          poster = posterUpload.url;
        }
        uploaded.push({
          url: videoUpload.url,
          ...(poster ? { poster } : {}),
          ...(asset.durationSeconds > 0
            ? { durationSeconds: Math.round(asset.durationSeconds) }
            : {}),
        });
      }
      const nextVideos = [...videoEntries];
      for (const entry of uploaded) {
        if (!nextVideos.some((v) => v.url === entry.url)) nextVideos.push(entry);
      }
      setVideoEntries(nextVideos);
      await persistMediaAndLocation(imageUrls, nextVideos, location);
      setActionNotice(`Uploaded ${uploaded.length} video(s).`);
      reexecuteGetWidget({ requestPolicy: "network-only" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Video upload failed.");
    } finally {
      setMediaUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  const removeImage = async (url: string) => {
    const nextImages = imageUrls.filter((item) => item !== url);
    setImageUrls(nextImages);
    setLoading(true);
    setActionError("");
    try {
      await persistMediaAndLocation(nextImages, videoEntries, location);
      setActionNotice("Image removed.");
      reexecuteGetWidget({ requestPolicy: "network-only" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to remove image.");
    } finally {
      setLoading(false);
    }
  };

  const removeVideo = async (url: string) => {
    const nextVideos = videoEntries.filter((item) => item.url !== url);
    setVideoEntries(nextVideos);
    setLoading(true);
    setActionError("");
    try {
      await persistMediaAndLocation(imageUrls, nextVideos, location);
      setActionNotice("Video removed.");
      reexecuteGetWidget({ requestPolicy: "network-only" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to remove video.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isDeleteConfirming) {
      setActionError("");
      setActionNotice("Press delete again to confirm removal.");
      setIsDeleteConfirming(true);
      return;
    }

    setLoading(true);
    setActionError("");
    setActionNotice("");
    const deleteId = data?.page?.id || widgetId;
    const result = await deleteWidget({ id: deleteId });

    if (result.error || result.data?.pageDelete?.errors?.length) {
      setLoading(false);
      const msg =
        result.error?.message ||
        result.data?.pageDelete?.errors?.map((e) => e.message || e.field).filter(Boolean).join(", ") ||
        "Unable to delete review.";
      setActionError(msg);
      setIsDeleteConfirming(false);
    } else {
      setActionNotice("Review deleted successfully.");
      setIsDeleteConfirming(false);
      router.push(`/reviews?refresh=${Date.now()}`);
    }
  };

  if (fetching) return <Box padding={8}><Spinner /></Box>;
  if (error) return <Box padding={8}><Text color="critical1">Error loading review: {error.message}</Text></Box>;
  if (!data?.page) return <Box padding={8}><Text>Review not found</Text></Box>;

  return (
    <Box padding={8}>
      <Box
        marginBottom={6}
        display="grid"
        __gridTemplateColumns="minmax(0, 3fr) minmax(0, 2fr)"
        alignItems="center"
        style={{ borderBottom: "1px solid #E6E6E6", gap: 12 }}
        paddingBottom={4}
      >
        <Box>
          <Text as="h1" size={9} fontWeight="bold">{data.page.title}</Text>
          <Text as="p" size={3} color="default2" marginTop={2}>
            Review for {data.page.pageType.name} — {widgetId}
          </Text>
        </Box>
        <Box display="flex" gap={2} justifyContent="flex-end" style={{ flexWrap: "wrap" }}>
          <Button
            variant="tertiary"
            onClick={handleDelete}
            disabled={loading}
            style={{ color: "#DC3545" }}
          >
            <Trash2 size={16} /> {isDeleteConfirming ? "Confirm delete" : "Delete"}
          </Button>
          {isDeleteConfirming ? (
            <Button
              variant="secondary"
              onClick={() => {
                setIsDeleteConfirming(false);
                setActionNotice("");
              }}
              disabled={loading}
            >
              Cancel
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => router.push("/reviews")}>
            Back to List
          </Button>
          <Box
            padding={2}
            borderRadius={4}
            style={{
              backgroundColor:
                status === "approved" ? "#E1F5FE" : status === "rejected" ? "#FEEBEE" : "#FFF8E1",
              display: "flex",
              alignItems: "center",
              paddingLeft: 16,
              paddingRight: 16,
            }}
          >
            <Text size={2} color="default2" fontWeight="bold" textTransform="uppercase">
              {status}
            </Text>
          </Box>
        </Box>
      </Box>
      {actionError ? (
        <Box marginBottom={4} borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
          <Text color="critical1">{actionError}</Text>
        </Box>
      ) : null}
      {actionNotice ? (
        <Box marginBottom={4} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
          <Text color="default2">{actionNotice}</Text>
        </Box>
      ) : null}

      <Box display="flex" gap={4} marginBottom={6} style={{ borderBottom: "1px solid #E6E6E6" }}>
        <Button
          variant="tertiary"
          onClick={() => setActiveTab("moderation")}
          style={{
            borderBottom: activeTab === "moderation" ? "2px solid #28234A" : "none",
            borderRadius: 0,
            paddingBottom: 12,
          }}
        >
          Moderation
        </Button>
        <Button
          variant="tertiary"
          onClick={() => setActiveTab("data")}
          style={{
            borderBottom: activeTab === "data" ? "2px solid #28234A" : "none",
            borderRadius: 0,
            paddingBottom: 12,
          }}
        >
          Review Content
        </Button>
        <Button
          variant="tertiary"
          onClick={() => setActiveTab("reply")}
          style={{
            borderBottom: activeTab === "reply" ? "2px solid #28234A" : "none",
            borderRadius: 0,
            paddingBottom: 12,
          }}
        >
          Admin Reply
        </Button>
      </Box>

      <Box display="grid" gap={6} style={{ maxWidth: 800 }}>
        {activeTab === "moderation" && (
          <Box display="grid" gap={6}>
            <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
              <Text as="h3" size={4} fontWeight="bold" marginBottom={4}>
                Action Center
              </Text>
              <Box display="flex" gap={4}>
                <Button
                  variant={status === "approved" ? "primary" : "secondary"}
                  onClick={() => handleUpdateStatus("approved")}
                  style={{ flex: 1, display: "flex", justifyContent: "center", gap: 8 }}
                  disabled={loading}
                >
                  Approve <CheckCircle size={18} />
                </Button>
                <Button
                  variant={status === "rejected" ? "error" : "secondary"}
                  onClick={() => handleUpdateStatus("rejected")}
                  style={{ flex: 1, display: "flex", justifyContent: "center", gap: 8 }}
                  disabled={loading}
                >
                  Reject <XCircle size={18} />
                </Button>
                <Button
                  variant={status === "pending" ? "tertiary" : "secondary"}
                  onClick={() => handleUpdateStatus("pending")}
                  style={{ flex: 1, display: "flex", justifyContent: "center", gap: 8 }}
                  disabled={loading}
                >
                  Pending <AlertCircle size={18} />
                </Button>
              </Box>
              <Text as="p" size={2} color="default2" marginTop={6}>
                Approved reviews will be visible on the storefront. Rejected reviews are hidden.
              </Text>
            </Box>
          </Box>
        )}

        {activeTab === "reply" && (
          <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
            <Text as="h3" size={4} fontWeight="bold" marginBottom={2}>
              Admin Reply
            </Text>
            <Text as="p" size={2} color="default2" marginBottom={4}>
              Reply publicly to this review. It appears on the storefront under the customer comment when
              the review is approved.
            </Text>
            <textarea
              value={adminReply}
              onChange={(event) => setAdminReply(event.target.value)}
              rows={6}
              placeholder="Write a reply from the store team..."
              disabled={loading}
              style={{
                width: "100%",
                resize: "vertical",
                border: "1px solid #D1D5DB",
                borderRadius: 8,
                padding: 12,
                fontFamily: "inherit",
                fontSize: 14,
                lineHeight: 1.5,
                boxSizing: "border-box",
              }}
            />
            {!adminReplyAttrId ? (
              <Text as="p" size={2} color="default2" marginTop={3}>
                Tip: run Magic CMS setup once so replies also sync to the{" "}
                <Text as="span" size={2} fontWeight="bold">
                  magic-admin-reply
                </Text>{" "}
                attribute. Content-based replies still work without it.
              </Text>
            ) : null}
            <Box display="flex" gap={3} marginTop={4} justifyContent="flex-end">
              <Button
                variant="secondary"
                onClick={() => setAdminReply(parsedContent.adminReplyLine || "")}
                disabled={loading}
              >
                Reset
              </Button>
              <Button variant="primary" onClick={handleSaveAdminReply} disabled={loading}>
                {loading ? "Saving..." : "Save Reply"}
              </Button>
            </Box>
          </Box>
        )}

        {activeTab === "data" && (
          <Box display="grid" gap={6}>
            <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
              <Text as="h3" size={4} fontWeight="bold" marginBottom={2}>
                Review content
              </Text>
              {parsedContent.bodyLines.length > 0 ? (
                <Box display="grid" gap={2} marginBottom={4}>
                  {parsedContent.bodyLines.map((line, index) => (
                    <Text key={`${line}-${index}`} as="p" size={3} color="default2">
                      {line}
                    </Text>
                  ))}
                </Box>
              ) : (
                <Text as="p" size={3} color="default2" marginBottom={4}>
                  No detailed content provided.
                </Text>
              )}

              {(parsedContent.reviewerLine || parsedContent.emailLine || parsedContent.reviewDateLine) ? (
                <Box
                  marginBottom={4}
                  padding={3}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  display="grid"
                  gap={1}
                >
                  <Text size={2} fontWeight="bold">
                    Reviewer details
                  </Text>
                  {parsedContent.reviewerLine ? (
                    <Text size={2} color="default2">
                      Reviewer: {parsedContent.reviewerLine}
                    </Text>
                  ) : null}
                  {parsedContent.emailLine ? (
                    <Text size={2} color="default2">
                      Email: {parsedContent.emailLine}
                    </Text>
                  ) : null}
                  {parsedContent.reviewDateLine ? (
                    <Text size={2} color="default2">
                      Review date: {parsedContent.reviewDateLine}
                    </Text>
                  ) : null}
                </Box>
              ) : null}

              {adminReply.trim() ? (
                <Box
                  marginBottom={4}
                  padding={3}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                >
                  <Text size={2} fontWeight="bold" marginBottom={1}>
                    Admin reply
                  </Text>
                  <Text size={2} color="default2">
                    {adminReply.trim()}
                  </Text>
                  <Box marginTop={3}>
                    <Button variant="secondary" size="small" onClick={() => setActiveTab("reply")}>
                      Edit reply
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Box marginBottom={4}>
                  <Button variant="secondary" onClick={() => setActiveTab("reply")}>
                    Add admin reply
                  </Button>
                </Box>
              )}

              <Box style={{ borderTop: "1px solid #eee" }} paddingTop={4} display="grid" gap={4}>
                <Box>
                  <Text as="h3" size={3} fontWeight="bold" marginBottom={2}>
                    Location
                  </Text>
                  <input
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="e.g. Lucknow, Uttar Pradesh"
                    disabled={loading || mediaUploading}
                    style={{
                      width: "100%",
                      border: "1px solid #D1D5DB",
                      borderRadius: 8,
                      padding: "10px 12px",
                      fontFamily: "inherit",
                      fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                </Box>

                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={2}>
                    <Text as="h3" size={3} fontWeight="bold">
                      Images
                    </Text>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={loading || mediaUploading}
                      onClick={() => imageInputRef.current?.click()}
                    >
                      {mediaUploading ? "Uploading..." : "Upload images"}
                    </Button>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(event) => void handleImageUpload(event.target.files)}
                    />
                  </Box>
                  {imageUrls.length === 0 ? (
                    <Text size={2} color="default2">
                      No images attached.
                    </Text>
                  ) : (
                    <Box display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                      {imageUrls.map((url) => (
                        <Box key={url} style={{ position: "relative" }}>
                          <a href={url} target="_blank" rel="noreferrer">
                            <img
                              src={url}
                              alt="Review attachment"
                              style={{
                                width: 140,
                                height: 140,
                                borderRadius: 8,
                                border: "1px solid #eee",
                                objectFit: "cover",
                                display: "block",
                              }}
                            />
                          </a>
                          <Button
                            variant="tertiary"
                            size="small"
                            onClick={() => void removeImage(url)}
                            disabled={loading || mediaUploading}
                            style={{ marginTop: 6 }}
                          >
                            Remove
                          </Button>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={2}>
                    <Text as="h3" size={3} fontWeight="bold">
                      Videos
                    </Text>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={loading || mediaUploading}
                      onClick={() => videoInputRef.current?.click()}
                    >
                      {mediaUploading ? "Uploading..." : "Upload videos"}
                    </Button>
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(event) => void handleVideoUpload(event.target.files)}
                    />
                  </Box>
                  <Text size={2} color="default2" marginBottom={2}>
                    Preview uses controls only — no autoplay.
                  </Text>
                  {videoEntries.length === 0 ? (
                    <Text size={2} color="default2">
                      No videos attached.
                    </Text>
                  ) : (
                    <Box display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                      {videoEntries.map((entry) => (
                        <Box key={entry.url} style={{ width: 220 }}>
                          <video
                            src={entry.url}
                            poster={entry.poster || undefined}
                            controls
                            playsInline
                            preload="metadata"
                            style={{
                              width: "100%",
                              height: 140,
                              borderRadius: 8,
                              border: "1px solid #eee",
                              background: "#111",
                              objectFit: "cover",
                            }}
                          />
                          {typeof entry.durationSeconds === "number" ? (
                            <Text size={2} color="default2">
                              {Math.floor(entry.durationSeconds / 60)}:
                              {String(Math.floor(entry.durationSeconds % 60)).padStart(2, "0")}
                            </Text>
                          ) : null}
                          <Button
                            variant="tertiary"
                            size="small"
                            onClick={() => void removeVideo(entry.url)}
                            disabled={loading || mediaUploading}
                            style={{ marginTop: 6 }}
                          >
                            Remove
                          </Button>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                <Box display="flex" justifyContent="flex-end">
                  <Button
                    variant="primary"
                    onClick={() => void handleSaveLocationAndMedia()}
                    disabled={loading || mediaUploading}
                  >
                    {loading ? "Saving..." : "Save location & media"}
                  </Button>
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
