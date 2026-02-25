import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClient } from "urql";

const SETTINGS_PAGE_TYPE_SLUG = "magiccms-storefront-settings";
const SETTINGS_PAGE_SLUG = "magic-settings";

const ATTRIBUTE_SLUGS = {
  headerCode: "magic-settings-header-code",
  footerCode: "magic-settings-footer-code",
  extraFields: "magic-settings-extra-fields",
} as const;

type AppliesTo = "all" | "collection" | "category" | "product";
type TargetMode = "all" | "specific";
type PriceType = "flat" | "percentage";

type TargetOption = {
  slug: string;
  label: string;
  fullLabel?: string;
};

type ExtraFieldDraft = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultSelected: boolean;
  appliesTo: AppliesTo;
  targetMode: TargetMode;
  targets: string[];
  priceType: PriceType;
  priceValue: string;
  variantId: string;
};

type SettingsFormState = {
  headerCode: string;
  footerCode: string;
  isPublished: boolean;
  extraFields: ExtraFieldDraft[];
};

type AttributeNode = {
  id: string;
  slug: string;
};

type PageTypeNode = {
  id: string;
  slug: string;
  attributes: AttributeNode[];
};

type PageAttributeNode = {
  attribute?: {
    id?: string | null;
    slug?: string | null;
  } | null;
  values?: Array<{
    plainText?: string | null;
    name?: string | null;
    richText?: string | null;
  } | null> | null;
};

type SettingsPageNode = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  attributes?: PageAttributeNode[] | null;
};

type TargetLists = {
  collections: TargetOption[];
  categories: TargetOption[];
  products: TargetOption[];
};

const createEmptyExtraField = (): ExtraFieldDraft => ({
  id: `field-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  label: "",
  description: "",
  enabled: true,
  defaultSelected: false,
  appliesTo: "all",
  targetMode: "all",
  targets: [],
  priceType: "flat",
  priceValue: "",
  variantId: "",
});

const defaultFormState = (): SettingsFormState => ({
  headerCode: "",
  footerCode: "",
  isPublished: false,
  extraFields: [],
});

function extractRichTextText(raw?: string | null): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as { blocks?: Array<{ data?: { text?: string } }> };
    const parts = (parsed.blocks || [])
      .map((block) => block?.data?.text || "")
      .map((text) => text.replace(/<[^>]+>/g, " ").trim())
      .filter(Boolean);
    return parts.join("\n").trim();
  } catch {
    return raw.trim();
  }
}

function attrFirstText(attr?: PageAttributeNode): string {
  const value = attr?.values?.[0];
  if (!value) {
    return "";
  }
  return (value.plainText || value.name || extractRichTextText(value.richText) || "").trim();
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function toDraftExtraField(raw: unknown, index: number): ExtraFieldDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const appliesToValue = String(source.appliesTo || "all").toLowerCase();
  const appliesTo: AppliesTo =
    appliesToValue === "collection" || appliesToValue === "product" || appliesToValue === "category"
      ? appliesToValue
      : "all";
  const priceTypeValue = String(source.priceType || "flat").toLowerCase();
  const priceType: PriceType = priceTypeValue === "percentage" ? "percentage" : "flat";
  const collectionSlugs = toStringArray(source.collectionSlugs);
  const categorySlugs = toStringArray(source.categorySlugs);
  const productSlugs = toStringArray(source.productSlugs);
  const targets =
    appliesTo === "collection"
      ? collectionSlugs
      : appliesTo === "category"
        ? categorySlugs
        : appliesTo === "product"
          ? productSlugs
          : [];
  const targetMode: TargetMode = targets.length > 0 ? "specific" : "all";

  return {
    id: String(source.id || `field-${index + 1}`),
    label: String(source.label || ""),
    description: String(source.description || ""),
    enabled: source.enabled !== false,
    defaultSelected: Boolean(source.defaultSelected),
    appliesTo,
    targetMode,
    targets,
    priceType,
    priceValue:
      typeof source.priceValue === "number" || typeof source.priceValue === "string"
        ? String(source.priceValue)
        : "",
    variantId: String(source.variantId || ""),
  };
}

function truncateLabel(value: string, maxLength: number): string {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function serializeExtraFields(fields: ExtraFieldDraft[]) {
  return fields
    .map((field) => {
      const trimmedLabel = field.label.trim();
      if (!trimmedLabel) {
        return null;
      }

      const priceValue = Number.parseFloat(field.priceValue || "");
      const normalizedPriceValue = Number.isFinite(priceValue) && priceValue > 0 ? priceValue : 0;
      const targets = field.targets
        .map((item) => item.trim())
        .filter(Boolean);
      const collectionSlugs =
        field.appliesTo === "collection" && field.targetMode === "specific" ? targets : [];
      const categorySlugs = field.appliesTo === "category" && field.targetMode === "specific" ? targets : [];
      const productSlugs = field.appliesTo === "product" && field.targetMode === "specific" ? targets : [];

      return {
        id: field.id || `field-${trimmedLabel.toLowerCase().replace(/\s+/g, "-")}`,
        label: trimmedLabel,
        description: field.description.trim(),
        enabled: field.enabled,
        defaultSelected: field.defaultSelected,
        appliesTo: field.appliesTo,
        targetMode: field.targetMode,
        collectionSlugs,
        categorySlugs,
        productSlugs,
        priceType: field.priceType,
        priceValue: normalizedPriceValue,
        variantId: field.variantId.trim(),
      };
    })
    .filter(Boolean);
}

export default function SettingsPage() {
  const client = useClient();
  const [loading, setLoading] = useState(true);
  const [savingHeaderCode, setSavingHeaderCode] = useState(false);
  const [savingFooterCode, setSavingFooterCode] = useState(false);
  const [savingExtraFields, setSavingExtraFields] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pageTypeId, setPageTypeId] = useState("");
  const [pageId, setPageId] = useState<string | null>(null);
  const [attributeIdBySlug, setAttributeIdBySlug] = useState<Record<string, string>>({});
  const [targetLists, setTargetLists] = useState<TargetLists>({
    collections: [],
    categories: [],
    products: [],
  });
  const [form, setForm] = useState<SettingsFormState>(defaultFormState);

  const canSave = useMemo(() => {
    return Boolean(pageTypeId) && !loading;
  }, [loading, pageTypeId]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const result: any = await client
        .query(
          `
            query LoadStorefrontSettings($pageTypeSlugs: [String!], $pageSlug: String!) {
              pageTypes(first: 10, filter: { slugs: $pageTypeSlugs }) {
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
              page(slug: $pageSlug) {
                id
                slug
                title
                isPublished
                attributes {
                  attribute {
                    id
                    slug
                  }
                  values {
                    plainText
                    name
                    richText
                  }
                }
              }
              collections(first: 100) {
                edges {
                  node {
                    slug
                    name
                  }
                }
              }
              categories(first: 100) {
                edges {
                  node {
                    slug
                    name
                  }
                }
              }
              products(first: 100) {
                edges {
                  node {
                    slug
                    name
                  }
                }
              }
            }
          `,
          {
            pageTypeSlugs: [SETTINGS_PAGE_TYPE_SLUG],
            pageSlug: SETTINGS_PAGE_SLUG,
          },
          { requestPolicy: "network-only" }
        )
        .toPromise();

      if (result.error?.message) {
        throw new Error(result.error.message);
      }

      const pageTypeNode = (result.data?.pageTypes?.edges || [])
        .map((edge: { node?: PageTypeNode | null }) => edge?.node)
        .find((node: PageTypeNode | undefined) => node?.slug === SETTINGS_PAGE_TYPE_SLUG);

      if (!pageTypeNode?.id) {
        throw new Error(
          "Settings page type not found. Run one-click setup first so magiccms-storefront-settings is created."
        );
      }

      setPageTypeId(pageTypeNode.id);
      const nextAttributeIdBySlug: Record<string, string> = {};
      for (const attr of pageTypeNode.attributes || []) {
        if (attr?.slug && attr.id) {
          nextAttributeIdBySlug[attr.slug] = attr.id;
        }
      }
      setAttributeIdBySlug(nextAttributeIdBySlug);
      setTargetLists({
        collections: (result.data?.collections?.edges || [])
          .map((edge: { node?: { slug?: string; name?: string } | null }) => edge?.node)
          .filter((node: { slug?: string } | null | undefined): node is { slug: string; name?: string } => Boolean(node?.slug))
          .map((node: { slug: string; name?: string }) => ({
            slug: node.slug,
            label: node.name?.trim() ? `${node.name} (${node.slug})` : node.slug,
          })),
        categories: (result.data?.categories?.edges || [])
          .map((edge: { node?: { slug?: string; name?: string } | null }) => edge?.node)
          .filter((node: { slug?: string } | null | undefined): node is { slug: string; name?: string } => Boolean(node?.slug))
          .map((node: { slug: string; name?: string }) => ({
            slug: node.slug,
            label: node.name?.trim() ? `${node.name} (${node.slug})` : node.slug,
          })),
        products: (result.data?.products?.edges || [])
          .map((edge: { node?: { slug?: string; name?: string } | null }) => edge?.node)
          .filter((node: { slug?: string } | null | undefined): node is { slug: string; name?: string } => Boolean(node?.slug))
          .map((node: { slug: string; name?: string }) => ({
            slug: node.slug,
            fullLabel: node.name?.trim() ? `${node.name} (${node.slug})` : node.slug,
            label: node.name?.trim()
              ? truncateLabel(`${node.name} (${node.slug})`, 100)
              : truncateLabel(node.slug, 100),
          })),
      });

      const settingsPage: SettingsPageNode | null = result.data?.page || null;
      setPageId(settingsPage?.id || null);

      const nextForm = defaultFormState();
      if (settingsPage) {
        nextForm.isPublished = Boolean(settingsPage.isPublished);
        const attrBySlug = new Map<string, PageAttributeNode>();
        for (const entry of settingsPage.attributes || []) {
          const slug = entry?.attribute?.slug || "";
          if (slug) {
            attrBySlug.set(slug, entry || {});
          }
        }

        nextForm.headerCode = attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.headerCode));
        nextForm.footerCode = attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.footerCode));
        const extraFieldsRaw = attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.extraFields));
        if (extraFieldsRaw) {
          try {
            const parsed = JSON.parse(extraFieldsRaw) as unknown[];
            nextForm.extraFields = parsed
              .map((item, index) => toDraftExtraField(item, index))
              .filter((item): item is ExtraFieldDraft => Boolean(item));
          } catch {
            nextForm.extraFields = [];
          }
        }
      }

      setForm(nextForm);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const setFormValue = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateExtraField = (id: string, patch: Partial<ExtraFieldDraft>) => {
    setForm((prev) => ({
      ...prev,
      extraFields: prev.extraFields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  };

  const removeExtraField = (id: string) => {
    setForm((prev) => ({
      ...prev,
      extraFields: prev.extraFields.filter((field) => field.id !== id),
    }));
  };

  const saveSettings = async (section: "headerCode" | "footerCode" | "extraFields") => {
    if (section === "headerCode") {
      setSavingHeaderCode(true);
    } else if (section === "footerCode") {
      setSavingFooterCode(true);
    } else {
      setSavingExtraFields(true);
    }
    setError("");
    setSuccess("");

    try {
      const sectionAttributes =
        section === "headerCode"
          ? [{ slug: ATTRIBUTE_SLUGS.headerCode, value: form.headerCode }]
          : section === "footerCode"
            ? [{ slug: ATTRIBUTE_SLUGS.footerCode, value: form.footerCode }]
            : [{ slug: ATTRIBUTE_SLUGS.extraFields, value: JSON.stringify(serializeExtraFields(form.extraFields)) }];

      const attributes = sectionAttributes
        .map((entry) => ({
          id: attributeIdBySlug[entry.slug],
          values: [entry.value],
        }))
        .filter((entry) => Boolean(entry.id));

      if (attributes.length === 0) {
        throw new Error("Settings attributes not resolved. Run setup and reload.");
      }

      if (!pageId) {
        const createRes: any = await client
          .mutation(
            `
              mutation CreateStorefrontSettingsPage($input: PageCreateInput!) {
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
              }
            `,
            {
              input: {
                title: "Magic Storefront Settings",
                slug: SETTINGS_PAGE_SLUG,
                isPublished: form.isPublished,
                pageType: pageTypeId,
                attributes,
              },
            }
          )
          .toPromise();

        if (createRes.error?.message) {
          throw new Error(createRes.error.message);
        }

        const gqlErrors = createRes.data?.pageCreate?.errors || [];
        if (gqlErrors.length > 0) {
          throw new Error(gqlErrors.map((item: { message?: string }) => item.message).filter(Boolean).join("; "));
        }

        const createdId = createRes.data?.pageCreate?.page?.id;
        if (!createdId) {
          throw new Error("Settings page created but ID missing.");
        }
        setPageId(createdId);
      } else {
        const updateRes: any = await client
          .mutation(
            `
              mutation UpdateStorefrontSettingsPage($id: ID!, $input: PageUpdateInput!) {
                pageUpdate(id: $id, input: $input) {
                  page {
                    id
                    slug
                    isPublished
                  }
                  errors {
                    field
                    message
                    code
                  }
                }
              }
            `,
            {
              id: pageId,
              input: {
                title: "Magic Storefront Settings",
                slug: SETTINGS_PAGE_SLUG,
                isPublished: form.isPublished,
                attributes,
              },
            }
          )
          .toPromise();

        if (updateRes.error?.message) {
          throw new Error(updateRes.error.message);
        }

        const gqlErrors = updateRes.data?.pageUpdate?.errors || [];
        if (gqlErrors.length > 0) {
          throw new Error(gqlErrors.map((item: { message?: string }) => item.message).filter(Boolean).join("; "));
        }
      }

      setSuccess(
        section === "headerCode"
          ? "Header code saved."
          : section === "footerCode"
            ? "Footer code saved."
            : "Magic Extra Fields saved."
      );
      await loadSettings();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      if (section === "headerCode") {
        setSavingHeaderCode(false);
      } else if (section === "footerCode") {
        setSavingFooterCode(false);
      } else {
        setSavingExtraFields(false);
      }
    }
  };

  const targetOptionsForScope = useCallback(
    (scope: AppliesTo): TargetOption[] => {
      if (scope === "collection") {
        return targetLists.collections;
      }
      if (scope === "category") {
        return targetLists.categories;
      }
      if (scope === "product") {
        return targetLists.products;
      }
      return [];
    },
    [targetLists.categories, targetLists.collections, targetLists.products],
  );

  return (
    <Box padding={8} display="flex" flexDirection="column" gap={6}>
      <Box>
        <Text as="h1" size={7} fontWeight="bold">
          Storefront Settings
        </Text>
        <Text as="p" size={3} color="default2" marginTop={2}>
          Manage tracking tags, global header/footer injections, and variant-backed product extra fields.
        </Text>
      </Box>

      {loading ? (
        <Box paddingY={8} display="flex" alignItems="center" gap={3}>
          <Spinner />
          <Text color="default2">Loading settings...</Text>
        </Box>
      ) : (
        <>
          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={6}
            padding={4}
            display="grid"
            style={{ gridTemplateColumns: "1fr", gap: 16 }}
          >
            <Box
              display="flex"
              alignItems="flex-start"
              justifyContent="space-between"
              style={{ gap: 12, flexWrap: "wrap" }}
            >
              <Box>
                <Text as="h2" size={4} fontWeight="bold">Header/Footer Injection</Text>
                <Text as="p" size={2} color="default2">
                  Save global script snippets independently from extra fields.
                </Text>
              </Box>
              <Box display="flex" gap={2} style={{ marginLeft: "auto", flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  disabled={!canSave || savingHeaderCode}
                  onClick={() => void saveSettings("headerCode")}
                >
                  <Save size={14} /> {savingHeaderCode ? "Saving..." : "Save Header"}
                </Button>
                <Button
                  variant="primary"
                  disabled={!canSave || savingFooterCode}
                  onClick={() => void saveSettings("footerCode")}
                >
                  <Save size={14} /> {savingFooterCode ? "Saving..." : "Save Footer"}
                </Button>
              </Box>
            </Box>
            <Box display="flex" flexDirection="column" gap={2}>
              <Text size={2} fontWeight="bold">Header Injection Code</Text>
              <textarea
                value={form.headerCode}
                onChange={(event) => setFormValue("headerCode", event.target.value)}
                placeholder="Paste trusted scripts/snippets for <head>."
                style={{
                  minHeight: 120,
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #d5d7da",
                  borderRadius: 8,
                  padding: 10,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                }}
              />
            </Box>
            <Box display="flex" flexDirection="column" gap={2}>
              <Text size={2} fontWeight="bold">Footer Injection Code</Text>
              <textarea
                value={form.footerCode}
                onChange={(event) => setFormValue("footerCode", event.target.value)}
                placeholder="Paste trusted scripts/snippets before </body>."
                style={{
                  minHeight: 120,
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #d5d7da",
                  borderRadius: 8,
                  padding: 10,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                }}
              />
            </Box>
          </Box>

          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={6}
            padding={4}
            display="flex"
            flexDirection="column"
            gap={4}
          >
            <Box
              display="flex"
              alignItems="flex-start"
              justifyContent="space-between"
              style={{ gap: 12, flexWrap: "wrap" }}
            >
              <Box>
                <Text as="h2" size={4} fontWeight="bold">Magic Extra Fields</Text>
                <Text as="p" size={2} color="default2">
                  Use variant-backed fields for payable charges. Flat/percentage config drives UI pricing.
                </Text>
              </Box>
              <Box display="flex" gap={2} style={{ marginLeft: "auto", flexWrap: "wrap" }}>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, extraFields: [...prev.extraFields, createEmptyExtraField()] }))
                  }
                >
                  <Plus size={14} /> Add field
                </Button>
                <Button
                  variant="primary"
                  disabled={!canSave || savingExtraFields}
                  onClick={() => void saveSettings("extraFields")}
                >
                  <Save size={14} /> {savingExtraFields ? "Saving..." : "Save Extra Fields"}
                </Button>
              </Box>
            </Box>

            {form.extraFields.length === 0 ? (
              <Text size={2} color="default2">
                No extra fields configured yet.
              </Text>
            ) : (
              form.extraFields.map((field) => (
                <Box
                  key={field.id}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  padding={4}
                  display="grid"
                  style={{ gap: 12 }}
                >
                  <Box display="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">Label</Text>
                      <Input
                        value={field.label}
                        onChange={(event) => updateExtraField(field.id, { label: event.target.value })}
                        placeholder="Installation Fee"
                      />
                    </Box>
                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">Variant ID (required for payable)</Text>
                      <Input
                        value={field.variantId}
                        onChange={(event) => updateExtraField(field.id, { variantId: event.target.value })}
                        placeholder="UHJvZHVjdFZhcmlhbnQ6..."
                      />
                    </Box>
                  </Box>

                  <Box display="flex" flexDirection="column" gap={2}>
                    <Text size={2} fontWeight="bold">Description</Text>
                    <Input
                      value={field.description}
                      onChange={(event) => updateExtraField(field.id, { description: event.target.value })}
                      placeholder="Shown below the field label on storefront."
                    />
                  </Box>

                  <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">Apply scope</Text>
                      <select
                        value={field.appliesTo}
                        onChange={(event) =>
                          updateExtraField(field.id, { appliesTo: event.target.value as AppliesTo, targets: [] })
                        }
                        style={{ border: "1px solid #d5d7da", borderRadius: 8, padding: "9px 10px" }}
                      >
                        <option value="all">All products</option>
                        <option value="collection">Collection</option>
                        <option value="category">Category</option>
                        <option value="product">Product</option>
                      </select>
                    </Box>

                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">Target mode</Text>
                      <select
                        value={field.targetMode}
                        onChange={(event) =>
                          updateExtraField(field.id, {
                            targetMode: event.target.value as TargetMode,
                            targets: event.target.value === "all" ? [] : field.targets,
                          })
                        }
                        style={{ border: "1px solid #d5d7da", borderRadius: 8, padding: "9px 10px" }}
                      >
                        <option value="all">All in scope</option>
                        <option value="specific">Specific targets</option>
                      </select>
                    </Box>

                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">Price mode</Text>
                      <select
                        value={field.priceType}
                        onChange={(event) => updateExtraField(field.id, { priceType: event.target.value as PriceType })}
                        style={{ border: "1px solid #d5d7da", borderRadius: 8, padding: "9px 10px" }}
                      >
                        <option value="flat">Flat price</option>
                        <option value="percentage">Percentage</option>
                      </select>
                    </Box>

                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">{field.priceType === "percentage" ? "Percent" : "Amount"}</Text>
                      <Input
                        type="number"
                        min={0}
                        step={field.priceType === "percentage" ? "0.1" : "1"}
                        value={field.priceValue}
                        onChange={(event) => updateExtraField(field.id, { priceValue: event.target.value })}
                        placeholder={field.priceType === "percentage" ? "5" : "499"}
                      />
                    </Box>
                  </Box>

                  {field.appliesTo !== "all" && field.targetMode === "specific" ? (
                    <Box display="flex" flexDirection="column" gap={2}>
                      <Text size={2} fontWeight="bold">
                        {field.appliesTo === "collection"
                          ? "Select Collections"
                          : field.appliesTo === "category"
                            ? "Select Categories"
                            : "Select Products"}
                      </Text>
                      <select
                        multiple
                        value={field.targets}
                        onChange={(event) => {
                          const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                          updateExtraField(field.id, { targets: values });
                        }}
                        style={{
                          border: "1px solid #d5d7da",
                          borderRadius: 8,
                          padding: "9px 10px",
                          minHeight: 110,
                        }}
                      >
                        {targetOptionsForScope(field.appliesTo).map((option) => (
                          <option
                            key={`${field.id}-${option.slug}`}
                            value={option.slug}
                            title={option.fullLabel || option.label}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Text size={1} color="default2">
                        Hold Ctrl/Cmd to select multiple items.
                      </Text>
                    </Box>
                  ) : null}

                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center" gap={4}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={(event) => updateExtraField(field.id, { enabled: event.target.checked })}
                        />
                        <Text size={2}>Enabled</Text>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={field.defaultSelected}
                          onChange={(event) => updateExtraField(field.id, { defaultSelected: event.target.checked })}
                        />
                        <Text size={2}>Selected by default</Text>
                      </label>
                    </Box>
                    <Button variant="tertiary" onClick={() => removeExtraField(field.id)}>
                      <Trash2 size={14} /> Remove
                    </Button>
                  </Box>
                </Box>
              ))
            )}
          </Box>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setFormValue("isPublished", event.target.checked)}
            />
            <Text size={2}>Publish settings page</Text>
          </label>

          {error ? (
            <Box padding={3} borderRadius={4} style={{ background: "#FCEAEA" }}>
              <Text size={2} color="critical1">{error}</Text>
            </Box>
          ) : null}
          {success ? (
            <Box padding={3} borderRadius={4} style={{ background: "#E9F9EE" }}>
              <Text size={2} color="success1">{success}</Text>
            </Box>
          ) : null}

          <Box display="flex" justifyContent="flex-end" gap={3}>
            <Button
              variant="tertiary"
              disabled={loading || savingHeaderCode || savingFooterCode || savingExtraFields}
              onClick={() => void loadSettings()}
            >
              Reload
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
