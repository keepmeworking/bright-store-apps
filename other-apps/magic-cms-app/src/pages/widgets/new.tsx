import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useClient } from "urql";
import { useCreateWidgetMutation } from "../../../generated/graphql";
import { syncMagicRefWidgetOnModulePages } from "@/lib/module-widget-reference-sync";
import { createShortToken, isWidgetOrModulePageType, sanitizeSlugPart } from "@/lib/widget-models";

type WidgetModelNode = {
  id: string;
  name: string;
  slug: string;
};

export default function CreateWidgetEntryPage() {
  const router = useRouter();
  const client = useClient();
  const [createWidgetResult, createWidget] = useCreateWidgetMutation();

  const [models, setModels] = useState<WidgetModelNode[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState("");

  const requestedModelId = typeof router.query.modelId === "string" ? router.query.modelId : "";

  useEffect(() => {
    const loadModels = async () => {
      setLoadingModels(true);
      setLoadError("");
      try {
        let after: string | null = null;
        let hasNextPage = true;
        let guard = 0;
        const collected: WidgetModelNode[] = [];

        while (hasNextPage && guard < 30) {
          const result: any = await client
            .query(
              `
                query LoadWidgetModelsForCreate($first: Int!, $after: String) {
                  pageTypes(first: $first, after: $after) {
                    edges {
                      node {
                        id
                        name
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

          const pageTypes: any = result.data?.pageTypes;
          (pageTypes?.edges || []).forEach((edge: any) => {
            const node = edge?.node;
            if (node?.slug && isWidgetOrModulePageType(node.slug)) {
              collected.push(node as WidgetModelNode);
            }
          });

          hasNextPage = Boolean(pageTypes?.pageInfo?.hasNextPage);
          after = pageTypes?.pageInfo?.endCursor || null;
          guard += 1;
        }

        collected.sort((a, b) => a.name.localeCompare(b.name));
        setModels(collected);
      } catch (loadModelsError) {
        setLoadError(loadModelsError instanceof Error ? loadModelsError.message : "Failed to load models.");
      } finally {
        setLoadingModels(false);
      }
    };

    void loadModels();
  }, [client]);

  useEffect(() => {
    if (!models.length) {
      return;
    }
    if (requestedModelId && models.some((model) => model.id === requestedModelId)) {
      setModelId(requestedModelId);
      return;
    }
    if (!modelId) {
      setModelId(models[0].id);
    }
  }, [models, modelId, requestedModelId]);

  const selectedModel = useMemo(() => models.find((model) => model.id === modelId), [models, modelId]);

  const handleCreate = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle || !modelId) {
      setError("Widget title and module are required.");
      return;
    }

    setError("");
    const modelHint = sanitizeSlugPart(selectedModel?.name || "model");
    const slug = `magic-widget-${modelHint}-${sanitizeSlugPart(cleanTitle) || "item"}-${createShortToken()}`;

    const result = await createWidget({
      input: {
        title: cleanTitle,
        slug,
        pageType: modelId,
        isPublished: false,
      },
    });

    const gqlErrors = result.data?.pageCreate?.errors || [];
    if (result.error || gqlErrors.length > 0 || !result.data?.pageCreate?.page?.id) {
      setError(result.error?.message || gqlErrors.map((entry) => entry.message).filter(Boolean).join(", ") || "Create failed.");
      return;
    }

    const createdPageId = result.data.pageCreate.page.id;

    let syncWarning = "";
    const syncResult = await syncMagicRefWidgetOnModulePages(client, createdPageId, "add");
    if (syncResult.errors.length > 0) {
      syncWarning =
        syncResult.errors[0] ||
        "Widget created, but magic-ref-widget sync failed for one or more module pages.";
    }

    if (syncWarning) {
      router.push(`/widgets/${createdPageId}?syncWarning=${encodeURIComponent(syncWarning)}`);
      return;
    }

    router.push(`/widgets/${createdPageId}`);
  };

  return (
    <Box padding={8}>
      <Box marginBottom={5}>
        <Button variant="tertiary" onClick={() => router.push("/widgets?tab=widgets")} style={{ paddingLeft: 0 }}>
          Back to Widgets
        </Button>
      </Box>

      <Box marginBottom={6}>
        <Text as="h1" size={9} fontWeight="bold">
          Create Widget
        </Text>
        <Text as="p" size={3} color="default2" marginTop={2}>
          Select module, create widget entry, then fill all fields in the next form page.
        </Text>
      </Box>

      <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={5}>
        {loadingModels ? (
          <Box display="flex" justifyContent="center" padding={4}>
            <Spinner />
          </Box>
        ) : loadError ? (
          <Text color="critical1">{loadError}</Text>
        ) : models.length === 0 ? (
          <Box>
            <Text color="default2">No module found. Create a module first.</Text>
            <Box marginTop={3}>
              <Button variant="secondary" onClick={() => router.push("/widgets/create")}>
                Create Module
              </Button>
            </Box>
          </Box>
        ) : (
          <>
            <Box marginBottom={4}>
              <Text as="span" size={2} fontWeight="bold">
                Module
              </Text>
              <Box marginTop={2}>
                <select
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 40,
                    borderRadius: 8,
                    border: "1px solid #CBD4E1",
                    padding: "8px 12px",
                    background: "white",
                  }}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </Box>
              {selectedModel ? (
                <Text as="p" size={1} color="default2" marginTop={1}>
                  Module slug: {selectedModel.slug}
                </Text>
              ) : null}
            </Box>

            <Box marginBottom={4}>
              <Text as="span" size={2} fontWeight="bold">
                Widget title
              </Text>
              <Box marginTop={2}>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Home Hero CTA 1" />
              </Box>
            </Box>

            {error ? (
              <Box marginBottom={3}>
                <Text color="critical1" size={2}>
                  {error}
                </Text>
              </Box>
            ) : null}

            <Box display="flex" gap={2}>
              <Button variant="primary" onClick={handleCreate} disabled={createWidgetResult.fetching}>
                {createWidgetResult.fetching ? "Creating..." : "Create & Open Form"}
              </Button>
              <Button variant="secondary" onClick={() => router.push("/widgets?tab=widgets")}>
                Cancel
              </Button>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
