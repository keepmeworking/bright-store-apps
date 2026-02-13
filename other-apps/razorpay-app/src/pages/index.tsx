/**
 * Razorpay App Dashboard
 *
 * Production-ready settings UI with tabs:
 * - Settings: API keys, mode, payment action, magic checkout
 * - Logs: Transaction history
 * - Status: Connection health, webhook info
 */

import { NextPage } from "next";
import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { useEffect, useState, useCallback } from "react";
import { Box, Button, Text, Input } from "@saleor/macaw-ui";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface MaskedSettings {
  enabled: boolean;
  title: string;
  description: string;
  mode: "test" | "live";
  testKeyId: string;
  testKeySecret: string;
  testWebhookSecret: string;
  liveKeyId: string;
  liveKeySecret: string;
  liveWebhookSecret: string;
  paymentAction: "authorize" | "authorize_capture";
  magicCheckout: boolean;
  debugMode: boolean;
  updatedAt: string;
  hasTestKeys: boolean;
  hasLiveKeys: boolean;
}

interface LogEntry {
  timestamp: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  saleorOrderId?: string;
  error?: string;
  mode: string;
}

interface ConnectionResult {
  success: boolean;
  mode?: string;
  message: string;
  details?: {
    totalPayments: number;
    enabled: boolean;
    paymentAction: string;
    magicCheckout: boolean;
  };
  error?: string;
}

type Tab = "settings" | "logs" | "status";

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const styles = {
  container: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: "900px",
    margin: "0 auto",
    padding: "24px",
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "2px solid #e5e7eb",
  } as React.CSSProperties,
  logo: {
    width: "40px",
    height: "40px",
    borderRadius: "8px",
    background: "linear-gradient(135deg, #2563eb, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontWeight: "bold",
    fontSize: "18px",
  } as React.CSSProperties,
  tabs: {
    display: "flex",
    gap: "4px",
    marginBottom: "24px",
    background: "#f3f4f6",
    padding: "4px",
    borderRadius: "8px",
  } as React.CSSProperties,
  tab: (active: boolean) =>
    ({
      padding: "10px 20px",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontWeight: 500,
      fontSize: "14px",
      transition: "all 0.2s",
      background: active ? "white" : "transparent",
      color: active ? "#1f2937" : "#6b7280",
      boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
    }) as React.CSSProperties,
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "16px",
    background: "white",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#1f2937",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  field: {
    marginBottom: "16px",
  } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
    marginBottom: "4px",
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
    fontFamily: "monospace",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  select: {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
    background: "white",
    cursor: "pointer",
  } as React.CSSProperties,
  toggle: (active: boolean) =>
    ({
      width: "44px",
      height: "24px",
      borderRadius: "12px",
      border: "none",
      cursor: "pointer",
      position: "relative" as const,
      transition: "background 0.2s",
      background: active ? "#2563eb" : "#d1d5db",
    }) as React.CSSProperties,
  toggleDot: (active: boolean) =>
    ({
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      background: "white",
      position: "absolute" as const,
      top: "3px",
      left: active ? "23px" : "3px",
      transition: "left 0.2s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    }) as React.CSSProperties,
  modeToggle: {
    display: "flex",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid #d1d5db",
  } as React.CSSProperties,
  modeBtn: (active: boolean, isLive: boolean) =>
    ({
      flex: 1,
      padding: "10px 16px",
      border: "none",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: "14px",
      transition: "all 0.2s",
      background: active
        ? isLive
          ? "#dc2626"
          : "#2563eb"
        : "#f9fafb",
      color: active ? "white" : "#6b7280",
    }) as React.CSSProperties,
  btn: (variant: "primary" | "secondary" | "danger") =>
    ({
      padding: "10px 20px",
      borderRadius: "8px",
      border:
        variant === "secondary" ? "1px solid #d1d5db" : "none",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: "14px",
      transition: "all 0.2s",
      background:
        variant === "primary"
          ? "#2563eb"
          : variant === "danger"
            ? "#dc2626"
            : "white",
      color:
        variant === "primary" || variant === "danger"
          ? "white"
          : "#374151",
    }) as React.CSSProperties,
  badge: (type: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      success: { bg: "#dcfce7", text: "#166534" },
      failed: { bg: "#fee2e2", text: "#991b1b" },
      pending: { bg: "#fef9c3", text: "#854d0e" },
      test: { bg: "#dbeafe", text: "#1e40af" },
      live: { bg: "#fee2e2", text: "#991b1b" },
      initialize: { bg: "#e0e7ff", text: "#3730a3" },
      charge: { bg: "#dcfce7", text: "#166534" },
      refund: { bg: "#fef3c7", text: "#92400e" },
      webhook: { bg: "#f3e8ff", text: "#6b21a8" },
    };
    const c = colors[type] || { bg: "#f3f4f6", text: "#374151" };
    return {
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: 600,
      background: c.bg,
      color: c.text,
    } as React.CSSProperties;
  },
  statusDot: (ok: boolean) =>
    ({
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      background: ok ? "#22c55e" : "#ef4444",
      display: "inline-block",
    }) as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px",
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "10px 8px",
    borderBottom: "2px solid #e5e7eb",
    color: "#6b7280",
    fontWeight: 600,
    fontSize: "12px",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  td: {
    padding: "10px 8px",
    borderBottom: "1px solid #f3f4f6",
    color: "#374151",
  } as React.CSSProperties,
  alert: (type: "info" | "warning" | "error" | "success") => {
    const colors = {
      info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" },
      warning: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
      error: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
      success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
    };
    const c = colors[type];
    return {
      padding: "12px 16px",
      borderRadius: "8px",
      border: `1px solid ${c.border}`,
      background: c.bg,
      color: c.text,
      fontSize: "14px",
      marginBottom: "16px",
    } as React.CSSProperties;
  },
  row: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  } as React.CSSProperties,
  flexBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div style={{ ...styles.flexBetween, marginBottom: "12px" }}>
      <span style={styles.label}>{label}</span>
      <button
        type="button"
        style={styles.toggle(checked)}
        onClick={() => onChange(!checked)}
        aria-label={label}
      >
        <div style={styles.toggleDot(checked)} />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const IndexPage: NextPage = () => {
  const { appBridge, appBridgeState } = useAppBridge();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("settings");

  // Settings state
  const [settings, setSettings] = useState<MaskedSettings | null>(null);
  const [editSettings, setEditSettings] = useState<Partial<MaskedSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // New keys (only populated when user types new values)
  const [newKeys, setNewKeys] = useState({
    testKeyId: "",
    testKeySecret: "",
    testWebhookSecret: "",
    liveKeyId: "",
    liveKeySecret: "",
    liveWebhookSecret: "",
  });

  // Connection test state
  const [connectionResult, setConnectionResult] =
    useState<ConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // API CALLS
  // ─────────────────────────────────────────────────────────────────────────

  const apiHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      "authorization-bearer": appBridgeState?.token || "",
      "saleor-api-url": appBridgeState?.saleorApiUrl || "",
    }),
    [appBridgeState]
  );

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setEditSettings(data);
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }, [apiHeaders]);

  const saveSettingsHandler = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const body: Record<string, unknown> = { ...editSettings };

      // Only send new keys if user typed them
      if (newKeys.testKeyId) body.testKeyId = newKeys.testKeyId;
      if (newKeys.testKeySecret) body.testKeySecret = newKeys.testKeySecret;
      if (newKeys.testWebhookSecret) body.testWebhookSecret = newKeys.testWebhookSecret;
      if (newKeys.liveKeyId) body.liveKeyId = newKeys.liveKeyId;
      if (newKeys.liveKeySecret) body.liveKeySecret = newKeys.liveKeySecret;
      if (newKeys.liveWebhookSecret) body.liveWebhookSecret = newKeys.liveWebhookSecret;

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const { settings: saved } = await res.json();
        setSettings(saved);
        setEditSettings(saved);
        setNewKeys({
          testKeyId: "",
          testKeySecret: "",
          testWebhookSecret: "",
          liveKeyId: "",
          liveKeySecret: "",
          liveWebhookSecret: "",
        });
        setSaveMsg("Settings saved successfully!");
        setTimeout(() => setSaveMsg(""), 3000);
      } else {
        const err = await res.json();
        setSaveMsg(`Error: ${err.error}`);
      }
    } catch (e) {
      setSaveMsg("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setConnectionResult(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: apiHeaders(),
      });
      const data = await res.json();
      setConnectionResult(data);
    } catch (e) {
      setConnectionResult({
        success: false,
        message: "Network error",
        error: "Could not reach the server",
      });
    } finally {
      setTesting(false);
    }
  };

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/logs?limit=50", {
        headers: apiHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    } finally {
      setLogsLoading(false);
    }
  }, [apiHeaders]);

  // Load settings on mount
  useEffect(() => {
    if (mounted && appBridgeState?.token) {
      fetchSettings();
    }
  }, [mounted, appBridgeState?.token, fetchSettings]);

  // Load logs when tab switches
  useEffect(() => {
    if (activeTab === "logs" && appBridgeState?.token) {
      fetchLogs();
    }
  }, [activeTab, appBridgeState?.token, fetchLogs]);

  if (!mounted) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: SETTINGS TAB
  // ─────────────────────────────────────────────────────────────────────────

  const renderSettings = () => (
    <>
      {/* Master Enable */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>⚡ Gateway Status</div>
        <Toggle
          label="Enable Razorpay Payment Gateway"
          checked={editSettings.enabled || false}
          onChange={(v) => setEditSettings({ ...editSettings, enabled: v })}
        />
        <p style={{ fontSize: "12px", color: "#9ca3af", margin: 0 }}>
          When disabled, Razorpay will not appear as a payment option.
        </p>
      </div>

      {/* Mode Toggle */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          🔄 Payment Mode
          <span style={styles.badge(editSettings.mode || "test")}>
            {editSettings.mode?.toUpperCase()}
          </span>
        </div>
        <div style={styles.modeToggle}>
          <button
            type="button"
            style={styles.modeBtn(editSettings.mode === "test", false)}
            onClick={() =>
              setEditSettings({ ...editSettings, mode: "test" })
            }
          >
            🧪 Test Mode
          </button>
          <button
            type="button"
            style={styles.modeBtn(editSettings.mode === "live", true)}
            onClick={() =>
              setEditSettings({ ...editSettings, mode: "live" })
            }
          >
            🔴 Live Mode
          </button>
        </div>
        {editSettings.mode === "live" && (
          <div style={{ ...styles.alert("warning"), marginTop: "12px" }}>
            ⚠️ <strong>Live Mode:</strong> Real money will be charged. Make
            sure your live API keys are correct.
          </div>
        )}
      </div>

      {/* Test API Keys */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          🧪 Test Mode API Keys
          {settings?.hasTestKeys && (
            <span style={styles.badge("success")}>✓ Configured</span>
          )}
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Test Key ID</label>
          <input
            style={styles.input}
            placeholder={settings?.testKeyId || "rzp_test_..."}
            value={newKeys.testKeyId}
            onChange={(e) =>
              setNewKeys({ ...newKeys, testKeyId: e.target.value })
            }
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Test Key Secret</label>
          <input
            style={styles.input}
            type="password"
            placeholder={
              settings?.hasTestKeys
                ? "••••••••  (leave blank to keep)"
                : "Enter test key secret"
            }
            value={newKeys.testKeySecret}
            onChange={(e) =>
              setNewKeys({ ...newKeys, testKeySecret: e.target.value })
            }
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Test Webhook Secret</label>
          <input
            style={styles.input}
            type="password"
            placeholder={
              settings?.testWebhookSecret
                ? "••••••••  (leave blank to keep)"
                : "Enter test webhook secret"
            }
            value={newKeys.testWebhookSecret}
            onChange={(e) =>
              setNewKeys({ ...newKeys, testWebhookSecret: e.target.value })
            }
          />
        </div>
      </div>

      {/* Live API Keys */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          🔴 Live Mode API Keys
          {settings?.hasLiveKeys && (
            <span style={styles.badge("success")}>✓ Configured</span>
          )}
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Live Key ID</label>
          <input
            style={styles.input}
            placeholder={settings?.liveKeyId || "rzp_live_..."}
            value={newKeys.liveKeyId}
            onChange={(e) =>
              setNewKeys({ ...newKeys, liveKeyId: e.target.value })
            }
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Live Key Secret</label>
          <input
            style={styles.input}
            type="password"
            placeholder={
              settings?.hasLiveKeys
                ? "••••••••  (leave blank to keep)"
                : "Enter live key secret"
            }
            value={newKeys.liveKeySecret}
            onChange={(e) =>
              setNewKeys({ ...newKeys, liveKeySecret: e.target.value })
            }
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Live Webhook Secret</label>
          <input
            style={styles.input}
            type="password"
            placeholder={
              settings?.liveWebhookSecret
                ? "••••••••  (leave blank to keep)"
                : "Enter live webhook secret"
            }
            value={newKeys.liveWebhookSecret}
            onChange={(e) =>
              setNewKeys({ ...newKeys, liveWebhookSecret: e.target.value })
            }
          />
        </div>
      </div>

      {/* Payment Options */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>💳 Payment Options</div>

        <div style={styles.field}>
          <label style={styles.label}>Customer-facing Title</label>
          <input
            style={styles.input}
            value={editSettings.title || ""}
            onChange={(e) =>
              setEditSettings({ ...editSettings, title: e.target.value })
            }
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Description</label>
          <input
            style={styles.input}
            value={editSettings.description || ""}
            onChange={(e) =>
              setEditSettings({
                ...editSettings,
                description: e.target.value,
              })
            }
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Payment Action</label>
          <select
            style={styles.select}
            value={editSettings.paymentAction || "authorize_capture"}
            onChange={(e) =>
              setEditSettings({
                ...editSettings,
                paymentAction: e.target.value as
                  | "authorize"
                  | "authorize_capture",
              })
            }
          >
            <option value="authorize_capture">
              Authorize & Capture (Recommended)
            </option>
            <option value="authorize">Authorize Only</option>
          </select>
          <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
            "Authorize Only" holds the payment for manual capture later.
          </p>
        </div>

        <Toggle
          label="Enable Magic Checkout"
          checked={editSettings.magicCheckout || false}
          onChange={(v) =>
            setEditSettings({ ...editSettings, magicCheckout: v })
          }
        />

        <Toggle
          label="Debug Mode (detailed logging)"
          checked={editSettings.debugMode || false}
          onChange={(v) =>
            setEditSettings({ ...editSettings, debugMode: v })
          }
        />
      </div>

      {/* Save */}
      {saveMsg && (
        <div
          style={styles.alert(
            saveMsg.startsWith("Error") ? "error" : "success"
          )}
        >
          {saveMsg}
        </div>
      )}
      <div style={{ display: "flex", gap: "12px" }}>
        <button
          type="button"
          style={{
            ...styles.btn("primary"),
            opacity: saving ? 0.7 : 1,
          }}
          onClick={saveSettingsHandler}
          disabled={saving}
        >
          {saving ? "💾 Saving..." : "💾 Save Settings"}
        </button>
        <button
          type="button"
          style={styles.btn("secondary")}
          onClick={fetchSettings}
        >
          🔄 Reset
        </button>
      </div>
    </>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: LOGS TAB
  // ─────────────────────────────────────────────────────────────────────────

  const renderLogs = () => (
    <>
      <div style={styles.flexBetween}>
        <div style={styles.cardTitle}>📋 Transaction History</div>
        <button
          type="button"
          style={styles.btn("secondary")}
          onClick={fetchLogs}
          disabled={logsLoading}
        >
          {logsLoading ? "Loading..." : "🔄 Refresh"}
        </button>
      </div>

      {logs.length === 0 ? (
        <div
          style={{
            ...styles.card,
            textAlign: "center",
            padding: "40px",
            color: "#9ca3af",
          }}
        >
          <p style={{ fontSize: "48px", margin: "0 0 8px" }}>📭</p>
          <p>No transactions yet</p>
          <p style={{ fontSize: "13px" }}>
            Transactions will appear here once payments are processed.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Amount</th>
                <th style={styles.th}>Razorpay ID</th>
                <th style={styles.th}>Mode</th>
                <th style={styles.th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 0 ? "white" : "#f9fafb",
                  }}
                >
                  <td style={styles.td}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge(log.type)}>{log.type}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge(log.status)}>
                      {log.status}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {log.currency} {log.amount?.toFixed(2)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      fontFamily: "monospace",
                      fontSize: "12px",
                    }}
                  >
                    {log.razorpayPaymentId || log.razorpayOrderId || "—"}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge(log.mode)}>{log.mode}</span>
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: "#ef4444",
                      maxWidth: "200px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {log.error || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: STATUS TAB
  // ─────────────────────────────────────────────────────────────────────────

  const renderStatus = () => (
    <>
      {/* Connection Test */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>🔌 Connection Test</div>
        <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
          Verify that your Razorpay API keys are correct and the connection is
          working.
        </p>
        <button
          type="button"
          style={{
            ...styles.btn("primary"),
            opacity: testing ? 0.7 : 1,
          }}
          onClick={testConnection}
          disabled={testing}
        >
          {testing ? "⏳ Testing..." : "🔗 Test Connection"}
        </button>

        {connectionResult && (
          <div
            style={{
              ...styles.alert(connectionResult.success ? "success" : "error"),
              marginTop: "16px",
            }}
          >
            <strong>{connectionResult.success ? "✅" : "❌"}</strong>{" "}
            {connectionResult.message}
            {connectionResult.details && (
              <div style={{ marginTop: "8px", fontSize: "13px" }}>
                <div>
                  Mode:{" "}
                  <span
                    style={styles.badge(connectionResult.mode || "test")}
                  >
                    {connectionResult.mode}
                  </span>
                </div>
                <div>
                  Payment Action: {connectionResult.details.paymentAction}
                </div>
                <div>
                  Magic Checkout:{" "}
                  {connectionResult.details.magicCheckout
                    ? "Enabled"
                    : "Disabled"}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Webhook Status */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>🪝 Registered Webhooks</div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Webhook</th>
              <th style={styles.th}>Path</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              {
                name: "Transaction Initialize",
                path: "/api/webhooks/transaction-initialize",
              },
              {
                name: "Transaction Charge",
                path: "/api/webhooks/transaction-charge-requested",
              },
              {
                name: "Transaction Refund",
                path: "/api/webhooks/transaction-refund-requested",
              },
              {
                name: "Razorpay Webhook",
                path: "/api/webhooks/razorpay",
              },
            ].map((wh, i) => (
              <tr key={i}>
                <td style={styles.td}>{wh.name}</td>
                <td
                  style={{
                    ...styles.td,
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                >
                  {wh.path}
                </td>
                <td style={styles.td}>
                  <span style={styles.statusDot(true)} /> Registered
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* App Info */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>ℹ️ App Information</div>
        <div
          style={{ display: "grid", gap: "8px", fontSize: "13px" }}
        >
          <div style={styles.flexBetween}>
            <span style={{ color: "#6b7280" }}>App ID</span>
            <code>razorpay.app</code>
          </div>
          <div style={styles.flexBetween}>
            <span style={{ color: "#6b7280" }}>Saleor URL</span>
            <code>
              {appBridgeState?.saleorApiUrl || "Not connected"}
            </code>
          </div>
          <div style={styles.flexBetween}>
            <span style={{ color: "#6b7280" }}>Last Updated</span>
            <span>
              {settings?.updatedAt
                ? new Date(settings.updatedAt).toLocaleString()
                : "Never"}
            </span>
          </div>
          <div style={styles.flexBetween}>
            <span style={{ color: "#6b7280" }}>Gateway Mode</span>
            <span style={styles.badge(settings?.mode || "test")}>
              {settings?.mode?.toUpperCase() || "TEST"}
            </span>
          </div>
        </div>
      </div>
    </>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: MAIN
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>₹</div>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "20px",
              color: "#1f2937",
            }}
          >
            Razorpay Payment Gateway
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              color: "#6b7280",
            }}
          >
            Accept payments via Credit Card, Debit Card, UPI, Net Banking & more
          </p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span style={styles.badge(settings?.enabled ? "success" : "failed")}>
            {settings?.enabled ? "● Active" : "○ Inactive"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          type="button"
          style={styles.tab(activeTab === "settings")}
          onClick={() => setActiveTab("settings")}
        >
          ⚙️ Settings
        </button>
        <button
          type="button"
          style={styles.tab(activeTab === "logs")}
          onClick={() => setActiveTab("logs")}
        >
          📋 Logs
        </button>
        <button
          type="button"
          style={styles.tab(activeTab === "status")}
          onClick={() => setActiveTab("status")}
        >
          📊 Status
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "settings" && renderSettings()}
      {activeTab === "logs" && renderLogs()}
      {activeTab === "status" && renderStatus()}
    </div>
  );
};

export default IndexPage;
