import type { Client } from "urql";
import { REVIEW_WIDGET_ATTR_SLUGS, REVIEWS_CORE_WIDGETS, isCoreReviewsWidgetSlug } from "./reviews-widget";

type EnsureCoreWidgetsResult = {
  created: string[];
  existing: string[];
  errors: string[];
};

const PAGE_BY_SLUG_QUERY = `
  query CoreReviewsWidgetBySlug($slug: String!) {
    page(slug: $slug) {
      id
      slug
      title
    }
  }
`;

const PAGE_TYPE_BY_SLUG_QUERY = `
  query CoreReviewsWidgetPageType($slug: String!) {
    pageTypes(filter: { search: $slug }, first: 20) {
      edges {
        node {
          id
          slug
          attributes {
            id
            slug
          }
        }
      }
    }
  }
`;

const CREATE_PAGE_MUTATION = `
  mutation CreateCoreReviewsWidget($input: PageCreateInput!) {
    pageCreate(input: $input) {
      page {
        id
        slug
        title
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Idempotently ensure Homepage Reviews core widget exists.
 * Safe to call from Reviews tab or after setup.
 */
export async function ensureCoreReviewsWidget(client: Client): Promise<EnsureCoreWidgetsResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const errors: string[] = [];

  const pageTypeRes = await client
    .query(PAGE_TYPE_BY_SLUG_QUERY, { slug: "magic-widget-reviews" }, { requestPolicy: "network-only" })
    .toPromise();

  if (pageTypeRes.error) {
    return {
      created,
      existing,
      errors: [pageTypeRes.error.message || "Failed to load magic-widget-reviews page type."],
    };
  }

  const pageType =
    (pageTypeRes.data?.pageTypes?.edges || []).map((edge: { node: any }) => edge.node).find(
      (node: { slug?: string | null }) => node.slug === "magic-widget-reviews",
    ) || null;

  if (!pageType?.id) {
    return {
      created,
      existing,
      errors: ['Page type "magic-widget-reviews" is missing. Run One-Click Initialization / Update first.'],
    };
  }

  const widgetNameAttr = (pageType.attributes || []).find(
    (attribute: { slug?: string | null }) => attribute.slug === REVIEW_WIDGET_ATTR_SLUGS.widgetName,
  );

  for (const core of REVIEWS_CORE_WIDGETS) {
    const existingRes = await client
      .query(PAGE_BY_SLUG_QUERY, { slug: core.slug }, { requestPolicy: "network-only" })
      .toPromise();

    if (existingRes.error) {
      errors.push(`${core.slug}: ${existingRes.error.message}`);
      continue;
    }

    if (existingRes.data?.page?.id) {
      existing.push(core.slug);
      continue;
    }

    const attributes: Array<{ id: string; plainText: string }> = [];
    if (widgetNameAttr?.id) {
      attributes.push({ id: widgetNameAttr.id, plainText: core.widgetName });
    }

    const createRes = await client
      .mutation(CREATE_PAGE_MUTATION, {
        input: {
          title: core.title,
          slug: core.slug,
          pageType: pageType.id,
          isPublished: true,
          attributes,
        },
      })
      .toPromise();

    const createErrors = createRes.data?.pageCreate?.errors || [];
    if (createRes.error || createErrors.length > 0 || !createRes.data?.pageCreate?.page) {
      const unique = createErrors.some((error: { code?: string | null }) => error?.code === "UNIQUE");
      if (unique) {
        existing.push(core.slug);
        continue;
      }
      errors.push(
        createRes.error?.message ||
          createErrors.map((error: { message?: string | null }) => error.message).filter(Boolean).join("; ") ||
          `Failed to create ${core.slug}`,
      );
      continue;
    }

    created.push(core.slug);
  }

  return { created, existing, errors };
}

export { isCoreReviewsWidgetSlug };
