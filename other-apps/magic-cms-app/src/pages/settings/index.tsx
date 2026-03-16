import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClient } from "urql";

const SETTINGS_PAGE_TYPE_SLUG = "magiccms-storefront-settings";
const SETTINGS_PAGE_SLUG = "magic-settings";

const ATTRIBUTE_SLUGS = {
  headerCode: "magic-settings-header-code",
  bodyCode: "magic-settings-body-code",
  footerCode: "magic-settings-footer-code",
  enquiryEmail: "magic-settings-enquiry-email",
} as const;

type SettingsFormState = {
  headerCode: string;
  bodyCode: string;
  footerCode: string;
  enquiryEmail: string;
  isPublished: boolean;
};

type PageAttributeNode = {
  attribute?: {
    id?: string | null;
    slug?: string | null;
  } | null;
  values?: Array<{
    plainText?: string | null;
    value?: string | null;
    name?: string | null;
    richText?: string | null;
  } | null> | null;
};

type PageTypeNode = {
  id: string;
  slug: string;
  attributes: Array<{
    id: string;
    slug: string;
  }>;
};

const defaultFormState = (): SettingsFormState => ({
  headerCode: "",
  bodyCode: "",
  footerCode: "",
  enquiryEmail: "",
  isPublished: false,
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
  return (value.plainText || value.value || value.name || extractRichTextText(value.richText) || "").trim();
}

export default function SettingsPage() {
  const client = useClient();
  const [loading, setLoading] = useState(true);
  const [savingHeaderCode, setSavingHeaderCode] = useState(false);
  const [savingBodyCode, setSavingBodyCode] = useState(false);
  const [savingFooterCode, setSavingFooterCode] = useState(false);
  const [savingEnquiryEmail, setSavingEnquiryEmail] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pageTypeId, setPageTypeId] = useState("");
  const [pageId, setPageId] = useState<string | null>(null);
  const [attributeIdBySlug, setAttributeIdBySlug] = useState<Record<string, string>>({});
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
                    value
                    name
                    richText
                  }
                }
              }
              attributes(first: 100, filter: { search: "magic-settings" }) {
                edges {
                  node {
                    id
                    slug
                  }
                }
              }
            }
          `,
          {
            pageTypeSlugs: [SETTINGS_PAGE_TYPE_SLUG],
            pageSlug: SETTINGS_PAGE_SLUG,
          },
          { requestPolicy: "network-only" },
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
          "Settings page type not found. Run one-click setup first so magiccms-storefront-settings is created.",
        );
      }

      setPageTypeId(pageTypeNode.id);
      const nextAttributeIdBySlug: Record<string, string> = {};
      for (const attr of pageTypeNode.attributes || []) {
        if (attr?.slug && attr.id) {
          nextAttributeIdBySlug[attr.slug] = attr.id;
        }
      }
      const fallbackSettingsAttributes = (result.data?.attributes?.edges || [])
        .map((edge: { node?: { id?: string; slug?: string } | null }) => edge?.node)
        .filter(
          (node: { id?: string; slug?: string } | null | undefined): node is { id: string; slug: string } =>
            Boolean(node?.id && node?.slug),
        );
      for (const attr of fallbackSettingsAttributes) {
        if (!nextAttributeIdBySlug[attr.slug]) {
          nextAttributeIdBySlug[attr.slug] = attr.id;
        }
      }
      setAttributeIdBySlug(nextAttributeIdBySlug);

      const settingsPage = result.data?.page;
      if (settingsPage?.id) {
        setPageId(settingsPage.id);
      }

      const attrBySlug = new Map<string, PageAttributeNode>();
      (settingsPage?.attributes || []).forEach((attr: PageAttributeNode) => {
        const slug = attr.attribute?.slug || "";
        if (slug) {
          attrBySlug.set(slug, attr);
        }
      });

      setForm({
        headerCode: attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.headerCode)),
        bodyCode: attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.bodyCode)),
        footerCode: attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.footerCode)),
        enquiryEmail: attrFirstText(attrBySlug.get(ATTRIBUTE_SLUGS.enquiryEmail)),
        isPublished: Boolean(settingsPage?.isPublished),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async (
    section: "headerCode" | "bodyCode" | "footerCode" | "enquiryEmail",
  ) => {
    if (!canSave) return;
    setError("");
    setSuccess("");
    const attrSlug = ATTRIBUTE_SLUGS[section];
    const attributeId = attributeIdBySlug[attrSlug];
    if (!attributeId) {
      setError("Required attribute ID not found. Run setup again.");
      return;
    }

    if (section === "headerCode") setSavingHeaderCode(true);
    if (section === "bodyCode") setSavingBodyCode(true);
    if (section === "footerCode") setSavingFooterCode(true);
    if (section === "enquiryEmail") setSavingEnquiryEmail(true);

    try {
      const rawValue = form[section];
      const payload = [
        rawValue.trim()
          ? {
              id: attributeId,
              plainText: rawValue,
            }
          : {
              id: attributeId,
              values: [],
            },
      ];

      if (pageId) {
        const updateResult = await client
          .mutation(
            `
              mutation UpdateSettings($id: ID!, $input: PageInput!) {
                pageUpdate(id: $id, input: $input) {
                  page {
                    id
                  }
                  errors {
                    field
                    message
                  }
                }
              }
            `,
            {
              id: pageId,
              input: {
                attributes: payload,
                isPublished: form.isPublished,
              },
            },
          )
          .toPromise();

        if (updateResult.error?.message) {
          throw new Error(updateResult.error.message);
        }
        const errors = updateResult.data?.pageUpdate?.errors || [];
        if (errors.length > 0) {
          throw new Error(errors[0]?.message || "Failed to save settings");
        }
      } else {
        const createResult = await client
          .mutation(
            `
              mutation CreateSettings($input: PageCreateInput!) {
                pageCreate(input: $input) {
                  page {
                    id
                  }
                  errors {
                    field
                    message
                  }
                }
              }
            `,
            {
              input: {
                title: "Magic Settings",
                slug: SETTINGS_PAGE_SLUG,
                pageType: pageTypeId,
                attributes: payload,
                isPublished: form.isPublished,
              },
            },
          )
          .toPromise();

        if (createResult.error?.message) {
          throw new Error(createResult.error.message);
        }
        const errors = createResult.data?.pageCreate?.errors || [];
        if (errors.length > 0) {
          throw new Error(errors[0]?.message || "Failed to save settings");
        }
        setPageId(createResult.data?.pageCreate?.page?.id || null);
      }

      await loadSettings();
      setSuccess(
        section === "headerCode"
          ? "Header code saved."
          : section === "bodyCode"
            ? "Body code saved."
            : section === "footerCode"
              ? "Footer code saved."
              : "Enquiry email saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSavingHeaderCode(false);
      setSavingBodyCode(false);
      setSavingFooterCode(false);
      setSavingEnquiryEmail(false);
    }
  };

  return (
    <Box padding={6}>
      <Text as="h1" size={6} fontWeight="bold">
        Storefront Settings
      </Text>
      <Text as="p" size={2} color="default2">
        Manage tracking tags and global header/body/footer injections.
      </Text>

      {loading ? (
        <Box paddingY={8} display="flex" alignItems="center" gap={4}>
          <Spinner />
          <Text>Loading settings...</Text>
        </Box>
      ) : (
        <>
          {error && (
            <Box paddingY={4}>
              <Text color="critical1">{error}</Text>
            </Box>
          )}
          {success && (
            <Box paddingY={4}>
              <Text color="success1">{success}</Text>
            </Box>
          )}

          <Box paddingTop={6} display="flex" flexDirection="column" gap={6}>
            <Box display="flex" flexDirection="column" gap={3}>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Text as="h2" size={4} fontWeight="bold">
                  Enquiry Email
                </Text>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => void saveSettings("enquiryEmail")}
                  disabled={!canSave || savingEnquiryEmail}
                >
                  <Save size={14} /> {savingEnquiryEmail ? "Saving..." : "Save Email"}
                </Button>
              </Box>
              <Box display="flex" flexDirection="column" gap={2}>
                <Text as="span" size={2} fontWeight="bold">
                  Form submission recipient
                </Text>
                <Input
                  value={form.enquiryEmail}
                  placeholder="support@example.com"
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, enquiryEmail: event.target.value }))
                  }
                />
              </Box>
            </Box>

            <Box display="flex" flexDirection="column" gap={3}>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Text as="h2" size={4} fontWeight="bold">
                  Header Injection
                </Text>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => void saveSettings("headerCode")}
                  disabled={!canSave || savingHeaderCode}
                >
                  <Save size={14} /> {savingHeaderCode ? "Saving..." : "Save Header"}
                </Button>
              </Box>
              <Box display="flex" flexDirection="column" gap={2}>
                <Text as="span" size={2} fontWeight="bold">
                   Header Injection Code
                </Text>
                <textarea
                  value={form.headerCode}
                  placeholder="Paste trusted scripts/snippets for <head>."
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, headerCode: event.target.value }))
                  }
                  style={{
                    width: "100%",
                    minHeight: 150,
                    border: "1px solid #CBD4E1",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
              </Box>
            </Box>

            <Box display="flex" flexDirection="column" gap={3}>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Text as="h2" size={4} fontWeight="bold">
                  Body Injection
                </Text>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => void saveSettings("bodyCode")}
                  disabled={!canSave || savingBodyCode}
                >
                  <Save size={14} /> {savingBodyCode ? "Saving..." : "Save Body"}
                </Button>
              </Box>
              <Box display="flex" flexDirection="column" gap={2}>
                <Text as="span" size={2} fontWeight="bold">
                   Body Injection Code
                </Text>
                <textarea
                  value={form.bodyCode}
                  placeholder="Paste trusted scripts/snippets after <body>."
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, bodyCode: event.target.value }))
                  }
                  style={{
                    width: "100%",
                    minHeight: 150,
                    border: "1px solid #CBD4E1",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
              </Box>
            </Box>

            <Box display="flex" flexDirection="column" gap={3}>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Text as="h2" size={4} fontWeight="bold">
                  Footer Injection
                </Text>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => void saveSettings("footerCode")}
                  disabled={!canSave || savingFooterCode}
                >
                  <Save size={14} /> {savingFooterCode ? "Saving..." : "Save Footer"}
                </Button>
              </Box>
              <Box display="flex" flexDirection="column" gap={2}>
                <Text as="span" size={2} fontWeight="bold">
                   Footer Injection Code
                </Text>
                <textarea
                  value={form.footerCode}
                  placeholder="Paste trusted scripts/snippets before </body>."
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, footerCode: event.target.value }))
                  }
                  style={{
                    width: "100%",
                    minHeight: 150,
                    border: "1px solid #CBD4E1",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
              </Box>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
