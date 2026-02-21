/**
 * Shipping Aggregator Dashboard
 *
 * Configuration-management UI inspired by Saleor SMTP app.
 *
 * Views:
 * - List: Shows configured providers with name, status, edit
 * - Add: Provider selection dropdown
 * - Edit: Provider-specific credentials + documentation
 */

import { NextPage } from "next";
import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { useEffect, useState, useCallback } from "react";
import { Box, Button, Text, Input, Checkbox, Select } from "@saleor/macaw-ui";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface ProviderConfig {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  credentials: Record<string, string>;
  settings: Record<string, string | boolean>;
  createdAt: string;
  updatedAt: string;
}

interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  docsUrl: string;
  credentialFields: {
    key: string;
    label: string;
    type: "text" | "password" | "email";
    placeholder: string;
    required: boolean;
    helpText?: string;
  }[];
  settingFields: {
    key: string;
    label: string;
    type: "text" | "checkbox";
    helpText?: string;
    defaultValue?: string | boolean;
  }[];
  setupGuide: string[];
}

type View = "list" | "add" | "edit";

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER DEFINITIONS (registry of supported providers + docs)
// ═══════════════════════════════════════════════════════════════════════════════

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: "shiprocket",
    name: "Shiprocket",
    description:
      "India's leading shipping aggregator. Auto-calculate rates from 17+ courier partners and auto-create shipments.",
    icon: "SR",
    docsUrl: "https://apidocs.shiprocket.in/",
    credentialFields: [
      {
        key: "email",
        label: "Account Email",
        type: "email",
        placeholder: "your@email.com",
        required: true,
        helpText: "The email address used to log in to Shiprocket",
      },
      {
        key: "password",
        label: "Account Password",
        type: "password",
        placeholder: "Enter your Shiprocket password",
        required: true,
        helpText: "Your Shiprocket account password for API authentication",
      },
    ],
    settingFields: [
      {
        key: "pickupPincode",
        label: "Pickup Pincode",
        type: "text",
        helpText: "The pincode of your pickup/warehouse location",
        defaultValue: "",
      },
      {
        key: "pickupLocation",
        label: "Pickup Location Name",
        type: "text",
        helpText:
          "Name of the pickup location as configured in your Shiprocket panel",
        defaultValue: "",
      },
      {
        key: "enableCod",
        label: "Enable COD rates",
        type: "checkbox",
        helpText: "Include Cash on Delivery rates in checkout",
        defaultValue: false,
      },
    ],
    setupGuide: [
      "Create a Shiprocket account at shiprocket.in if you don't have one",
      "Go to Settings → API → Generate API credentials in your Shiprocket panel",
      "Enter your account email and password above",
      "Add at least one pickup location in Shiprocket before enabling this provider",
      "Set the pickup pincode and location name to match your Shiprocket configuration",
    ],
  },
  {
    id: "delhivery",
    name: "Delhivery",
    description:
      "Pan-India logistics with express, reverse logistics, and same-day delivery. API-based rate calculation.",
    icon: "DL",
    docsUrl: "https://www.delhivery.com/developers",
    credentialFields: [
      {
        key: "apiToken",
        label: "API Token",
        type: "password",
        placeholder: "Enter your Delhivery API token",
        required: true,
        helpText:
          "Get your API token from the Delhivery developer portal",
      },
      {
        key: "clientName",
        label: "Client Name",
        type: "text",
        placeholder: "Your registered client name",
        required: true,
        helpText: "The client name assigned by Delhivery",
      },
    ],
    settingFields: [
      {
        key: "warehouseName",
        label: "Warehouse Name",
        type: "text",
        helpText: "Name of the warehouse registered in Delhivery",
      },
      {
        key: "originPincode",
        label: "Origin Pincode",
        type: "text",
        helpText: "Pincode of the origin warehouse",
      },
    ],
    setupGuide: [
      "Register on the Delhivery developer portal",
      "Generate an API token from your dashboard",
      "Register your warehouse through the Delhivery panel",
      "Enter the API token and client name above",
      "Set origin pincode to match your registered warehouse",
    ],
  },
  {
    id: "eshipz",
    name: "eShipz",
    description:
      "Multi-carrier shipping platform with 30+ courier integrations. Best rates through AI-based selection.",
    icon: "ES",
    docsUrl: "https://eshipz.com/api-documentation/",
    credentialFields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "Enter your eShipz API key",
        required: true,
        helpText: "Found in eShipz Dashboard → Settings → API",
      },
      {
        key: "secretKey",
        label: "Secret Key",
        type: "password",
        placeholder: "Enter your eShipz secret key",
        required: true,
        helpText: "The secret key paired with your API key",
      },
    ],
    settingFields: [
      {
        key: "originPincode",
        label: "Origin Pincode",
        type: "text",
        helpText: "Pincode of the dispatch warehouse",
      },
    ],
    setupGuide: [
      "Sign up at eshipz.com",
      "Navigate to Settings → API and generate your API credentials",
      "Enter the API key and secret key above",
      "Configure your origin warehouse in the eShipz dashboard",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const IndexPage: NextPage = () => {
  const { appBridgeState } = useAppBridge();
  const [mounted, setMounted] = useState(false);

  // View management
  const [view, setView] = useState<View>("list");

  // Configurations
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Add flow
  const [selectedProvider, setSelectedProvider] = useState<string>("");

  // Edit / Create form
  const [editingConfig, setEditingConfig] = useState<Partial<ProviderConfig>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

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

  // ─── DATA FETCHING ──────────────────────────────────────────────────────

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configurations || []);
      }
    } catch (e) {
      console.error("Failed to load configurations:", e);
    } finally {
      setLoading(false);
    }
  }, [apiHeaders]);

  useEffect(() => {
    if (mounted && appBridgeState?.token) {
      fetchConfigs();
    }
  }, [mounted, appBridgeState?.token, fetchConfigs]);

  // ─── ACTIONS ────────────────────────────────────────────────────────────

  const handleAddProvider = () => {
    if (!selectedProvider) return;
    const def = PROVIDER_DEFINITIONS.find((p) => p.id === selectedProvider);
    if (!def) return;

    // Build default credentials & settings
    const defaultCreds: Record<string, string> = {};
    def.credentialFields.forEach((f) => (defaultCreds[f.key] = ""));

    const defaultSettings: Record<string, string | boolean> = {};
    def.settingFields.forEach(
      (f) => (defaultSettings[f.key] = f.defaultValue ?? "")
    );

    setEditingConfig({
      provider: def.id,
      name: def.name,
      active: true,
      credentials: defaultCreds,
      settings: defaultSettings,
    });
    setView("edit");
    setSaveMsg("");
  };

  const handleEditConfig = (config: ProviderConfig) => {
    setEditingConfig({ ...config });
    setView("edit");
    setSaveMsg("");
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(editingConfig),
      });

      if (res.ok) {
        setSaveMsg("Configuration saved successfully");
        await fetchConfigs();
        setTimeout(() => {
          setView("list");
          setSaveMsg("");
          setSelectedProvider("");
        }, 1000);
      } else {
        const err = await res.json();
        setSaveMsg(`Error: ${err.error || "Save failed"}`);
      }
    } catch {
      setSaveMsg("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this configuration?")) return;

    try {
      const res = await fetch(`/api/settings?id=${id}`, {
        method: "DELETE",
        headers: apiHeaders(),
      });

      if (res.ok) {
        await fetchConfigs();
      }
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  };

  const handleToggleActive = async (config: ProviderConfig) => {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          ...config,
          active: !config.active,
        }),
      });
      await fetchConfigs();
    } catch (e) {
      console.error("Failed to toggle:", e);
    }
  };

  if (!mounted) return null;

  // ─── PROVIDER DEFINITION HELPER ─────────────────────────────────────────

  const getProviderDef = (id: string) =>
    PROVIDER_DEFINITIONS.find((p) => p.id === id);

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW: CONFIGURATIONS LIST
  // ═══════════════════════════════════════════════════════════════════════════

  const renderList = () => (
    <Box display="flex" flexDirection="column">
      {/* Header */}
      <Box marginBottom={6}>
        <Text as="h2" size={8} fontWeight="bold">
          Configuration
        </Text>
        <Box marginTop={2}>
          <Text color="default2" size={3}>
            Configure shipping providers to calculate real-time rates and
            auto-create shipments from Saleor orders.
          </Text>
        </Box>
      </Box>

      {/* Configurations section */}
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: "48px",
          padding: "32px 0",
        }}
      >
        <Box>
          <Box marginBottom={2}>
            <Text as="h3" size={6} fontWeight="bold">
              Configurations
            </Text>
          </Box>
          <Text size={2} color="default2">
            Manage configurations and modify provider settings.
          </Text>
        </Box>

        <Box
          padding={0}
          borderRadius={4}
          style={{
            border: "1px solid rgba(0,0,0,0.1)",
            backgroundColor: "white",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            overflow: "hidden",
          }}
        >
          {loading ? (
            <Box padding={8} style={{ textAlign: "center" }}>
              <Text color="default2">Loading configurations...</Text>
            </Box>
          ) : configs.length === 0 ? (
            <Box padding={8} style={{ textAlign: "center" }}>
              <Text color="default2">
                No shipping providers configured yet.
              </Text>
            </Box>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  <th
                    style={{
                      textAlign: "left",
                      padding: "14px 20px",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#666",
                    }}
                  >
                    Configuration name
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "14px 20px",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#666",
                    }}
                  >
                    Provider
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "14px 20px",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#666",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "14px 20px",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#666",
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {configs.map((config) => {
                  const def = getProviderDef(config.provider);
                  return (
                    <tr
                      key={config.id}
                      style={{
                        borderBottom: "1px solid rgba(0,0,0,0.04)",
                        transition: "background 0.15s",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(0,0,0,0.015)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                      onClick={() => handleEditConfig(config)}
                    >
                      <td
                        style={{
                          padding: "16px 20px",
                          fontSize: "14px",
                          fontWeight: 500,
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={3}>
                          {config.name}
                        </Box>
                      </td>
                      <td
                        style={{
                          padding: "16px 20px",
                          fontSize: "13px",
                          color: "#666",
                        }}
                      >
                        {def?.name || config.provider}
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleActive(config);
                          }}
                          style={{
                            display: "inline-block",
                            padding: "3px 12px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            backgroundColor: config.active
                              ? "#e0f2f1"
                              : "#fef2f2",
                            color: config.active ? "#00796b" : "#dc2626",
                            border: `1px solid ${config.active ? "#b2dfdb" : "#fecaca"}`,
                            transition: "all 0.2s",
                          }}
                        >
                          {config.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "16px 20px",
                          textAlign: "right",
                        }}
                      >
                        <Box display="flex" justifyContent="flex-end" gap={2}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditConfig(config);
                            }}
                            style={{
                              background: "none",
                              border: "1px solid rgba(0,0,0,0.12)",
                              borderRadius: "4px",
                              padding: "6px 14px",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: 500,
                              transition: "all 0.15s",
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(config.id);
                            }}
                            style={{
                              background: "none",
                              border: "1px solid rgba(220,38,38,0.2)",
                              borderRadius: "4px",
                              padding: "6px 14px",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: 500,
                              color: "#dc2626",
                              transition: "all 0.15s",
                            }}
                          >
                            Remove
                          </button>
                        </Box>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Add provider row */}
          <Box
            padding={5}
            display="flex"
            justifyContent="flex-end"
            style={{
              borderTop:
                configs.length > 0
                  ? "1px solid rgba(0,0,0,0.06)"
                  : "none",
            }}
          >
            <Button
              variant="primary"
              onClick={() => {
                setSelectedProvider("");
                setView("add");
              }}
            >
              Add configuration
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Webhooks section */}
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: "48px",
          padding: "32px 0",
          borderTop: "1px solid rgba(0,0,0,0.05)",
        }}
      >
        <Box>
          <Box marginBottom={2}>
            <Text as="h3" size={6} fontWeight="bold">
              Webhooks
            </Text>
          </Box>
          <Text size={2} color="default2">
            Events this app listens to from Saleor.
          </Text>
        </Box>

        <Box
          padding={6}
          borderRadius={4}
          style={{
            border: "1px solid rgba(0,0,0,0.1)",
            backgroundColor: "white",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <Box display="flex" flexDirection="column" gap={3}>
            {[
              {
                name: "SHIPPING_LIST_METHODS_FOR_CHECKOUT",
                desc: "Synchronous — returns available shipping methods and rates during checkout",
                type: "Sync",
              },
              {
                name: "ORDER_CREATED",
                desc: "Asynchronous — triggers automatic shipment creation when an order is placed",
                type: "Async",
              },
            ].map((wh) => (
              <Box
                key={wh.name}
                padding={4}
                borderRadius={2}
                style={{
                  border: "1px solid rgba(0,0,0,0.05)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Box>
                  <Text fontWeight="bold" size={2}>
                    {wh.name}
                  </Text>
                  <Text size={1} color="default2" display="block">
                    {wh.desc}
                  </Text>
                </Box>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "3px",
                    backgroundColor:
                      wh.type === "Sync" ? "#e8eaf6" : "#fff3e0",
                    color: wh.type === "Sync" ? "#3f51b5" : "#e65100",
                  }}
                >
                  {wh.type}
                </span>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW: ADD PROVIDER (provider selection)
  // ═══════════════════════════════════════════════════════════════════════════

  const renderAddProvider = () => (
    <Box display="flex" flexDirection="column">
      {/* Back button */}
      <Box marginBottom={6}>
        <button
          onClick={() => setView("list")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "14px",
            color: "#666",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          ← Back to Configurations
        </button>
      </Box>

      <Box marginBottom={8}>
        <Text as="h2" size={8} fontWeight="bold">
          Add Shipping Provider
        </Text>
        <Box marginTop={2}>
          <Text color="default2" size={3}>
            Select a shipping provider to configure. Each provider requires API
            credentials for authentication.
          </Text>
        </Box>
      </Box>

      {/* Provider cards */}
      <Box display="flex" flexDirection="column" gap={4}>
        {PROVIDER_DEFINITIONS.map((def) => {
          const isSelected = selectedProvider === def.id;
          const alreadyConfigured = configs.some(
            (c) => c.provider === def.id
          );

          return (
            <Box
              key={def.id}
              padding={6}
              borderRadius={4}
              style={{
                border: isSelected
                  ? "2px solid #1a1a1a"
                  : "1px solid rgba(0,0,0,0.1)",
                backgroundColor: "white",
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: isSelected
                  ? "0 2px 8px rgba(0,0,0,0.08)"
                  : "0 1px 3px rgba(0,0,0,0.02)",
              }}
              onClick={() => setSelectedProvider(def.id)}
            >
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="flex-start"
              >
                <Box display="flex" gap={4} alignItems="flex-start">
                  <span
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "6px",
                      backgroundColor: "#f0f0f0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#333",
                      flexShrink: 0,
                    }}
                  >
                    {def.icon}
                  </span>
                  <Box>
                    <Box display="flex" alignItems="center" gap={3}>
                      <Text size={5} fontWeight="bold">
                        {def.name}
                      </Text>
                      {alreadyConfigured && (
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "3px",
                            backgroundColor: "#e0f2f1",
                            color: "#00796b",
                            fontWeight: 600,
                          }}
                        >
                          Already configured
                        </span>
                      )}
                    </Box>
                    <Text size={2} color="default2" display="block" marginTop={1}>
                      {def.description}
                    </Text>
                    <Box marginTop={2}>
                      <a
                        href={def.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: "12px",
                          color: "#1976d2",
                          textDecoration: "none",
                        }}
                      >
                        View API Documentation →
                      </a>
                    </Box>
                  </Box>
                </Box>

                {/* Radio indicator */}
                <span
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    border: isSelected
                      ? "6px solid #1a1a1a"
                      : "2px solid rgba(0,0,0,0.2)",
                    flexShrink: 0,
                    marginTop: "2px",
                    transition: "all 0.2s",
                  }}
                />
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Continue button */}
      <Box display="flex" justifyContent="flex-end" gap={3} marginTop={8}>
        <Button variant="secondary" onClick={() => setView("list")}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!selectedProvider}
          onClick={handleAddProvider}
        >
          Continue to Configuration
        </Button>
      </Box>
    </Box>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW: EDIT / CREATE CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  const renderEditConfig = () => {
    const def = getProviderDef(editingConfig.provider || "");
    if (!def) return null;

    const isNew = !editingConfig.id;
    const creds = editingConfig.credentials || {};
    const settings = editingConfig.settings || {};

    return (
      <Box display="flex" flexDirection="column">
        {/* Back button */}
        <Box marginBottom={6}>
          <button
            onClick={() => {
              setView("list");
              setSaveMsg("");
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "14px",
              color: "#666",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ← Back to Configurations
          </button>
        </Box>

        {/* Title row */}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="flex-start"
          marginBottom={8}
        >
          <Box display="flex" gap={4} alignItems="center">
            <span
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "6px",
                backgroundColor: "#f0f0f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: "#333",
                flexShrink: 0,
              }}
            >
              {def.icon}
            </span>
            <Box>
              <Text as="h2" size={8} fontWeight="bold">
                {isNew ? `Configure ${def.name}` : editingConfig.name}
              </Text>
              <Text color="default2" size={3}>
                {def.description}
              </Text>
            </Box>
          </Box>
          <a
            href={def.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid rgba(0,0,0,0.12)",
              fontSize: "13px",
              color: "#1976d2",
              textDecoration: "none",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            API Docs
          </a>
        </Box>

        {/* Configuration Name */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: "48px",
            padding: "32px 0",
            borderBottom: "1px solid rgba(0,0,0,0.05)",
          }}
        >
          <Box>
            <Text as="h3" size={6} fontWeight="bold">
              General
            </Text>
            <Text size={2} color="default2">
              Give this configuration a name to identify it.
            </Text>
          </Box>
          <Box
            padding={8}
            borderRadius={4}
            style={{
              border: "1px solid rgba(0,0,0,0.1)",
              backgroundColor: "white",
            }}
          >
            <Box display="flex" flexDirection="column" gap={5}>
              <Box>
                <Text
                  marginBottom={2}
                  size={2}
                  fontWeight="bold"
                  color="default1"
                >
                  Configuration Name
                </Text>
                <Input
                  value={editingConfig.name || ""}
                  placeholder={`e.g. Production ${def.name}`}
                  onChange={(e) =>
                    setEditingConfig({
                      ...editingConfig,
                      name: e.target.value,
                    })
                  }
                />
              </Box>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
              >
                <Box>
                  <Text fontWeight="bold">Active</Text>
                  <Text size={2} color="default2" display="block">
                    Enable this provider for shipping rate calculations
                  </Text>
                </Box>
                <Checkbox
                  checked={editingConfig.active || false}
                  onCheckedChange={(v) =>
                    setEditingConfig({ ...editingConfig, active: !!v })
                  }
                />
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Credentials */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: "48px",
            padding: "32px 0",
            borderBottom: "1px solid rgba(0,0,0,0.05)",
          }}
        >
          <Box>
            <Text as="h3" size={6} fontWeight="bold">
              API Credentials
            </Text>
            <Text size={2} color="default2">
              Authentication details for the {def.name} API. These are stored
              securely and never exposed in plain text.
            </Text>
          </Box>
          <Box
            padding={8}
            borderRadius={4}
            style={{
              border: "1px solid rgba(0,0,0,0.1)",
              backgroundColor: "white",
            }}
          >
            <Box display="flex" flexDirection="column" gap={6}>
              {def.credentialFields.map((field) => (
                <Box key={field.key}>
                  <Box display="flex" justifyContent="space-between" marginBottom={1}>
                    <Text
                      size={2}
                      fontWeight="bold"
                      color="default1"
                    >
                      {field.label}
                      {field.required && (
                        <span style={{ color: "#dc2626" }}> *</span>
                      )}
                    </Text>
                  </Box>
                  {field.helpText && (
                    <Text
                      size={1}
                      color="default2"
                      display="block"
                      marginBottom={2}
                    >
                      {field.helpText}
                    </Text>
                  )}
                  <Input
                    type={field.type === "password" ? "password" : "text"}
                    placeholder={field.placeholder}
                    value={creds[field.key] || ""}
                    onChange={(e) =>
                      setEditingConfig({
                        ...editingConfig,
                        credentials: {
                          ...creds,
                          [field.key]: e.target.value,
                        },
                      })
                    }
                  />
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Provider Settings */}
        {def.settingFields.length > 0 && (
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: "48px",
              padding: "32px 0",
              borderBottom: "1px solid rgba(0,0,0,0.05)",
            }}
          >
            <Box>
              <Text as="h3" size={6} fontWeight="bold">
                Provider Settings
              </Text>
              <Text size={2} color="default2">
                Configure {def.name}-specific options like warehouse details and
                shipping preferences.
              </Text>
            </Box>
            <Box
              padding={8}
              borderRadius={4}
              style={{
                border: "1px solid rgba(0,0,0,0.1)",
                backgroundColor: "white",
              }}
            >
              <Box display="flex" flexDirection="column" gap={6}>
                {def.settingFields.map((field) =>
                  field.type === "checkbox" ? (
                    <Box
                      key={field.key}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Box>
                        <Text fontWeight="bold">{field.label}</Text>
                        {field.helpText && (
                          <Text
                            size={2}
                            color="default2"
                            display="block"
                          >
                            {field.helpText}
                          </Text>
                        )}
                      </Box>
                      <Checkbox
                        checked={!!settings[field.key]}
                        onCheckedChange={(v) =>
                          setEditingConfig({
                            ...editingConfig,
                            settings: {
                              ...settings,
                              [field.key]: !!v,
                            },
                          })
                        }
                      />
                    </Box>
                  ) : (
                    <Box key={field.key}>
                      <Text
                        marginBottom={1}
                        size={2}
                        fontWeight="bold"
                        color="default1"
                      >
                        {field.label}
                      </Text>
                      {field.helpText && (
                        <Text
                          size={1}
                          color="default2"
                          display="block"
                          marginBottom={2}
                        >
                          {field.helpText}
                        </Text>
                      )}
                      <Input
                        value={(settings[field.key] as string) || ""}
                        onChange={(e) =>
                          setEditingConfig({
                            ...editingConfig,
                            settings: {
                              ...settings,
                              [field.key]: e.target.value,
                            },
                          })
                        }
                      />
                    </Box>
                  )
                )}
              </Box>
            </Box>
          </Box>
        )}

        {/* Setup Guide */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: "48px",
            padding: "32px 0",
            borderBottom: "1px solid rgba(0,0,0,0.05)",
          }}
        >
          <Box>
            <Text as="h3" size={6} fontWeight="bold">
              Setup Guide
            </Text>
            <Text size={2} color="default2">
              Follow these steps to integrate {def.name} with your store.
            </Text>
          </Box>
          <Box
            padding={8}
            borderRadius={4}
            style={{
              border: "1px solid rgba(0,0,0,0.1)",
              backgroundColor: "#fafafa",
            }}
          >
            <Box display="flex" flexDirection="column" gap={4}>
              {def.setupGuide.map((step, i) => (
                <Box key={i} display="flex" gap={3} alignItems="flex-start">
                  <span
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      backgroundColor: "#1a1a1a",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: "bold",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <Text size={2} style={{ paddingTop: "2px" }}>
                    {step}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Save actions */}
        <Box
          marginTop={8}
          paddingTop={6}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" alignItems="center" gap={4}>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !editingConfig.name}
              size="large"
            >
              {saving
                ? "Saving..."
                : isNew
                  ? "Save Configuration"
                  : "Update Configuration"}
            </Button>
            <Button variant="secondary" onClick={() => setView("list")}>
              Cancel
            </Button>
          </Box>
          {saveMsg && (
            <Text
              color={saveMsg.includes("Error") ? "critical1" : "success1"}
              fontWeight="bold"
            >
              {saveMsg}
            </Text>
          )}
        </Box>
      </Box>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <Box
      padding={8}
      backgroundColor="default1"
      style={{ minHeight: "100vh" }}
    >
      <div style={{ margin: "0 auto" }}>
        {/* View rendering */}
        {view === "list" && renderList()}
        {view === "add" && renderAddProvider()}
        {view === "edit" && renderEditConfig()}

        {/* Footer */}
        <Box
          marginTop={12}
          paddingTop={6}
          borderTopStyle="solid"
          borderTopWidth={1}
          borderColor="default2"
          textAlign="center"
        >
          <Text size={2} color="default2">
            Shipping Integration by{" "}
            <a
              href="https://brightcodecanvas.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontWeight: "bold",
                textDecoration: "none",
                color: "black",
              }}
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
