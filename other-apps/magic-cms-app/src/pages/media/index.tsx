import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Input, Spinner, Text } from "@saleor/macaw-ui";
import { Copy, Edit, Eye, Image as ImageIcon, Trash2, Upload } from "lucide-react";
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
  status: UploadStatus;
  error: string;
};

const PAGE_SIZE = 20;

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export default function MediaPage() {
  const { appBridgeState } = useAppBridge();
  const token = appBridgeState?.token || "";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [editDisplayName, setEditDisplayName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

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
        setItems(payload.items || []);
        setPage(payload.page || nextPage);
        setTotal(payload.total || 0);
        setTotalPages(payload.totalPages || 1);
        setHasPrev(Boolean(payload.hasPrev));
        setHasNext(Boolean(payload.hasNext));
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

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length || !token) return;

    for (const file of list) {
      const localId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setQueue((prev) => [
        { id: localId, fileName: file.name, status: "uploading", error: "" },
        ...prev,
      ]);

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
        setQueue((prev) =>
          prev.map((item) => (item.id === localId ? { ...item, status: "done" } : item)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        setQueue((prev) =>
          prev.map((item) =>
            item.id === localId ? { ...item, status: "failed", error: message } : item,
          ),
        );
      }
    }

    await loadPage(1);
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      void uploadFiles(event.target.files);
      event.target.value = "";
    }
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
    setEditDisplayName(item.fileName.replace(/^bymagic-media-/, "").replace(/_[a-z0-9]+\.webp$/i, ""));
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
          displayName: editDisplayName,
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

  const deleteItem = async (item: MagicMediaItem) => {
    if (!token) return;
    const confirmed = window.confirm(`Delete ${item.fileName}? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/media/item?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || "Unable to delete media.");
      }
      await loadPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete media.");
    } finally {
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
            Upload images (auto WebP). Files are stored as cleaned `bymagic-media-*` names and indexed in
            `magic-media/magic-media.json`.
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
            void uploadFiles(event.dataTransfer.files);
          }
        }}
      >
        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
          <Upload size={28} />
          <Text size={4} fontWeight="bold">
            Drag & drop images here
          </Text>
          <Text size={2} color="default2">
            JPG / PNG / WebP / GIF · max 12MB · converted to high-quality WebP
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
        <Box display="flex" flexDirection="column" gap={2}>
          {queue.slice(0, 6).map((item) => (
            <Box
              key={item.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              padding={3}
              borderRadius={3}
              style={{ background: "#FAFAFA" }}
            >
              <Text size={2}>
                {item.fileName} — {item.status}
                {item.error ? ` (${item.error})` : ""}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {error ? (
        <Box padding={4} borderRadius={3} style={{ background: "#FEECEC" }}>
          <Text size={2} color="critical1">
            {error}
          </Text>
        </Box>
      ) : null}

      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text size={3} color="default2">
          {total === 0
            ? "No media yet"
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </Text>
        <Box display="flex" gap={2} alignItems="center">
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
            Upload your first image to populate the library.
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
            >
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
                  disabled={deletingId === item.id}
                  onClick={() => void deleteItem(item)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#B42318" }}
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}

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
            <Box display="flex" flexDirection="column" gap={2}>
              <Text size={2}>Display name (cleaned to bymagic-media-*)</Text>
              <Input value={editDisplayName} onChange={(event) => setEditDisplayName(event.target.value)} />
            </Box>
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
