import { Box, Button, Text, Spinner } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useGetWidgetQuery, useUpdateWidgetMutation, useDeleteWidgetMutation } from "../../../generated/graphql";
import { useState, useEffect, useMemo } from "react";
import { CheckCircle, XCircle, AlertCircle, Trash2 } from "lucide-react";

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

export default function ReviewDetailsPage() {
  const router = useRouter();
  const { id } = router.query;
  const widgetId = typeof id === "string" ? id : "";
  
  const [{ data, fetching, error }] = useGetWidgetQuery({
    variables: { id: widgetId },
    pause: !widgetId,
  });

  const [, updateWidget] = useUpdateWidgetMutation();
  const [, deleteWidget] = useDeleteWidgetMutation();
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);

  const parsedContent = useMemo(() => parseReviewContent(data?.page?.content), [data?.page?.content]);

  useEffect(() => {
    if (data?.page) {
       const statusAttr = data.page.attributes.find(a => a.attribute.slug === "magic-status");
       const val = statusAttr?.values[0]?.slug || statusAttr?.values[0]?.name || "pending"; 
       setStatus(val.toLowerCase());
    }
  }, [data]);

  useEffect(() => {
    setIsDeleteConfirming(false);
  }, [widgetId]);

  const handleUpdateStatus = async (newStatus: string) => {
    const previousStatus = status;
    setLoading(true);
    setActionError("");
    setActionNotice("");
    setStatus(newStatus); // Optimistic

    const statusAttr = data?.page?.attributes.find(a => a.attribute.slug === "magic-status");
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
                }
            ]
        }
    });

    setLoading(false);
    if (result.error || result.data?.pageUpdate?.errors?.length) {
        setStatus(previousStatus);
        const msg = result.error?.message || result.data?.pageUpdate?.errors?.map(e => e.message).join(", ") || "Unable to update status.";
        setActionError(msg);
        return;
    }
    setActionNotice(`Status updated to ${newStatus}.`);
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
        result.data?.pageDelete?.errors?.map(e => e.message || e.field).filter(Boolean).join(", ") ||
        "Unable to delete review.";
      setActionError(msg);
      setIsDeleteConfirming(false);
    } else {
      setActionNotice("Review deleted successfully.");
      setIsDeleteConfirming(false);
      router.push(`/reviews?refresh=${Date.now()}`);
    }
  };

  const [activeTab, setActiveTab] = useState<"data" | "moderation">("moderation");

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
            <Text as="p" size={3} color="default2" marginTop={2}>Review for {data.page.pageType.name} — {widgetId}</Text>
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
            <Button variant="secondary" onClick={() => router.push("/reviews")}>Back to List</Button>
            <Box padding={2} borderRadius={4} style={{ backgroundColor: status === "approved" ? "#E1F5FE" : status === "rejected" ? "#FEEBEE" : "#FFF8E1", display: "flex", alignItems: "center", paddingLeft: 16, paddingRight: 16 }}>
                <Text size={2} color="default2" fontWeight="bold" textTransform="uppercase">{status}</Text>
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

      {/* Tabs Layout */}
      <Box display="flex" gap={4} marginBottom={6} style={{ borderBottom: "1px solid #E6E6E6" }}>
        <Button variant="tertiary" onClick={() => setActiveTab("moderation")} style={{ borderBottom: activeTab === "moderation" ? "2px solid #28234A" : "none", borderRadius: 0, paddingBottom: 12 }}>Moderation</Button>
        <Button variant="tertiary" onClick={() => setActiveTab("data")} style={{ borderBottom: activeTab === "data" ? "2px solid #28234A" : "none", borderRadius: 0, paddingBottom: 12 }}>Review Content</Button>
      </Box>

      <Box display="grid" gap={6} style={{ maxWidth: 800 }}>
        {activeTab === "moderation" && (
            <Box display="grid" gap={6}>
                <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
                    <Text as="h3" size={4} fontWeight="bold" marginBottom={4}>Action Center</Text>
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

        {activeTab === "data" && (
            <Box display="grid" gap={6}>
                <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
                    <Text as="h3" size={4} fontWeight="bold" marginBottom={2}>Review content</Text>
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
                      <Box marginBottom={4} padding={3} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} display="grid" gap={1}>
                        <Text size={2} fontWeight="bold">
                          Reviewer details
                        </Text>
                        {parsedContent.reviewerLine ? <Text size={2} color="default2">Reviewer: {parsedContent.reviewerLine}</Text> : null}
                        {parsedContent.emailLine ? <Text size={2} color="default2">Email: {parsedContent.emailLine}</Text> : null}
                        {parsedContent.reviewDateLine ? <Text size={2} color="default2">Review date: {parsedContent.reviewDateLine}</Text> : null}
                      </Box>
                    ) : null}

                    {parsedContent.adminReplyLine ? (
                      <Box marginBottom={4} padding={3} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
                        <Text size={2} fontWeight="bold" marginBottom={1}>
                          Admin reply
                        </Text>
                        <Text size={2} color="default2">
                          {parsedContent.adminReplyLine}
                        </Text>
                      </Box>
                    ) : null}

                    {/* Media */}
                    <Box style={{ borderTop: "1px solid #eee" }} paddingTop={4}>
                        <Text as="h3" size={3} fontWeight="bold" marginBottom={2}>Attached documents</Text>
                        {(() => {
                          const urls: string[] = [];
                          const seen = new Set<string>();
                          const push = (raw?: string | null) => {
                            const url = String(raw || "").trim();
                            if (!url || seen.has(url)) return;
                            seen.add(url);
                            urls.push(url);
                          };

                          const imagesAttr = data.page.attributes.find(
                            (a) => a.attribute.slug === "magic-review-images",
                          );
                          const imagesRaw =
                            imagesAttr?.values[0]?.plainText || imagesAttr?.values[0]?.name || "";
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

                          push(
                            data.page.attributes.find((a) => a.attribute.slug === "magic-media")
                              ?.values[0]?.file?.url,
                          );

                          if (urls.length === 0) {
                            return (
                              <Box
                                padding={10}
                                borderStyle="solid"
                                borderWidth={1}
                                borderColor="default1"
                                borderRadius={4}
                                display="flex"
                                justifyContent="center"
                              >
                                <Text color="default2">No media files attached to this review.</Text>
                              </Box>
                            );
                          }

                          return (
                            <Box display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                              {urls.map((url) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer">
                                  <img
                                    src={url}
                                    alt="Review attachment"
                                    style={{
                                      maxWidth: 220,
                                      maxHeight: 280,
                                      borderRadius: 8,
                                      border: "1px solid #eee",
                                      objectFit: "cover",
                                    }}
                                  />
                                </a>
                              ))}
                            </Box>
                          );
                        })()}
                    </Box>
                </Box>
            </Box>
        )}

      </Box>
    </Box>
  );
}
