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
import { Box, Button, Text, Input, Checkbox, Select } from "@saleor/macaw-ui";

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

// Styles removed in favor of Macaw UI props

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
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Master Enable */}
      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>⚡ Gateway Status</Text>
        <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
          <Text>Enable Razorpay Payment Gateway</Text>
          <Checkbox
            checked={editSettings.enabled || false}
            onCheckedChange={(v) => setEditSettings({ ...editSettings, enabled: !!v })}
          />
        </Box>
        <Text size={2}>
          When disabled, Razorpay will not appear as a payment option.
        </Text>
      </Box>

      {/* Mode Toggle */}
      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
          <Text as="h2" size={6} fontWeight="bold">🔄 Payment Mode</Text>
          <Box paddingX={2} paddingY={1} backgroundColor={editSettings.mode === "live" ? "critical1" : "info1"} borderRadius={2}>
            <Text size={1}>
              {editSettings.mode?.toUpperCase()}
            </Text>
          </Box>
        </Box>
        <Box display="flex" gap={2} marginBottom={4}>
          <Button
            variant={editSettings.mode === "test" ? "primary" : "secondary"}
            onClick={() => setEditSettings({ ...editSettings, mode: "test" })}
          >
            🧪 Test Mode
          </Button>
          <Button
            variant={editSettings.mode === "live" ? "tertiary" : "secondary"}
            onClick={() => setEditSettings({ ...editSettings, mode: "live" })}
          >
            🔴 Live Mode
          </Button>
        </Box>
        {editSettings.mode === "live" && (
          <Box padding={4} backgroundColor="warning1" borderRadius={2} borderStyle="solid" borderWidth={1} borderColor="warning1">
            <Text>
              ⚠️ <strong>Live Mode:</strong> Real money will be charged. Make
              sure your live API keys are correct.
            </Text>
          </Box>
        )}
      </Box>

      {/* Test API Keys */}
      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>🧪 Test Mode API Keys</Text>
        <Box display="flex" flexDirection="column" gap={4}>
          <Box>
            <Text marginBottom={1}>Test Key ID</Text>
            <Input
              placeholder={settings?.testKeyId || "rzp_test_..."}
              value={newKeys.testKeyId}
              onChange={(e) => setNewKeys({ ...newKeys, testKeyId: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1}>Test Key Secret</Text>
            <Input
              type="password"
              placeholder={settings?.hasTestKeys ? "••••••••  (leave blank to keep)" : "Enter test key secret"}
              value={newKeys.testKeySecret}
              onChange={(e) => setNewKeys({ ...newKeys, testKeySecret: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1}>Test Webhook Secret</Text>
            <Input
              type="password"
              placeholder={settings?.testWebhookSecret ? "••••••••  (leave blank to keep)" : "Enter test webhook secret"}
              value={newKeys.testWebhookSecret}
              onChange={(e) => setNewKeys({ ...newKeys, testWebhookSecret: e.target.value })}
            />
          </Box>
        </Box>
      </Box>

      {/* Live API Keys */}
      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>🔴 Live Mode API Keys</Text>
        <Box display="flex" flexDirection="column" gap={4}>
          <Box>
            <Text marginBottom={1}>Live Key ID</Text>
            <Input
              placeholder={settings?.liveKeyId || "rzp_live_..."}
              value={newKeys.liveKeyId}
              onChange={(e) => setNewKeys({ ...newKeys, liveKeyId: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1}>Live Key Secret</Text>
            <Input
              type="password"
              placeholder={settings?.hasLiveKeys ? "••••••••  (leave blank to keep)" : "Enter live key secret"}
              value={newKeys.liveKeySecret}
              onChange={(e) => setNewKeys({ ...newKeys, liveKeySecret: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1}>Live Webhook Secret</Text>
            <Input
              type="password"
              placeholder={settings?.liveWebhookSecret ? "••••••••  (leave blank to keep)" : "Enter live webhook secret"}
              value={newKeys.liveWebhookSecret}
              onChange={(e) => setNewKeys({ ...newKeys, liveWebhookSecret: e.target.value })}
            />
          </Box>
        </Box>
      </Box>

      {/* Payment Options */}
      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>💳 Payment Options</Text>
        <Box display="flex" flexDirection="column" gap={4}>
          <Box>
            <Text marginBottom={1}>Customer-facing Title</Text>
            <Input
              value={editSettings.title || ""}
              onChange={(e) => setEditSettings({ ...editSettings, title: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1}>Description</Text>
            <Input
              value={editSettings.description || ""}
              onChange={(e) => setEditSettings({ ...editSettings, description: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1}>Payment Action</Text>
            <select
              style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
              value={editSettings.paymentAction || "authorize_capture"}
              onChange={(e) => setEditSettings({ ...editSettings, paymentAction: e.target.value as any })}
            >
              <option value="authorize_capture">Authorize & Capture (Recommended)</option>
              <option value="authorize">Authorize Only</option>
            </select>
          </Box>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Text>Enable Magic Checkout</Text>
            <Checkbox
              checked={editSettings.magicCheckout || false}
              onCheckedChange={(v) => setEditSettings({ ...editSettings, magicCheckout: !!v })}
            />
          </Box>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Text>Debug Mode (detailed logging)</Text>
            <Checkbox
              checked={editSettings.debugMode || false}
              onCheckedChange={(v) => setEditSettings({ ...editSettings, debugMode: !!v })}
            />
          </Box>
        </Box>
      </Box>

      {/* Save Status & Actions */}
      {saveMsg && (
        <Box padding={4} backgroundColor={saveMsg.startsWith("Error") ? "critical1" : "success1"} borderRadius={2}>
          <Text>
            {saveMsg}
          </Text>
        </Box>
      )}
      <Box display="flex" gap={4}>
        <Button variant="primary" onClick={saveSettingsHandler} disabled={saving}>
          {saving ? "💾 Saving..." : "💾 Save Settings"}
        </Button>
        <Button variant="secondary" onClick={fetchSettings}>
          🔄 Reset
        </Button>
      </Box>
    </Box>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: LOGS TAB
  // ─────────────────────────────────────────────────────────────────────────

  const renderLogs = () => (
    <Box display="flex" flexDirection="column" gap={4}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text as="h2" size={6} fontWeight="bold">📋 Transaction History</Text>
        <Button
          variant="secondary"
          onClick={fetchLogs}
          disabled={logsLoading}
        >
          {logsLoading ? "Loading..." : "🔄 Refresh"}
        </Button>
      </Box>

      {logs.length === 0 ? (
        <Box padding={10} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1" textAlign="center">
          <Text size={10} marginBottom={2}>📭</Text>
          <Text>No transactions yet</Text>
          <Text size={2}>
            Transactions will appear here once payments are processed.
          </Text>
        </Box>
      ) : (
        <Box overflowX="auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <th style={{ textAlign: "left", padding: "12px" }}>Time</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Type</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Status</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Amount</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Razorpay ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f9f9f9" }}>
                  <td style={{ padding: "12px" }}>{new Date(log.timestamp).toLocaleString()}</td>
                  <td style={{ padding: "12px" }}>
                    <Box paddingX={2} paddingY={0.5} backgroundColor="info1" borderRadius={2} display="inline-block">
                      <Text size={1}>{log.type}</Text>
                    </Box>
                  </td>
                  <td style={{ padding: "12px" }}>
                    <Box paddingX={2} paddingY={0.5} backgroundColor={log.status === "success" ? "success1" : "critical1"} borderRadius={2} display="inline-block">
                      <Text size={1}>{log.status}</Text>
                    </Box>
                  </td>
                  <td style={{ padding: "12px" }}>{log.currency} {log.amount?.toFixed(2)}</td>
                  <td style={{ padding: "12px", fontFamily: "monospace", fontSize: "12px" }}>
                    {log.razorpayPaymentId || log.razorpayOrderId || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  );

  const renderStatus = () => (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>🔌 Connection Test</Text>
        <Text marginBottom={4}>
          Verify that your Razorpay API keys are correct and the connection is working.
        </Text>
        <Button variant="primary" onClick={testConnection} disabled={testing}>
          {testing ? "⏳ Testing..." : "🔗 Test Connection"}
        </Button>

        {connectionResult && (
          <Box marginTop={4} padding={4} backgroundColor={connectionResult.success ? "success1" : "critical1"} borderRadius={2}>
            <Text fontWeight="bold">
              {connectionResult.success ? "✅ Success" : "❌ Error"}
            </Text>
            <Text>{connectionResult.message}</Text>
          </Box>
        )}
      </Box>

      <Box padding={6} backgroundColor="default1" borderRadius={4} borderStyle="solid" borderWidth={1} borderColor="default1">
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>🪝 Active Webhooks</Text>
        <Box display="flex" flexDirection="column" gap={2}>
          <Text>The following webhooks are configured in your App Manifest:</Text>
          <Box paddingX={4} paddingY={2} backgroundColor="info1" borderRadius={2}>
            <Text size={2}>PAYMENT_GATEWAY_INITIALIZE_SESSION</Text>
          </Box>
          <Box paddingX={4} paddingY={2} backgroundColor="info1" borderRadius={2}>
            <Text size={2}>TRANSACTION_INITIALIZE_SESSION</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box padding={8} backgroundColor="default1" style={{ minHeight: "100vh" }}>
      <Box style={{ maxWidth: "900px" }} marginX="auto">
        <Box display="flex" alignItems="center" gap={4} marginBottom={8}>
          <Box width={10} height={10} backgroundColor="accent1" borderRadius={2} display="flex" alignItems="center" justifyContent="center">
            <Text color="default1" fontWeight="bold">R</Text>
          </Box>
          <Box>
            <Text as="h1" size={8} fontWeight="bold">Razorpay Payment Gateway</Text>
            <Text size={2}>Accept payments via Credit Card, UPI, Net Banking & more</Text>
          </Box>
        </Box>

        <Box display="flex" gap={2} marginBottom={6} backgroundColor="default2" padding={1} borderRadius={4}>
          <Button
            variant={activeTab === "settings" ? "primary" : "secondary"}
            onClick={() => setActiveTab("settings")}
          >
            ⚙️ Settings
          </Button>
          <Button
            variant={activeTab === "logs" ? "primary" : "secondary"}
            onClick={() => setActiveTab("logs")}
          >
            📋 Logs
          </Button>
          <Button
            variant={activeTab === "status" ? "primary" : "secondary"}
            onClick={() => setActiveTab("status")}
          >
            🔌 Status
          </Button>
        </Box>

        <Box>
          {activeTab === "settings" && renderSettings()}
          {activeTab === "logs" && renderLogs()}
          {activeTab === "status" && renderStatus()}
        </Box>
      </Box>
    </Box>
  );
};

export default IndexPage;
