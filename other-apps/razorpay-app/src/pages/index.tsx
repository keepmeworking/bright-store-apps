/**
 * Razorpay App Dashboard
 *
 * Professional minimalist UI with tabs:
 * - Configuration: API keys, mode, payment action, magic checkout
 * - History: Transaction logs
 * - Reliability: Connection health, webhook info
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



// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const Section = ({ title, description, children, actions }: any) => (
  <div 
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 2fr",
      gap: "48px",
      padding: "32px 0",
      borderBottom: "1px solid rgba(0,0,0,0.05)"
    }}
  >
    <Box>
      <Box marginBottom={2}>
        <Text as="h3" size={6} fontWeight="bold">{title}</Text>
      </Box>
      <Text size={2} color="default2">{description}</Text>
    </Box>
    <Box 
      padding={8} 
      borderRadius={4} 
      style={{ 
        border: "1px solid rgba(0,0,0,0.1)", 
        backgroundColor: "white",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
      }}
    >
      <Box display="flex" flexDirection="column" gap={6}>
        {children}
      </Box>
      {actions && (
         <Box display="flex" justifyContent="flex-end" gap={2} marginTop={8}>
            {actions}
         </Box>
      )}
    </Box>
  </div>
);

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

  // Edit modes per credentials section only
  const [editModes, setEditModes] = useState({
    test: false,
    live: false,
  });

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
  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      // Construction of body: only send non-key settings from editSettings
      // and only send keys from newKeys if they were explicitly changed.
      const body: Record<string, unknown> = {
        enabled: editSettings.enabled,
        mode: editSettings.mode,
        title: editSettings.title,
        description: editSettings.description,
        paymentAction: editSettings.paymentAction,
        magicCheckout: editSettings.magicCheckout,
        debugMode: editSettings.debugMode,
      };

      // Add keys ONLY if user typed something NEW
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
        const data = await res.json();
        const saved = data.settings;
        setSettings(saved);
        setEditSettings(saved);
        // Reset draft keys
        setNewKeys({
          testKeyId: "",
          testKeySecret: "",
          testWebhookSecret: "",
          liveKeyId: "",
          liveKeySecret: "",
          liveWebhookSecret: "",
        });
        setEditModes({ test: false, live: false });
        setSaveMsg("All settings saved successfully");
        setTimeout(() => setSaveMsg(""), 3000);
      } else {
        const err = await res.json();
        setSaveMsg(`Error: ${err.error || "Save failed"}`);
      }
    } catch (e) {
      setSaveMsg("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const toggleEdit = (mode: "test" | "live") => {
    const isEntering = !editModes[mode];
    if (isEntering && settings) {
      setNewKeys((prev) => ({
        ...prev,
        [`${mode}KeyId`]: settings[`${mode}KeyId`] || "",
      }));
    }
    setEditModes((prev) => ({ ...prev, [mode]: !prev[mode] }));
    setConnectionResult(null); // Clear test results when toggling
  };

  const testConnection = async (credentials?: { keyId: string, keySecret: string }) => {
    setTesting(true);
    setConnectionResult(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: {
            ...apiHeaders()
        },
        body: credentials ? JSON.stringify(credentials) : undefined
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

  useEffect(() => {
    if (mounted && appBridgeState?.token) {
      fetchSettings();
    }
  }, [mounted, appBridgeState?.token, fetchSettings]);

  useEffect(() => {
    if (activeTab === "logs" && appBridgeState?.token) {
      fetchLogs();
    }
  }, [activeTab, appBridgeState?.token, fetchLogs]);

  if (!mounted) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: CONFIGURATION TAB
  // ─────────────────────────────────────────────────────────────────────────

  const renderConfiguration = () => (
    <Box display="flex" flexDirection="column">
      
      <Box marginBottom={6}>
        <Text as="h2" size={8} fontWeight="bold">Configuration</Text>
        <Text color="default2">Manage your Razorpay account settings and API credentials.</Text>
      </Box>

      <Section 
        title="Gateway Status" 
        description="Enable or disable the payment gateway and switch between Test and Live modes."
        showEditButton={false}
      >
        <Box display="flex" flexDirection="column" gap={4}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Text>Enabled</Text>
            <Checkbox
              checked={editSettings.enabled || false}
              onCheckedChange={(v) => setEditSettings({ ...editSettings, enabled: !!v })}
            />
          </Box>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Text>Payment Mode</Text>
            <Box display="flex" gap={2}>
              <Button
                variant={editSettings.mode === "test" ? "primary" : "secondary"}
                onClick={() => setEditSettings({ ...editSettings, mode: "test" })}
              >
                Test
              </Button>
              <Button
                variant={editSettings.mode === "live" ? "primary" : "secondary"}
                onClick={() => setEditSettings({ ...editSettings, mode: "live" })}
              >
                Live
              </Button>
            </Box>
          </Box>
        </Box>
      </Section>

      <Section 
        title="Test Mode Credentials" 
        description="Use these keys while testing in a development or staging environment."
        actions={
          editModes.test ? (
             <>
                <Button 
                   variant="secondary" 
                   onClick={() => testConnection({ 
                      keyId: newKeys.testKeyId || settings?.testKeyId || "", 
                      keySecret: newKeys.testKeySecret 
                   })} 
                   disabled={testing}
                >
                   {testing ? "Testing..." : "Test Credentials"}
                </Button>
                <Button variant="primary" onClick={saveSettingsHandler} disabled={saving}>Save Configuration</Button>
                <Button variant="secondary" onClick={() => toggleEdit("test")}>Cancel</Button>
             </>
          ) : (
             <Button variant="secondary" onClick={() => toggleEdit("test")}>Edit</Button>
          )
        }
      >
        <Box display="flex" flexDirection="column" gap={6}>
          <Box>
            <Text marginBottom={2} size={2} fontWeight="bold" color="default1">Key ID</Text>
            <Input
              disabled={!editModes.test}
              placeholder="rzp_test_..."
              value={editModes.test ? newKeys.testKeyId : (settings?.testKeyId || "")}
              onChange={(e) => setNewKeys({ ...newKeys, testKeyId: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={2} size={2} fontWeight="bold" color="default1">Key Secret</Text>
            <Input
              type="password"
              disabled={!editModes.test}
              placeholder="Enter test key secret"
              value={editModes.test ? newKeys.testKeySecret : (settings?.hasTestKeys ? "••••••••••••" : "")}
              onChange={(e) => setNewKeys({ ...newKeys, testKeySecret: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={2} size={2} fontWeight="bold" color="default1">Webhook Secret</Text>
            <Input
              type="password"
              disabled={!editModes.test}
              placeholder="Enter test webhook secret"
              value={editModes.test ? newKeys.testWebhookSecret : (settings?.testWebhookSecret ? "••••••••••••" : "")}
              onChange={(e) => setNewKeys({ ...newKeys, testWebhookSecret: e.target.value })}
            />
          </Box>
          {editModes.test && connectionResult && (
             <Box marginTop={2} padding={4} backgroundColor={connectionResult.success ? "default1" : "critical1"} borderRadius={2} style={{ border: connectionResult.success ? "1px solid #16a34a" : "1px solid #dc2626" }}>
                <Text fontWeight="bold" size={2} color={connectionResult.success ? "default1" : "critical1"}>{connectionResult.success ? "Connection Successful" : "Connection Failed"}</Text>
                {!connectionResult.success && <Text size={1} display="block" marginTop={1}>{connectionResult.message}</Text>}
             </Box>
          )}
        </Box>
      </Section>

      <Section 
        title="Live Mode Credentials" 
        description="Your production credentials. Real money will be charged using these keys."
        actions={
          editModes.live ? (
             <>
                <Button 
                   variant="secondary" 
                   onClick={() => testConnection({ 
                      keyId: newKeys.liveKeyId || settings?.liveKeyId || "", 
                      keySecret: newKeys.liveKeySecret 
                   })} 
                   disabled={testing}
                >
                   {testing ? "Testing..." : "Test Credentials"}
                </Button>
                <Button variant="primary" onClick={saveSettingsHandler} disabled={saving}>Save Configuration</Button>
                <Button variant="secondary" onClick={() => toggleEdit("live")}>Cancel</Button>
             </>
          ) : (
             <Button variant="secondary" onClick={() => toggleEdit("live")}>Edit</Button>
          )
        }
      >
        <Box display="flex" flexDirection="column" gap={6}>
          <Box>
            <Text marginBottom={2} size={2} fontWeight="bold" color="default1">Key ID</Text>
            <Input
              disabled={!editModes.live}
              placeholder="rzp_live_..."
              value={editModes.live ? newKeys.liveKeyId : (settings?.liveKeyId || "")}
              onChange={(e) => setNewKeys({ ...newKeys, liveKeyId: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={2} size={2} fontWeight="bold" color="default1">Key Secret</Text>
            <Input
              type="password"
              disabled={!editModes.live}
              placeholder="Enter live key secret"
              value={editModes.live ? newKeys.liveKeySecret : (settings?.hasLiveKeys ? "••••••••••••" : "")}
              onChange={(e) => setNewKeys({ ...newKeys, liveKeySecret: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={2} size={2} fontWeight="bold" color="default1">Webhook Secret</Text>
            <Input
              type="password"
              disabled={!editModes.live}
              placeholder="Enter live webhook secret"
              value={editModes.live ? newKeys.liveWebhookSecret : (settings?.liveWebhookSecret ? "••••••••••••" : "")}
              onChange={(e) => setNewKeys({ ...newKeys, liveWebhookSecret: e.target.value })}
            />
          </Box>
          {editModes.live && connectionResult && (
             <Box marginTop={2} padding={4} backgroundColor={connectionResult.success ? "default1" : "critical1"} borderRadius={2} style={{ border: connectionResult.success ? "1px solid #16a34a" : "1px solid #dc2626" }}>
                <Text fontWeight="bold" size={2} color={connectionResult.success ? "default1" : "critical1"}>{connectionResult.success ? "Connection Successful" : "Connection Failed"}</Text>
                {!connectionResult.success && <Text size={1} display="block" marginTop={1}>{connectionResult.message}</Text>}
             </Box>
          )}
        </Box>
      </Section>

      <Section 
        title="Webhook Configuration" 
        description="Configure this URL in your Razorpay Dashboard to receive payment updates."
        showEditButton={false}
      >
        <Box display="flex" flexDirection="column" gap={6}>
          <Box>
            <Text marginBottom={1} size={2} color="default2">Webhook Endpoint</Text>
            <Box display="flex" gap={2} alignItems="center">
              <Input
                value={typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/razorpay` : ""}
                readOnly
                style={{ backgroundColor: "var(--color-background-default2)", color: "var(--color-text-default2)", flex: 1 }}
              />
              <Button 
                variant="secondary" 
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/razorpay`);
                    setSaveMsg("Webhook URL copied to clipboard");
                    setTimeout(() => setSaveMsg(""), 3000);
                  }
                }}
              >
                Copy
              </Button>
            </Box>
          </Box>

          <Box>
            <Text marginBottom={2} size={2} color="default2">The following events must be active in your Razorpay dashboard:</Text>
            <Box display="flex" flexDirection="column" gap={2}>
              {["payment.authorized", "payment.captured", "payment.failed", "refund.processed"].map(ev => (
                <div key={ev} style={{ padding: "8px 12px", background: "white", borderRadius: "6px", border: "1px solid rgba(0,0,0,0.05)", fontFamily: "monospace", fontSize: "12px" }}>
                  {ev}
                </div>
              ))}
            </Box>
          </Box>

          <Box marginTop={2}>
             {/* Test Connection moved to credential sections */}
          </Box>
        </Box>
      </Section>

      <Section 
        title="Merchant Display" 
        description="Customize how the payment option appears to customers during checkout."
        showEditButton={false}
      >
        <Box display="flex" flexDirection="column" gap={4}>
          <Box>
            <Text marginBottom={1} size={2} color="default2">Display Title</Text>
            <Input
              value={editSettings.title || ""}
              onChange={(e) => setEditSettings({ ...editSettings, title: e.target.value })}
            />
          </Box>
          <Box>
            <Text marginBottom={1} size={2} color="default2">Description</Text>
            <Input
              value={editSettings.description || ""}
              onChange={(e) => setEditSettings({ ...editSettings, description: e.target.value })}
            />
          </Box>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Text>Enable Magic Checkout</Text>
            <Checkbox
              checked={editSettings.magicCheckout || false}
              onCheckedChange={(v) => setEditSettings({ ...editSettings, magicCheckout: !!v })}
            />
          </Box>
        </Box>
      </Section>

      {/* Unified Save Action */}
      <Box
        marginTop={8}
        paddingTop={8}
        borderTopStyle="solid"
        borderTopWidth={1}
        borderColor="default2"
        display="flex"
        flexDirection="column"
        alignItems="flex-start"
        gap={4}
      >
        <Box display="flex" alignItems="center" gap={4}>
          <Button
            variant="primary"
            onClick={saveSettingsHandler}
            disabled={saving}
            size="large"
          >
            {saving ? "Saving..." : "Save All Settings"}
          </Button>
          {saveMsg && (
            <Text color={saveMsg.includes("Error") ? "critical1" : "success1"} fontWeight="bold">
              {saveMsg}
            </Text>
          )}
        </Box>
        <Text size={2} color="default2">
          Clicking save will update all configuration, gateway status, and merchant display settings.
        </Text>
      </Box>
    </Box>
  );

  const renderHistory = () => (
    <Box display="flex" flexDirection="column" gap={4}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text as="h2" size={8} fontWeight="bold">Transaction History</Text>
        <Button variant="secondary" onClick={fetchLogs} disabled={logsLoading}>
          Refresh
        </Button>
      </Box>

      {logs.length === 0 ? (
        <Box 
          padding={12} 
          style={{ 
            textAlign: "center", 
            borderStyle: "dashed", 
            borderWidth: "1px", 
            borderColor: "rgba(0,0,0,0.1)", 
            borderRadius: "4px" 
          }}
        >
          <Text color="default2">No transactions recorded yet.</Text>
        </Box>
      ) : (
        <Box overflowX="auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.1)" }}>
                <th style={{ textAlign: "left", padding: "12px" }}>Timestamp</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Type</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Status</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Amount</th>
                <th style={{ textAlign: "left", padding: "12px" }}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <td style={{ padding: "12px", fontSize: "12px" }}>{new Date(log.timestamp).toLocaleString()}</td>
                  <td style={{ padding: "12px" }}><Text size={1}>{log.type}</Text></td>
                  <td style={{ padding: "12px" }}>
                    <Box paddingX={2} paddingY={0.5} backgroundColor="default2" borderRadius={2} display="inline-block">
                      <Text size={1}>{log.status}</Text>
                    </Box>
                  </td>
                  <td style={{ padding: "12px" }}>{log.currency} {log.amount?.toFixed(2)}</td>
                  <td style={{ padding: "12px", fontFamily: "monospace", fontSize: "11px", color: "var(--text-color-default-2)" }}>
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

  return (
    <Box padding={8} backgroundColor="default1" style={{ minHeight: "100vh" }}>
      <div style={{ margin: "0 auto" }}>
        
        {/* Header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" marginBottom={10}>
          <Box display="flex" alignItems="center" gap={4}>
            <img 
               src="/razorpay.png" 
               alt="Razorpay" 
               style={{ height: "42px", width: "auto", objectFit: "contain" }} 
            />
            <Box>
              <Text as="h1" size={9} fontWeight="bold">Razorpay</Text>
              <Text color="default2" size={3}>by Brightcode Canvas</Text>
            </Box>
          </Box>
        </Box>

        {/* Navigation Tabs */}
        <Box 
          display="flex" 
          gap={6} 
          marginBottom={8} 
          style={{ 
            borderBottom: "1px solid rgba(0,0,0,0.05)" 
          }}
        >
          <button 
            onClick={() => setActiveTab("settings")}
            style={{ 
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "16px 4px",
              fontSize: "14px",
              fontWeight: activeTab === "settings" ? "bold" : "normal",
              color: activeTab === "settings" ? "black" : "var(--text-color-default-2)",
              borderBottom: activeTab === "settings" ? "2px solid black" : "2px solid transparent",
              transition: "all 0.2s ease"
            }}
          >
            Configuration
          </button>
          <button 
            onClick={() => setActiveTab("logs")}
            style={{ 
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "16px 4px",
              fontSize: "14px",
              fontWeight: activeTab === "logs" ? "bold" : "normal",
              color: activeTab === "logs" ? "black" : "var(--text-color-default-2)",
              borderBottom: activeTab === "logs" ? "2px solid black" : "2px solid transparent",
              transition: "all 0.2s ease"
            }}
          >
            History
          </button>
        </Box>

        {/* Tab Content Rendering */}
        <Box>
          {activeTab === "settings" && renderConfiguration()}
          {activeTab === "logs" && renderHistory()}
        </Box>

        {/* Footer */}
        <Box marginTop={12} paddingTop={6} borderTopStyle="solid" borderTopWidth={1} borderColor="default2" textAlign="center">
          <Text size={2} color="default2">
            Professional Payment Integration by{" "}
            <a
              href="https://brightcodecanvas.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: "bold", textDecoration: "none", color: "black" }}
            >
              Brightcode Canvas
            </a>
          </Text>
        </Box>
      </div>
    </Box>
  );
};

export default IndexPage;
