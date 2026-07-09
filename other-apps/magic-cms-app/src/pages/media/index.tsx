import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { Copy, Edit, Eye, Image as ImageIcon, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { MagicMediaItem } from "@/lib/magic-media-catalog";

type ListResponse = {
  items: MagicMediaItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  message?: string;
};

type UploadStatus = "queued" | "uploading" | "done" | "failed";

type UploadQueueItem = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: UploadStatus;
  error: string;
  storedFileName?: string;
};

const PAGE_SIZE = 20;
const MAX_CONCURRENT_UPLOADS = 3;

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const createLocalId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const statusLabel: Record<UploadStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  done: "Done",
  failed: "Failed",
};

export default function MediaPage() {
  const { appBridgeState } = useAppBridge();
  const token = appBridgeState?.token || "";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBusyRef = useRef(false);
  const pendingFilesRef = useRef<Map<string, File>>(new Map());

  const [items, setItems] = useState<MagicMediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [editing, setEditing] = useState<MagicMediaItem | null>(null);
  const [editAlt, setEditAlt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const queueStats = useMemo(() => {
    const queued = queue.filter((item) => item.status === "queued").length;
    const uploading = queue.filter((item) => item.status === "uploading").length;
    const done = queue.filter((item) => item.status === "done").length;
    const failed = queue.filter((item) => item.status === "failed").length;
    return { queued, uploading, done, failed, total: queue.length };
  }, [queue]);

  const pageIds = useMemo(() => items.map((item) => item.id), [items]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const selectedCount = selectedIds.length;

  const loadPage = useCallback(
    async (nextPage: number) => {
      if (!token) return;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/media/list?page=${nextPage}&pageSize=${PAGE_SIZE}`, {
          headers: authHeaders,
        });
        const payload = (await response.json()) as ListResponse;
        if (!response.ok) {
          throw new Error(payload.message || "Unable to load media.");
        }
        const nextItems = payload.items || [];
        setItems(nextItems);
        setPage(payload.page || nextPage);
        setTotal(payload.total || 0);
        setTotalPages(payload.totalPages || 1);
        setHasPrev(Boolean(payload.hasPrev));
        setHasNext(Boolean(payload.hasNext));
        setSelectedIds((prev) => prev.filter((id) => nextItems.some((item) => item.id === id)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load media.");
      } finally {
        setLoading(false);
      }
    },
    [authHeaders, token],
  );

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const processUploadQueue = useCallback(async () => {
    if (!token || uploadBusyRef.current) return;
    uploadBusyRef.current = true;

    let uploadedAny = false;
    try {
      while (true) {
        const snapshot = await new Promise<UploadQueueItem[]>((resolve) => {
          setQueue((prev) => {
            resolve(prev);
            return prev;
          });
        });

        const uploadingCount = snapshot.filter((item) => item.status === "uploading").length;
        const slots = Math.max(0, MAX_CONCURRENT_UPLOADS - uploadingCount);
        const nextBatch = snapshot.filter((item) => item.status === "queued").slice(0, slots);

        if (nextBatch.length === 0) {
          if (uploadingCount === 0) break;
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          continue;
        }

        setQueue((prev) =>
          prev.map((item) =>
            nextBatch.some((batchItem) => batchItem.id === item.id)
              ? { ...item, status: "uploading", error: "" }
              : item,
          ),
        );

        await Promise.all(
          nextBatch.map(async (queueItem) => {
            const file = pendingFilesRef.current.get(queueItem.id);
            if (!file) {
              setQueue((prev) =>
                prev.map((item) =>
                  item.id === queueItem.id
                    ? { ...item, status: "failed", error: "File missing from queue." }
                    : item,
                ),
              );
              return;
            }

            try {
              const form = new FormData();
              form.append("file", file, file.name);
              const response = await fetch("/api/media/upload", {
                method: "POST",
                headers: authHeaders,
                body: form,
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                throw new Error(payload.message || "Upload failed.");
              }
              uploadedAny = true;
              const storedFileName =
                typeof payload?.item?.fileName === "string" ? payload.item.fileName : undefined;
              setQueue((prev) =>
                prev.map((item) =>
                  item.id === queueItem.id
                    ? { ...item, status: "done", error: "", storedFileName }
                    : item,
                ),
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : "Upload failed.";
              setQueue((prev) =>
                prev.map((item) =>
                  item.id === queueItem.id ? { ...item, status: "failed", error: message } : item,
                ),
              );
            } finally {
              pendingFilesRef.current.delete(queueItem.id);
            }
          }),
        );
      }
    } finally {
      uploadBusyRef.current = false;
      if (uploadedAny) {
        await loadPage(1);
      }
    }
  }, [authHeaders, loadPage, token]);

  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length || !token) return;

      const nextItems: UploadQueueItem[] = list.map((file) => {
        const id = createLocalId();
        pendingFilesRef.current.set(id, file);
        return {
          id,
          fileName: file.name,
          sizeBytes: file.size,
          status: "queued",
          error: "",
        };
      });

      setQueue((prev) => [...nextItems, ...prev]);
      void processUploadQueue();
    },
    [processUploadQueue, token],
  );

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      enqueueFiles(event.target.files);
      event.target.value = "";
    }
  };

  const clearFinishedQueue = () => {
    setQueue((prev) => prev.filter((item) => item.status === "queued" || item.status === "uploading"));
  };

  const removeQueueItem = (id: string) => {
    pendingFilesRef.current.delete(id);
    setQueue((prev) => prev.filter((item) => item.id !== id || item.status === "uploading"));
  };

  const copyLink = async (item: MagicMediaItem) => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(""), 1500);
    } catch {
      setError("Unable to copy link.");
    }
  };

  const openEdit = (item: MagicMediaItem) => {
    setEditing(item);
    setEditAlt(item.alt || "");
  };

  const saveEdit = async () => {
    if (!editing || !token) return;
    setSavingEdit(true);
    setError("");
    try {
      const response = await fetch("/api/media/item", {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editing.id,
          alt: editAlt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || "Unable to save changes.");
      }
      setEditing(null);
      await loadPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
      return;
    }
    setSelectedIds((prev) => [...new Set([...prev, ...pageIds])]);
  };

  const clearSelection = () => setSelectedIds([]);

  const requestDelete = (ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    setPendingDeleteIds(unique);
  };

  const confirmDelete = async () => {
    if (!token || pendingDeleteIds.length === 0) return;
    const ids = [...pendingDeleteIds];
    setBulkDeleting(true);
    setDeletingId(ids.length === 1 ? ids[0] : "bulk");
    setError("");
    try {
      const response = await fetch("/api/media/item", {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "bulk-delete",
          ids,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || "Unable to delete media.");
      }
      setPendingDeleteIds([]);
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      await loadPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete media.");
    } finally {
      setBulkDeleting(false);
      setDeletingId("");
    }
  };

  return (
    <Box padding={8} display="flex" flexDirection="column" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={4}>
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Media
          </Text>
          <Text as="p" size={3} color="default2" style={{ marginTop: 6 }}>
            Multi-file image upload with queue. Stored as `bymagic-media-daikcell-india-{"{id}"}.webp` and
            indexed in `magic-media/magic-media.json`.
          </Text>
        </Box>
      </Box>

      <Box
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        padding={6}
        style={{
          borderStyle: "dashed",
          background: dragOver ? "#F7F7FB" : "#fff",
          transition: "background 0.15s",
          opacity: queueStats.uploading > 0 ? 0.95 : 1,
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (event.dataTransfer.files?.length) {
            enqueueFiles(event.dataTransfer.files);
          }
        }}
      >
        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
          <Upload size={28} />
          <Text size={4} fontWeight="bold">
            Drag & drop multiple images
          </Text>
          <Text size={2} color="default2">
            JPG / PNG / WebP / GIF · max 12MB each · auto WebP · up to {MAX_CONCURRENT_UPLOADS} parallel uploads
          </Text>
          <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={onPickFiles}
          />
        </Box>
      </Box>

      {queue.length > 0 ? (
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
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
            <Text size={3} fontWeight="bold">
              Upload queue · {queueStats.uploading} uploading · {queueStats.queued} queued · {queueStats.done}{" "}
              done · {queueStats.failed} failed
            </Text>
            <Button
              variant="tertiary"
              disabled={queueStats.done + queueStats.failed === 0}
              onClick={clearFinishedQueue}
            >
              Clear finished
            </Button>
          </Box>
          <Box display="flex" flexDirection="column" gap={2} style={{ maxHeight: 260, overflowY: "auto" }}>
            {queue.map((item) => (
              <Box
                key={item.id}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                gap={3}
                padding={3}
                borderRadius={3}
                style={{
                  background:
                    item.status === "failed"
                      ? "#FEECEC"
                      : item.status === "done"
                        ? "#F1F8F3"
                        : "#FAFAFA",
                }}
              >
                <Box display="flex" flexDirection="column" gap={1} style={{ minWidth: 0 }}>
                  <Text size={2} style={{ wordBreak: "break-all" }}>
                    {item.fileName} · {formatBytes(item.sizeBytes)}
                  </Text>
                  <Text size={1} color="default2">
                    {statusLabel[item.status]}
                    {item.storedFileName ? ` → ${item.storedFileName}` : ""}
                    {item.error ? ` · ${item.error}` : ""}
                  </Text>
                </Box>
                {item.status !== "uploading" ? (
                  <Button
                    variant="tertiary"
                    onClick={() => removeQueueItem(item.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <X size={14} />
                  </Button>
                ) : (
                  <Spinner />
                )}
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}

      {error ? (
        <Box padding={4} borderRadius={3} style={{ background: "#FEECEC" }}>
          <Text size={2} color="critical1">
            {error}
          </Text>
        </Box>
      ) : null}

      <Box display="flex" justifyContent="space-between" alignItems="center" gap={3} style={{ flexWrap: "wrap" }}>
        <Text size={3} color="default2">
          {total === 0
            ? "No media yet"
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </Text>
        <Box display="flex" gap={2} alignItems="center" style={{ flexWrap: "wrap" }}>
          <Button variant="secondary" disabled={items.length === 0 || loading} onClick={toggleSelectAllPage}>
            {allPageSelected ? "Unselect page" : "Select all"}
          </Button>
          <Button variant="tertiary" disabled={selectedCount === 0} onClick={clearSelection}>
            Clear ({selectedCount})
          </Button>
          <Button
            variant="primary"
            disabled={selectedCount === 0 || bulkDeleting}
            onClick={() => requestDelete(selectedIds)}
            style={{ background: selectedCount ? "#B42318" : undefined }}
          >
            Delete selected ({selectedCount})
          </Button>
          <Button variant="secondary" disabled={!hasPrev || loading} onClick={() => void loadPage(page - 1)}>
            Prev
          </Button>
          <Text size={2}>
            Page {page} / {totalPages}
          </Text>
          <Button variant="secondary" disabled={!hasNext || loading} onClick={() => void loadPage(page + 1)}>
            Next
          </Button>
        </Box>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" padding={10}>
          <Spinner />
        </Box>
      ) : items.length === 0 ? (
        <Box
          padding={10}
          display="flex"
          flexDirection="column"
          alignItems="center"
          gap={3}
          borderStyle="solid"
          borderWidth={1}
          borderColor="default1"
          borderRadius={4}
        >
          <ImageIcon size={32} />
          <Text size={4} fontWeight="bold">
            No media uploaded
          </Text>
          <Text size={2} color="default2">
            Upload one or more images to populate the library.
          </Text>
        </Box>
      ) : (
        <Box
          display="grid"
          gap={5}
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
        >
          {items.map((item) => (
            <Box
              key={item.id}
              borderStyle="solid"
              borderWidth={1}
              borderColor="default1"
              borderRadius={4}
              padding={3}
              display="flex"
              flexDirection="column"
              gap={3}
              style={{
                outline: selectedIds.includes(item.id) ? "2px solid #28234A" : "none",
                background: selectedIds.includes(item.id) ? "#F7F7FB" : "#fff",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                  />
                  <Text size={1}>Select</Text>
                </label>
              </Box>
              <Box
                style={{
                  width: "100%",
                  aspectRatio: "4 / 3",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#F3F3F7",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.alt || item.fileName}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <Text size={2} fontWeight="bold" style={{ wordBreak: "break-all" }}>
                  {item.fileName}
                </Text>
                <Text size={1} color="default2">
                  {item.alt || "No alt text"} · {formatBytes(item.sizeBytes)} · {item.width}×{item.height}
                </Text>
                {item.originalName ? (
                  <Text size={1} color="default2" style={{ wordBreak: "break-all" }}>
                    Original: {item.originalName}
                  </Text>
                ) : null}
              </Box>
              <Box display="flex" flexWrap="wrap" gap={2}>
                <Button
                  variant="tertiary"
                  onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Eye size={14} /> View
                </Button>
                <Button
                  variant="tertiary"
                  onClick={() => openEdit(item)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Edit size={14} /> Edit
                </Button>
                <Button
                  variant="tertiary"
                  onClick={() => void copyLink(item)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Copy size={14} /> {copiedId === item.id ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="tertiary"
                  disabled={deletingId === item.id || bulkDeleting}
                  onClick={() => requestDelete([item.id])}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#B42318" }}
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {pendingDeleteIds.length > 0 ? (
        <Box
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 220,
            padding: 16,
          }}
          onClick={() => (!bulkDeleting ? setPendingDeleteIds([]) : null)}
        >
          <Box
            backgroundColor="default1"
            borderRadius={4}
            padding={6}
            display="flex"
            flexDirection="column"
            gap={4}
            style={{ width: "min(460px, 100%)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <Text size={5} fontWeight="bold">
              Delete media?
            </Text>
            <Text size={2} color="default2">
              {pendingDeleteIds.length === 1
                ? "This will permanently delete 1 selected image from storage and the media catalog."
                : `This will permanently delete ${pendingDeleteIds.length} selected images from storage and the media catalog.`}
            </Text>
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="secondary" disabled={bulkDeleting} onClick={() => setPendingDeleteIds([])}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={bulkDeleting}
                onClick={() => void confirmDelete()}
                style={{ background: "#B42318" }}
              >
                {bulkDeleting ? "Deleting..." : "Delete"}
              </Button>
            </Box>
          </Box>
        </Box>
      ) : null}

      {editing ? (
        <Box
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 16,
          }}
          onClick={() => (!savingEdit ? setEditing(null) : null)}
        >
          <Box
            backgroundColor="default1"
            borderRadius={4}
            padding={6}
            display="flex"
            flexDirection="column"
            gap={4}
            style={{ width: "min(480px, 100%)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <Text size={5} fontWeight="bold">
              Edit media
            </Text>
            <Text size={2} color="default2" style={{ wordBreak: "break-all" }}>
              {editing.fileName}
            </Text>
            <Box display="flex" flexDirection="column" gap={2}>
              <Text size={2}>Alt text</Text>
              <Input value={editAlt} onChange={(event) => setEditAlt(event.target.value)} />
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="secondary" disabled={savingEdit} onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={savingEdit} onClick={() => void saveEdit()}>
                {savingEdit ? "Saving..." : "Save"}
              </Button>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
