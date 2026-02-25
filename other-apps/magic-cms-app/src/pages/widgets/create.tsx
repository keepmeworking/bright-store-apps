import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { useClient } from "urql";
import {
  AttributeCreateDocument,
  AttributeInputTypeEnum,
  AttributeTypeEnum,
  GetPageTypesDocument,
  PageTypeCreateDocument,
  PageTypeUpdateDocument,
} from "../../../generated/graphql";
import {
  buildWidgetModelSlug,
  createShortToken,
  mapWidgetFieldTypeToSaleor,
  sanitizeSlugPart,
  stripWidgetModelPrefix,
  WIDGET_JSON_ATTRIBUTE_PREFIX,
  WIDGET_MODEL_PAGE_TYPE_PREFIX,
  WIDGET_FIELD_TYPE_OPTIONS,
  WIDGET_MODEL_ATTRIBUTE_PREFIX,
  type WidgetFieldDraft,
  type WidgetModelMode,
} from "@/lib/widget-models";

const createFieldDraft = (): WidgetFieldDraft => ({
  id: createShortToken(),
  label: "",
  slug: "",
  manualSlug: false,
  type: "text",
});

const normalizeGraphQLErrors = (
  errors: ReadonlyArray<{ message?: string | null; code?: string | null; field?: string | null }>
) =>
  errors.map((error) => [error.code, error.field, error.message].filter(Boolean).join(" | ")).filter(Boolean);

export default function CreateWidgetModelPage() {
  const router = useRouter();
  const client = useClient();

  const [modelName, setModelName] = useState("");
  const [mode, setMode] = useState<WidgetModelMode>("single");
  const [fields, setFields] = useState<WidgetFieldDraft[]>([createFieldDraft()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const modelSlugPreview = useMemo(() => {
    const base = sanitizeSlugPart(modelName) || "model";
    return `${WIDGET_MODEL_PAGE_TYPE_PREFIX}${mode}-${base}-*`;
  }, [mode, modelName]);

  const addField = () => setFields((prev) => [...prev, createFieldDraft()]);

  const removeField = (id: string) => {
    setFields((prev) => (prev.length === 1 ? prev : prev.filter((field) => field.id !== id)));
  };

  const updateField = (id: string, patch: Partial<WidgetFieldDraft>) => {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };

  const loadAttributeIdBySlug = async (slug: string) => {
    const result = await client
      .query(
        `query LoadAttrBySlug($search: String!) {
          attributes(filter: { search: $search }, first: 100) {
            edges {
              node {
                id
                slug
              }
            }
          }
        }`,
        { search: slug },
        { requestPolicy: "network-only" }
      )
      .toPromise();

    const edges = result.data?.attributes?.edges || [];
    const node = edges.map((edge: any) => edge?.node).find((entry: any) => entry?.slug === slug);
    return node?.id || "";
  };

  const resolveFieldAttributeIds = async (modelSlug: string, cleanFields: WidgetFieldDraft[]) => {
    const modelKey = stripWidgetModelPrefix(modelSlug);
    const output: string[] = [];
    const localSlugSet = new Set<string>();

    for (const field of cleanFields) {
      const cleanFieldSlug = sanitizeSlugPart(field.slug || field.label || "field");
      const attrSlug = `${WIDGET_MODEL_ATTRIBUTE_PREFIX}${modelKey}-${cleanFieldSlug}`;
      if (localSlugSet.has(attrSlug)) {
        throw new Error(`Duplicate field slug generated: ${cleanFieldSlug}`);
      }
      localSlugSet.add(attrSlug);

      const existingAttrId = await loadAttributeIdBySlug(attrSlug);
      if (existingAttrId) {
        output.push(existingAttrId);
        continue;
      }

      const mapping = mapWidgetFieldTypeToSaleor(field.type);
      const createResult = await client
        .mutation(AttributeCreateDocument, {
          input: {
            name: `Magic Widget ${modelName || "Field"}: ${field.label || cleanFieldSlug}`,
            slug: attrSlug,
            type: AttributeTypeEnum.PageType,
            inputType: mapping.inputType as AttributeInputTypeEnum,
            entityType: mapping.entityType,
          },
        })
        .toPromise();

      const transportMessage = createResult.error?.message;
      if (transportMessage) {
        throw new Error(`Create attribute ${attrSlug} failed: ${transportMessage}`);
      }

      const gqlErrors = normalizeGraphQLErrors(createResult.data?.attributeCreate?.errors || []);
      if (gqlErrors.length > 0) {
        const isUnique = (createResult.data?.attributeCreate?.errors || []).some((entry) => entry.code === "UNIQUE");
        if (!isUnique) {
          throw new Error(`Create attribute ${attrSlug}: ${gqlErrors.join("; ")}`);
        }
        const resolvedAfterUnique = await loadAttributeIdBySlug(attrSlug);
        if (!resolvedAfterUnique) {
          throw new Error(`Create attribute ${attrSlug}: UNIQUE but ID could not be resolved.`);
        }
        output.push(resolvedAfterUnique);
        continue;
      }

      const createdAttrId = createResult.data?.attributeCreate?.attribute?.id || "";
      if (!createdAttrId) {
        throw new Error(`Create attribute ${attrSlug}: ID missing.`);
      }
      output.push(createdAttrId);
    }

    if (mode === "repeater") {
      const repeaterSlug = `${WIDGET_JSON_ATTRIBUTE_PREFIX}${modelKey}`;
      const existingRepeaterAttr = await loadAttributeIdBySlug(repeaterSlug);
      if (existingRepeaterAttr) {
        output.push(existingRepeaterAttr);
      } else {
        const createRepeater = await client
          .mutation(AttributeCreateDocument, {
            input: {
              name: `Magic Widget ${modelName || "Model"} Repeater Items`,
              slug: repeaterSlug,
              type: AttributeTypeEnum.PageType,
              inputType: AttributeInputTypeEnum.PlainText,
            },
          })
          .toPromise();
        const transportMessage = createRepeater.error?.message;
        if (transportMessage) {
          throw new Error(`Create repeater attribute failed: ${transportMessage}`);
        }
        const gqlErrors = normalizeGraphQLErrors(createRepeater.data?.attributeCreate?.errors || []);
        if (gqlErrors.length > 0) {
          throw new Error(`Create repeater attribute: ${gqlErrors.join("; ")}`);
        }
        const repeaterId = createRepeater.data?.attributeCreate?.attribute?.id || "";
        if (!repeaterId) {
          throw new Error("Create repeater attribute: ID missing.");
        }
        output.push(repeaterId);
      }
    }

    return output;
  };

  const handleCreateModel = async () => {
    setError("");
    setSuccess("");

    const cleanName = modelName.trim();
    const cleanFields = fields
      .map((field) => ({
        ...field,
        label: field.label.trim(),
        slug: sanitizeSlugPart(field.slug || field.label),
      }))
      .filter((field) => Boolean(field.label));

    if (!cleanName) {
      setError("Model name is required.");
      return;
    }
    if (cleanFields.length === 0) {
      setError("At least one field is required.");
      return;
    }

    setLoading(true);
    try {
      const proposedModelSlug = buildWidgetModelSlug(`${mode}-${cleanName}`);
      const attributeIds = await resolveFieldAttributeIds(proposedModelSlug, cleanFields);

      const createResult = await client
        .mutation(PageTypeCreateDocument, {
          input: {
            name: `MagicCMS: Widget Model ${cleanName}`,
            slug: proposedModelSlug,
            addAttributes: attributeIds,
          },
        })
        .toPromise();

      if (createResult.error?.message) {
        throw new Error(`Create model failed: ${createResult.error.message}`);
      }

      const createErrors = createResult.data?.pageTypeCreate?.errors || [];
      const normalizedErrors = normalizeGraphQLErrors(createErrors);
      if (normalizedErrors.length > 0) {
        const isUnique = createErrors.some((entry) => entry.code === "UNIQUE");
        if (!isUnique) {
          throw new Error(`Create model failed: ${normalizedErrors.join("; ")}`);
        }

        // If slug already exists, sync any newly created attributes into that page type.
        const existingResult = await client
          .query(GetPageTypesDocument, { slug: proposedModelSlug }, { requestPolicy: "network-only" })
          .toPromise();
        const existingNode = existingResult.data?.pageTypes?.edges?.[0]?.node;
        if (!existingNode?.id) {
          throw new Error("Model already exists but could not be loaded for update.");
        }

        const existingAttrIds = new Set((existingNode.attributes || []).map((attribute) => attribute.id));
        const missingAttrIds = attributeIds.filter((attributeId) => !existingAttrIds.has(attributeId));
        if (missingAttrIds.length > 0) {
          const updateResult = await client
            .mutation(PageTypeUpdateDocument, {
              id: existingNode.id,
              input: { addAttributes: missingAttrIds },
            })
            .toPromise();
          if (updateResult.error?.message) {
            throw new Error(`Model update failed: ${updateResult.error.message}`);
          }
          const updateErrors = normalizeGraphQLErrors(updateResult.data?.pageTypeUpdate?.errors || []);
          if (updateErrors.length > 0) {
            throw new Error(`Model update failed: ${updateErrors.join("; ")}`);
          }
        }
      }

      setSuccess(`Widget model created: ${proposedModelSlug}`);
      setTimeout(() => {
        router.push("/widgets?tab=modules");
      }, 500);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create model failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box padding={8}>
      <Box marginBottom={5}>
        <Button variant="tertiary" onClick={() => router.push("/widgets?tab=modules")} style={{ paddingLeft: 0 }}>
          Back to Widgets
        </Button>
      </Box>

      <Box marginBottom={6}>
        <Text as="h1" size={9} fontWeight="bold">
          Create Widget Model
        </Text>
        <Text as="p" size={3} color="default2" marginTop={2}>
          Saleor-native model builder: create a page type + attributes, then create widget entries from it.
        </Text>
      </Box>

      <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={5}>
        <Box marginBottom={4}>
          <Text as="span" size={2} fontWeight="bold">
            Model name
          </Text>
          <Box marginTop={2}>
            <Input
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="e.g. Home CTA, Promo Banner, FAQ Section"
            />
          </Box>
        </Box>

        <Box marginBottom={4}>
          <Text as="span" size={2} fontWeight="bold">
            Mode
          </Text>
          <Box marginTop={2}>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as WidgetModelMode)}
              style={{
                width: 240,
                minHeight: 40,
                borderRadius: 8,
                border: "1px solid #CBD4E1",
                padding: "8px 12px",
                background: "white",
              }}
            >
              <option value="single">Single data widget</option>
              <option value="repeater">Repeater widget</option>
            </select>
          </Box>
          <Text as="p" size={1} color="default2" marginTop={1}>
            Repeater mode auto-adds plain text JSON field with slug `magic-json-*`.
          </Text>
        </Box>

        <Box marginBottom={4}>
          <Text as="span" size={2} fontWeight="bold">
            Field schema
          </Text>

          <Box
            marginTop={3}
            display="grid"
            gap={2}
            style={{ gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr) minmax(180px, 220px) 96px" }}
          >
            <Text size={1} color="default2">
              Field label
            </Text>
            <Text size={1} color="default2">
              Field slug
            </Text>
            <Text size={1} color="default2">
              Type
            </Text>
            <Text size={1} color="default2">
              &nbsp;
            </Text>
          </Box>

          <Box marginTop={1} display="grid" gap={3}>
            {fields.map((field) => (
              <Box
                key={field.id}
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                padding={3}
                display="grid"
                gap={2}
                __gridTemplateColumns="minmax(160px, 1fr) minmax(140px, 1fr) minmax(150px, 180px) 80px"
              >
                <Input
                  value={field.label}
                  onChange={(event) => {
                    const nextLabel = event.target.value;
                    updateField(field.id, {
                      label: nextLabel,
                      slug: field.manualSlug ? field.slug : sanitizeSlugPart(nextLabel),
                    });
                  }}
                  placeholder="e.g. Title, CTA Text, Heading"
                />
                <Input
                  value={field.slug}
                  onChange={(event) => {
                    const nextSlug = sanitizeSlugPart(event.target.value);
                    updateField(field.id, {
                      slug: nextSlug,
                      manualSlug: nextSlug.length > 0,
                    });
                  }}
                  placeholder="auto-from-label"
                />
                <select
                  value={field.type}
                  onChange={(event) => updateField(field.id, { type: event.target.value as WidgetFieldDraft["type"] })}
                  style={{
                    width: "100%",
                    minHeight: 40,
                    borderRadius: 8,
                    border: "1px solid #CBD4E1",
                    padding: "8px 12px",
                    background: "white",
                  }}
                >
                  {WIDGET_FIELD_TYPE_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => removeField(field.id)} style={{ width: "100%" }}>
                  Remove
                </Button>
              </Box>
            ))}
          </Box>

          <Box marginTop={3}>
            <Button variant="secondary" onClick={addField}>
              Add Field
            </Button>
          </Box>
        </Box>

        <Box marginBottom={4}>
          <Text as="p" size={1} color="default2">
            Generated page type slug pattern: {modelSlugPreview}
          </Text>
          <Text as="p" size={1} color="default2" marginTop={1}>
            Generated field slug pattern: {WIDGET_MODEL_ATTRIBUTE_PREFIX}...
          </Text>
        </Box>

        {error ? (
          <Box marginBottom={3}>
            <Text color="critical1" size={2}>
              {error}
            </Text>
          </Box>
        ) : null}

        {success ? (
          <Box marginBottom={3}>
            <Text color="success1" size={2}>
              {success}
            </Text>
          </Box>
        ) : null}

        <Box display="flex" gap={2}>
          <Button variant="primary" onClick={handleCreateModel} disabled={loading}>
            {loading ? "Creating model..." : "Create Model"}
          </Button>
          <Button variant="secondary" onClick={() => router.push("/widgets?tab=modules")} disabled={loading}>
            Cancel
          </Button>
        </Box>
      </Box>

      {loading ? (
        <Box marginTop={4} display="flex" gap={2} alignItems="center">
          <Spinner />
          <Text size={2} color="default2">
            Provisioning attributes + page type in Saleor...
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
