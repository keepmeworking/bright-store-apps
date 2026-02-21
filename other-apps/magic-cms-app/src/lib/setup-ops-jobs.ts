import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, fetchExchange } from "urql";
import {
  cleanupManagedData,
  createManagedBackupSnapshot,
  restoreManagedBackupSnapshot,
  type SetupBackupSnapshot,
} from "./setup";
import { normalizeSaleorApiUrl } from "./saleor-api-url";

export type SetupOpsJobType = "backup" | "restore" | "cleanup";
export type SetupOpsJobStatus = "queued" | "running" | "completed" | "failed";

type SetupOpsPayload = {
  saleorApiUrl: string;
  token: string;
  type: SetupOpsJobType;
  dryRun?: boolean;
  snapshotJobId?: string;
};

export type SetupOpsJobSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  type: SetupOpsJobType;
  status: SetupOpsJobStatus;
  dryRun: boolean;
  stepCount: number;
  errorCount: number;
  steps: string[];
  errors: string[];
  snapshotJobId?: string;
  snapshotAvailable?: boolean;
};

type SetupOpsJobStore = {
  jobs: SetupOpsJobSummary[];
};

const DATA_ROOT = path.join(process.cwd(), ".data", "setup-ops-jobs");
const STORE_FILE = path.join(DATA_ROOT, "jobs.json");
const PAYLOAD_DIR = path.join(DATA_ROOT, "payloads");
const SNAPSHOT_DIR = path.join(DATA_ROOT, "snapshots");

const WORKER_STATE = globalThis as typeof globalThis & {
  __magicSetupOpsWorkerRunning?: boolean;
};

const nowIso = () => new Date().toISOString();
const createJobId = () => `sj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const payloadFilePath = (jobId: string) => path.join(PAYLOAD_DIR, `${jobId}.json`);
const snapshotFilePath = (jobId: string) => path.join(SNAPSHOT_DIR, `${jobId}.json`);

const ensureStoreReady = async () => {
  await mkdir(DATA_ROOT, { recursive: true });
  await mkdir(PAYLOAD_DIR, { recursive: true });
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  try {
    await readFile(STORE_FILE, "utf8");
  } catch {
    await writeFile(STORE_FILE, JSON.stringify({ jobs: [] }, null, 2), "utf8");
  }
};

const readStore = async (): Promise<SetupOpsJobStore> => {
  await ensureStoreReady();
  const raw = await readFile(STORE_FILE, "utf8");
  try {
    return JSON.parse(raw) as SetupOpsJobStore;
  } catch {
    return { jobs: [] };
  }
};

const writeStore = async (store: SetupOpsJobStore) => {
  await ensureStoreReady();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
};

const updateJob = async (
  id: string,
  updater: (current: SetupOpsJobSummary) => SetupOpsJobSummary
) => {
  const store = await readStore();
  const nextJobs = store.jobs.map((job) => (job.id === id ? updater(job) : job));
  await writeStore({ jobs: nextJobs });
};

const getLatestCompletedBackupJobId = (jobs: SetupOpsJobSummary[]) =>
  jobs
    .filter((job) => job.type === "backup" && job.status === "completed" && job.snapshotAvailable)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;

export const createSetupOpsJob = async (payload: SetupOpsPayload) => {
  const store = await readStore();
  const id = createJobId();
  const createdAt = nowIso();
  const resolvedSnapshotJobId =
    payload.type === "restore"
      ? payload.snapshotJobId || getLatestCompletedBackupJobId(store.jobs) || ""
      : undefined;

  const summary: SetupOpsJobSummary = {
    id,
    createdAt,
    updatedAt: createdAt,
    type: payload.type,
    status: "queued",
    dryRun: Boolean(payload.dryRun),
    stepCount: 0,
    errorCount: 0,
    steps: [],
    errors: [],
    snapshotJobId: resolvedSnapshotJobId,
    snapshotAvailable: false,
  };

  store.jobs.unshift(summary);
  await writeStore(store);
  await writeFile(
    payloadFilePath(id),
    JSON.stringify({ ...payload, snapshotJobId: resolvedSnapshotJobId }, null, 2),
    "utf8"
  );
  return summary;
};

export const listSetupOpsJobs = async (page: number, pageSize: number) => {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(50, Math.max(1, pageSize));
  const store = await readStore();
  const sorted = [...store.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = sorted.length;
  const offset = (safePage - 1) * safePageSize;
  const items = sorted.slice(offset, offset + safePageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
};

export const getSetupOpsJob = async (id: string) => {
  const store = await readStore();
  return store.jobs.find((job) => job.id === id) || null;
};

export const getSetupOpsSnapshot = async (id: string): Promise<SetupBackupSnapshot | null> => {
  try {
    const raw = await readFile(snapshotFilePath(id), "utf8");
    return JSON.parse(raw) as SetupBackupSnapshot;
  } catch {
    return null;
  }
};

const finalizeJob = async (
  id: string,
  data: { status: SetupOpsJobStatus; steps: string[]; errors: string[]; snapshotAvailable?: boolean }
) => {
  await updateJob(id, (current) => ({
    ...current,
    status: data.status,
    steps: data.steps.slice(0, 500),
    errors: data.errors.slice(0, 200),
    stepCount: data.steps.length,
    errorCount: data.errors.length,
    snapshotAvailable: data.snapshotAvailable ?? current.snapshotAvailable,
    finishedAt: nowIso(),
    updatedAt: nowIso(),
  }));
};

const processSetupOpsJob = async (summary: SetupOpsJobSummary) => {
  const payloadRaw = await readFile(payloadFilePath(summary.id), "utf8");
  const payload = JSON.parse(payloadRaw) as SetupOpsPayload;

  await updateJob(summary.id, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt || nowIso(),
    updatedAt: nowIso(),
  }));

  const client = createClient({
    url: normalizeSaleorApiUrl(payload.saleorApiUrl),
    fetchOptions: {
      headers: { Authorization: `Bearer ${payload.token}` },
    },
    exchanges: [fetchExchange],
  });

  if (payload.type === "backup") {
    const backup = await createManagedBackupSnapshot(client);
    await writeFile(snapshotFilePath(summary.id), JSON.stringify(backup.snapshot, null, 2), "utf8");
    await finalizeJob(summary.id, {
      status: backup.result.errors.length ? "failed" : "completed",
      steps: backup.result.steps,
      errors: backup.result.errors,
      snapshotAvailable: true,
    });
    return;
  }

  if (payload.type === "restore") {
    const sourceJobId = payload.snapshotJobId;
    if (!sourceJobId) {
      await finalizeJob(summary.id, {
        status: "failed",
        steps: [],
        errors: ["Restore failed: backup snapshot source was not provided and none was found."],
      });
      return;
    }
    const snapshot = await getSetupOpsSnapshot(sourceJobId);
    if (!snapshot) {
      await finalizeJob(summary.id, {
        status: "failed",
        steps: [],
        errors: [`Restore failed: backup snapshot for job ${sourceJobId} not found.`],
      });
      return;
    }

    const restore = await restoreManagedBackupSnapshot(client, snapshot, { dryRun: Boolean(payload.dryRun) });
    await finalizeJob(summary.id, {
      status: restore.errors.length ? "failed" : "completed",
      steps: restore.steps,
      errors: restore.errors,
    });
    return;
  }

  const cleanup = await cleanupManagedData(client, { dryRun: Boolean(payload.dryRun) });
  await finalizeJob(summary.id, {
    status: cleanup.errors.length ? "failed" : "completed",
    steps: cleanup.steps,
    errors: cleanup.errors,
  });
};

const processSetupOpsQueue = async () => {
  if (WORKER_STATE.__magicSetupOpsWorkerRunning) {
    return;
  }
  WORKER_STATE.__magicSetupOpsWorkerRunning = true;

  try {
    while (true) {
      const store = await readStore();
      const nextJob = store.jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

      if (!nextJob) {
        break;
      }

      try {
        await processSetupOpsJob(nextJob);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Setup operation crashed unexpectedly.";
        await finalizeJob(nextJob.id, {
          status: "failed",
          steps: [],
          errors: [message],
        });
      }
    }
  } finally {
    WORKER_STATE.__magicSetupOpsWorkerRunning = false;
  }
};

export const startSetupOpsWorker = () => {
  void processSetupOpsQueue();
};

