import { Client } from "urql";
import { CMS_ATTRIBUTES, CMS_DEFAULT_PAGES, CMS_MENU_STRUCTURES, CMS_PAGE_TYPES } from "./consts";
import {
  AttributeCreateDocument,
  PageTypeCreateDocument,
  PageTypeUpdateDocument,
  AttributeInputTypeEnum,
  AttributeTypeEnum,
  AttributeEntityTypeEnum,
} from "../../generated/graphql";

const INPUT_TYPE_MAP: Record<string, AttributeInputTypeEnum> = {
  NUMERIC: AttributeInputTypeEnum.Numeric,
  PLAIN_TEXT: AttributeInputTypeEnum.PlainText,
  BOOLEAN: AttributeInputTypeEnum.Boolean,
  DATE: AttributeInputTypeEnum.Date,
  DROPDOWN: AttributeInputTypeEnum.Dropdown,
  REFERENCE: AttributeInputTypeEnum.Reference,
  FILE: AttributeInputTypeEnum.File,
  RICH_TEXT: AttributeInputTypeEnum.RichText,
};

const ENTITY_TYPE_MAP: Record<string, AttributeEntityTypeEnum> = {
  PRODUCT: AttributeEntityTypeEnum.Product,
  PAGE: AttributeEntityTypeEnum.Page,
  PRODUCT_VARIANT: AttributeEntityTypeEnum.ProductVariant,
  CATEGORY: AttributeEntityTypeEnum.Category,
  COLLECTION: AttributeEntityTypeEnum.Collection,
};

const MANAGED_ATTRIBUTE_PREFIXES = ["magic-"];
const MANAGED_PAGE_TYPE_PREFIXES = [
  "magiccms-",
  "magic-shoppable-widget",
  "magic-widget-shoppable",
  "magic-widget-module-",
];
const MANAGED_PAGE_TYPE_SLUGS = new Set(CMS_PAGE_TYPES.map((pageType) => pageType.slug));

type SetupMode = "initialize" | "update" | "already_initialized";

type SetupOptions = {
  dryRun?: boolean;
  cleanup?: boolean;
};

type ManagedAttribute = {
  id: string;
  slug: string;
  type?: string | null;
  inputType?: string | null;
  entityType?: string | null;
  valueRequired?: boolean | null;
  visibleInStorefront?: boolean | null;
  filterableInDashboard?: boolean | null;
};

type ManagedPageType = {
  id: string;
  slug: string;
  name?: string | null;
  attributes: Array<{ id: string; slug?: string | null }>;
};

type ManagedProductType = {
  id: string;
  slug: string;
  name?: string | null;
  productAttributes: Array<{ id: string; slug?: string | null }>;
};

type SetupCounts = {
  missingAttributes: number;
  missingPageTypes: number;
  missingPages: number;
  missingMenus: number;
  missingPageTypeAttributeLinks: number;
  missingMenuItems: number;
  staleAttributes: number;
  stalePageTypes: number;
  createdAttributes: number;
  createdPageTypes: number;
  createdPages: number;
  createdMenus: number;
  createdMenuItems: number;
  updatedPageTypes: number;
  removedAttributes: number;
  removedPageTypes: number;
  skippedAttributes: number;
  skippedPageTypes: number;
  skippedPages: number;
  skippedMenus: number;
  skippedMenuItems: number;
};

type ManagedPage = {
  id: string;
  slug: string;
  pageTypeSlug?: string | null;
};

type ManagedMenuItem = {
  id: string;
  name: string;
  url?: string | null;
  children: ManagedMenuItem[];
};

type ManagedMenu = {
  id: string;
  slug: string;
  name?: string | null;
  items: ManagedMenuItem[];
};

type MenuLoadResult = {
  menus: ManagedMenu[];
  missingPermission: boolean;
};

export type SetupResult = {
  steps: string[];
  errors: string[];
  mode: SetupMode;
  dryRun: boolean;
  hasPendingChanges: boolean;
  counts: SetupCounts;
};

export type SetupOpsMode = "backup" | "restore" | "cleanup";

export type SetupOpsResult = {
  steps: string[];
  errors: string[];
  mode: SetupOpsMode;
  dryRun: boolean;
};

export type SetupBackupAttribute = {
  slug: string;
  name: string;
  type: string;
  entity?: string | null;
  scope?: "PAGE_TYPE" | "PRODUCT_TYPE";
  referencePageTypeSlugs?: string[];
};

export type SetupBackupPageType = {
  slug: string;
  name: string;
  attributes: string[];
};

export type SetupBackupPageAttribute = {
  slug: string;
  inputType?: string | null;
  plainText?: string;
  richText?: string;
  date?: string;
  numeric?: string;
  boolean?: boolean;
  file?: string;
  reference?: string;
  references?: string[];
  dropdownValue?: string;
};

export type SetupBackupPage = {
  slug: string;
  title: string;
  pageTypeSlug: string;
  isPublished: boolean;
  content?: string | null;
  attributes: SetupBackupPageAttribute[];
};

export type SetupBackupMenuItem = {
  name: string;
  url?: string;
  children?: SetupBackupMenuItem[];
};

export type SetupBackupMenu = {
  slug: string;
  name: string;
  items: SetupBackupMenuItem[];
};

export type SetupBackupSnapshot = {
  version: 1;
  createdAt: string;
  attributes: SetupBackupAttribute[];
  pageTypes: SetupBackupPageType[];
  pages: SetupBackupPage[];
  menus: SetupBackupMenu[];
};

const isManagedAttributeSlug = (slug: string) =>
  MANAGED_ATTRIBUTE_PREFIXES.some((prefix) => slug.startsWith(prefix));

const isManagedPageTypeSlug = (slug: string) =>
  MANAGED_PAGE_TYPE_PREFIXES.some((prefix) => slug.startsWith(prefix)) || MANAGED_PAGE_TYPE_SLUGS.has(slug);

const normalizeErrors = (errors: Array<{ message?: string | null; field?: string | null; code?: string | null }>) =>
  errors
    .map((error) => [error.code, error.field, error.message].filter(Boolean).join(" | "))
    .filter(Boolean);

const compactTransportMessage = (raw: string) => {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Unknown network error.";
  }
  if (
    normalized.includes("DOCTYPE html") ||
    normalized.includes("GraphQL Playground") ||
    normalized.includes("returned HTML")
  ) {
    return "Saleor returned HTML instead of JSON. Verify GraphQL URL ends with /graphql/ and refresh app auth token.";
  }
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
};

const hasProductTypePermissionError = (message: string) =>
  message.includes("MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES");

const hasMenuPermissionError = (message: string) => message.includes("MANAGE_MENUS");

const getOperationErrorMessage = (operationError: unknown): string | null => {
  if (!operationError) {
    return null;
  }
  return compactTransportMessage(operationError instanceof Error ? operationError.message : String(operationError));
};

const ensureNoTransportError = (operationError: unknown, errors: string[], label: string) => {
  const message = getOperationErrorMessage(operationError);
  if (!message) {
    return;
  }
  errors.push(`${label}: ${message}`);
};

const loadManagedAttributes = async (client: Client, errors: string[]) => {
  const result = await client
    .query(
      `query LoadManagedAttributes($search: String!) {
        attributes(filter: { search: $search }, first: 100) {
          edges {
            node {
              id
              slug
              type
              inputType
              entityType
              valueRequired
              visibleInStorefront
              filterableInDashboard
            }
          }
        }
      }`,
      { search: "magic" }
    )
    .toPromise();

  ensureNoTransportError(result.error, errors, "Load managed attributes failed");

  const list: ManagedAttribute[] = (result.data?.attributes?.edges || [])
    .map((edge: any) => edge?.node)
    .filter((node: any): node is ManagedAttribute => Boolean(node?.id && node?.slug))
    .filter((node: ManagedAttribute) => isManagedAttributeSlug(node.slug));

  return list;
};

const loadAllProductTypes = async (client: Client, errors: string[]) => {
  const allNodes: ManagedProductType[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  let safety = 0;

  while (hasNextPage && safety < 30) {
    safety += 1;
    const result: any = await client
      .query(
        `query LoadAllProductTypes($first: Int!, $after: String) {
          productTypes(first: $first, after: $after) {
            edges {
              node {
                id
                slug
                name
                productAttributes {
                  id
                  slug
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        { first: 100, after }
      )
      .toPromise();

    const transportMessage = getOperationErrorMessage(result.error);
    if (transportMessage) {
      if (hasProductTypePermissionError(transportMessage)) {
        return { items: allNodes, missingPermission: true };
      }
      errors.push(`Load product types failed: ${transportMessage}`);
      return { items: allNodes, missingPermission: false };
    }

    const connection: any = result.data?.productTypes;
    const edges = connection?.edges || [];
    for (const edge of edges) {
      const node = edge?.node;
      if (node?.id && node?.slug) {
        allNodes.push({
          id: node.id,
          slug: node.slug,
          name: node.name,
          productAttributes: (node.productAttributes || []).filter((attribute: any) => Boolean(attribute?.id)),
        });
      }
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return { items: allNodes, missingPermission: false };
};

const resolveAttributeScope = (scope?: string | null) =>
  scope === "PRODUCT_TYPE" ? AttributeTypeEnum.ProductType : AttributeTypeEnum.PageType;

const getAttributeCreateConfigInput = (attribute: {
  [key: string]: unknown;
  valueRequired?: boolean;
  visibleInStorefront?: boolean;
  filterableInDashboard?: boolean;
}) => {
  const config: {
    valueRequired?: boolean;
    visibleInStorefront?: boolean;
    filterableInDashboard?: boolean;
  } = {};

  if (typeof attribute.valueRequired === "boolean") {
    config.valueRequired = attribute.valueRequired;
  }
  if (typeof attribute.visibleInStorefront === "boolean") {
    config.visibleInStorefront = attribute.visibleInStorefront;
  }
  if (typeof attribute.filterableInDashboard === "boolean") {
    config.filterableInDashboard = attribute.filterableInDashboard;
  }

  return config;
};

const getAttributeUpdateConfigInput = (
  attribute: {
    valueRequired?: boolean;
    visibleInStorefront?: boolean;
    filterableInDashboard?: boolean;
  },
  existing?: ManagedAttribute
) => {
  if (!existing) {
    return null;
  }

  const input: {
    valueRequired?: boolean;
    visibleInStorefront?: boolean;
    filterableInDashboard?: boolean;
  } = {};

  if (typeof attribute.valueRequired === "boolean" && existing.valueRequired !== attribute.valueRequired) {
    input.valueRequired = attribute.valueRequired;
  }
  if (
    typeof attribute.visibleInStorefront === "boolean" &&
    existing.visibleInStorefront !== attribute.visibleInStorefront
  ) {
    input.visibleInStorefront = attribute.visibleInStorefront;
  }
  if (
    typeof attribute.filterableInDashboard === "boolean" &&
    existing.filterableInDashboard !== attribute.filterableInDashboard
  ) {
    input.filterableInDashboard = attribute.filterableInDashboard;
  }

  return Object.keys(input).length > 0 ? input : null;
};

async function syncProductTypeAttributeLinks(args: {
  client: Client;
  dryRun: boolean;
  steps: string[];
  errors: string[];
  attrIdsBySlug: Record<string, string>;
}) {
  const { client, dryRun, steps, errors, attrIdsBySlug } = args;
  const productAttributeDefs = CMS_ATTRIBUTES.filter((attribute) => attribute.scope === "PRODUCT_TYPE");
  if (productAttributeDefs.length === 0) {
    return;
  }

  const desiredAttrIds = productAttributeDefs.map((attribute) => attrIdsBySlug[attribute.slug]).filter(Boolean);
  if (desiredAttrIds.length === 0) {
    return;
  }

  const productTypesResult = await loadAllProductTypes(client, errors);
  if (productTypesResult.missingPermission) {
    steps.push("Skipped product-type attribute sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES permission");
    return;
  }

  for (const productType of productTypesResult.items) {
    const existingAttrIds = new Set((productType.productAttributes || []).map((attribute) => attribute.id));
    const mergedAttrIds = Array.from(new Set([...existingAttrIds, ...desiredAttrIds]));
    if (mergedAttrIds.length === existingAttrIds.size) {
      continue;
    }

    if (dryRun) {
      steps.push(
        `[Plan] Update product type ${productType.slug} with ${mergedAttrIds.length - existingAttrIds.size} missing attribute(s)`
      );
      continue;
    }

    const updateRes = await client
      .mutation(
        `mutation UpdateProductTypeAttributes($id: ID!, $input: ProductTypeInput!) {
          productTypeUpdate(id: $id, input: $input) {
            productType {
              id
              slug
            }
            errors {
              field
              message
              code
            }
          }
        }`,
        {
          id: productType.id,
          input: {
            productAttributes: mergedAttrIds,
          },
        }
      )
      .toPromise();

    const transportMessage = getOperationErrorMessage(updateRes.error);
    if (transportMessage) {
      if (hasProductTypePermissionError(transportMessage)) {
        steps.push(`Skipped product type ${productType.slug} sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Update product type ${productType.slug} failed: ${transportMessage}`);
      }
      continue;
    }

    const gqlErrors = updateRes.data?.productTypeUpdate?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      const joined = normalized.join("; ");
      if (hasProductTypePermissionError(joined)) {
        steps.push(`Skipped product type ${productType.slug} sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Update product type ${productType.slug}: ${joined}`);
      }
      continue;
    }

    steps.push(`Updated product type ${productType.slug} (+${mergedAttrIds.length - existingAttrIds.size} attributes)`);
  }
}

const loadManagedPageTypes = async (client: Client, errors: string[]) => {
  const allNodes: ManagedPageType[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  let safety = 0;

  while (hasNextPage && safety < 20) {
    safety += 1;
    const result: any = await client
      .query(
        `query LoadManagedPageTypes($first: Int!, $after: String) {
          pageTypes(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                slug
                name
                attributes {
                  id
                  slug
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        { first: 100, after }
      )
      .toPromise();

    ensureNoTransportError(result.error, errors, "Load managed page types failed");
    const connection: any = result.data?.pageTypes;
    const edges = connection?.edges || [];
    for (const edge of edges) {
      const node = edge?.node;
      if (node?.id && node?.slug) {
        allNodes.push({
          ...node,
          attributes: (node.attributes || []).filter((attribute: any) => Boolean(attribute?.id)),
        });
      }
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return allNodes.filter((node) => isManagedPageTypeSlug(node.slug));
};

const emptyCounts = (): SetupCounts => ({
  missingAttributes: 0,
  missingPageTypes: 0,
  missingPages: 0,
  missingMenus: 0,
  missingPageTypeAttributeLinks: 0,
  missingMenuItems: 0,
  staleAttributes: 0,
  stalePageTypes: 0,
  createdAttributes: 0,
  createdPageTypes: 0,
  createdPages: 0,
  createdMenus: 0,
  createdMenuItems: 0,
  updatedPageTypes: 0,
  removedAttributes: 0,
  removedPageTypes: 0,
  skippedAttributes: 0,
  skippedPageTypes: 0,
  skippedPages: 0,
  skippedMenus: 0,
  skippedMenuItems: 0,
});

const loadManagedPagesBySlugs = async (
  client: Client,
  slugs: string[],
  errors: string[]
): Promise<ManagedPage[]> => {
  if (slugs.length === 0) {
    return [] as ManagedPage[];
  }

  const result = await client
    .query(
      `query LoadManagedPagesBySlugs($slugs: [String!]) {
        pages(filter: { slugs: $slugs }, first: 100) {
          edges {
            node {
              id
              slug
              pageType {
                slug
              }
            }
          }
        }
      }`,
      { slugs }
    )
    .toPromise();

  ensureNoTransportError(result.error, errors, "Load managed pages failed");

  return ((result.data?.pages?.edges || []) as any[])
    .map((edge: any) => edge?.node)
    .filter((node: any): node is ManagedPage => Boolean(node?.id && node?.slug))
    .map((node: any) => ({
      id: node.id,
      slug: node.slug,
      pageTypeSlug: node.pageType?.slug || null,
    }));
};

type ManagedPageForBackup = {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
  content?: string | null;
  pageType: {
    id: string;
    slug: string;
  };
  attributes: Array<{
    attribute?: { id: string; slug?: string | null; inputType?: string | null } | null;
    values: Array<{
      value?: string | null;
      reference?: string | null;
      richText?: string | null;
      file?: { url?: string | null } | null;
    }>;
  }>;
};

const loadManagedPagesByPageTypeIds = async (
  client: Client,
  pageTypeIds: string[],
  errors: string[]
): Promise<ManagedPageForBackup[]> => {
  if (pageTypeIds.length === 0) {
    return [];
  }

  let after: string | null = null;
  let hasNextPage = true;
  let guard = 0;
  const pages: ManagedPageForBackup[] = [];

  while (hasNextPage && guard < 200) {
    guard += 1;
    const result = await client
      .query(
        `query LoadManagedPagesByPageTypes($pageTypeIds: [ID!], $first: Int!, $after: String) {
          pages(filter: { pageTypes: $pageTypeIds }, first: $first, after: $after) {
            edges {
              node {
                id
                slug
                title
                isPublished
                content
                pageType {
                  id
                  slug
                }
                attributes {
                  attribute {
                    id
                    slug
                    inputType
                  }
                  values {
                    value
                    reference
                    richText
                    file {
                      url
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        { pageTypeIds, first: 100, after }
      )
      .toPromise();

    ensureNoTransportError(result.error, errors, "Load managed pages by page types failed");
    const connection: any = result.data?.pages;
    const edges = connection?.edges || [];
    for (const edge of edges) {
      const node = edge?.node;
      if (node?.id && node?.slug && node?.pageType?.id && node?.pageType?.slug) {
        pages.push({
          id: node.id,
          slug: node.slug,
          title: node.title || node.slug,
          isPublished: Boolean(node.isPublished),
          content: node.content || null,
          pageType: {
            id: node.pageType.id,
            slug: node.pageType.slug,
          },
          attributes: (node.attributes || []).filter((entry: any) => Boolean(entry?.attribute?.id)),
        });
      }
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return pages;
};

const normalizeMenuItemName = (name: string) => name.trim().toLowerCase();

const MENU_INTERNAL_PLACEHOLDER_ORIGIN = "https://magic.local";

const toMenuCreateUrl = (url?: string | null): string | null => {
  if (!url) {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    // Fall through for relative/internal routes.
  }

  if (trimmed.startsWith("/")) {
    return `${MENU_INTERNAL_PLACEHOLDER_ORIGIN}${trimmed}`;
  }

  return `${MENU_INTERNAL_PLACEHOLDER_ORIGIN}/${trimmed.replace(/^\/+/, "")}`;
};

const mapMenuItemNode = (node: any): ManagedMenuItem => ({
  id: node.id,
  name: node.name || "",
  url: node.url || null,
  children: ((node.children || []) as any[])
    .filter((child) => Boolean(child?.id))
    .map((child) => mapMenuItemNode(child)),
});

const loadManagedMenusBySlugs = async (
  client: Client,
  slugs: string[],
  errors: string[]
): Promise<MenuLoadResult> => {
  if (slugs.length === 0) {
    return { menus: [], missingPermission: false };
  }

  const result = await client
    .query(
      `query LoadManagedMenusBySlugs($slugs: [String!]) {
        menus(filter: { slugs: $slugs }, first: 100) {
          edges {
            node {
              id
              slug
              name
              items {
                id
                name
                url
                children {
                  id
                  name
                  url
                  children {
                    id
                    name
                    url
                    children {
                      id
                      name
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { slugs }
    )
    .toPromise();

  const transportMessage = getOperationErrorMessage(result.error);
  if (transportMessage) {
    if (hasMenuPermissionError(transportMessage)) {
      return { menus: [], missingPermission: true };
    }
    errors.push(`Load managed menus failed: ${transportMessage}`);
  }

  const menus: ManagedMenu[] = ((result.data?.menus?.edges || []) as any[])
    .map((edge: any) => edge?.node)
    .filter((node: any) => Boolean(node?.id && node?.slug))
    .map((node: any) => ({
      id: node.id,
      slug: node.slug,
      name: node.name || null,
      items: ((node.items || []) as any[])
        .filter((item: any) => Boolean(item?.id))
        .map((item: any) => mapMenuItemNode(item)),
    }));

  return {
    menus,
    missingPermission: false,
  };
};

const countSeedMenuItems = (items: Array<{ children?: any[] }>): number =>
  items.reduce((acc, item) => acc + 1 + countSeedMenuItems(item.children || []), 0);

const countMissingSeedMenuItems = (
  existingItems: ManagedMenuItem[],
  seedItems: Array<{ name: string; children?: any[] }>
) => {
  let missing = 0;
  const existingByName = new Map(existingItems.map((item) => [normalizeMenuItemName(item.name), item]));
  for (const seed of seedItems) {
    const existing = existingByName.get(normalizeMenuItemName(seed.name));
    if (!existing) {
      missing += countSeedMenuItems([seed]);
      continue;
    }
    missing += countMissingSeedMenuItems(existing.children || [], seed.children || []);
  }
  return missing;
};

const ensureSeedMenuItems = async (
  client: Client,
  menuId: string,
  existingItems: ManagedMenuItem[],
  seedItems: Array<{ name: string; url?: string; children?: any[] }>,
  errors: string[],
  steps: string[],
  menuSlug: string,
  parentId?: string
): Promise<{ created: number; skipped: number; permissionMissing: boolean }> => {
  let created = 0;
  let skipped = 0;
  const existingByName = new Map(existingItems.map((item) => [normalizeMenuItemName(item.name), item]));

  for (const seed of seedItems) {
    const existing = existingByName.get(normalizeMenuItemName(seed.name));
    let node = existing;
    if (!node) {
      const createRes = await client
        .mutation(
          `mutation CreateMenuItem($input: MenuItemCreateInput!) {
            menuItemCreate(input: $input) {
              menuItem {
                id
                name
              }
              errors {
                field
                message
                code
              }
            }
          }`,
          {
            input: {
              menu: menuId,
              name: seed.name,
              url: toMenuCreateUrl(seed.url),
              parent: parentId || null,
            },
          }
        )
        .toPromise();

      const transportMessage = getOperationErrorMessage(createRes.error);
      if (transportMessage) {
        if (hasMenuPermissionError(transportMessage)) {
          return { created, skipped, permissionMissing: true };
        }
        errors.push(`Create menu item ${seed.name} in ${menuSlug} failed: ${transportMessage}`);
        continue;
      }

      const itemErrors = createRes.data?.menuItemCreate?.errors || [];
      const normalized = normalizeErrors(itemErrors as any);
      if (normalized.length > 0) {
        const joined = normalized.join("; ");
        if (hasMenuPermissionError(joined)) {
          return { created, skipped, permissionMissing: true };
        }
        errors.push(`Create menu item ${seed.name} in ${menuSlug}: ${joined}`);
        continue;
      }

      const createdId = createRes.data?.menuItemCreate?.menuItem?.id;
      if (!createdId) {
        errors.push(`Create menu item ${seed.name} in ${menuSlug}: created but ID missing.`);
        continue;
      }
      node = {
        id: createdId,
        name: seed.name,
        url: seed.url || null,
        children: [],
      };
      created += 1;
      steps.push(`Created menu item "${seed.name}" in ${menuSlug}`);
    } else {
      skipped += 1;
      steps.push(`Menu item "${seed.name}" already exists in ${menuSlug} (skipped)`);
    }

    if ((seed.children || []).length > 0 && node) {
      const nested = await ensureSeedMenuItems(
        client,
        menuId,
        node.children || [],
        seed.children || [],
        errors,
        steps,
        menuSlug,
        node.id
      );
      if (nested.permissionMissing) {
        return { created, skipped, permissionMissing: true };
      }
      created += nested.created;
      skipped += nested.skipped;
    }
  }

  return { created, skipped, permissionMissing: false };
};

export async function performSetup(client: Client, options: SetupOptions = {}): Promise<SetupResult> {
  const dryRun = Boolean(options.dryRun);
  const cleanup = options.cleanup !== false;

  const steps: string[] = [];
  const errors: string[] = [];
  const counts = emptyCounts();

  const desiredAttributeBySlug = new Map(CMS_ATTRIBUTES.map((attr) => [attr.slug, attr]));
  const desiredPageTypeBySlug = new Map(CMS_PAGE_TYPES.map((pt) => [pt.slug, pt]));

  const existingAttributes = await loadManagedAttributes(client, errors);
  const existingPageTypes = await loadManagedPageTypes(client, errors);
  const existingPages = await loadManagedPagesBySlugs(
    client,
    CMS_DEFAULT_PAGES.map((page) => page.slug),
    errors
  );
  const existingMenusResult = await loadManagedMenusBySlugs(
    client,
    CMS_MENU_STRUCTURES.map((menu) => menu.slug),
    errors
  );
  const canManageMenus = !existingMenusResult.missingPermission;
  if (!canManageMenus) {
    steps.push("Skipped navbar structure sync: missing MANAGE_MENUS permission");
  }
  const existingMenus = existingMenusResult.menus;

  const existingAttributeBySlug = new Map(existingAttributes.map((attribute) => [attribute.slug, attribute]));
  const existingPageTypeBySlug = new Map(existingPageTypes.map((pageType) => [pageType.slug, pageType]));
  const existingPageBySlug = new Map<string, ManagedPage>(
    existingPages.map((page: ManagedPage): [string, ManagedPage] => [page.slug, page])
  );
  const existingMenuBySlug = new Map<string, ManagedMenu>(
    existingMenus.map((menu: ManagedMenu): [string, ManagedMenu] => [menu.slug, menu])
  );

  const missingAttributeDefs = CMS_ATTRIBUTES.filter((attr) => !existingAttributeBySlug.has(attr.slug));
  const missingPageTypeDefs = CMS_PAGE_TYPES.filter((pageType) => !existingPageTypeBySlug.has(pageType.slug));
  const missingPageDefs = CMS_DEFAULT_PAGES.filter((page) => !existingPageBySlug.has(page.slug));
  const missingMenuDefs = canManageMenus
    ? CMS_MENU_STRUCTURES.filter((menu) => !existingMenuBySlug.has(menu.slug))
    : [];

  counts.missingAttributes = missingAttributeDefs.length;
  counts.missingPageTypes = missingPageTypeDefs.length;
  counts.missingPages = missingPageDefs.length;
  counts.missingMenus = missingMenuDefs.length;
  counts.missingMenuItems = canManageMenus
    ? CMS_MENU_STRUCTURES.reduce((total, menuDef) => {
        const seeds = menuDef.items || [];
        if (seeds.length === 0) {
          return total;
        }
        const existingMenu = existingMenuBySlug.get(menuDef.slug);
        if (!existingMenu) {
          return total + countSeedMenuItems(seeds);
        }
        return total + countMissingSeedMenuItems(existingMenu.items || [], seeds);
      }, 0)
    : 0;

  const desiredAttributeSlugs = new Set(CMS_ATTRIBUTES.map((attr) => attr.slug));
  const desiredPageTypeSlugs = new Set(CMS_PAGE_TYPES.map((pageType) => pageType.slug));

  const staleAttributes = existingAttributes.filter((attribute) => !desiredAttributeSlugs.has(attribute.slug));
  const stalePageTypes = existingPageTypes.filter((pageType) => !desiredPageTypeSlugs.has(pageType.slug));

  counts.staleAttributes = staleAttributes.length;
  counts.stalePageTypes = stalePageTypes.length;

  let missingLinks = 0;
  const mismatchedAttributes = new Map<string, ManagedAttribute>();
  for (const pageTypeDef of CMS_PAGE_TYPES) {
    const existingPageType = existingPageTypeBySlug.get(pageTypeDef.slug);
    if (!existingPageType) {
      continue;
    }

    const existingAttrSlugSet = new Set((existingPageType.attributes || []).map((attribute) => attribute.slug || ""));
    for (const requiredSlug of pageTypeDef.attributes) {
      if (!existingAttrSlugSet.has(requiredSlug)) {
        missingLinks += 1;
      }
    }
  }
  counts.missingPageTypeAttributeLinks = missingLinks;

  const attrIdsBySlug: Record<string, string> = {};
  for (const attrDef of CMS_ATTRIBUTES) {
    const existing = existingAttributeBySlug.get(attrDef.slug);
    if (existing?.id) {
      attrIdsBySlug[attrDef.slug] = existing.id;
    }
  }

  const hasAnyManagedState = existingAttributes.length > 0 || existingPageTypes.length > 0 || existingMenus.length > 0;
  const hasPendingChanges =
    counts.missingAttributes > 0 ||
    counts.missingPageTypes > 0 ||
    counts.missingPages > 0 ||
    counts.missingMenus > 0 ||
    counts.missingPageTypeAttributeLinks > 0 ||
    counts.missingMenuItems > 0 ||
    mismatchedAttributes.size > 0 ||
    (cleanup && (counts.staleAttributes > 0 || counts.stalePageTypes > 0));

  const mode: SetupMode = hasPendingChanges ? (hasAnyManagedState ? "update" : "initialize") : "already_initialized";

  // Validate managed attribute shapes: Saleor does not support changing `inputType` after creation.
  // Treat these as non-blocking action warnings so setup can continue for unaffected modules.
  for (const attrDef of CMS_ATTRIBUTES) {
    const existing = existingAttributeBySlug.get(attrDef.slug);
    if (!existing) continue;
    const desiredInputType = INPUT_TYPE_MAP[attrDef.type];
    const existingInputType = (existing.inputType || "").toUpperCase();
    if (desiredInputType && existingInputType && existingInputType !== String(desiredInputType)) {
      mismatchedAttributes.set(attrDef.slug, existing);
      const extraHint =
        attrDef.slug === "magic-product-images"
          ? " This field must be FILE type (image URLs) for PDP image blocks."
          : "";
      if (dryRun) {
        steps.push(
          `[Plan] Recreate attribute ${attrDef.slug} due to inputType mismatch: expected ${desiredInputType}, got ${existing.inputType}.${extraHint}`
        );
      } else {
        steps.push(
          `[Auto-Fix] Attribute ${attrDef.slug} inputType mismatch: expected ${desiredInputType}, got ${existing.inputType}. Recreate flow will run.${extraHint}`
        );
      }
    }
  }

  for (const attrDef of CMS_ATTRIBUTES) {
    const mismatch = mismatchedAttributes.get(attrDef.slug);
    let existing = existingAttributeBySlug.get(attrDef.slug);

    if (mismatch && existing?.id) {
      if (dryRun) {
        continue;
      }
      const existingAttrId = existing.id;

      if (attrDef.scope === "PRODUCT_TYPE") {
        const productTypesResult = await loadAllProductTypes(client, errors);
        if (productTypesResult.missingPermission) {
          steps.push(
            `Skipped mismatch auto-fix for ${attrDef.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`
          );
          continue;
        }

        for (const productType of productTypesResult.items) {
          const currentAttrIds = (productType.productAttributes || []).map((attribute) => attribute.id);
          if (!currentAttrIds.includes(existingAttrId)) continue;

          const nextAttrIds = currentAttrIds.filter((attributeId) => attributeId !== existingAttrId);
          const updateRes = await client
            .mutation(
              `mutation UpdateProductTypeAttributes($id: ID!, $input: ProductTypeInput!) {
                productTypeUpdate(id: $id, input: $input) {
                  errors {
                    field
                    message
                    code
                  }
                }
              }`,
              {
                id: productType.id,
                input: {
                  productAttributes: nextAttrIds,
                },
              }
            )
            .toPromise();

          const updateTransportMessage = getOperationErrorMessage(updateRes.error);
          if (updateTransportMessage) {
            errors.push(
              `Unassign mismatched attribute ${attrDef.slug} from product type ${productType.slug} failed: ${updateTransportMessage}`
            );
            continue;
          }

          const updateErrors = updateRes.data?.productTypeUpdate?.errors || [];
          const normalizedUpdateErrors = normalizeErrors(updateErrors as any);
          if (normalizedUpdateErrors.length > 0) {
            errors.push(
              `Unassign mismatched attribute ${attrDef.slug} from product type ${productType.slug}: ${normalizedUpdateErrors.join("; ")}`
            );
            continue;
          }

          steps.push(`Unassigned mismatched attribute ${attrDef.slug} from product type ${productType.slug}`);
        }
      } else {
        const pageTypes = await loadManagedPageTypes(client, errors);
        const linkedPageTypes = pageTypes.filter((pageType) =>
          (pageType.attributes || []).some((pageTypeAttribute) => pageTypeAttribute.id === existingAttrId)
        );
        for (const pageType of linkedPageTypes) {
          const unassignRes = await client
            .mutation(
              `mutation UnassignAttributeFromPageType($pageTypeId: ID!, $attributeIds: [ID!]!) {
                pageAttributeUnassign(pageTypeId: $pageTypeId, attributeIds: $attributeIds) {
                  errors {
                    field
                    message
                    code
                  }
                }
              }`,
              {
                pageTypeId: pageType.id,
                attributeIds: [existingAttrId],
              }
            )
            .toPromise();

          const unassignTransportMessage = getOperationErrorMessage(unassignRes.error);
          if (unassignTransportMessage) {
            errors.push(
              `Unassign mismatched attribute ${attrDef.slug} from page type ${pageType.slug} failed: ${unassignTransportMessage}`
            );
            continue;
          }

          const unassignErrors = unassignRes.data?.pageAttributeUnassign?.errors || [];
          const normalizedUnassignErrors = normalizeErrors(unassignErrors as any);
          if (normalizedUnassignErrors.length > 0) {
            errors.push(
              `Unassign mismatched attribute ${attrDef.slug} from page type ${pageType.slug}: ${normalizedUnassignErrors.join("; ")}`
            );
            continue;
          }

          steps.push(`Unassigned mismatched attribute ${attrDef.slug} from page type ${pageType.slug}`);
        }
      }

      const deleteRes = await client
        .mutation(
          `mutation DeleteAttribute($id: ID!) {
            attributeDelete(id: $id) {
              errors {
                field
                message
                code
              }
            }
          }`,
          { id: existing.id }
        )
        .toPromise();

      const deleteTransportMessage = getOperationErrorMessage(deleteRes.error);
      if (deleteTransportMessage) {
        if (hasProductTypePermissionError(deleteTransportMessage)) {
          steps.push(
            `Skipped mismatch auto-fix for ${attrDef.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`
          );
        } else {
          errors.push(`Delete mismatched attribute ${attrDef.slug} failed: ${deleteTransportMessage}`);
        }
      } else {
        const deleteErrors = deleteRes.data?.attributeDelete?.errors || [];
        const normalizedDeleteErrors = normalizeErrors(deleteErrors as any);
        if (normalizedDeleteErrors.length > 0) {
          const joined = normalizedDeleteErrors.join("; ");
          if (hasProductTypePermissionError(joined)) {
            steps.push(
              `Skipped mismatch auto-fix for ${attrDef.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`
            );
          } else {
            errors.push(`Delete mismatched attribute ${attrDef.slug}: ${joined}`);
          }
        } else {
          steps.push(`Removed mismatched attribute ${attrDef.slug}`);
          counts.removedAttributes += 1;
          existingAttributeBySlug.delete(attrDef.slug);
          delete attrIdsBySlug[attrDef.slug];
          existing = undefined;
        }
      }
    }

    if (existing) {
      if (!dryRun) {
        const updateInput = getAttributeUpdateConfigInput(attrDef, existing);
        if (updateInput) {
          const updateRes = await client
            .mutation(
              `mutation UpdateAttributeConfig($id: ID!, $input: AttributeUpdateInput!) {
                attributeUpdate(id: $id, input: $input) {
                  errors {
                    field
                    message
                    code
                  }
                }
              }`,
              { id: existing.id, input: updateInput }
            )
            .toPromise();

          const updateTransportMessage = getOperationErrorMessage(updateRes.error);
          if (updateTransportMessage) {
            errors.push(`Update attribute ${attrDef.slug} config failed: ${updateTransportMessage}`);
          } else {
            const updateErrors = updateRes.data?.attributeUpdate?.errors || [];
            const normalizedUpdateErrors = normalizeErrors(updateErrors as any);
            if (normalizedUpdateErrors.length > 0) {
              errors.push(`Update attribute ${attrDef.slug} config: ${normalizedUpdateErrors.join("; ")}`);
            } else {
              steps.push(`Updated attribute ${attrDef.slug} config`);
            }
          }
        }
      }
      counts.skippedAttributes += 1;
      steps.push(`Attribute ${attrDef.slug} already exists (skipped)`);
      continue;
    }

    if (dryRun) {
      steps.push(`[Plan] Create attribute ${attrDef.slug}`);
      continue;
    }

    const createRes = await client
      .mutation(AttributeCreateDocument, {
        input: {
          name: attrDef.name,
          slug: attrDef.slug,
          type: resolveAttributeScope(attrDef.scope),
          inputType: INPUT_TYPE_MAP[attrDef.type],
          entityType: attrDef.entity ? ENTITY_TYPE_MAP[attrDef.entity] : undefined,
          ...getAttributeCreateConfigInput(attrDef),
        },
      })
      .toPromise();

    ensureNoTransportError(createRes.error, errors, `Create attribute ${attrDef.slug} failed`);

    const gqlErrors = createRes.data?.attributeCreate?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      const unique = gqlErrors.some((error) => error.code === "UNIQUE");
      if (!unique) {
        errors.push(`Create attribute ${attrDef.slug}: ${normalized.join("; ")}`);
      }

      const refreshedAttributes = await loadManagedAttributes(client, errors);
      const refreshed = refreshedAttributes.find((attribute) => attribute.slug === attrDef.slug);
      if (refreshed?.id) {
        attrIdsBySlug[attrDef.slug] = refreshed.id;
        counts.skippedAttributes += 1;
        steps.push(`Attribute ${attrDef.slug} already exists (linked after retry)`);
      } else if (!unique) {
        continue;
      } else {
        errors.push(`Create attribute ${attrDef.slug}: UNIQUE reported but could not resolve the attribute ID.`);
      }
      continue;
    }

    const createdId = createRes.data?.attributeCreate?.attribute?.id || "";
    if (!createdId) {
      errors.push(`Create attribute ${attrDef.slug}: created but ID missing.`);
      continue;
    }

    attrIdsBySlug[attrDef.slug] = createdId;
    counts.createdAttributes += 1;
    steps.push(`Created attribute ${attrDef.slug}`);
  }

  const refreshedPageTypes = dryRun ? existingPageTypes : await loadManagedPageTypes(client, errors);
  const pageTypeBySlug = new Map(refreshedPageTypes.map((pageType) => [pageType.slug, pageType]));

  for (const pageTypeDef of CMS_PAGE_TYPES) {
    const desiredAttributeIds = pageTypeDef.attributes
      .map((slug) => attrIdsBySlug[slug])
      .filter(Boolean)
      .filter((attributeId) => {
        const attrSlug = pageTypeDef.attributes.find((slug) => attrIdsBySlug[slug] === attributeId);
        if (!attrSlug) {
          return false;
        }
        const attrDef = CMS_ATTRIBUTES.find((attribute) => attribute.slug === attrSlug);
        return attrDef?.scope !== "PRODUCT_TYPE";
      });

    const existingPageType = pageTypeBySlug.get(pageTypeDef.slug);
    if (!existingPageType) {
      if (dryRun) {
        steps.push(`[Plan] Create page type ${pageTypeDef.slug}`);
        continue;
      }

      const createRes = await client
        .mutation(PageTypeCreateDocument, {
          input: {
            name: pageTypeDef.name,
            slug: pageTypeDef.slug,
            addAttributes: desiredAttributeIds,
          },
        })
        .toPromise();

      ensureNoTransportError(createRes.error, errors, `Create page type ${pageTypeDef.slug} failed`);
      const gqlErrors = createRes.data?.pageTypeCreate?.errors || [];
      const normalized = normalizeErrors(gqlErrors as any);
      if (normalized.length > 0) {
        const unique = gqlErrors.some((error) => error.code === "UNIQUE");
        if (!unique) {
          errors.push(`Create page type ${pageTypeDef.slug}: ${normalized.join("; ")}`);
          continue;
        }

        const refreshedPageTypeList = await loadManagedPageTypes(client, errors);
        const refreshed = refreshedPageTypeList.find((pageType) => pageType.slug === pageTypeDef.slug);
        if (refreshed?.id) {
          pageTypeBySlug.set(pageTypeDef.slug, refreshed);
          counts.skippedPageTypes += 1;
          steps.push(`Page type ${pageTypeDef.slug} already exists (linked after retry)`);
        } else {
          errors.push(`Create page type ${pageTypeDef.slug}: UNIQUE reported but could not resolve the page type ID.`);
        }
        continue;
      }

      const createdPageTypeId = createRes.data?.pageTypeCreate?.pageType?.id || "";
      if (!createdPageTypeId) {
        errors.push(`Create page type ${pageTypeDef.slug}: created but ID missing.`);
        continue;
      }
      pageTypeBySlug.set(pageTypeDef.slug, {
        id: createdPageTypeId,
        slug: pageTypeDef.slug,
        name: pageTypeDef.name,
        attributes: desiredAttributeIds.map((id) => ({ id })),
      });
      counts.createdPageTypes += 1;
      steps.push(`Created page type ${pageTypeDef.slug}`);
      continue;
    }

    const existingAttrIds = new Set((existingPageType.attributes || []).map((attribute) => attribute.id));
    const missingAttributeIds = desiredAttributeIds.filter((id) => !existingAttrIds.has(id));

    if (missingAttributeIds.length === 0) {
      counts.skippedPageTypes += 1;
      steps.push(`Page type ${pageTypeDef.slug} already up-to-date (skipped)`);
      continue;
    }

    if (dryRun) {
      steps.push(`[Plan] Update page type ${pageTypeDef.slug} with ${missingAttributeIds.length} missing attribute(s)`);
      continue;
    }

    const updateRes = await client
      .mutation(PageTypeUpdateDocument, {
        id: existingPageType.id,
        input: {
          addAttributes: missingAttributeIds,
        },
      })
      .toPromise();

    ensureNoTransportError(updateRes.error, errors, `Update page type ${pageTypeDef.slug} failed`);

    const updateErrors = updateRes.data?.pageTypeUpdate?.errors || [];
    const normalized = normalizeErrors(updateErrors as any);
    if (normalized.length > 0) {
      errors.push(`Update page type ${pageTypeDef.slug}: ${normalized.join("; ")}`);
      continue;
    }

    counts.updatedPageTypes += 1;
    steps.push(`Updated page type ${pageTypeDef.slug} (+${missingAttributeIds.length} attributes)`);
  }

  await syncProductTypeAttributeLinks({
    client,
    dryRun,
    steps,
    errors,
    attrIdsBySlug,
  });

  for (const attrDef of CMS_ATTRIBUTES) {
    if (!attrDef.referencePageTypeSlugs || attrDef.referencePageTypeSlugs.length === 0) {
      continue;
    }
    const attrId = attrIdsBySlug[attrDef.slug];
    if (!attrId) {
      errors.push(`Reference sync ${attrDef.slug}: attribute ID not resolved.`);
      continue;
    }
    const referenceTypeIds = attrDef.referencePageTypeSlugs
      .map((slug) => pageTypeBySlug.get(slug)?.id || "")
      .filter(Boolean);
    if (referenceTypeIds.length === 0) {
      errors.push(
        `Reference sync ${attrDef.slug}: none of referenced page types were resolved (${attrDef.referencePageTypeSlugs.join(
          ", "
        )}).`
      );
      continue;
    }

    if (dryRun) {
      steps.push(
        `[Plan] Sync ${attrDef.slug} referenceTypes -> ${attrDef.referencePageTypeSlugs.join(", ")}`
      );
      continue;
    }

    const refSyncRes = await client
      .mutation(
        `mutation AttributeReferenceTypesSync($id: ID!, $input: AttributeUpdateInput!) {
          attributeUpdate(id: $id, input: $input) {
            attribute {
              id
              slug
            }
            errors {
              field
              message
              code
            }
          }
        }`,
        {
          id: attrId,
          input: {
            referenceTypes: referenceTypeIds,
          },
        }
      )
      .toPromise();

    const transportMessage = getOperationErrorMessage(refSyncRes.error);
    if (transportMessage) {
      if (hasProductTypePermissionError(transportMessage)) {
        steps.push(
          `Skipped ${attrDef.slug} referenceTypes sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES permission`
        );
      } else {
        errors.push(`Reference sync ${attrDef.slug} failed: ${transportMessage}`);
      }
      continue;
    }

    const syncErrors = refSyncRes.data?.attributeUpdate?.errors || [];
    const normalized = normalizeErrors(syncErrors as any);
    if (normalized.length > 0) {
      const joined = normalized.join("; ");
      if (hasProductTypePermissionError(joined)) {
        steps.push(
          `Skipped ${attrDef.slug} referenceTypes sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES permission`
        );
      } else {
        errors.push(`Reference sync ${attrDef.slug}: ${joined}`);
      }
      continue;
    }
    steps.push(`Synced ${attrDef.slug} referenceTypes (${attrDef.referencePageTypeSlugs.length} page types)`);
  }

  const refreshedPages = dryRun
    ? existingPages
    : await loadManagedPagesBySlugs(
        client,
        CMS_DEFAULT_PAGES.map((page) => page.slug),
        errors
      );
  const pageBySlug = new Map<string, ManagedPage>(
    refreshedPages.map((page: ManagedPage): [string, ManagedPage] => [page.slug, page])
  );

  for (const pageDef of CMS_DEFAULT_PAGES) {
    const existingPage = pageBySlug.get(pageDef.slug);
    if (existingPage?.id) {
      counts.skippedPages += 1;
      steps.push(`Page ${pageDef.slug} already exists (skipped)`);
      continue;
    }

    const pageTypeId = pageTypeBySlug.get(pageDef.pageTypeSlug)?.id;
    if (!pageTypeId) {
      errors.push(`Create page ${pageDef.slug}: page type ${pageDef.pageTypeSlug} not found.`);
      continue;
    }

    const attributes: Array<{ id: string; values: string[] }> = [];
    if (pageDef.attributeValues) {
      for (const [attrSlug, rawValue] of Object.entries(pageDef.attributeValues)) {
        const attrId = attrIdsBySlug[attrSlug];
        if (!attrId) {
          errors.push(`Create page ${pageDef.slug}: attribute ${attrSlug} not found.`);
          continue;
        }
        const value = Array.isArray(rawValue)
          ? rawValue.map((item) => String(item))
          : [typeof rawValue === "object" ? JSON.stringify(rawValue) : String(rawValue)];
        attributes.push({ id: attrId, values: value });
      }
    }

    if (dryRun) {
      steps.push(`[Plan] Create page ${pageDef.slug}`);
      continue;
    }

    const createPageRes = await client
      .mutation(
        `mutation CreateManagedPage($input: PageCreateInput!) {
          pageCreate(input: $input) {
            page {
              id
              slug
            }
            errors {
              field
              message
              code
            }
          }
        }`,
        {
          input: {
            title: pageDef.title,
            slug: pageDef.slug,
            pageType: pageTypeId,
            isPublished: pageDef.isPublished,
            content: pageDef.content || null,
            attributes,
          },
        }
      )
      .toPromise();

    ensureNoTransportError(createPageRes.error, errors, `Create page ${pageDef.slug} failed`);

    const pageErrors = createPageRes.data?.pageCreate?.errors || [];
    const normalizedPageErrors = normalizeErrors(pageErrors as any);
    if (normalizedPageErrors.length > 0) {
      const joined = normalizedPageErrors.join("; ");
      if (pageErrors.some((error: any) => error?.code === "UNIQUE")) {
        counts.skippedPages += 1;
        steps.push(`Page ${pageDef.slug} already exists (linked after retry)`);
      } else {
        errors.push(`Create page ${pageDef.slug}: ${joined}`);
      }
      continue;
    }

    counts.createdPages += 1;
    steps.push(`Created page ${pageDef.slug}`);
  }

  if (canManageMenus) {
    const menuBySlug = new Map<string, ManagedMenu>(
      (
        dryRun
          ? existingMenus
          : (
              await loadManagedMenusBySlugs(
                client,
                CMS_MENU_STRUCTURES.map((menu) => menu.slug),
                errors
              )
            ).menus
      ).map((menu) => [menu.slug, menu])
    );

    for (const menuDef of CMS_MENU_STRUCTURES) {
      let menuNode = menuBySlug.get(menuDef.slug);
      if (!menuNode) {
        if (dryRun) {
          steps.push(`[Plan] Create menu structure ${menuDef.slug}`);
        } else {
          const createMenuRes = await client
            .mutation(
              `mutation CreateMenuStructure($input: MenuCreateInput!) {
                menuCreate(input: $input) {
                  menu {
                    id
                    slug
                    name
                  }
                  errors {
                    field
                    message
                    code
                  }
                }
              }`,
              {
                input: {
                  name: menuDef.name,
                  slug: menuDef.slug,
                },
              }
            )
            .toPromise();

          const transportMessage = getOperationErrorMessage(createMenuRes.error);
          if (transportMessage) {
            if (hasMenuPermissionError(transportMessage)) {
              steps.push(`Skipped menu ${menuDef.slug}: missing MANAGE_MENUS permission`);
              continue;
            }
            errors.push(`Create menu ${menuDef.slug} failed: ${transportMessage}`);
            continue;
          }

          const menuErrors = createMenuRes.data?.menuCreate?.errors || [];
          const normalizedMenuErrors = normalizeErrors(menuErrors as any);
          if (normalizedMenuErrors.length > 0) {
            const joined = normalizedMenuErrors.join("; ");
            if (hasMenuPermissionError(joined)) {
              steps.push(`Skipped menu ${menuDef.slug}: missing MANAGE_MENUS permission`);
            } else if (menuErrors.some((error: any) => error?.code === "UNIQUE")) {
              counts.skippedMenus += 1;
              steps.push(`Menu ${menuDef.slug} already exists (linked after retry)`);
            } else {
              errors.push(`Create menu ${menuDef.slug}: ${joined}`);
            }
          } else {
            const createdMenu = createMenuRes.data?.menuCreate?.menu;
            if (createdMenu?.id && createdMenu?.slug) {
              counts.createdMenus += 1;
              steps.push(`Created menu ${menuDef.slug}`);
              menuNode = {
                id: createdMenu.id,
                slug: createdMenu.slug,
                name: createdMenu.name || null,
                items: [],
              };
              menuBySlug.set(menuDef.slug, menuNode);
            } else {
              errors.push(`Create menu ${menuDef.slug}: created but ID missing.`);
            }
          }
        }
      } else {
        counts.skippedMenus += 1;
        steps.push(`Menu ${menuDef.slug} already exists (skipped)`);
      }

      const seedItems = menuDef.items || [];
      if (seedItems.length === 0) {
        continue;
      }

      if (dryRun) {
        const pendingSeeds = menuNode
          ? countMissingSeedMenuItems(menuNode.items || [], seedItems)
          : countSeedMenuItems(seedItems);
        if (pendingSeeds > 0) {
          steps.push(`[Plan] Seed ${pendingSeeds} menu item(s) into ${menuDef.slug}`);
        }
        continue;
      }

      if (!menuNode?.id) {
        const refreshedMenus = await loadManagedMenusBySlugs(client, [menuDef.slug], errors);
        menuNode = refreshedMenus.menus[0];
      }
      if (!menuNode?.id) {
        errors.push(`Seed menu ${menuDef.slug}: menu not found.`);
        continue;
      }

      const seedResult = await ensureSeedMenuItems(
        client,
        menuNode.id,
        menuNode.items || [],
        seedItems,
        errors,
        steps,
        menuDef.slug
      );
      if (seedResult.permissionMissing) {
        steps.push(`Skipped menu item seeding for ${menuDef.slug}: missing MANAGE_MENUS permission`);
        continue;
      }

      counts.createdMenuItems += seedResult.created;
      counts.skippedMenuItems += seedResult.skipped;
    }
  }

  if (cleanup) {
    for (const pageType of stalePageTypes) {
      if (dryRun) {
        steps.push(`[Plan] Remove stale page type ${pageType.slug}`);
        continue;
      }

      const result = await client
        .mutation(
          `mutation DeletePageType($id: ID!) {
            pageTypeDelete(id: $id) {
              errors {
                field
                message
              }
            }
          }`,
          { id: pageType.id }
        )
        .toPromise();

      const transportMessage = getOperationErrorMessage(result.error);
      if (transportMessage) {
        if (hasProductTypePermissionError(transportMessage)) {
          steps.push(`Skipped stale page type cleanup for ${pageType.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
        } else {
          errors.push(`Delete stale page type ${pageType.slug} failed: ${transportMessage}`);
        }
        continue;
      }

      const gqlErrors = result.data?.pageTypeDelete?.errors || [];
      const normalized = normalizeErrors(gqlErrors as any);
      if (normalized.length > 0) {
        const joined = normalized.join("; ");
        if (hasProductTypePermissionError(joined)) {
          steps.push(`Skipped stale page type cleanup for ${pageType.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
        } else {
          errors.push(`Delete stale page type ${pageType.slug}: ${joined}`);
        }
        continue;
      }

      counts.removedPageTypes += 1;
      steps.push(`Removed stale page type ${pageType.slug}`);
    }

    const cleanupPageTypes = dryRun ? existingPageTypes : await loadManagedPageTypes(client, errors);

    for (const attribute of staleAttributes) {
      if (dryRun) {
        steps.push(`[Plan] Remove stale attribute ${attribute.slug}`);
        continue;
      }

      const linkedPageTypes = cleanupPageTypes.filter((pageType) =>
        (pageType.attributes || []).some((pageTypeAttribute) => pageTypeAttribute.id === attribute.id)
      );
      for (const pageType of linkedPageTypes) {
        const unassignRes = await client
          .mutation(
            `mutation UnassignAttributeFromPageType($pageTypeId: ID!, $attributeIds: [ID!]!) {
              pageAttributeUnassign(pageTypeId: $pageTypeId, attributeIds: $attributeIds) {
                errors {
                  field
                  message
                }
              }
            }`,
            {
              pageTypeId: pageType.id,
              attributeIds: [attribute.id],
            }
          )
          .toPromise();

        const transportMessage = getOperationErrorMessage(unassignRes.error);
        if (transportMessage) {
          if (hasProductTypePermissionError(transportMessage)) {
            steps.push(
              `Skipped unassign ${attribute.slug} from ${pageType.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`
            );
          } else {
            errors.push(`Unassign stale attribute ${attribute.slug} from ${pageType.slug} failed: ${transportMessage}`);
          }
          continue;
        }

        const unassignErrors = unassignRes.data?.pageAttributeUnassign?.errors || [];
        const normalizedUnassignErrors = normalizeErrors(unassignErrors as any);
        if (normalizedUnassignErrors.length > 0) {
          const joined = normalizedUnassignErrors.join("; ");
          if (joined.includes("Couldn't resolve to a node")) {
            steps.push(`Skipped unassign ${attribute.slug} from ${pageType.slug}: page type no longer exists`);
          } else if (hasProductTypePermissionError(joined)) {
            steps.push(
              `Skipped unassign ${attribute.slug} from ${pageType.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`
            );
          } else {
            errors.push(`Unassign stale attribute ${attribute.slug} from ${pageType.slug}: ${joined}`);
          }
          continue;
        }
        steps.push(`Unassigned stale attribute ${attribute.slug} from ${pageType.slug}`);
      }

      const result = await client
        .mutation(
          `mutation DeleteAttribute($id: ID!) {
            attributeDelete(id: $id) {
              errors {
                field
                message
                code
              }
            }
          }`,
          { id: attribute.id }
        )
        .toPromise();

      const transportMessage = getOperationErrorMessage(result.error);
      if (transportMessage) {
        if (hasProductTypePermissionError(transportMessage)) {
          steps.push(`Skipped stale attribute cleanup for ${attribute.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
        } else {
          errors.push(`Delete stale attribute ${attribute.slug} failed: ${transportMessage}`);
        }
        continue;
      }

      const gqlErrors = result.data?.attributeDelete?.errors || [];
      const normalized = normalizeErrors(gqlErrors as any);
      if (normalized.length > 0) {
        const joined = normalized.join("; ");
        if (joined.includes("Couldn't resolve to a node")) {
          steps.push(`Skipped stale attribute cleanup for ${attribute.slug}: attribute already missing`);
          continue;
        }
        if (hasProductTypePermissionError(joined)) {
          steps.push(`Skipped stale attribute cleanup for ${attribute.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
        } else {
          errors.push(`Delete stale attribute ${attribute.slug}: ${joined}`);
        }
        continue;
      }

      counts.removedAttributes += 1;
      steps.push(`Removed stale attribute ${attribute.slug}`);
    }
  }

  const normalizedErrors: string[] = [];
  for (const entry of errors) {
    if (entry.toLowerCase().includes("inputtype mismatch")) {
      const actionNote = entry.startsWith("[Action Required]") ? entry : `[Action Required] ${entry}`;
      if (!steps.includes(actionNote)) {
        steps.push(actionNote);
      }
      continue;
    }
    normalizedErrors.push(entry);
  }

  return {
    steps,
    errors: normalizedErrors,
    mode,
    dryRun,
    hasPendingChanges,
    counts,
  };
}

const fromStoredMenuUrl = (url?: string | null): string | undefined => {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith(`${MENU_INTERNAL_PLACEHOLDER_ORIGIN}/`)) {
    return trimmed.slice(MENU_INTERNAL_PLACEHOLDER_ORIGIN.length);
  }
  if (trimmed === MENU_INTERNAL_PLACEHOLDER_ORIGIN) {
    return "/";
  }
  return trimmed;
};

const toBackupMenuItems = (items: ManagedMenuItem[]): SetupBackupMenuItem[] =>
  items.map((item) => ({
    name: item.name,
    url: fromStoredMenuUrl(item.url || undefined),
    children: toBackupMenuItems(item.children || []),
  }));

const serializePageAttributeForBackup = (
  inputType: string | null | undefined,
  values: Array<{
    value?: string | null;
    reference?: string | null;
    richText?: string | null;
    file?: { url?: string | null } | null;
    date?: string | null;
  }>
): Omit<SetupBackupPageAttribute, "slug" | "inputType"> => {
  const references = Array.from(new Set(values.map((entry) => entry.reference || "").filter(Boolean)));
  const first = values[0];
  const firstValue = first?.value || "";
  const firstRichText = first?.richText || "";
  const firstFile = first?.file?.url || "";
  const firstDate = first?.date || "";

  switch (inputType) {
    case "REFERENCE":
      return references.length > 1
        ? { references }
        : references.length === 1
          ? { reference: references[0] }
          : {};
    case "FILE":
      return firstFile ? { file: firstFile } : {};
    case "RICH_TEXT":
      return firstRichText ? { richText: firstRichText } : firstValue ? { richText: firstValue } : {};
    case "DATE":
      return firstDate ? { date: firstDate } : firstValue ? { date: firstValue } : {};
    case "NUMERIC":
      return firstValue ? { numeric: firstValue } : {};
    case "BOOLEAN":
      return { boolean: firstValue === "true" || firstValue === "1" };
    case "DROPDOWN":
      return firstValue ? { dropdownValue: firstValue } : {};
    case "PLAIN_TEXT":
    default:
      return firstValue ? { plainText: firstValue } : {};
  }
};

const toAttributeValueInputFromSnapshot = (
  attributeId: string,
  attribute: SetupBackupPageAttribute
): Record<string, unknown> | null => {
  const base: Record<string, unknown> = { id: attributeId };
  if (attribute.reference) {
    return { ...base, reference: attribute.reference };
  }
  if (attribute.references && attribute.references.length > 0) {
    return { ...base, references: attribute.references };
  }
  if (attribute.file) {
    return { ...base, file: attribute.file };
  }
  if (attribute.richText) {
    return { ...base, richText: attribute.richText };
  }
  if (attribute.date) {
    return { ...base, date: attribute.date };
  }
  if (attribute.numeric) {
    return { ...base, numeric: attribute.numeric };
  }
  if (typeof attribute.boolean === "boolean") {
    return { ...base, boolean: attribute.boolean };
  }
  if (attribute.dropdownValue) {
    return {
      ...base,
      dropdown: {
        value: attribute.dropdownValue,
      },
    };
  }
  if (attribute.plainText) {
    return { ...base, plainText: attribute.plainText };
  }
  return null;
};

export async function createManagedBackupSnapshot(client: Client): Promise<{
  result: SetupOpsResult;
  snapshot: SetupBackupSnapshot;
}> {
  const steps: string[] = [];
  const errors: string[] = [];

  const attributes = await loadManagedAttributes(client, errors);
  const pageTypes = await loadManagedPageTypes(client, errors);
  const pageTypeIds = pageTypes.map((pageType) => pageType.id);
  const pages = await loadManagedPagesByPageTypeIds(client, pageTypeIds, errors);
  const menusResult = await loadManagedMenusBySlugs(
    client,
    CMS_MENU_STRUCTURES.map((menu) => menu.slug),
    errors
  );

  if (menusResult.missingPermission) {
    steps.push("Skipped managed menus backup: missing MANAGE_MENUS permission");
  }

  const attributeReferenceMap = new Map<string, string[]>(
    CMS_ATTRIBUTES.map((attribute) => [attribute.slug, attribute.referencePageTypeSlugs || []])
  );
  const attributeNameMap = new Map<string, string>(CMS_ATTRIBUTES.map((attribute) => [attribute.slug, attribute.name]));

  const snapshot: SetupBackupSnapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    attributes: attributes.map((attribute) => ({
      slug: attribute.slug,
      name: attributeNameMap.get(attribute.slug) || attribute.slug,
      type: attribute.inputType || "PLAIN_TEXT",
      entity: attribute.entityType || null,
      scope: attribute.type === AttributeTypeEnum.ProductType ? "PRODUCT_TYPE" : "PAGE_TYPE",
      referencePageTypeSlugs: attributeReferenceMap.get(attribute.slug) || [],
    })),
    pageTypes: pageTypes.map((pageType) => ({
      slug: pageType.slug,
      name: pageType.name || pageType.slug,
      attributes: (pageType.attributes || []).map((attribute) => attribute.slug || "").filter(Boolean),
    })),
    pages: pages.map((page) => ({
      slug: page.slug,
      title: page.title,
      pageTypeSlug: page.pageType.slug,
      isPublished: Boolean(page.isPublished),
      content: page.content || null,
      attributes: (page.attributes || [])
        .map((entry) => {
          const slug = entry.attribute?.slug || "";
          if (!slug) {
            return null;
          }
          return {
            slug,
            inputType: entry.attribute?.inputType || null,
            ...serializePageAttributeForBackup(entry.attribute?.inputType, entry.values || []),
          } as SetupBackupPageAttribute;
        })
        .filter((entry): entry is SetupBackupPageAttribute => Boolean(entry)),
    })),
    menus: menusResult.menus.map((menu) => ({
      slug: menu.slug,
      name: menu.name || menu.slug,
      items: toBackupMenuItems(menu.items || []),
    })),
  };

  steps.push(`Backed up ${snapshot.attributes.length} managed attribute(s)`);
  steps.push(`Backed up ${snapshot.pageTypes.length} managed page type(s)`);
  steps.push(`Backed up ${snapshot.pages.length} managed page(s)`);
  steps.push(`Backed up ${snapshot.menus.length} managed menu structure(s)`);

  return {
    result: {
      mode: "backup",
      dryRun: false,
      steps,
      errors,
    },
    snapshot,
  };
}

export async function restoreManagedBackupSnapshot(
  client: Client,
  snapshot: SetupBackupSnapshot,
  options: { dryRun?: boolean } = {}
): Promise<SetupOpsResult> {
  const dryRun = Boolean(options.dryRun);
  const steps: string[] = [];
  const errors: string[] = [];

  const existingAttributes = await loadManagedAttributes(client, errors);
  const existingAttributeBySlug = new Map(existingAttributes.map((attribute) => [attribute.slug, attribute]));
  const attrIdsBySlug: Record<string, string> = {};
  for (const existing of existingAttributes) {
    attrIdsBySlug[existing.slug] = existing.id;
  }

  for (const attrDef of snapshot.attributes || []) {
    const existing = existingAttributeBySlug.get(attrDef.slug);
    if (existing) {
      steps.push(`Attribute ${attrDef.slug} already exists (restore skip)`);
      continue;
    }

    if (dryRun) {
      steps.push(`[Plan] Restore attribute ${attrDef.slug}`);
      continue;
    }

    const createRes = await client
      .mutation(AttributeCreateDocument, {
        input: {
          name: attrDef.name,
          slug: attrDef.slug,
          type: resolveAttributeScope(attrDef.scope),
          inputType: INPUT_TYPE_MAP[attrDef.type] || AttributeInputTypeEnum.PlainText,
          entityType: attrDef.entity ? ENTITY_TYPE_MAP[attrDef.entity] : undefined,
          ...getAttributeCreateConfigInput(attrDef),
        },
      })
      .toPromise();

    ensureNoTransportError(createRes.error, errors, `Restore attribute ${attrDef.slug} failed`);
    const gqlErrors = createRes.data?.attributeCreate?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      if (gqlErrors.some((error) => error.code === "UNIQUE")) {
        const refreshed = await loadManagedAttributes(client, errors);
        const found = refreshed.find((attribute) => attribute.slug === attrDef.slug);
        if (found?.id) {
          attrIdsBySlug[attrDef.slug] = found.id;
          steps.push(`Attribute ${attrDef.slug} already exists (linked during restore)`);
        } else {
          errors.push(`Restore attribute ${attrDef.slug}: UNIQUE but ID unresolved.`);
        }
      } else {
        errors.push(`Restore attribute ${attrDef.slug}: ${normalized.join("; ")}`);
      }
      continue;
    }

    const createdId = createRes.data?.attributeCreate?.attribute?.id || "";
    if (!createdId) {
      errors.push(`Restore attribute ${attrDef.slug}: created but ID missing.`);
      continue;
    }
    attrIdsBySlug[attrDef.slug] = createdId;
    steps.push(`Restored attribute ${attrDef.slug}`);
  }

  const refreshedAttributes = dryRun ? existingAttributes : await loadManagedAttributes(client, errors);
  for (const attribute of refreshedAttributes) {
    attrIdsBySlug[attribute.slug] = attribute.id;
  }

  const existingPageTypes = await loadManagedPageTypes(client, errors);
  const pageTypeBySlug = new Map(existingPageTypes.map((pageType) => [pageType.slug, pageType]));

  for (const pageTypeDef of snapshot.pageTypes || []) {
    const desiredAttributeIds = (pageTypeDef.attributes || [])
      .map((slug) => attrIdsBySlug[slug])
      .filter(Boolean)
      .filter((attributeId) => {
        const attrSlug = (pageTypeDef.attributes || []).find((slug) => attrIdsBySlug[slug] === attributeId);
        if (!attrSlug) {
          return false;
        }
        const attrSnapshot = (snapshot.attributes || []).find((attribute) => attribute.slug === attrSlug);
        return attrSnapshot?.scope !== "PRODUCT_TYPE";
      });
    const existing = pageTypeBySlug.get(pageTypeDef.slug);

    if (!existing) {
      if (dryRun) {
        steps.push(`[Plan] Restore page type ${pageTypeDef.slug}`);
        continue;
      }

      const createRes = await client
        .mutation(PageTypeCreateDocument, {
          input: {
            name: pageTypeDef.name,
            slug: pageTypeDef.slug,
            addAttributes: desiredAttributeIds,
          },
        })
        .toPromise();

      ensureNoTransportError(createRes.error, errors, `Restore page type ${pageTypeDef.slug} failed`);
      const gqlErrors = createRes.data?.pageTypeCreate?.errors || [];
      const normalized = normalizeErrors(gqlErrors as any);
      if (normalized.length > 0) {
        if (gqlErrors.some((error) => error.code === "UNIQUE")) {
          steps.push(`Page type ${pageTypeDef.slug} already exists (restore link)`);
        } else {
          errors.push(`Restore page type ${pageTypeDef.slug}: ${normalized.join("; ")}`);
        }
        continue;
      }

      steps.push(`Restored page type ${pageTypeDef.slug}`);
      continue;
    }

    const existingAttrIds = new Set((existing.attributes || []).map((attribute) => attribute.id));
    const missingAttributeIds = desiredAttributeIds.filter((id) => !existingAttrIds.has(id));
    if (missingAttributeIds.length === 0) {
      steps.push(`Page type ${pageTypeDef.slug} already up-to-date (restore skip)`);
      continue;
    }

    if (dryRun) {
      steps.push(`[Plan] Restore missing links for ${pageTypeDef.slug} (${missingAttributeIds.length})`);
      continue;
    }

    const updateRes = await client
      .mutation(PageTypeUpdateDocument, {
        id: existing.id,
        input: { addAttributes: missingAttributeIds },
      })
      .toPromise();

    ensureNoTransportError(updateRes.error, errors, `Restore page type ${pageTypeDef.slug} update failed`);
    const gqlErrors = updateRes.data?.pageTypeUpdate?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      errors.push(`Restore page type ${pageTypeDef.slug}: ${normalized.join("; ")}`);
      continue;
    }
    steps.push(`Restored page type links for ${pageTypeDef.slug} (+${missingAttributeIds.length})`);
  }

  await syncProductTypeAttributeLinks({
    client,
    dryRun,
    steps,
    errors,
    attrIdsBySlug,
  });

  const refreshedPageTypes = dryRun ? existingPageTypes : await loadManagedPageTypes(client, errors);
  const refreshedPageTypeBySlug = new Map(refreshedPageTypes.map((pageType) => [pageType.slug, pageType]));

  for (const attrDef of snapshot.attributes || []) {
    if (!attrDef.referencePageTypeSlugs || attrDef.referencePageTypeSlugs.length === 0) {
      continue;
    }
    const attrId = attrIdsBySlug[attrDef.slug];
    if (!attrId) {
      continue;
    }
    const referenceTypeIds = attrDef.referencePageTypeSlugs
      .map((slug) => refreshedPageTypeBySlug.get(slug)?.id || "")
      .filter(Boolean);
    if (referenceTypeIds.length === 0) {
      continue;
    }

    if (dryRun) {
      steps.push(`[Plan] Sync reference types for ${attrDef.slug}`);
      continue;
    }

    const syncRes = await client
      .mutation(
        `mutation RestoreAttributeReferenceTypes($id: ID!, $input: AttributeUpdateInput!) {
          attributeUpdate(id: $id, input: $input) {
            errors {
              field
              message
              code
            }
          }
        }`,
        { id: attrId, input: { referenceTypes: referenceTypeIds } }
      )
      .toPromise();

    const transportMessage = getOperationErrorMessage(syncRes.error);
    if (transportMessage) {
      if (hasProductTypePermissionError(transportMessage)) {
        steps.push(`Skipped ${attrDef.slug} reference sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Restore reference sync ${attrDef.slug} failed: ${transportMessage}`);
      }
      continue;
    }

    const syncErrors = syncRes.data?.attributeUpdate?.errors || [];
    const normalized = normalizeErrors(syncErrors as any);
    if (normalized.length > 0) {
      const joined = normalized.join("; ");
      if (hasProductTypePermissionError(joined)) {
        steps.push(`Skipped ${attrDef.slug} reference sync: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Restore reference sync ${attrDef.slug}: ${joined}`);
      }
      continue;
    }
    steps.push(`Synced reference types for ${attrDef.slug}`);
  }

  const existingPages = await loadManagedPagesBySlugs(
    client,
    (snapshot.pages || []).map((page) => page.slug),
    errors
  );
  const existingPageBySlug = new Map(existingPages.map((page) => [page.slug, page]));

  for (const pageDef of snapshot.pages || []) {
    const pageTypeId = refreshedPageTypeBySlug.get(pageDef.pageTypeSlug)?.id;
    if (!pageTypeId) {
      errors.push(`Restore page ${pageDef.slug}: page type ${pageDef.pageTypeSlug} not found.`);
      continue;
    }

    const attributes = (pageDef.attributes || [])
      .map((attribute) => {
        const attrId = attrIdsBySlug[attribute.slug];
        if (!attrId) {
          return null;
        }
        return toAttributeValueInputFromSnapshot(attrId, attribute);
      })
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));

    const existingPage = existingPageBySlug.get(pageDef.slug);
    if (!existingPage) {
      if (dryRun) {
        steps.push(`[Plan] Restore page ${pageDef.slug}`);
        continue;
      }

      const createRes = await client
        .mutation(
          `mutation RestorePageCreate($input: PageCreateInput!) {
            pageCreate(input: $input) {
              page {
                id
              }
              errors {
                field
                message
                code
              }
            }
          }`,
          {
            input: {
              title: pageDef.title,
              slug: pageDef.slug,
              pageType: pageTypeId,
              isPublished: pageDef.isPublished,
              content: pageDef.content || null,
              attributes,
            },
          }
        )
        .toPromise();

      ensureNoTransportError(createRes.error, errors, `Restore page ${pageDef.slug} failed`);
      const gqlErrors = createRes.data?.pageCreate?.errors || [];
      const normalized = normalizeErrors(gqlErrors as any);
      if (normalized.length > 0) {
        errors.push(`Restore page ${pageDef.slug}: ${normalized.join("; ")}`);
        continue;
      }
      steps.push(`Restored page ${pageDef.slug}`);
      continue;
    }

    if (dryRun) {
      steps.push(`[Plan] Update page ${pageDef.slug} from backup`);
      continue;
    }

    const updateRes = await client
      .mutation(
        `mutation RestorePageUpdate($id: ID!, $input: PageInput!) {
          pageUpdate(id: $id, input: $input) {
            page {
              id
            }
            errors {
              field
              message
              code
            }
          }
        }`,
        {
          id: existingPage.id,
          input: {
            title: pageDef.title,
            isPublished: pageDef.isPublished,
            content: pageDef.content || null,
            attributes,
          },
        }
      )
      .toPromise();

    ensureNoTransportError(updateRes.error, errors, `Restore page ${pageDef.slug} update failed`);
    const gqlErrors = updateRes.data?.pageUpdate?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      errors.push(`Restore page ${pageDef.slug} update: ${normalized.join("; ")}`);
      continue;
    }
    steps.push(`Updated page ${pageDef.slug} from backup`);
  }

  const existingMenusResult = await loadManagedMenusBySlugs(
    client,
    (snapshot.menus || []).map((menu) => menu.slug),
    errors
  );
  if (existingMenusResult.missingPermission) {
    steps.push("Skipped managed menu restore: missing MANAGE_MENUS permission");
  } else {
    const menuBySlug = new Map(existingMenusResult.menus.map((menu) => [menu.slug, menu]));
    for (const menuDef of snapshot.menus || []) {
      let menuNode = menuBySlug.get(menuDef.slug);
      if (!menuNode) {
        if (dryRun) {
          steps.push(`[Plan] Restore menu ${menuDef.slug}`);
        } else {
          const createMenuRes = await client
            .mutation(
              `mutation RestoreMenuCreate($input: MenuCreateInput!) {
                menuCreate(input: $input) {
                  menu {
                    id
                    slug
                    name
                  }
                  errors {
                    field
                    message
                    code
                  }
                }
              }`,
              { input: { name: menuDef.name, slug: menuDef.slug } }
            )
            .toPromise();

          const transportMessage = getOperationErrorMessage(createMenuRes.error);
          if (transportMessage) {
            if (hasMenuPermissionError(transportMessage)) {
              steps.push(`Skipped menu ${menuDef.slug}: missing MANAGE_MENUS permission`);
              continue;
            }
            errors.push(`Restore menu ${menuDef.slug} failed: ${transportMessage}`);
            continue;
          }
          const gqlErrors = createMenuRes.data?.menuCreate?.errors || [];
          const normalized = normalizeErrors(gqlErrors as any);
          if (normalized.length > 0) {
            errors.push(`Restore menu ${menuDef.slug}: ${normalized.join("; ")}`);
            continue;
          }
          const created = createMenuRes.data?.menuCreate?.menu;
          if (!created?.id) {
            errors.push(`Restore menu ${menuDef.slug}: created but ID missing.`);
            continue;
          }
          menuNode = { id: created.id, slug: created.slug || menuDef.slug, name: created.name || null, items: [] };
          steps.push(`Restored menu ${menuDef.slug}`);
        }
      } else {
        steps.push(`Menu ${menuDef.slug} already exists (restore skip)`);
      }

      if (!menuNode?.id || (menuDef.items || []).length === 0) {
        continue;
      }
      if (dryRun) {
        steps.push(`[Plan] Restore menu items for ${menuDef.slug}`);
        continue;
      }
      const seed = await ensureSeedMenuItems(
        client,
        menuNode.id,
        menuNode.items || [],
        menuDef.items || [],
        errors,
        steps,
        menuDef.slug
      );
      if (seed.permissionMissing) {
        steps.push(`Skipped menu item restore for ${menuDef.slug}: missing MANAGE_MENUS permission`);
      }
    }
  }

  return {
    steps,
    errors,
    mode: "restore",
    dryRun,
  };
}

export async function cleanupManagedData(
  client: Client,
  options: { dryRun?: boolean } = {}
): Promise<SetupOpsResult> {
  const dryRun = Boolean(options.dryRun);
  const steps: string[] = [];
  const errors: string[] = [];

  const pageTypes = await loadManagedPageTypes(client, errors);
  const pageTypeIds = pageTypes.map((pageType) => pageType.id);
  const managedPages = await loadManagedPagesByPageTypeIds(client, pageTypeIds, errors);

  for (const page of managedPages) {
    if (dryRun) {
      steps.push(`[Plan] Delete managed page ${page.slug}`);
      continue;
    }

    const result = await client
      .mutation(
        `mutation CleanupDeletePage($id: ID!) {
          pageDelete(id: $id) {
            errors {
              field
              message
              code
            }
          }
        }`,
        { id: page.id }
      )
      .toPromise();

    ensureNoTransportError(result.error, errors, `Delete managed page ${page.slug} failed`);
    const gqlErrors = result.data?.pageDelete?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      errors.push(`Delete managed page ${page.slug}: ${normalized.join("; ")}`);
      continue;
    }
    steps.push(`Deleted managed page ${page.slug}`);
  }

  const menusResult = await loadManagedMenusBySlugs(
    client,
    CMS_MENU_STRUCTURES.map((menu) => menu.slug),
    errors
  );
  if (menusResult.missingPermission) {
    steps.push("Skipped managed menu cleanup: missing MANAGE_MENUS permission");
  } else {
    for (const menu of menusResult.menus) {
      if (dryRun) {
        steps.push(`[Plan] Delete managed menu ${menu.slug}`);
        continue;
      }
      const result = await client
        .mutation(
          `mutation CleanupDeleteMenu($id: ID!) {
            menuDelete(id: $id) {
              errors {
                field
                message
                code
              }
            }
          }`,
          { id: menu.id }
        )
        .toPromise();

      const transportMessage = getOperationErrorMessage(result.error);
      if (transportMessage) {
        if (hasMenuPermissionError(transportMessage)) {
          steps.push(`Skipped managed menu ${menu.slug} cleanup: missing MANAGE_MENUS permission`);
        } else {
          errors.push(`Delete managed menu ${menu.slug} failed: ${transportMessage}`);
        }
        continue;
      }

      const gqlErrors = result.data?.menuDelete?.errors || [];
      const normalized = normalizeErrors(gqlErrors as any);
      if (normalized.length > 0) {
        const joined = normalized.join("; ");
        if (hasMenuPermissionError(joined)) {
          steps.push(`Skipped managed menu ${menu.slug} cleanup: missing MANAGE_MENUS permission`);
        } else {
          errors.push(`Delete managed menu ${menu.slug}: ${joined}`);
        }
        continue;
      }
      steps.push(`Deleted managed menu ${menu.slug}`);
    }
  }

  const refreshedPageTypes = dryRun ? pageTypes : await loadManagedPageTypes(client, errors);
  for (const pageType of refreshedPageTypes) {
    if (dryRun) {
      steps.push(`[Plan] Delete managed page type ${pageType.slug}`);
      continue;
    }
    const result = await client
      .mutation(
        `mutation CleanupDeletePageType($id: ID!) {
          pageTypeDelete(id: $id) {
            errors {
              field
              message
              code
            }
          }
        }`,
        { id: pageType.id }
      )
      .toPromise();

    const transportMessage = getOperationErrorMessage(result.error);
    if (transportMessage) {
      if (hasProductTypePermissionError(transportMessage)) {
        steps.push(`Skipped page type cleanup for ${pageType.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Delete managed page type ${pageType.slug} failed: ${transportMessage}`);
      }
      continue;
    }

    const gqlErrors = result.data?.pageTypeDelete?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      const joined = normalized.join("; ");
      if (hasProductTypePermissionError(joined)) {
        steps.push(`Skipped page type cleanup for ${pageType.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Delete managed page type ${pageType.slug}: ${joined}`);
      }
      continue;
    }
    steps.push(`Deleted managed page type ${pageType.slug}`);
  }

  const attributes = await loadManagedAttributes(client, errors);
  for (const attribute of attributes) {
    if (dryRun) {
      steps.push(`[Plan] Delete managed attribute ${attribute.slug}`);
      continue;
    }
    const result = await client
      .mutation(
        `mutation CleanupDeleteAttribute($id: ID!) {
          attributeDelete(id: $id) {
            errors {
              field
              message
              code
            }
          }
        }`,
        { id: attribute.id }
      )
      .toPromise();

    const transportMessage = getOperationErrorMessage(result.error);
    if (transportMessage) {
      if (hasProductTypePermissionError(transportMessage)) {
        steps.push(`Skipped attribute cleanup for ${attribute.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Delete managed attribute ${attribute.slug} failed: ${transportMessage}`);
      }
      continue;
    }

    const gqlErrors = result.data?.attributeDelete?.errors || [];
    const normalized = normalizeErrors(gqlErrors as any);
    if (normalized.length > 0) {
      const joined = normalized.join("; ");
      if (hasProductTypePermissionError(joined)) {
        steps.push(`Skipped attribute cleanup for ${attribute.slug}: missing MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES`);
      } else {
        errors.push(`Delete managed attribute ${attribute.slug}: ${joined}`);
      }
      continue;
    }
    steps.push(`Deleted managed attribute ${attribute.slug}`);
  }

  return {
    steps,
    errors,
    mode: "cleanup",
    dryRun,
  };
}
