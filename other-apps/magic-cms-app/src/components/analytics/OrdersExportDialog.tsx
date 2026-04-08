import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";

type ExportFormat = "csv" | "xlsx";

interface OrdersExportDialogProps {
  open: boolean;
  startDate: string;
  endDate: string;
  format: ExportFormat;
  loading: boolean;
  error: string;
  onClose: () => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onFormatChange: (value: ExportFormat) => void;
  onPresetLast7Days: () => void;
  onPresetLast30Days: () => void;
  onPresetThisMonth: () => void;
  onExport: () => void;
}

export const OrdersExportDialog = ({
  open,
  startDate,
  endDate,
  format,
  loading,
  error,
  onClose,
  onStartDateChange,
  onEndDateChange,
  onFormatChange,
  onPresetLast7Days,
  onPresetLast30Days,
  onPresetThisMonth,
  onExport,
}: OrdersExportDialogProps) => {
  if (!open) {
    return null;
  }

  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.28)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <Box
        backgroundColor="default1"
        borderRadius={4}
        padding={6}
        style={{
          width: "100%",
          maxWidth: 520,
          boxShadow: "0 24px 64px rgba(15, 23, 42, 0.22)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" marginBottom={4}>
          <Box>
            <Text as="h2" size={6} fontWeight="bold">
              Export orders
            </Text>
            <Text size={2} color="default2">
              Download completed orders between the selected dates with customer details.
            </Text>
          </Box>
          <Button variant="tertiary" size="small" onClick={onClose} disabled={loading}>
            Close
          </Button>
        </Box>

        <Box display="grid" gap={4}>
          <Box display="flex" gap={2} style={{ flexWrap: "wrap" }}>
            <Button variant="secondary" size="small" onClick={onPresetLast7Days} disabled={loading}>
              Last 7 days
            </Button>
            <Button variant="secondary" size="small" onClick={onPresetLast30Days} disabled={loading}>
              Last 30 days
            </Button>
            <Button variant="secondary" size="small" onClick={onPresetThisMonth} disabled={loading}>
              This month
            </Button>
          </Box>

          <Box display="grid" gap={2} __gridTemplateColumns="1fr 1fr">
            <Box>
              <Text size={2} color="default2" marginBottom={1}>
                Start date
              </Text>
              <Input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} />
            </Box>
            <Box>
              <Text size={2} color="default2" marginBottom={1}>
                End date
              </Text>
              <Input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} />
            </Box>
          </Box>

          <Box style={{ maxWidth: 180 }}>
            <Select
              label="File format"
              value={format}
              onChange={(value: string) => onFormatChange(value as ExportFormat)}
              options={[
                { label: "CSV", value: "csv" },
                { label: "Excel (.xlsx)", value: "xlsx" },
              ]}
            />
          </Box>

          <Box
            padding={3}
            borderRadius={3}
            backgroundColor="default2"
            style={{ background: "rgba(99, 102, 241, 0.06)" }}
          >
            <Text size={2} color="default2">
              Large exports are fetched in paginated chunks on the server, then assembled into one file for download.
            </Text>
          </Box>

          {error ? (
            <Box
              padding={3}
              borderRadius={3}
              style={{ background: "rgba(220, 38, 38, 0.08)", border: "1px solid rgba(220, 38, 38, 0.16)" }}
            >
              <Text size={2} color="critical1">
                {error}
              </Text>
            </Box>
          ) : null}

          <Box display="flex" justifyContent="flex-end" gap={2}>
            <Button variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={onExport} disabled={loading || !startDate || !endDate}>
              {loading ? "Preparing export..." : "Export & download"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
