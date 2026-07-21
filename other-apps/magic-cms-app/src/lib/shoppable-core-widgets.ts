import type { Client } from "urql";
import {
  SH_VIDEO_ATTR_SLUGS,
  SHOPPABLE_CORE_WIDGETS,
  isCoreShoppableWidgetSlug,
} from "./shoppable-video";

type EnsureCoreWidgetsResult = {
  created: string[];
  existing: string[];
  errors: string[];
};

const PAGE_BY_SLUG_QUERY = `
  query CoreWidgetBySlug($slug: String!) {
    page(slug: $slug) {
      id
      slug
      title
    }
  }
`;

const PAGE_TYPE_BY_SLUG_QUERY = `
  query CoreWidgetPageType($slug: String!) {
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
  mutation CreateCoreShoppableWidget($input: PageCreateInput!) {
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
 * Idempotently ensure Homepage + PDP core shoppable widgets exist.
 * Safe to call from Videos tab or after setup.
 */
export async function ensureCoreShoppableWidgets(client: Client): Promise<EnsureCoreWidgetsResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const errors: string[] = [];

  const pageTypeRes = await client
    .query(PAGE_TYPE_BY_SLUG_QUERY, { slug: "magic-widget-shoppable" }, { requestPolicy: "network-only" })
    .toPromise();

  if (pageTypeRes.error) {
    return {
      created,
      existing,
      errors: [pageTypeRes.error.message || "Failed to load magic-widget-shoppable page type."],
    };
  }

  const pageType =
    (pageTypeRes.data?.pageTypes?.edges || []).map((edge: { node: any }) => edge.node).find(
      (node: { slug?: string | null }) => node.slug === "magic-widget-shoppable"
    ) || null;

  if (!pageType?.id) {
    return {
      created,
      existing,
      errors: ['Page type "magic-widget-shoppable" is missing. Run One-Click Initialization first.'],
    };
  }

  const widgetNameAttr = (pageType.attributes || []).find(
    (attribute: { slug?: string | null }) => attribute.slug === SH_VIDEO_ATTR_SLUGS.widgetName
  );

  for (const core of SHOPPABLE_CORE_WIDGETS) {
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

    const attributes = widgetNameAttr?.id
      ? [{ id: widgetNameAttr.id, plainText: core.widgetName }]
      : [];

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
          `Failed to create ${core.slug}`
      );
      continue;
    }

    created.push(core.slug);
  }

  return { created, existing, errors };
}

export { isCoreShoppableWidgetSlug };
