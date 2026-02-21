import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { Check, Copy } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useClient } from "urql";
import {
  AttributeInputTypeEnum,
  type GetWidgetQuery,
  useDeleteWidgetMutation,
  useGetWidgetQuery,
  useUpdateWidgetMutation,
} from "../../../generated/graphql";
import { syncMagicRefWidgetOnModulePages } from "@/lib/module-widget-reference-sync";
import { buildAttributeUpdateInput, readAttributeValue } from "@/lib/page-attribute-utils";
import { isRepeaterDataAttributeSlug } from "@/lib/widget-models";

type WidgetAttributeNode = NonNullable<NonNullable<GetWidgetQuery["page"]>["attributes"]>[number];
type RepeaterRow = Record<string, string>;

const slugToVariableName = (slug: string) =>
  slug
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`
    )
    .join("") || "value";

const normalizeRepeaterCell = (value: unknown, inputType?: AttributeInputTypeEnum | null): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (inputType === AttributeInputTypeEnum.Boolean && typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
};

const parseRepeaterRows = (raw: string, schemaAttributes: WidgetAttributeNode[]) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { rows: [] as RepeaterRow[], error: "" };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const candidateRows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown[] }).items)
        ? (parsed as { items: unknown[] }).items
        : null;

    if (!candidateRows) {
      return {
        rows: [] as RepeaterRow[],
        error: "Existing repeater value is not array JSON. Add rows and save to normalize it.",
      };
    }

    const rows = candidateRows
      .map((entry) => {
        const row: RepeaterRow = {};
        for (const attribute of schemaAttributes) {
          const slug = attribute.attribute.slug || "";
          if (!slug) {
            continue;
          }
          const sourceValue =
            entry && typeof entry === "object" ? (entry as Record<string, unknown>)[slug] : undefined;
          row[slug] = normalizeRepeaterCell(sourceValue, attribute.attribute.inputType);
        }
        return row;
      })
      .filter((row) => Object.values(row).some((value) => value.trim() !== ""));

    return { rows, error: "" };
  } catch {
    return {
      rows: [] as RepeaterRow[],
      error: "Existing repeater value is invalid JSON. Add rows and save to rewrite valid JSON.",
    };
  }
};

const serializeRepeaterRows = (rows: RepeaterRow[], schemaAttributes: WidgetAttributeNode[]) => {
  const output = rows
    .map((row) => {
      const serialized: Record<string, unknown> = {};
      for (const attribute of schemaAttributes) {
        const slug = attribute.attribute.slug || "";
        if (!slug) {
          continue;
        }
        const rawValue = (row[slug] || "").trim();
        const inputType = attribute.attribute.inputType;

        if (!rawValue && inputType !== AttributeInputTypeEnum.Boolean) {
          continue;
        }

        if (inputType === AttributeInputTypeEnum.Boolean) {
          if (rawValue === "true" || rawValue === "false") {
            serialized[slug] = rawValue === "true";
          }
          continue;
        }

        if (inputType === AttributeInputTypeEnum.Numeric) {
          const numericValue = Number(rawValue);
          serialized[slug] = Number.isFinite(numericValue) ? numericValue : rawValue;
          continue;
        }

        if (inputType === AttributeInputTypeEnum.Reference) {
          const ids = rawValue
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          if (ids.length === 1) {
            serialized[slug] = ids[0];
          } else if (ids.length > 1) {
            serialized[slug] = ids;
          }
          continue;
        }

        serialized[slug] = rawValue;
      }
      return serialized;
    })
    .filter((row) => Object.keys(row).length > 0);

  return JSON.stringify(output, null, 2);
};

const buildWidgetUsageSnippet = ({
  widgetSlug,
  modelSlug,
  singleFieldSlugs,
  repeaterDataSlug,
  repeaterFieldSlugs,
}: {
  widgetSlug: string;
  modelSlug: string;
  singleFieldSlugs: string[];
  repeaterDataSlug?: string;
  repeaterFieldSlugs: string[];
}) => {
  const singleLines =
    singleFieldSlugs.length > 0
      ? singleFieldSlugs
          .map((slug) => `const ${slugToVariableName(slug)} = attrs["${slug}"];`)
          .join("\n")
      : "// No single-field attributes in this widget model.";

  const repeaterType =
    repeaterFieldSlugs.length > 0
      ? repeaterFieldSlugs
          .map((slug) => `  ${slugToVariableName(slug)}?: unknown; // ${slug}`)
          .join("\n")
      : "  [key: string]: unknown;";

  const repeaterLines = repeaterDataSlug
    ? [
        `const rows = safeJsonParse<RepeaterRow[]>(attrs["${repeaterDataSlug}"], []);`,
        "",
        "type RepeaterRow = {",
        repeaterType,
        "};",
      ].join("\n")
    : "// Not a repeater widget model.";

  return `// Magic CMS widget usage
// Widget slug: ${widgetSlug}
// Model slug: ${modelSlug}

const page = await fetchPageBySlug("${widgetSlug}");

const attrs = Object.fromEntries(
  (page?.attributes || []).map((entry) => {
    const slug = entry.attribute.slug || "";
    const value = entry.values?.[0];
    const resolved =
      value?.value ??
      value?.richText ??
      value?.reference ??
      value?.file?.url ??
      "";
    return [slug, resolved];
  })
);

${singleLines}

${repeaterLines}

function safeJsonParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}`;
};

export default function EditWidgetPage() {
  const router = useRouter();
  const client = useClient();
  const widgetId = typeof router.query.id === "string" ? router.query.id : "";

  const [{ data, fetching, error }, reexecuteWidget] = useGetWidgetQuery({
    variables: { id: widgetId },
    pause: !widgetId,
    requestPolicy: "network-only",
  });
  const [, updateWidget] = useUpdateWidgetMutation();
  const [, deleteWidget] = useDeleteWidgetMutation();

  const [title, setTitle] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [repeaterRows, setRepeaterRows] = useState<RepeaterRow[]>([]);
  const [repeaterParseError, setRepeaterParseError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedUsage, setCopiedUsage] = useState(false);

  useEffect(() => {
    const syncWarning = typeof router.query.syncWarning === "string" ? router.query.syncWarning : "";
    if (!widgetId || !syncWarning) {
      return;
    }
    setErrorMessage(syncWarning);
    router.replace(`/widgets/${widgetId}`, undefined, { shallow: true });
  }, [router, widgetId]);

  const sortedAttributes = useMemo(() => {
    if (!data?.page?.attributes) {
      return [];
    }
    return [...data.page.attributes].sort((a, b) => (a.attribute.name || "").localeCompare(b.attribute.name || ""));
  }, [data?.page?.attributes]);

  const repeaterDataAttribute = useMemo(
    () =>
      sortedAttributes.find((attribute) => isRepeaterDataAttributeSlug(attribute.attribute.slug || "")) ||
      null,
    [sortedAttributes]
  );
  const repeaterDataSlug = repeaterDataAttribute?.attribute.slug || "";
  const isRepeaterWidget = Boolean(repeaterDataAttribute);

  const repeaterSchemaAttributes = useMemo(
    () =>
      sortedAttributes.filter(
        (attribute) => (attribute.attribute.slug || "") && !isRepeaterDataAttributeSlug(attribute.attribute.slug || "")
      ),
    [sortedAttributes]
  );

  const singleWidgetAttributes = useMemo(
    () =>
      sortedAttributes.filter((attribute) => !isRepeaterDataAttributeSlug(attribute.attribute.slug || "")),
    [sortedAttributes]
  );

  const repeaterJsonPreview = useMemo(
    () => serializeRepeaterRows(repeaterRows, repeaterSchemaAttributes),
    [repeaterRows, repeaterSchemaAttributes]
  );

  const usageSnippet = useMemo(() => {
    if (!data?.page) {
      return "";
    }

    const singleFieldSlugs = isRepeaterWidget
      ? []
      : singleWidgetAttributes.map((attribute) => attribute.attribute.slug || "").filter(Boolean);
    const repeaterFieldSlugs = repeaterSchemaAttributes
      .map((attribute) => attribute.attribute.slug || "")
      .filter(Boolean);

    return buildWidgetUsageSnippet({
      widgetSlug: data.page.slug,
      modelSlug: data.page.pageType.slug,
      singleFieldSlugs,
      repeaterDataSlug: isRepeaterWidget ? repeaterDataSlug : undefined,
      repeaterFieldSlugs,
    });
  }, [data?.page, isRepeaterWidget, repeaterDataSlug, repeaterSchemaAttributes, singleWidgetAttributes]);

  useEffect(() => {
    if (!data?.page) {
      return;
    }
    setTitle(data.page.title);
    const nextForm: Record<string, string> = {};
    for (const attribute of data.page.attributes) {
      const slug = attribute.attribute.slug || "";
      if (!slug) {
        continue;
      }
      nextForm[slug] = readAttributeValue(attribute);
    }
    setFormData(nextForm);

    const schemaAttributes = data.page.attributes.filter(
      (attribute) => (attribute.attribute.slug || "") && !isRepeaterDataAttributeSlug(attribute.attribute.slug || "")
    );
    const repeaterAttribute = data.page.attributes.find((attribute) =>
      isRepeaterDataAttributeSlug(attribute.attribute.slug || "")
    );

    if (!repeaterAttribute?.attribute.slug) {
      setRepeaterRows([]);
      setRepeaterParseError("");
      return;
    }

    const parsedRows = parseRepeaterRows(nextForm[repeaterAttribute.attribute.slug] || "", schemaAttributes);
    setRepeaterRows(parsedRows.rows);
    setRepeaterParseError(parsedRows.error);
  }, [data?.page]);

  const addRepeaterRow = () => {
    const nextRow: RepeaterRow = {};
    for (const attribute of repeaterSchemaAttributes) {
      const slug = attribute.attribute.slug || "";
      if (!slug) {
        continue;
      }
      nextRow[slug] = "";
    }
    setRepeaterRows((prev) => [...prev, nextRow]);
    setRepeaterParseError("");
  };

  const removeRepeaterRow = (rowIndex: number) => {
    setRepeaterRows((prev) => prev.filter((_, index) => index !== rowIndex));
  };

  const updateRepeaterCell = (rowIndex: number, slug: string, value: string) => {
    setRepeaterRows((prev) =>
      prev.map((row, index) => (index === rowIndex ? { ...row, [slug]: value } : row))
    );
  };

  const copyUsageSnippet = async () => {
    if (!usageSnippet) {
      return;
    }
    try {
      await navigator.clipboard.writeText(usageSnippet);
      setCopiedUsage(true);
      window.setTimeout(() => setCopiedUsage(false), 1800);
    } catch {
      setErrorMessage("Unable to copy usage snippet. Clipboard permission blocked.");
    }
  };

  const handleSave = async () => {
    if (!data?.page) {
      return;
    }

    setIsSaving(true);
    setNotice("");
    setErrorMessage("");
    try {
      const repeaterPayload = isRepeaterWidget
        ? serializeRepeaterRows(repeaterRows, repeaterSchemaAttributes)
        : "";

      const attributes = data.page.attributes.map((attribute) => {
        const slug = attribute.attribute.slug || "";
        if (isRepeaterWidget) {
          if (slug === repeaterDataSlug) {
            return buildAttributeUpdateInput(attribute, repeaterPayload);
          }
          return { id: attribute.attribute.id, values: [] };
        }
        const value = formData[slug] || "";
        return buildAttributeUpdateInput(attribute, value);
      });

      const result = await updateWidget({
        id: data.page.id,
        input: {
          title: title.trim() || data.page.title,
          attributes,
        },
      });

      const gqlErrors = result.data?.pageUpdate?.errors || [];
      if (result.error || gqlErrors.length > 0) {
        setErrorMessage(
          result.error?.message || gqlErrors.map((entry) => entry.message).filter(Boolean).join(", ") || "Save failed."
        );
        return;
      }

      setNotice(
        isRepeaterWidget
          ? `Widget saved. ${repeaterRows.length} repeater row(s) written to ${repeaterDataSlug}.`
          : "Widget saved."
      );
      setDeleteConfirming(false);
      await reexecuteWidget({ requestPolicy: "network-only" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!data?.page) {
      return;
    }
    if (!deleteConfirming) {
      setDeleteConfirming(true);
      setNotice('Press "Confirm Delete" to permanently remove this widget.');
      setErrorMessage("");
      return;
    }

    setIsDeleting(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await deleteWidget({ id: data.page.id });
      const gqlErrors = result.data?.pageDelete?.errors || [];
      if (result.error || gqlErrors.length > 0) {
        setErrorMessage(
          result.error?.message || gqlErrors.map((entry) => entry.message).filter(Boolean).join(", ") || "Delete failed."
        );
        setDeleteConfirming(false);
        return;
      }

      const syncResult = await syncMagicRefWidgetOnModulePages(client, data.page.id, "remove");
      const syncWarning =
        syncResult.errors[0] ||
        (syncResult.errors.length > 0
          ? "Widget deleted, but magic-ref-widget cleanup failed for one or more module pages."
          : "");
      const target = syncWarning
        ? `/widgets?tab=widgets&syncWarning=${encodeURIComponent(syncWarning)}`
        : "/widgets?tab=widgets";
      router.push(target);
    } finally {
      setIsDeleting(false);
    }
  };

  if (fetching) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (error || !data?.page) {
    return (
      <Box padding={8}>
        <Text color="critical1">{error?.message || "Widget not found."}</Text>
      </Box>
    );
  }

  return (
    <Box padding={8}>
      <Box
        marginBottom={5}
        display="grid"
        __gridTemplateColumns="minmax(320px, 1fr) auto"
        gap={3}
        alignItems="center"
        style={{ borderBottom: "1px solid #E5EAF2", paddingBottom: 16 }}
      >
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            {data.page.title}
          </Text>
          <Text as="p" size={2} color="default2" marginTop={1}>
            Model: {data.page.pageType.name} ({data.page.pageType.slug})
          </Text>
        </Box>
        <Box display="flex" gap={2} justifyContent="flex-end" flexWrap="wrap">
          <Button
            variant={deleteConfirming ? "secondary" : "tertiary"}
            onClick={handleDelete}
            disabled={isDeleting || isSaving}
            style={{ color: "#D61F1F" }}
          >
            {deleteConfirming ? "Confirm Delete" : "Delete"}
          </Button>
          {deleteConfirming ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteConfirming(false);
                setNotice("");
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => router.push("/widgets")} disabled={isSaving || isDeleting}>
            Back
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving || isDeleting}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </Box>
      </Box>

      {notice ? (
        <Box marginBottom={3}>
          <Text color="default2">{notice}</Text>
        </Box>
      ) : null}
      {errorMessage ? (
        <Box marginBottom={3}>
          <Text color="critical1">{errorMessage}</Text>
        </Box>
      ) : null}

      <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} marginBottom={4}>
        <Text as="span" size={2} fontWeight="bold">
          Widget title
        </Text>
        <Box marginTop={2}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Widget title" />
        </Box>
      </Box>

      {isRepeaterWidget ? (
        <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            marginBottom={2}
            style={{ gap: 10, flexWrap: "wrap" }}
          >
            <Text as="h3" size={5} fontWeight="bold">
              Repeater items
            </Text>
            <Button variant="secondary" onClick={addRepeaterRow}>
              Add row
            </Button>
          </Box>
          <Text as="p" size={2} color="default2" marginBottom={3}>
            CRUD rows below. On save, all rows are converted to JSON and stored in `{repeaterDataSlug}`.
          </Text>

          {repeaterParseError ? (
            <Box marginBottom={3}>
              <Text color="critical1" size={2}>
                {repeaterParseError}
              </Text>
            </Box>
          ) : null}

          {repeaterRows.length === 0 ? (
            <Box
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={4}
              marginBottom={3}
              textAlign="center"
            >
              <Text size={2} color="default2">
                No rows added yet.
              </Text>
            </Box>
          ) : (
            <Box display="grid" gap={3} marginBottom={4}>
              {repeaterRows.map((row, rowIndex) => (
                <Box
                  key={`row-${rowIndex}`}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  padding={3}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={3}>
                    <Text as="span" size={2} fontWeight="bold">
                      Row {rowIndex + 1}
                    </Text>
                    <Button variant="tertiary" size="small" onClick={() => removeRepeaterRow(rowIndex)}>
                      Remove row
                    </Button>
                  </Box>

                  <Box display="grid" gap={3} __gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))">
                    {repeaterSchemaAttributes.map((attribute) => {
                      const slug = attribute.attribute.slug || "";
                      const inputType = attribute.attribute.inputType;
                      const cellValue = row[slug] || "";

                      return (
                        <Box key={`${slug}-${rowIndex}`}>
                          <Text as="span" size={1} color="default2">
                            {attribute.attribute.name}
                          </Text>
                          <Box marginTop={1}>
                            {inputType === AttributeInputTypeEnum.Boolean ? (
                              <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40 }}>
                                <input
                                  type="checkbox"
                                  checked={cellValue === "true"}
                                  onChange={(event) => updateRepeaterCell(rowIndex, slug, event.target.checked ? "true" : "false")}
                                />
                                <Text size={2}>Enabled</Text>
                              </label>
                            ) : inputType === AttributeInputTypeEnum.RichText ? (
                              <textarea
                                value={cellValue}
                                onChange={(event) => updateRepeaterCell(rowIndex, slug, event.target.value)}
                                placeholder="Rich text content"
                                style={{
                                  width: "100%",
                                  minHeight: 100,
                                  border: "1px solid #CBD4E1",
                                  borderRadius: 8,
                                  padding: 10,
                                  fontSize: 14,
                                  fontFamily: "inherit",
                                }}
                              />
                            ) : (
                              <Input
                                value={cellValue}
                                onChange={(event) => updateRepeaterCell(rowIndex, slug, event.target.value)}
                                placeholder={
                                  inputType === AttributeInputTypeEnum.Reference
                                    ? "Global ID(s), comma separated"
                                    : inputType === AttributeInputTypeEnum.File
                                      ? "File URL"
                                      : undefined
                                }
                              />
                            )}
                          </Box>
                          <Text as="p" size={1} color="default2" marginTop={1}>
                            {slug}
                          </Text>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          <Box
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            borderRadius={4}
            padding={3}
            style={{ background: "#F8FAFC", overflowX: "auto" }}
          >
            <Text as="p" size={2} fontWeight="bold" marginBottom={2}>
              Stored JSON preview
            </Text>
            <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              <code>{repeaterJsonPreview}</code>
            </pre>
          </Box>
        </Box>
      ) : (
        <Box display="grid" gap={4}>
          {singleWidgetAttributes.map((attribute) => {
            const slug = attribute.attribute.slug || "";
            const inputType = attribute.attribute.inputType;
            const value = formData[slug] || "";

            return (
              <Box
                key={attribute.attribute.id}
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                padding={4}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={2}>
                  <Text as="span" size={3} fontWeight="bold">
                    {attribute.attribute.name}
                  </Text>
                  <Text as="span" size={1} color="default2" textTransform="uppercase">
                    {inputType || "N/A"}
                  </Text>
                </Box>

                {inputType === AttributeInputTypeEnum.Boolean ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={value === "true" || value === "1" || value.toLowerCase() === "yes"}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          [slug]: event.target.checked ? "true" : "false",
                        }))
                      }
                    />
                    <Text size={2}>Enabled</Text>
                  </label>
                ) : inputType === AttributeInputTypeEnum.RichText ? (
                  <textarea
                    value={value}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        [slug]: event.target.value,
                      }))
                    }
                    placeholder="Rich text content"
                    style={{
                      width: "100%",
                      minHeight: 160,
                      border: "1px solid #CBD4E1",
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 14,
                      fontFamily: "inherit",
                    }}
                  />
                ) : (
                  <Input
                    value={value}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        [slug]: event.target.value,
                      }))
                    }
                  />
                )}

                <Text as="p" size={1} color="default2" marginTop={2}>
                  Slug: {slug}
                </Text>
                {inputType === AttributeInputTypeEnum.Reference ? (
                  <Text as="p" size={1} color="default2" marginTop={1}>
                    Enter Saleor global ID(s). For multi-values use comma separated IDs.
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={5} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4}>
        <Box display="flex" justifyContent="space-between" alignItems="center" style={{ gap: 10, flexWrap: "wrap" }}>
          <Text as="h3" size={5} fontWeight="bold">
            Storefront usage
          </Text>
          <Button variant="secondary" onClick={() => void copyUsageSnippet()}>
            {copiedUsage ? <Check size={14} /> : <Copy size={14} />}
            {copiedUsage ? "Copied" : "Copy code"}
          </Button>
        </Box>
        <Text as="p" size={2} color="default2" marginTop={1} marginBottom={3}>
          Use this code block to map widget variables in storefront integration.
        </Text>
        <Box
          borderStyle="solid"
          borderWidth={1}
          borderColor="default1"
          borderRadius={4}
          padding={3}
          style={{ background: "#F8FAFC", overflowX: "auto" }}
        >
          <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: "pre" }}>
            <code>{usageSnippet}</code>
          </pre>
        </Box>
      </Box>
    </Box>
  );
}
