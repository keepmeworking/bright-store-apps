import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { Edit, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useClient } from "urql";
import { useGetWidgetsQuery } from "../../../generated/graphql";
import {
  isModulePageType,
  isRepeaterDataAttributeSlug,
  isRepeaterModelByAttributes,
  isWidgetModelPageType,
} from "@/lib/widget-models";

type WidgetModelNode = {
  id: string;
  name: string;
  slug: string;
  attributes?: ReadonlyArray<{ slug?: string | null } | null> | null;
};

const isMagicCmsManagedModel = (slug: string) =>
  isModulePageType(slug) || isWidgetModelPageType(slug);

const getFieldCount = (attributes: ReadonlyArray<{ slug?: string | null }> = []) =>
  attributes.filter((attribute) => !isRepeaterDataAttributeSlug(attribute.slug || "")).length;

const normalizeGraphQLErrors = (
  errors: ReadonlyArray<{ message?: string | null; code?: string | null; field?: string | null }>
) =>
  errors.map((error) => [error.code, error.field, error.message].filter(Boolean).join(" | ")).filter(Boolean);

const WidgetModelCard = ({
  model,
  onCreateWidget,
  onOpenModeling,
  onDeleteModel,
  isDeleteConfirm,
  isDeleting,
}: {
  model: WidgetModelNode;
  onCreateWidget: (modelId: string) => void;
  onOpenModeling: () => void;
  onDeleteModel: (model: WidgetModelNode) => void;
  isDeleteConfirm: boolean;
  isDeleting: boolean;
}) => {
  const attrs = (model.attributes || []).filter((attr): attr is { slug?: string | null } => Boolean(attr));
  const isRepeater = isRepeaterModelByAttributes(attrs);
  const isModule = isModulePageType(model.slug);
  const isWidgetModel = isWidgetModelPageType(model.slug);

  return (
    <Box
      borderStyle="solid"
      borderWidth={1}
      borderColor="default1"
      borderRadius={4}
      padding={4}
      display="flex"
      flexDirection="column"
      gap={3}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text as="h4" size={4} fontWeight="bold">
          {model.name}
        </Text>
        <Text as="span" size={1} color="default2" textTransform="uppercase">
          {isModule ? "MODULE" : isRepeater ? "REPEATER" : "SINGLE"}
        </Text>
      </Box>

      <Text as="p" size={1} color="default2">
        Slug: {model.slug}
      </Text>
      <Text as="p" size={2} color="default2">
        {getFieldCount(attrs)} field(s)
      </Text>

      <Box marginTop="auto" display="flex" gap={2}>
        {isModule ? (
          <Button variant="secondary" size="small" onClick={onOpenModeling} style={{ flex: 1 }}>
            Open in /models
          </Button>
        ) : isWidgetModel ? (
          <Button variant="secondary" size="small" onClick={() => onCreateWidget(model.id)} style={{ flex: 1 }}>
            Create Widget
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="small"
          onClick={() => onDeleteModel(model)}
          disabled={isDeleting}
          style={{
            minWidth: 96,
            color: isDeleteConfirm ? "#C8321A" : undefined,
          }}
        >
          {isDeleting ? "Deleting..." : isDeleteConfirm ? "Sure delete" : "Delete"}
        </Button>
      </Box>
    </Box>
  );
};

export default function WidgetsPage() {
  const router = useRouter();
  const client = useClient();

  const [modelTypes, setModelTypes] = useState<WidgetModelNode[]>([]);
  const [fetchingModels, setFetchingModels] = useState(true);
  const [modelLoadError, setModelLoadError] = useState("");

  const [selectedModelId, setSelectedModelId] = useState("all");
  const [search, setSearch] = useState("");
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState("");

  const activeTab = router.query.tab === "widgets" ? "widgets" : "modules";
  const syncWarning = typeof router.query.syncWarning === "string" ? router.query.syncWarning : "";

  const setTab = (tab: "modules" | "widgets") => {
    setPendingDeleteModelId(null);
    router.replace(
      { pathname: "/widgets", query: tab === "modules" ? {} : { tab } },
      undefined,
      { shallow: true }
    );
  };

  const loadWidgetModels = useCallback(async () => {
    setFetchingModels(true);
    setModelLoadError("");

    try {
      let after: string | null = null;
      let hasNextPage = true;
      let guard = 0;
      const collected: WidgetModelNode[] = [];

      while (hasNextPage && guard < 30) {
        const result: any = await client
          .query(
            `
              query LoadWidgetModels($first: Int!, $after: String) {
                pageTypes(first: $first, after: $after) {
                  edges {
                    node {
                      id
                      name
                      slug
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
        const edges = pageTypes?.edges || [];
        edges.forEach((edge: any) => {
          const node = edge?.node;
          if (node?.id && node?.slug) {
            collected.push(node as WidgetModelNode);
          }
        });

        hasNextPage = Boolean(pageTypes?.pageInfo?.hasNextPage);
        after = pageTypes?.pageInfo?.endCursor || null;
        guard += 1;
      }

      const uniqueById = Array.from(new Map(collected.map((node) => [node.id, node])).values());
      uniqueById.sort((a, b) => a.name.localeCompare(b.name));
      setModelTypes(uniqueById);
    } catch (loadError) {
      setModelTypes([]);
      setModelLoadError(loadError instanceof Error ? loadError.message : "Failed to load widget models.");
    } finally {
      setFetchingModels(false);
    }
  }, [client]);

  useEffect(() => {
    void loadWidgetModels();
  }, [loadWidgetModels]);

  const filteredModelTypes = useMemo(
    () => modelTypes.filter((model) => isMagicCmsManagedModel(model.slug)),
    [modelTypes]
  );

  const filteredModelTypeIds = useMemo(
    () => filteredModelTypes.map((model) => model.id),
    [filteredModelTypes]
  );

  const activeTypeIds = useMemo(() => {
    if (selectedModelId === "all") {
      return filteredModelTypeIds;
    }
    return selectedModelId ? [selectedModelId] : undefined;
  }, [selectedModelId, filteredModelTypeIds]);

  const shouldPauseWidgetsQuery = selectedModelId === "all" && filteredModelTypeIds.length === 0;

  const [{ data: widgetsData, fetching: fetchingWidgets }] = useGetWidgetsQuery({
    variables: {
      pageTypeIds: activeTypeIds,
      first: 120,
      search: search.trim() || undefined,
    },
    pause: shouldPauseWidgetsQuery,
    requestPolicy: "network-only",
  });

  const widgets = useMemo(() => (widgetsData?.pages?.edges || []).map((edge) => edge.node), [widgetsData]);
  const widgetModelTypes = useMemo(
    () => filteredModelTypes.filter((model) => isWidgetModelPageType(model.slug)),
    [filteredModelTypes]
  );
  const modelOptions = useMemo(
    () =>
      filteredModelTypes.map((model) => ({
        id: model.id,
        name: model.name,
      })),
    [filteredModelTypes]
  );

  const goCreateWidget = (modelId?: string) => {
    if (modelId) {
      router.push(`/widgets/new?modelId=${encodeURIComponent(modelId)}`);
      return;
    }
    router.push("/widgets/new");
  };

  const handleDeleteModel = async (model: WidgetModelNode) => {
    if (deletingModelId) {
      return;
    }

    setDeleteError("");
    setDeleteSuccess("");

    if (pendingDeleteModelId !== model.id) {
      setPendingDeleteModelId(model.id);
      return;
    }

    setDeletingModelId(model.id);
    try {
      const result: any = await client
        .mutation(
          `
            mutation DeleteWidgetModel($id: ID!) {
              pageTypeDelete(id: $id) {
                errors {
                  code
                  field
                  message
                }
              }
            }
          `,
          { id: model.id }
        )
        .toPromise();

      if (result.error?.message) {
        throw new Error(result.error.message);
      }

      const errors = normalizeGraphQLErrors(result.data?.pageTypeDelete?.errors || []);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      if (selectedModelId === model.id) {
        setSelectedModelId("all");
      }
      setPendingDeleteModelId(null);
      setDeleteSuccess(`Model deleted: ${model.name}`);
      await loadWidgetModels();
    } catch (deleteModelError) {
      setDeleteError(
        deleteModelError instanceof Error ? deleteModelError.message : "Failed to delete model."
      );
    } finally {
      setDeletingModelId(null);
    }
  };

  return (
    <Box padding={8}>
      <Box marginBottom={6} display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={3}>
        <Text as="h1" size={9} fontWeight="bold">
          Widgets
        </Text>
        <Box display="flex" gap={2}>
          {activeTab === "modules" ? (
            <Button
              variant="secondary"
              onClick={() => router.push("/widgets/create")}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <Plus size={16} />
              Create Model
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => goCreateWidget()}
              disabled={filteredModelTypes.length === 0}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <Plus size={16} />
              Create Widget
            </Button>
          )}

          <Button
            variant="secondary"
            onClick={() => void loadWidgetModels()}
            disabled={fetchingModels}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <RefreshCw size={14} />
            {fetchingModels ? "Refreshing..." : "Refresh"}
          </Button>
        </Box>
      </Box>

      {syncWarning ? (
        <Box marginBottom={4} borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
          <Text color="critical1" size={2}>
            {syncWarning}
          </Text>
        </Box>
      ) : null}

      {deleteError ? (
        <Box marginBottom={4} borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={3}>
          <Text color="critical1" size={2}>
            {deleteError}
          </Text>
        </Box>
      ) : null}

      {deleteSuccess ? (
        <Box marginBottom={4} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={3}>
          <Text size={2}>{deleteSuccess}</Text>
        </Box>
      ) : null}

      <Box marginBottom={5} display="flex" gap={4} style={{ borderBottom: "1px solid #E6E6E6", flexWrap: "wrap" }}>
        <Button
          variant="tertiary"
          onClick={() => setTab("modules")}
          style={{
            borderBottom: activeTab === "modules" ? "2px solid #28234A" : "none",
            borderRadius: 0,
            paddingBottom: 12,
            textTransform: "none",
          }}
        >
          Modules
        </Button>
        <Button
          variant="tertiary"
          onClick={() => setTab("widgets")}
          style={{
            borderBottom: activeTab === "widgets" ? "2px solid #28234A" : "none",
            borderRadius: 0,
            paddingBottom: 12,
            textTransform: "none",
          }}
        >
          Widgets
        </Button>
      </Box>

      {activeTab === "modules" ? (
        <Box>
          <Box marginBottom={4}>
            <Text as="h3" size={6} fontWeight="bold">
              Models ({filteredModelTypes.length})
            </Text>
          </Box>

          {fetchingModels ? (
            <Box
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={6}
              display="flex"
              justifyContent="center"
            >
              <Spinner />
            </Box>
          ) : modelLoadError ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="critical1" borderRadius={4} padding={4}>
              <Text color="critical1">{modelLoadError}</Text>
            </Box>
          ) : filteredModelTypes.length === 0 ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={8} textAlign="center">
              <Text as="p" size={3} color="default2">
                No model found. Create your first model to start building dynamic widgets.
              </Text>
              <Box marginTop={4} display="flex" justifyContent="center">
                <Button variant="secondary" onClick={() => router.push("/widgets/create")}>
                  Create Widget Model
                </Button>
              </Box>
            </Box>
          ) : (
            <Box display="grid" gap={4} __gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))">
              {filteredModelTypes.map((model) => (
                <WidgetModelCard
                  key={model.id}
                  model={model}
                  onCreateWidget={goCreateWidget}
                  onOpenModeling={() => window.location.assign("/models/")}
                  onDeleteModel={handleDeleteModel}
                  isDeleteConfirm={pendingDeleteModelId === model.id}
                  isDeleting={deletingModelId === model.id}
                />
              ))}
            </Box>
          )}
        </Box>
      ) : (
        <Box>
          <Box marginBottom={4}>
            <Text as="h3" size={6} fontWeight="bold">
              Widget Models ({widgetModelTypes.length})
            </Text>
          </Box>

          {fetchingModels ? (
            <Box
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={6}
              display="flex"
              justifyContent="center"
              marginBottom={4}
            >
              <Spinner />
            </Box>
          ) : widgetModelTypes.length === 0 ? (
            <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={5} marginBottom={4}>
              <Text as="p" size={2} color="default2">
                No widget model found. Create one first, then create widget entries from it.
              </Text>
              <Box marginTop={3}>
                <Button variant="secondary" onClick={() => router.push("/widgets/create")}>
                  Create Model
                </Button>
              </Box>
            </Box>
          ) : (
            <Box display="grid" gap={4} __gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" marginBottom={5}>
              {widgetModelTypes.map((model) => (
                <WidgetModelCard
                  key={model.id}
                  model={model}
                  onCreateWidget={goCreateWidget}
                  onOpenModeling={() => window.location.assign("/models/")}
                  onDeleteModel={handleDeleteModel}
                  isDeleteConfirm={pendingDeleteModelId === model.id}
                  isDeleting={deletingModelId === model.id}
                />
              ))}
            </Box>
          )}

          <Box marginBottom={3}>
            <Text as="h3" size={6} fontWeight="bold">
              Widget Entries
            </Text>
          </Box>

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} padding={4} marginBottom={4}>
            <Box display="grid" gap={3} __gridTemplateColumns="minmax(220px, 1fr) minmax(220px, 280px)">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search widget entry by title"
              />
              <select
                value={selectedModelId}
                onChange={(event) => setSelectedModelId(event.target.value)}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 8,
                  border: "1px solid #CBD4E1",
                  padding: "8px 12px",
                  background: "white",
                }}
              >
                <option value="all">All models</option>
                {modelOptions.map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </Box>
          </Box>

          <Box borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4} overflow="hidden">
            <Box
              padding={3}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(240px, 1fr) minmax(220px, 220px) 120px",
                gap: 12,
                borderBottom: "1px solid #E5EAF2",
                fontWeight: 600,
              }}
            >
              <Text>Title</Text>
              <Text>Model</Text>
              <Text>Action</Text>
            </Box>

            {fetchingWidgets ? (
              <Box padding={6} display="flex" justifyContent="center">
                <Spinner />
              </Box>
            ) : widgets.length === 0 ? (
              <Box padding={6} textAlign="center">
                <Text color="default2">No widget entry found for selected model/filter.</Text>
                <Box marginTop={3} display="flex" gap={2} justifyContent="center" flexWrap="wrap">
                  <Button variant="secondary" onClick={() => goCreateWidget()}>
                    Create Widget
                  </Button>
                  <Button variant="tertiary" onClick={() => setSelectedModelId("all")}>
                    Show All Models
                  </Button>
                </Box>
              </Box>
            ) : (
              widgets.map((widget) => (
                <Box
                  key={widget.id}
                  padding={3}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(240px, 1fr) minmax(220px, 220px) 120px",
                    gap: 12,
                    borderBottom: "1px solid #E5EAF2",
                    alignItems: "center",
                  }}
                >
                  <Box>
                    <Text fontWeight="bold">{widget.title}</Text>
                    <Text as="p" size={1} color="default2">
                      {widget.slug}
                    </Text>
                  </Box>
                  <Text size={2}>{widget.pageType.name}</Text>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => router.push(`/widgets/${widget.id}`)}
                    style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}
                  >
                    <Edit size={14} />
                    Edit
                  </Button>
                </Box>
              ))
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
