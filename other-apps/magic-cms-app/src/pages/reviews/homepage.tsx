import { Box, Button, Spinner, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Lock, Star } from "lucide-react";
import { useClient } from "urql";
import {
  GetPageBySlugDocument,
  GetReviewPageTypeDocument,
  GetReviewsWidgetPageTypeDocument,
  GetWidgetsDocument,
  useUpdateWidgetMutation,
  type GetWidgetsQuery,
} from "../../../generated/graphql";
import { ensureCoreReviewsWidget } from "@/lib/reviews-core-widgets";
import {
  REVIEW_WIDGET_ATTR_SLUGS,
  REVIEWS_CORE_WIDGETS,
  buildReferenceAttributeInput,
} from "@/lib/reviews-widget";
import { getAttributeBySlug, getReferenceValuesBySlug, getTextValueBySlug } from "@/lib/shoppable-video";

type ReviewNode = NonNullable<NonNullable<GetWidgetsQuery["pages"]>["edges"][number]>["node"];

const getReviewStatus = (page: ReviewNode): string => {
  const statusAttr = page.attributes.find((a) => a.attribute.slug === "magic-status");
  return (statusAttr?.values[0]?.slug || statusAttr?.values[0]?.name || "pending").toLowerCase();
};

const getReviewRating = (page: ReviewNode): number => {
  const ratingAttr = page.attributes.find((a) => a.attribute.slug === "magic-rating");
  const raw = ratingAttr?.values[0]?.name || ratingAttr?.values[0]?.value || "0";
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
};

export default function HomepageReviewsWidgetPage() {
  const router = useRouter();
  const gqlClient = useClient();
  const [, updateWidget] = useUpdateWidgetMutation();

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [widgetId, setWidgetId] = useState("");
  const [widgetTitle, setWidgetTitle] = useState<string>(REVIEWS_CORE_WIDGETS[0].title);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [approvedReviews, setApprovedReviews] = useState<ReviewNode[]>([]);

  const coreSlug = REVIEWS_CORE_WIDGETS[0].slug;

  const loadWidget = useCallback(async () => {
    const pageRes = await gqlClient
      .query(GetPageBySlugDocument, { slug: coreSlug }, { requestPolicy: "network-only" })
      .toPromise();
    if (pageRes.error) {
      throw new Error(pageRes.error.message);
    }
    const page = pageRes.data?.page;
    if (!page) {
      throw new Error("Homepage Reviews widget not found after ensure.");
    }
    setWidgetId(page.id);
    const name = getTextValueBySlug(page, REVIEW_WIDGET_ATTR_SLUGS.widgetName).trim();
    setWidgetTitle(name || page.title || "Homepage Reviews");
    const refs = getReferenceValuesBySlug(page, REVIEW_WIDGET_ATTR_SLUGS.reviewRefs);
    setSelectedRefs(refs);
  }, [coreSlug, gqlClient]);

  const loadApprovedReviews = useCallback(async () => {
    setIsLoadingReviews(true);
    try {
      const typeRes = await gqlClient
        .query(GetReviewPageTypeDocument, {}, { requestPolicy: "network-only" })
        .toPromise();
      const pageTypeId = typeRes.data?.pageTypes?.edges?.[0]?.node?.id;
      if (!pageTypeId) {
        setApprovedReviews([]);
        return;
      }

      const all: ReviewNode[] = [];
      let after: string | undefined;
      for (let requests = 0; requests < 10; requests += 1) {
        // eslint-disable-next-line no-await-in-loop
        const pageBatchResult = await gqlClient
          .query(GetWidgetsDocument, {
            pageTypeIds: [pageTypeId],
            first: 100,
            after,
          })
          .toPromise();
        if (pageBatchResult.error) {
          throw new Error(pageBatchResult.error.message);
        }
        const connection = pageBatchResult.data?.pages;
        const edges = connection?.edges || [];
        for (const edge of edges) {
          if (edge?.node) all.push(edge.node);
        }
        if (!connection?.pageInfo?.hasNextPage) break;
        after = connection.pageInfo.endCursor || undefined;
        if (!after) break;
      }

      setApprovedReviews(
        all.filter((page) => page.isPublished && getReviewStatus(page) === "approved"),
      );
    } finally {
      setIsLoadingReviews(false);
    }
  }, [gqlClient]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setIsBootstrapping(true);
      setError("");
      try {
        // Ensure page type exists in schema cache (attrs may need setup update first)
        await gqlClient
          .query(GetReviewsWidgetPageTypeDocument, {}, { requestPolicy: "network-only" })
          .toPromise();
        const ensure = await ensureCoreReviewsWidget(gqlClient);
        if (cancelled) return;
        if (ensure.errors.length > 0) {
          setError(ensure.errors[0]);
          return;
        }
        if (ensure.created.length > 0) {
          setNotice(`Created locked section: ${ensure.created.join(", ")}`);
        }
        await loadWidget();
        await loadApprovedReviews();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Homepage Reviews.");
        }
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [gqlClient, loadApprovedReviews, loadWidget]);

  const selectedSet = useMemo(() => new Set(selectedRefs), [selectedRefs]);

  const orderedSelected = useMemo(() => {
    const byId = new Map(approvedReviews.map((r) => [r.id, r]));
    return selectedRefs.map((id) => byId.get(id)).filter((r): r is ReviewNode => Boolean(r));
  }, [approvedReviews, selectedRefs]);

  const toggleReview = (id: string) => {
    setSelectedRefs((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const moveSelected = (id: string, direction: -1 | 1) => {
    setSelectedRefs((prev) => {
      const index = prev.indexOf(id);
      if (index < 0) return prev;
      const next = index + direction;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  };

  const handleSave = async () => {
    if (!widgetId) return;
    setIsSaving(true);
    setError("");
    setNotice("");

    try {
      const pageRes = await gqlClient
        .query(GetPageBySlugDocument, { slug: coreSlug }, { requestPolicy: "network-only" })
        .toPromise();
      const page = pageRes.data?.page;
      if (!page) throw new Error("Homepage Reviews widget missing.");

      const refsAttr = getAttributeBySlug(page, REVIEW_WIDGET_ATTR_SLUGS.reviewRefs);
      if (!refsAttr) {
        throw new Error(
          "Attribute magic-review-refs missing. Run Magic CMS One-Click Update, then reopen this page.",
        );
      }

      const result = await updateWidget({
        id: page.id,
        input: {
          attributes: [
            buildReferenceAttributeInput(
              refsAttr.attribute.id,
              selectedRefs,
              refsAttr.attribute.inputType,
            ),
          ],
        },
      });

      const mutationErrors = result.data?.pageUpdate?.errors || [];
      if (result.error || mutationErrors.length > 0) {
        throw new Error(
          result.error?.message ||
            mutationErrors.map((e) => e.message).filter(Boolean).join(", ") ||
            "Unable to save selected reviews.",
        );
      }

      setNotice(
        selectedRefs.length > 0
          ? `Saved ${selectedRefs.length} review(s) for the homepage carousel.`
          : "Cleared homepage selection. Storefront will show the default reviews marquee.",
      );
      await loadWidget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isBootstrapping) {
    return (
      <Box padding={8}>
        <Spinner />
      </Box>
    );
  }

  return (
    <Box padding={8} display="grid" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center" style={{ flexWrap: "wrap", gap: 12 }}>
        <Box>
          <Box display="flex" alignItems="center" gap={2} marginBottom={2}>
            <Lock size={18} />
            <Text as="h1" size={8} fontWeight="bold">
              {widgetTitle}
            </Text>
          </Box>
          <Text size={3} color="default2">
            Locked core section — select approved reviews for the homepage. Empty selection keeps the
            existing marquee.
          </Text>
          <Text size={2} color="default2" marginTop={1}>
            Slug: {coreSlug}
          </Text>
        </Box>
        <Box display="flex" gap={2}>
          <Button variant="secondary" onClick={() => router.push("/reviews")}>
            <ArrowLeft size={16} /> Back
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving || !widgetId}>
            {isSaving ? "Saving..." : "Save selection"}
          </Button>
        </Box>
      </Box>

      {error ? (
        <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
          <Text color="critical1">{error}</Text>
        </Box>
      ) : null}
      {notice ? (
        <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
          <Text color="default2">{notice}</Text>
        </Box>
      ) : null}

      <Box
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        padding={4}
        display="grid"
        gap={3}
      >
        <Text as="h3" size={5} fontWeight="bold">
          Selected order ({selectedRefs.length})
        </Text>
        {orderedSelected.length === 0 ? (
          <Text size={2} color="default2">
            No reviews selected yet.
          </Text>
        ) : (
          <Box display="grid" gap={2}>
            {orderedSelected.map((review, index) => (
              <Box
                key={review.id}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                padding={3}
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                style={{ gap: 8, flexWrap: "wrap" }}
              >
                <Box>
                  <Text size={3} fontWeight="bold">
                    {index + 1}. {review.title}
                  </Text>
                  <Text size={2} color="default2">
                    {getReviewRating(review)}★ · {review.slug}
                  </Text>
                </Box>
                <Box display="flex" gap={2}>
                  <Button
                    variant="tertiary"
                    size="small"
                    onClick={() => moveSelected(review.id, -1)}
                    disabled={index === 0}
                  >
                    Up
                  </Button>
                  <Button
                    variant="tertiary"
                    size="small"
                    onClick={() => moveSelected(review.id, 1)}
                    disabled={index === orderedSelected.length - 1}
                  >
                    Down
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => toggleReview(review.id)}>
                    Remove
                  </Button>
                </Box>
              </Box>
            ))}
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
        gap={3}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Text as="h3" size={5} fontWeight="bold">
            Approved reviews
          </Text>
          <Button
            variant="tertiary"
            size="small"
            onClick={() => void loadApprovedReviews()}
            disabled={isLoadingReviews}
          >
            {isLoadingReviews ? "Loading..." : "Refresh"}
          </Button>
        </Box>

        {isLoadingReviews && approvedReviews.length === 0 ? (
          <Spinner />
        ) : approvedReviews.length === 0 ? (
          <Text size={2} color="default2">
            No published approved reviews found.
          </Text>
        ) : (
          <Box display="grid" gap={2}>
            {approvedReviews.map((review) => {
              const selected = selectedSet.has(review.id);
              return (
                <Box
                  key={review.id}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  padding={3}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  style={{
                    gap: 8,
                    flexWrap: "wrap",
                    background: selected ? "#f0f7ff" : "#fff",
                  }}
                >
                  <Box>
                    <Text size={3} fontWeight="bold">
                      {review.title}
                    </Text>
                    <Box display="flex" alignItems="center" gap={1} marginTop={1}>
                      <Star size={14} />
                      <Text size={2} color="default2">
                        {getReviewRating(review)} / 5 · {review.slug}
                      </Text>
                    </Box>
                  </Box>
                  <Button
                    variant={selected ? "secondary" : "primary"}
                    size="small"
                    onClick={() => toggleReview(review.id)}
                  >
                    {selected ? "Selected" : "Add"}
                  </Button>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
