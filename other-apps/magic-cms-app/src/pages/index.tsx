
import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Layout, MessageSquare, Video, CheckCircle } from "lucide-react";
import type { SetupOpsJobSummary, SetupOpsJobType } from "@/lib/setup-ops-jobs";

const ModuleCard = ({ title, description, href, icon: Icon }: { title: string, description: string, href: string, icon?: any }) => {
  const router = useRouter();
  return (
    <Box
      borderStyle="solid"
      borderWidth={1}
      borderColor="default1"
      borderRadius={4}
      padding={6}
      display="flex"
      flexDirection="column"
      gap={4}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text as="h3" size={5} fontWeight="bold">
          {title}
        </Text>
        {Icon && <Icon size={24} />}
      </Box>
      <Text as="p" size={2} color="default2">
        {description}
      </Text>
      <Box marginTop="auto" paddingTop={4}>
        <Button variant="secondary" onClick={() => router.push(href)} style={{ width: "100%" }}>
          Manage
        </Button>
      </Box>
    </Box>
  );
};

export default function IndexPage() {
  const { appBridgeState } = useAppBridge();
  const [mounted, setMounted] = useState(false);
  const [setupStatus, setSetupStatus] = useState<"checking" | "idle" | "loading" | "success" | "error">("checking");
  const [setupMode, setSetupMode] = useState<"initialize" | "update" | "already_initialized">("initialize");
  const [setupLogs, setSetupLogs] = useState<string[]>([]);
  const [setupErrors, setSetupErrors] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [opsJobs, setOpsJobs] = useState<SetupOpsJobSummary[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState("");
  const [opsAction, setOpsAction] = useState<
    "backup" | "restore" | "cleanup-plan" | "cleanup-delete-all" | null
  >(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [expandedJobIds, setExpandedJobIds] = useState<string[]>([]);
  const [restoreSnapshotJobId, setRestoreSnapshotJobId] = useState("");

  const hasRunningOpsJob = useMemo(
    () => opsJobs.some((job) => job.status === "queued" || job.status === "running"),
    [opsJobs]
  );
  const backupJobs = useMemo(
    () =>
      opsJobs
        .filter((job) => job.type === "backup" && job.status === "completed" && job.snapshotAvailable)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [opsJobs],
  );

  const fetchSetupOpsJobs = useCallback(async () => {
    setOpsLoading(true);
    setOpsError("");
    try {
      const res = await fetch("/api/setup/ops?page=1&pageSize=10");
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || `Failed to load setup jobs (${res.status})`);
      }
      const payload = await res.json();
      setOpsJobs(payload.items || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load setup jobs.";
      setOpsError(message);
    } finally {
      setOpsLoading(false);
    }
  }, []);

  const detectSetupState = useCallback(async () => {
    if (!appBridgeState?.token || !appBridgeState?.saleorApiUrl) return;
    setSetupStatus("checking");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${appBridgeState.token}`,
        },
        body: JSON.stringify({
          saleorApiUrl: appBridgeState.saleorApiUrl,
          dryRun: true,
          cleanup: true,
        }),
      });
      const data = await res.json();
      setSetupMode(data.mode || "initialize");
      setHasPendingChanges(Boolean(data.hasPendingChanges));
      setSetupStatus("idle");
    } catch {
      setSetupStatus("idle");
    }
  }, [appBridgeState?.saleorApiUrl, appBridgeState?.token]);

  const createSetupOpsJob = useCallback(
    async (
      input: { type: SetupOpsJobType; dryRun?: boolean; snapshotJobId?: string },
      actionLabel: typeof opsAction,
    ) => {
      if (!appBridgeState?.token || !appBridgeState?.saleorApiUrl) return;
      setOpsError("");
      setOpsAction(actionLabel);
      try {
        const res = await fetch("/api/setup/ops", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${appBridgeState.token}`,
          },
          body: JSON.stringify({
            saleorApiUrl: appBridgeState.saleorApiUrl,
            type: input.type,
            dryRun: Boolean(input.dryRun),
            snapshotJobId: input.snapshotJobId,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.message || `Setup operation failed (${res.status})`);
        }
        await fetchSetupOpsJobs();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Setup operation failed.";
        setOpsError(message);
      } finally {
        setOpsAction(null);
        if (actionLabel === "cleanup-delete-all") {
          setConfirmDeleteAll(false);
        }
      }
    },
    [appBridgeState?.saleorApiUrl, appBridgeState?.token, fetchSetupOpsJobs, opsAction]
  );

  useEffect(() => {
    if (!backupJobs.length) {
      setRestoreSnapshotJobId("");
      return;
    }
    setRestoreSnapshotJobId((current) => (current ? current : backupJobs[0].id));
  }, [backupJobs]);

  const toggleJobLog = (jobId: string) => {
    setExpandedJobIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]
    );
  };

  const downloadBackupSnapshot = (jobId: string) => {
    const url = `/api/setup/ops/${jobId}/snapshot?download=1`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSetup = async () => {
    if (!appBridgeState?.token || !appBridgeState?.saleorApiUrl) return;
    setSetupStatus("loading");
    setSetupLogs([]);
    setSetupErrors([]);
    
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${appBridgeState.token}`,
        },
        body: JSON.stringify({
          saleorApiUrl: appBridgeState.saleorApiUrl,
          dryRun: false,
          cleanup: true,
        }),
      });
      const data = await res.json();
      
      setSetupLogs(data.steps || []);
      setSetupErrors(data.errors || []);
      setSetupMode(data.mode || "initialize");
      setHasPendingChanges(Boolean(data.hasPendingChanges));
      
      if (data.errors?.length > 0) {
        setSetupStatus("error");
      } else {
        setSetupStatus("success");
      }
      setShowLogs(true);
    } catch (e: any) {
      setSetupStatus("error");
      setSetupErrors([e.toString()]);
      setShowLogs(true);
    }
    await detectSetupState();
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (appBridgeState?.ready && appBridgeState?.token && appBridgeState?.saleorApiUrl) {
      void detectSetupState();
      void fetchSetupOpsJobs();
    }
  }, [
    appBridgeState?.ready,
    appBridgeState?.saleorApiUrl,
    appBridgeState?.token,
    detectSetupState,
    fetchSetupOpsJobs,
  ]);

  useEffect(() => {
    if (!hasRunningOpsJob) {
      return;
    }
    const timer = setInterval(() => {
      void fetchSetupOpsJobs();
    }, 2500);
    return () => clearInterval(timer);
  }, [fetchSetupOpsJobs, hasRunningOpsJob]);

  if (!mounted) return null;

  if (!appBridgeState?.ready) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Text>Loading app...</Text>
      </Box>
    );
  }

  const setupButtonLabel =
    setupStatus === "loading"
      ? setupMode === "update"
        ? "Updating Initialization..."
        : "Initializing..."
      : setupMode === "already_initialized" && !hasPendingChanges
        ? "Initialization Already Sucessfully"
        : setupMode === "update" || hasPendingChanges
          ? "One-Click Update Initialization"
          : "One-Click Initialization";

  const setupButtonVariant =
    setupMode === "already_initialized" && !hasPendingChanges ? "secondary" : "primary";

  return (
    <Box padding={8}>
      <Box marginBottom={8}>
        <Text as="h1" size={9} fontWeight="bold">
          Storefront Control Center
        </Text>
        <Text as="p" size={3} color="default2" marginTop={2}>
          Select a module below to start managing your dynamic content.
        </Text>
        {setupStatus === "checking" ? (
          <Text as="p" size={2} color="default2" marginTop={2}>
            Checking initialization state...
          </Text>
        ) : setupMode === "already_initialized" && !hasPendingChanges ? (
          <Text as="p" size={2} color="default2" marginTop={2}>
            Initialization state is up-to-date. No migration pending.
          </Text>
        ) : setupMode === "update" || hasPendingChanges ? (
          <Text as="p" size={2} color="default2" marginTop={2}>
            New migration detected. Run update initialization to sync latest schema.
          </Text>
        ) : (
          <Text as="p" size={2} color="default2" marginTop={2}>
            First-time initialization required for Magic CMS schema.
          </Text>
        )}
        <Box display="flex" gap={4} marginTop={4}>
            <Button
              onClick={handleSetup}
              variant={setupButtonVariant}
              disabled={setupStatus === "loading" || setupStatus === "checking"}
            >
                {setupButtonLabel}
            </Button>
            {setupStatus !== "idle" && (
                 <Button variant="tertiary" onClick={() => setShowLogs(!showLogs)}>
                    {showLogs ? "Hide Logs" : "Show Setup Logs"}
                 </Button>
            )}
        </Box>
      </Box>

      {showLogs && (
        <Box marginBottom={8} padding={4} backgroundColor="default2" borderRadius={4}>
          <Text as="h4" size={3} fontWeight="bold" marginBottom={2}>
            Initialization Logs
          </Text>
          {setupErrors.length > 0 && (
            <Box marginBottom={2}>
              <Text color="critical1" fontWeight="bold">
                Errors:
              </Text>
              {setupErrors.map((err, i) => (
                <Text key={i} as="p" size={2} color="critical1">
                  • {err}
                </Text>
              ))}
            </Box>
          )}
          {setupLogs.map((log, i) => (
            <Text key={i} as="p" size={2} color="default2">
              • {log}
            </Text>
          ))}
          {setupStatus === "success" && (
            <Box marginTop={2} display="flex" alignItems="center" gap={2}>
              <CheckCircle size={16} color="green" />
              <Text color="success1" fontWeight="bold">
                Setup Complete!
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box
        marginBottom={8}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        padding={5}
        display="flex"
        flexDirection="column"
        gap={4}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" __flexWrap="wrap" __rowGap="8px">
          <Text as="h3" size={5} fontWeight="bold">
            Setup Operations
          </Text>
          <Button variant="tertiary" onClick={() => void fetchSetupOpsJobs()} disabled={opsLoading}>
            {opsLoading ? "Refreshing..." : "Refresh Jobs"}
          </Button>
        </Box>
        <Text as="p" size={2} color="default2">
          Backup / restore / cleanup run in background jobs. Use cleanup plan before delete-all.
        </Text>
        <Box display="flex" gap={3} __flexWrap="wrap">
          <Button
            variant="secondary"
            disabled={Boolean(opsAction)}
            onClick={() => void createSetupOpsJob({ type: "backup" }, "backup")}
          >
            {opsAction === "backup" ? "Starting Backup..." : "Backup Managed Data"}
          </Button>
          <Button
            variant="secondary"
            disabled={Boolean(opsAction) || backupJobs.length === 0}
            onClick={() =>
              void createSetupOpsJob({ type: "restore", snapshotJobId: restoreSnapshotJobId }, "restore")
            }
          >
            {opsAction === "restore" ? "Starting Restore..." : "Restore Selected Backup"}
          </Button>
          <Button
            variant="secondary"
            disabled={Boolean(opsAction)}
            onClick={() => void createSetupOpsJob({ type: "cleanup", dryRun: true }, "cleanup-plan")}
          >
            {opsAction === "cleanup-plan" ? "Planning..." : "Plan Cleanup"}
          </Button>
          <Button
            variant={confirmDeleteAll ? "primary" : "tertiary"}
            disabled={Boolean(opsAction) && opsAction !== "cleanup-delete-all"}
            onClick={() => {
              if (!confirmDeleteAll) {
                setConfirmDeleteAll(true);
                return;
              }
              void createSetupOpsJob({ type: "cleanup", dryRun: false }, "cleanup-delete-all");
            }}
          >
            {opsAction === "cleanup-delete-all"
              ? "Deleting..."
              : confirmDeleteAll
                ? "Confirm Delete All"
                : "Delete All Managed Data"}
          </Button>
          {confirmDeleteAll && opsAction !== "cleanup-delete-all" && (
            <Button variant="tertiary" onClick={() => setConfirmDeleteAll(false)}>
              Cancel
            </Button>
          )}
        </Box>
        <Box display="flex" flexDirection="column" gap={2}>
          <Text as="p" size={2} fontWeight="bold">
            Restore Source Backup
          </Text>
          <select
            value={restoreSnapshotJobId}
            onChange={(event) => setRestoreSnapshotJobId(event.target.value)}
            disabled={backupJobs.length === 0 || Boolean(opsAction)}
            style={{ border: "1px solid #d5d7da", borderRadius: 8, padding: "9px 10px", minWidth: 320 }}
          >
            {backupJobs.length === 0 ? (
              <option value="">No completed backup snapshot available</option>
            ) : (
              backupJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.id} • {job.createdAt}
                </option>
              ))
            )}
          </select>
          <Text as="p" size={1} color="default2">
            Restore uses the selected backup snapshot. Run backup first if list is empty.
          </Text>
        </Box>
        {opsError && (
          <Text color="critical1" size={2}>
            {opsError}
          </Text>
        )}

        <Box display="flex" flexDirection="column" gap={3}>
          {opsJobs.length === 0 ? (
            <Text as="p" size={2} color="default2">
              No setup operation jobs yet.
            </Text>
          ) : (
            opsJobs.map((job) => {
              const isExpanded = expandedJobIds.includes(job.id);
              return (
                <Box
                  key={job.id}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={3}
                  padding={3}
                  display="flex"
                  flexDirection="column"
                  gap={2}
                >
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    __flexWrap="wrap"
                    __rowGap="8px"
                    __columnGap="8px"
                  >
                    <Text as="p" size={2} fontWeight="bold">
                      {job.type.toUpperCase()} • {job.status.toUpperCase()} {job.dryRun ? "• DRY RUN" : ""}
                    </Text>
                    <Box display="flex" gap={2} __flexWrap="wrap">
                      <Button variant="tertiary" onClick={() => toggleJobLog(job.id)}>
                        {isExpanded ? "Hide Logs" : "View Logs"}
                      </Button>
                      {job.snapshotAvailable && (
                        <Button variant="tertiary" onClick={() => downloadBackupSnapshot(job.id)}>
                          Download Snapshot
                        </Button>
                      )}
                    </Box>
                  </Box>
                  <Text as="p" size={1} color="default2">
                    Job: {job.id} • {job.createdAt}
                  </Text>
                  <Text as="p" size={1} color="default2">
                    Steps: {job.stepCount} • Errors: {job.errorCount}
                    {job.snapshotJobId ? ` • Snapshot Source: ${job.snapshotJobId}` : ""}
                  </Text>

                  {isExpanded && (
                    <Box
                      marginTop={2}
                      borderStyle="solid"
                      borderWidth={1}
                      borderColor="default1"
                      borderRadius={3}
                      padding={3}
                      display="flex"
                      flexDirection="column"
                      gap={2}
                      __maxHeight="220px"
                      __overflowY="auto"
                    >
                      {job.errors.length > 0 && (
                        <Box display="flex" flexDirection="column" gap={1}>
                          <Text size={1} color="critical1" fontWeight="bold">
                            Errors
                          </Text>
                          {job.errors.map((entry, index) => (
                            <Text key={`${job.id}-err-${index}`} size={1} color="critical1">
                              • {entry}
                            </Text>
                          ))}
                        </Box>
                      )}
                      {job.steps.length > 0 && (
                        <Box display="flex" flexDirection="column" gap={1}>
                          <Text size={1} fontWeight="bold">
                            Steps
                          </Text>
                          {job.steps.map((entry, index) => (
                            <Text key={`${job.id}-step-${index}`} size={1} color="default2">
                              • {entry}
                            </Text>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </Box>

      <Box
        display="grid"
        gap={6}
        __gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))"
      >
        <ModuleCard
          title="Analytics"
          description="View impressions, clicks, and engagement sets."
          href="/analytics"
          icon={BarChart3}
        />
        <ModuleCard
          title="Widgets"
          description="Manage sliders, banners, and reusable content sections."
          href="/widgets"
          icon={Layout}
        />
        <ModuleCard
          title="Reviews"
          description="Moderate and manage product reviews and ratings."
          href="/reviews"
          icon={MessageSquare}
        />
        <ModuleCard
          title="Shoppable Videos"
          description="Manage videos with tagged products and display rules."
          href="/videos"
          icon={Video}
        />
      </Box>
    </Box>
  );
}
