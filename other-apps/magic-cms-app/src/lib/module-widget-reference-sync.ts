import { type Client } from "urql";
import { UpdateWidgetDocument } from "../../generated/graphql";
import { MODULE_PAGE_TYPE_PREFIX } from "./widget-models";

const MAGIC_REF_WIDGET_SLUG = "magic-ref-widget";

type ModulePageTypeNode = {
  id: string;
  slug: string;
};

type ModulePageNode = {
  id: string;
  slug: string;
  attributes: Array<{
    attribute?: { id: string; slug?: string | null } | null;
    values: Array<{ reference?: string | null }>;
  }>;
};

export type WidgetReferenceSyncMode = "add" | "remove";

export type WidgetReferenceSyncResult = {
  updated: number;
  skipped: number;
  errors: string[];
};

const uniqueRefs = (refs: string[]) => Array.from(new Set(refs.filter(Boolean)));

const loadModulePageTypeIds = async (client: Client): Promise<string[]> => {
  let after: string | null = null;
  let hasNextPage = true;
  let guard = 0;
  const pageTypes: ModulePageTypeNode[] = [];

  while (hasNextPage && guard < 20) {
    guard += 1;
    const result: any = await client
      .query(
        `
          query LoadModulePageTypes($first: Int!, $after: String) {
            pageTypes(first: $first, after: $after) {
              edges {
                node {
                  id
                  slug
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        { first: 100, after },
        { requestPolicy: "network-only" }
      )
      .toPromise();

    if (result.error?.message) {
      throw new Error(result.error.message);
    }

    const connection = result.data?.pageTypes;
    const edges = connection?.edges || [];
    edges.forEach((edge: any) => {
      const node = edge?.node;
      if (node?.id && node?.slug?.startsWith(MODULE_PAGE_TYPE_PREFIX)) {
        pageTypes.push(node as ModulePageTypeNode);
      }
    });

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return pageTypes.map((node) => node.id);
};

const loadModulePages = async (client: Client, pageTypeIds: string[]): Promise<ModulePageNode[]> => {
  if (!pageTypeIds.length) {
    return [];
  }

  let after: string | null = null;
  let hasNextPage = true;
  let guard = 0;
  const pages: ModulePageNode[] = [];

  while (hasNextPage && guard < 30) {
    guard += 1;
    const result: any = await client
      .query(
        `
          query LoadModulePages($pageTypeIds: [ID!], $first: Int!, $after: String) {
            pages(filter: { pageTypes: $pageTypeIds }, first: $first, after: $after) {
              edges {
                node {
                  id
                  slug
                  attributes {
                    attribute {
                      id
                      slug
                    }
                    values {
                      reference
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        { pageTypeIds, first: 100, after },
        { requestPolicy: "network-only" }
      )
      .toPromise();

    if (result.error?.message) {
      throw new Error(result.error.message);
    }

    const connection = result.data?.pages;
    const edges = connection?.edges || [];
    edges.forEach((edge: any) => {
      const node = edge?.node;
      if (node?.id) {
        pages.push(node as ModulePageNode);
      }
    });

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return pages;
};

export const syncMagicRefWidgetOnModulePages = async (
  client: Client,
  widgetPageId: string,
  mode: WidgetReferenceSyncMode
): Promise<WidgetReferenceSyncResult> => {
  const errors: string[] = [];
  let updated = 0;
  let skipped = 0;

  if (!widgetPageId) {
    return { updated, skipped, errors: ["Widget ID is missing for magic-ref-widget sync."] };
  }

  let modulePageTypeIds: string[] = [];
  try {
    modulePageTypeIds = await loadModulePageTypeIds(client);
  } catch (error) {
    return {
      updated,
      skipped,
      errors: [
        error instanceof Error
          ? `Load module page types failed: ${error.message}`
          : "Load module page types failed.",
      ],
    };
  }

  if (!modulePageTypeIds.length) {
    return { updated, skipped, errors };
  }

  let modulePages: ModulePageNode[] = [];
  try {
    modulePages = await loadModulePages(client, modulePageTypeIds);
  } catch (error) {
    return {
      updated,
      skipped,
      errors: [
        error instanceof Error ? `Load module pages failed: ${error.message}` : "Load module pages failed.",
      ],
    };
  }

  for (const page of modulePages) {
    const targetAttribute = (page.attributes || []).find(
      (entry) => entry.attribute?.slug === MAGIC_REF_WIDGET_SLUG && entry.attribute?.id
    );

    if (!targetAttribute?.attribute?.id) {
      skipped += 1;
      continue;
    }

    const currentRefs = uniqueRefs((targetAttribute.values || []).map((value) => value.reference || ""));
    const nextRefs =
      mode === "add"
        ? uniqueRefs([...currentRefs, widgetPageId])
        : currentRefs.filter((referenceId) => referenceId !== widgetPageId);

    const unchanged =
      nextRefs.length === currentRefs.length &&
      nextRefs.every((referenceId, index) => referenceId === currentRefs[index]);

    if (unchanged) {
      skipped += 1;
      continue;
    }

    const updateResult = await client
      .mutation(UpdateWidgetDocument, {
        id: page.id,
        input: {
          attributes: [
            nextRefs.length
              ? { id: targetAttribute.attribute.id, references: nextRefs }
              : { id: targetAttribute.attribute.id, values: [] },
          ],
        },
      })
      .toPromise();

    if (updateResult.error?.message) {
      errors.push(`Sync ${page.slug} failed: ${updateResult.error.message}`);
      continue;
    }

    const gqlErrors = updateResult.data?.pageUpdate?.errors || [];
    if (gqlErrors.length > 0) {
      const normalized = gqlErrors
        .map((entry) => [entry.code, entry.field, entry.message].filter(Boolean).join(" | "))
        .filter(Boolean)
        .join("; ");
      errors.push(`Sync ${page.slug} failed: ${normalized || "Unknown GraphQL error."}`);
      continue;
    }

    updated += 1;
  }

  return { updated, skipped, errors };
};
