import { actions, useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Text, Spinner, Select, Input } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { OrdersExportDialog } from "@/components/analytics/OrdersExportDialog";
import {
  useGetDashboardAnalyticsQuery,
  useGetCheckoutsAnalyticsSummaryQuery,
  useGetChannelsQuery,
  type GetDashboardAnalyticsQuery,
  type GetCheckoutsAnalyticsSummaryQuery,
} from "../../../generated/graphql";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  TrendingUp,
  ShoppingCart,
  DollarSign,
  Activity,
  RefreshCw,
  CalendarDays,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import {
  subDays,
  format,
  parseISO,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYesterday,
  endOfYesterday,
  addDays,
  addMonths,
  isSameDay,
  isSameMonth,
  startOfWeek,
  isAfter,
  isBefore,
  differenceInCalendarDays,
  eachDayOfInterval,
} from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { AppliedRange, toDateQuery } from "@/lib/analytics-range";

type PresetKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "365d"
  | "thisMonth"
  | "lastMonth";

type RangeMode = "fixed" | "rolling";
type RollingUnit = "days" | "weeks" | "months";
type ExportFormat = "csv" | "xlsx";

const weekLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const presetLabels: Record<PresetKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 365 days",
  thisMonth: "This month",
  lastMonth: "Last month",
};

const resolvePresetRange = (preset: PresetKey): AppliedRange => {
  const now = new Date();

  switch (preset) {
    case "today":
      return { label: presetLabels[preset], startDate: startOfDay(now), endDate: endOfDay(now) };
    case "yesterday":
      return {
        label: presetLabels[preset],
        startDate: startOfYesterday(),
        endDate: endOfYesterday(),
      };
    case "30d":
      return {
        label: presetLabels[preset],
        startDate: subDays(startOfDay(now), 29),
        endDate: endOfDay(now),
      };
    case "90d":
      return {
        label: presetLabels[preset],
        startDate: subDays(startOfDay(now), 89),
        endDate: endOfDay(now),
      };
    case "365d":
      return {
        label: presetLabels[preset],
        startDate: subDays(startOfDay(now), 364),
        endDate: endOfDay(now),
      };
    case "thisMonth":
      return {
        label: presetLabels[preset],
        startDate: startOfMonth(now),
        endDate: endOfDay(now),
      };
    case "lastMonth": {
      const prev = subMonths(now, 1);
      return {
        label: presetLabels[preset],
        startDate: startOfMonth(prev),
        endDate: endOfMonth(prev),
      };
    }
    case "7d":
    default:
      return {
        label: presetLabels["7d"],
        startDate: subDays(startOfDay(now), 6),
        endDate: endOfDay(now),
      };
  }
};

const buildRollingRange = (
  value: number,
  unit: RollingUnit,
  includeCurrentPeriod: boolean
): AppliedRange => {
  const now = new Date();
  const anchorDay = includeCurrentPeriod ? startOfDay(now) : startOfDay(subDays(now, 1));
  const endDate = includeCurrentPeriod ? endOfDay(now) : endOfDay(subDays(now, 1));

  let startDate = anchorDay;
  if (unit === "days") {
    startDate = subDays(anchorDay, Math.max(value - 1, 0));
  }
  if (unit === "weeks") {
    startDate = subDays(anchorDay, Math.max(value * 7 - 1, 0));
  }
  if (unit === "months") {
    startDate = subMonths(anchorDay, Math.max(value, 0));
  }

  return {
    label: `Last ${value} ${unit}`,
    startDate: startOfDay(startDate),
    endDate,
  };
};

const toDateInput = (date: Date) => format(date, "yyyy-MM-dd");

const parseDateInput = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day);
};

const downloadBlobFile = (fileName: string, blob: Blob) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
};

const getMonthMatrix = (month: Date) => {
  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });

  return Array.from({ length: 42 }, (_, idx) => addDays(gridStart, idx));
};

const normalizeRangeBounds = (from: Date, to: Date) => {
  if (isAfter(from, to)) {
    return { from: to, to: from };
  }
  return { from, to };
};

type DashboardOrder = NonNullable<NonNullable<GetDashboardAnalyticsQuery["orders"]>["edges"][number]>["node"];
type DashboardCheckout = NonNullable<
  NonNullable<GetCheckoutsAnalyticsSummaryQuery["checkouts"]>["edges"][number]
>["node"];

type ChartGranularity = "day" | "week" | "month";
type ChartMetric = "sales" | "orders" | "avgOrderValue";

type ChartPoint = {
  label: string;
  sales: number;
  orders: number;
  avgOrderValue: number;
  checkouts: number;
  previousSales: number;
  previousOrders: number;
  previousAvgOrderValue: number;
  previousCheckouts: number;
};

const chartMetricLabels: Record<ChartMetric, string> = {
  sales: "Total sales",
  orders: "Orders",
  avgOrderValue: "Average order value",
};

const formatCompactNumber = (value: number) => {
  if (value >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
};

const hasCheckoutContact = (checkout: DashboardCheckout) =>
  Boolean(checkout.email || checkout.billingAddress?.phone || checkout.shippingAddress?.phone);

const isPermissionDeniedError = (message?: string) =>
  /need one of the following permissions|permission/i.test(message || "");

const selectChartGranularity = (rangeDays: number): ChartGranularity => {
  if (rangeDays > 180) return "month";
  if (rangeDays > 45) return "week";
  return "day";
};

const bucketKeyForDate = (date: Date, granularity: ChartGranularity) => {
  if (granularity === "month") return format(startOfMonth(date), "yyyy-MM");
  if (granularity === "week") return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
  return format(startOfDay(date), "yyyy-MM-dd");
};

const bucketLabelForDate = (date: Date, granularity: ChartGranularity) => {
  if (granularity === "month") return format(startOfMonth(date), "MMM yyyy");
  if (granularity === "week") return format(startOfWeek(date, { weekStartsOn: 1 }), "dd MMM");
  return format(startOfDay(date), "dd MMM");
};

const getBucketOrder = (startDate: Date, endDate: Date, granularity: ChartGranularity) => {
  const days = eachDayOfInterval({
    start: startOfDay(startDate),
    end: startOfDay(endDate),
  });
  const seen = new Set<string>();
  const ordered: Array<{ key: string; label: string }> = [];

  days.forEach((day) => {
    const key = bucketKeyForDate(day, granularity);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    ordered.push({ key, label: bucketLabelForDate(day, granularity) });
  });

  return ordered;
};

const aggregateOrdersAndCheckouts = (
  orders: DashboardOrder[],
  checkouts: DashboardCheckout[],
  granularity: ChartGranularity
) => {
  const buckets = new Map<
    string,
    {
      sales: number;
      orders: number;
      checkouts: number;
    }
  >();

  orders.forEach((order) => {
    const key = bucketKeyForDate(parseISO(order.created), granularity);
    const current = buckets.get(key) || { sales: 0, orders: 0, checkouts: 0 };
    current.sales += order.total?.gross?.amount || 0;
    current.orders += 1;
    buckets.set(key, current);
  });

  checkouts.filter(hasCheckoutContact).forEach((checkout) => {
    const key = bucketKeyForDate(parseISO(checkout.created), granularity);
    const current = buckets.get(key) || { sales: 0, orders: 0, checkouts: 0 };
    current.checkouts += 1;
    buckets.set(key, current);
  });

  return buckets;
};

export default function AnalyticsPage() {
  const router = useRouter();
  const { appBridgeState, appBridge } = useAppBridge();

  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [appliedRange, setAppliedRange] = useState<AppliedRange>(() => resolvePresetRange("7d"));
  const [chartMetric, setChartMetric] = useState<ChartMetric>("sales");
  const [topProductsPage, setTopProductsPage] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1440);

  const [isRangePickerOpen, setRangePickerOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling");
  const [rollingValue, setRollingValue] = useState(30);
  const [rollingUnit, setRollingUnit] = useState<RollingUnit>("days");
  const [includeCurrentPeriod, setIncludeCurrentPeriod] = useState(true);

  const [draftFrom, setDraftFrom] = useState<Date>(resolvePresetRange("7d").startDate);
  const [draftTo, setDraftTo] = useState<Date>(resolvePresetRange("7d").endDate);
  const [calendarBaseMonth, setCalendarBaseMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectionStep, setSelectionStep] = useState<"start" | "end">("start");
  const [isExportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(() =>
    toDateInput(resolvePresetRange("7d").startDate)
  );
  const [exportEndDate, setExportEndDate] = useState(() => toDateInput(resolvePresetRange("7d").endDate));
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [isExportingOrders, setIsExportingOrders] = useState(false);
  const [exportOrdersError, setExportOrdersError] = useState("");

  const [{ data: channelData, fetching: fetchingChannels, error: channelError }, refetchChannels] =
    useGetChannelsQuery({
      pause: !appBridgeState?.ready || !appBridgeState?.token || !appBridgeState?.saleorApiUrl,
    });
  const channels = channelData?.channels || [];

  useEffect(() => {
    if (!fetchingChannels && channels.length > 0) {
      const currentInList = channels.find((c) => c.id === selectedChannelId);
      if (!selectedChannelId || !currentInList) {
        setSelectedChannelId(channels[0].id);
      }
    }
  }, [channels, selectedChannelId, fetchingChannels]);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) || channels[0],
    [channels, selectedChannelId]
  );

  const dateFilters = useMemo(
    () => ({
      createdAfter: toDateQuery(appliedRange.startDate),
      createdBefore: toDateQuery(appliedRange.endDate),
      channels: selectedChannelId ? [selectedChannelId] : [],
    }),
    [appliedRange, selectedChannelId]
  );

  const previousRange = useMemo(() => {
    const days =
      differenceInCalendarDays(endOfDay(appliedRange.endDate), startOfDay(appliedRange.startDate)) + 1;

    return {
      days,
      startDate: startOfDay(subDays(appliedRange.startDate, days)),
      endDate: endOfDay(subDays(appliedRange.endDate, days)),
    };
  }, [appliedRange]);

  const previousDateFilters = useMemo(
    () => ({
      createdAfter: toDateQuery(previousRange.startDate),
      createdBefore: toDateQuery(previousRange.endDate),
      channels: selectedChannelId ? [selectedChannelId] : [],
    }),
    [previousRange, selectedChannelId]
  );

  const [{ data: orderData, fetching: fetchingOrders, error: orderError }] =
    useGetDashboardAnalyticsQuery({
      variables: dateFilters,
      pause: !appBridgeState?.ready || !selectedChannelId,
    });

  const [{ data: checkoutData, fetching: fetchingCheckouts, error: checkoutError }] =
    useGetCheckoutsAnalyticsSummaryQuery({
      variables: { ...dateFilters, first: 100 },
      pause: !appBridgeState?.ready || !selectedChannelId,
      requestPolicy: "cache-and-network",
    });

  const [{ data: previousOrderData, fetching: fetchingPreviousOrders, error: previousOrderError }] =
    useGetDashboardAnalyticsQuery({
      variables: previousDateFilters,
      pause: !appBridgeState?.ready || !selectedChannelId,
    });

  const [
    { data: previousCheckoutData, fetching: fetchingPreviousCheckouts, error: previousCheckoutError },
  ] = useGetCheckoutsAnalyticsSummaryQuery({
    variables: { ...previousDateFilters, first: 100 },
    pause: !appBridgeState?.ready || !selectedChannelId,
    requestPolicy: "cache-and-network",
  });

  const hasCheckoutPermissionError =
    isPermissionDeniedError(checkoutError?.message) || isPermissionDeniedError(previousCheckoutError?.message);

  const loading =
    fetchingOrders ||
    fetchingPreviousOrders ||
    (!hasCheckoutPermissionError && fetchingCheckouts) ||
    (!hasCheckoutPermissionError && fetchingPreviousCheckouts) ||
    fetchingChannels;
  const analyticsError =
    orderError ||
    previousOrderError ||
    (!hasCheckoutPermissionError ? checkoutError || previousCheckoutError : undefined);
  const hasAutoReloadedRef = useRef(false);

  useEffect(() => {
    const allErrors = [channelError?.message, analyticsError?.message].filter(Boolean).join(" ");
    const hasExpiredSignatureError = /signature has expired/i.test(allErrors);

    if (!hasExpiredSignatureError || hasAutoReloadedRef.current) {
      return;
    }

    hasAutoReloadedRef.current = true;
    const reloadTimeout = window.setTimeout(() => router.reload(), 150);

    return () => {
      window.clearTimeout(reloadTimeout);
    };
  }, [channelError?.message, analyticsError?.message, router]);

  const stats = useMemo(() => {
    if (!selectedChannelId && channels.length > 0) return null;
    if (channels.length === 0 && !fetchingChannels) return "no-channels";

    const orders = orderData?.orders?.edges.map((e) => e.node) || [];
    const checkouts = hasCheckoutPermissionError
      ? []
      : checkoutData?.checkouts?.edges.map(
          (e: NonNullable<GetCheckoutsAnalyticsSummaryQuery["checkouts"]>["edges"][number]) => e.node,
        ) || [];
    const previousOrders = previousOrderData?.orders?.edges.map((e) => e.node) || [];
    const previousCheckouts = hasCheckoutPermissionError
      ? []
      : previousCheckoutData?.checkouts?.edges.map(
          (e: NonNullable<GetCheckoutsAnalyticsSummaryQuery["checkouts"]>["edges"][number]) => e.node,
        ) || [];

    const actionableCheckouts = checkouts.filter(hasCheckoutContact);
    const previousActionableCheckouts = previousCheckouts.filter(hasCheckoutContact);

    const totalOrders = orders.length;
    const totalSales = orders.reduce((sum, order) => sum + (order.total?.gross?.amount || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    const totalCheckouts = actionableCheckouts.length;

    const previousTotalOrders = previousOrders.length;
    const previousTotalSales = previousOrders.reduce((sum, order) => sum + (order.total?.gross?.amount || 0), 0);
    const previousAvgOrderValue = previousTotalOrders > 0 ? previousTotalSales / previousTotalOrders : 0;
    const previousTotalCheckouts = previousActionableCheckouts.length;

    const chartGranularity = selectChartGranularity(previousRange.days);
    const currentBucketOrder = getBucketOrder(
      appliedRange.startDate,
      appliedRange.endDate,
      chartGranularity
    );
    const previousBucketOrder = getBucketOrder(
      previousRange.startDate,
      previousRange.endDate,
      chartGranularity
    );

    const currentBuckets = aggregateOrdersAndCheckouts(orders, checkouts, chartGranularity);
    const previousBuckets = aggregateOrdersAndCheckouts(
      previousOrders,
      previousCheckouts,
      chartGranularity
    );

    const chartData: ChartPoint[] = currentBucketOrder.map((bucket, index) => {
      const current = currentBuckets.get(bucket.key) || { sales: 0, orders: 0, checkouts: 0 };
      const previousKey = previousBucketOrder[index]?.key;
      const previous = previousKey
        ? previousBuckets.get(previousKey) || { sales: 0, orders: 0, checkouts: 0 }
        : { sales: 0, orders: 0, checkouts: 0 };

      return {
        label: bucket.label,
        sales: current.sales,
        orders: current.orders,
        checkouts: current.checkouts,
        avgOrderValue: current.orders > 0 ? current.sales / current.orders : 0,
        previousSales: previous.sales,
        previousOrders: previous.orders,
        previousCheckouts: previous.checkouts,
        previousAvgOrderValue: previous.orders > 0 ? previous.sales / previous.orders : 0,
      };
    });

    const productMap = new Map<string, { id?: string; slug?: string; name: string; qty: number }>();
    orders.forEach((order) => {
      order.lines.forEach((line) => {
        const productId = line.variant?.product?.id || line.productVariantId || line.productName;
        const current = productMap.get(productId) || {
          id: line.variant?.product?.id || undefined,
          slug: line.variant?.product?.slug || undefined,
          name: line.variant?.product?.name || line.productName,
          qty: 0,
        };
        current.qty += line.quantity;
        productMap.set(productId, current);
      });
    });

    const topProducts = Array.from(productMap.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.qty - a.qty);

    const comparePercent = (current: number, previous: number) => {
      if (previous === 0) return null;
      return ((current - previous) / previous) * 100;
    };

    return {
      totalOrders,
      totalSales,
      avgOrderValue,
      totalCheckouts,
      chartData,
      topProducts,
      chartGranularity,
      comparison: {
        sales: comparePercent(totalSales, previousTotalSales),
        orders: comparePercent(totalOrders, previousTotalOrders),
        avgOrderValue: comparePercent(avgOrderValue, previousAvgOrderValue),
        checkouts: comparePercent(totalCheckouts, previousTotalCheckouts),
      },
      currency: activeChannel?.currencyCode || "USD",
    };
  }, [
    orderData,
    checkoutData,
    previousOrderData,
    previousCheckoutData,
    hasCheckoutPermissionError,
    selectedChannelId,
    channels,
    activeChannel,
    fetchingChannels,
    previousRange,
    appliedRange,
  ]);

  const analyticsRouteQuery = useMemo(
    () => ({
      channelId: selectedChannelId,
      start: toDateQuery(appliedRange.startDate),
      end: toDateQuery(appliedRange.endDate),
      label: appliedRange.label,
    }),
    [selectedChannelId, appliedRange]
  );

  const openCheckoutsPage = () => {
    router.push({ pathname: "/analytics/checkouts", query: analyticsRouteQuery });
  };

  const openSaleorOrdersPage = () => {
    if (appBridge) {
      appBridge.dispatch(
        actions.Redirect({
          to: "/orders",
          newContext: false,
        })
      );
      return;
    }

    if (typeof window !== "undefined") {
      window.location.href = "/orders";
    }
  };

  const openOrdersPage = () => {
    openSaleorOrdersPage();
  };

  const openOrdersByProduct = () => {
    openSaleorOrdersPage();
  };

  const openOrdersExportDialog = () => {
    setExportStartDate(toDateInput(appliedRange.startDate));
    setExportEndDate(toDateInput(appliedRange.endDate));
    setExportOrdersError("");
    setExportDialogOpen(true);
  };

  const closeOrdersExportDialog = () => {
    if (isExportingOrders) {
      return;
    }
    setExportDialogOpen(false);
    setExportOrdersError("");
  };

  const applyExportPreset = (preset: Extract<PresetKey, "7d" | "30d" | "thisMonth">) => {
    const next = resolvePresetRange(preset);
    setExportStartDate(toDateInput(next.startDate));
    setExportEndDate(toDateInput(next.endDate));
    setExportOrdersError("");
  };

  const handleOrdersExport = async () => {
    const token = appBridge?.getState().token ?? appBridgeState?.token ?? "";
    const saleorApiUrl = appBridgeState?.saleorApiUrl ?? "";

    if (!token || !saleorApiUrl || !selectedChannelId) {
      setExportOrdersError("Missing Saleor authentication or channel context. Refresh the app and try again.");
      return;
    }

    if (!exportStartDate || !exportEndDate) {
      setExportOrdersError("Please choose both start and end dates.");
      return;
    }

    if (exportStartDate > exportEndDate) {
      setExportOrdersError("Start date cannot be after end date.");
      return;
    }

    try {
      setIsExportingOrders(true);
      setExportOrdersError("");

      const response = await fetch("/api/analytics/orders-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          saleorApiUrl,
          channelId: selectedChannelId,
          startDate: exportStartDate,
          endDate: exportEndDate,
          format: exportFormat,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Unable to export orders." }));
        throw new Error(payload.message || "Unable to export orders.");
      }

      const fileNameHeader = response.headers.get("content-disposition") || "";
      const fileNameMatch = fileNameHeader.match(/filename="?([^"]+)"?/i);
      const fileName =
        fileNameMatch?.[1] || `orders-export-${exportStartDate}-to-${exportEndDate}.${exportFormat}`;
      const blob = await response.blob();
      downloadBlobFile(fileName, blob);
      setExportDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to export orders.";
      setExportOrdersError(message);
    } finally {
      setIsExportingOrders(false);
    }
  };

  useEffect(() => {
    setTopProductsPage(1);
  }, [analyticsRouteQuery.channelId, analyticsRouteQuery.start, analyticsRouteQuery.end]);

  const openPreset = (preset: PresetKey) => {
    const next = resolvePresetRange(preset);
    setAppliedRange(next);
    setRangePickerOpen(false);
  };

  const openRangePicker = () => {
    setDraftFrom(appliedRange.startDate);
    setDraftTo(appliedRange.endDate);
    setCalendarBaseMonth(startOfMonth(appliedRange.startDate));
    setSelectionStep("start");
    setRangePickerOpen(true);
  };

  const selectFixedMonth = (monthType: "this" | "last") => {
    const base = monthType === "this" ? new Date() : subMonths(new Date(), 1);
    const nextStart = startOfMonth(base);
    const nextEnd = endOfMonth(base);
    setDraftFrom(nextStart);
    setDraftTo(nextEnd);
    setCalendarBaseMonth(nextStart);
  };

  const handleDaySelection = (day: Date) => {
    if (selectionStep === "start") {
      setDraftFrom(day);
      setDraftTo(day);
      setSelectionStep("end");
      return;
    }

    const next = normalizeRangeBounds(draftFrom, day);
    setDraftFrom(next.from);
    setDraftTo(next.to);
    setSelectionStep("start");
  };

  const applyRangeSelection = () => {
    if (rangeMode === "rolling") {
      const next = buildRollingRange(rollingValue, rollingUnit, includeCurrentPeriod);
      setAppliedRange(next);
      setRangePickerOpen(false);
      return;
    }

    const next = normalizeRangeBounds(startOfDay(draftFrom), endOfDay(draftTo));
    setAppliedRange({
      label: `${format(next.from, "dd MMM yyyy")} - ${format(next.to, "dd MMM yyyy")}`,
      startDate: next.from,
      endDate: next.to,
    });
    setRangePickerOpen(false);
  };

  const isHtmlError =
    channelError?.message?.includes("<!DOCTYPE") || channelError?.message?.includes("<html");

  useEffect(() => {
    if (!stats || stats === "no-channels") return;
    const totalPages = Math.max(1, Math.ceil(stats.topProducts.length / 6));
    if (topProductsPage > totalPages) {
      setTopProductsPage(totalPages);
    }
  }, [stats, topProductsPage]);

  const chartMetricConfig: Record<
    ChartMetric,
    { currentKey: keyof ChartPoint; previousKey: keyof ChartPoint }
  > = {
    sales: { currentKey: "sales", previousKey: "previousSales" },
    orders: { currentKey: "orders", previousKey: "previousOrders" },
    avgOrderValue: { currentKey: "avgOrderValue", previousKey: "previousAvgOrderValue" },
  };

  const topProductsPagination = useMemo(() => {
    if (!stats || stats === "no-channels") {
      return { items: [], totalPages: 1 };
    }

    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(stats.topProducts.length / perPage));
    const current = Math.min(topProductsPage, totalPages);
    const start = (current - 1) * perPage;
    const end = start + perPage;

    return {
      items: stats.topProducts.slice(start, end),
      totalPages,
    };
  }, [stats, topProductsPage]);

  const currentProductsPage = Math.min(topProductsPage, topProductsPagination.totalPages);
  const isCompactRangePicker = viewportWidth < 980;
  const rangePickerWidth = isCompactRangePicker ? Math.min(520, viewportWidth - 24) : 920;

  return (
    <Box padding={8}>
      <Box
        marginBottom={6}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        style={{ flexWrap: "wrap", gap: 12 }}
      >
        <Text as="h1" size={7} fontWeight="bold">
          Storefront Performance
        </Text>

        <Box display="flex" gap={4} alignItems="center" style={{ flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={openOrdersExportDialog} disabled={!selectedChannelId}>
            Export orders
          </Button>

          {channels.length > 0 && (
            <Box style={{ minWidth: isCompactRangePicker ? 260 : 330, flex: "1 1 260px" }}>
              <Select
                label="Channel"
                value={selectedChannelId}
                onChange={(val: string) => setSelectedChannelId(val)}
                options={channels.map((c) => ({ label: c.name, value: c.id }))}
              />
            </Box>
          )}

          <Box style={{ position: "relative" }}>
            <Button
              variant="secondary"
              onClick={openRangePicker}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <CalendarDays size={16} /> {appliedRange.label}
            </Button>

            {isRangePickerOpen && (
              <Box
                borderStyle="solid"
                borderWidth={1}
                borderColor="default1"
                borderRadius={4}
                backgroundColor="default1"
                style={{
                  position: isCompactRangePicker ? "fixed" : "absolute",
                  top: isCompactRangePicker ? 110 : 48,
                  right: isCompactRangePicker ? 12 : 0,
                  left: isCompactRangePicker ? 12 : "auto",
                  zIndex: 40,
                  width: isCompactRangePicker ? rangePickerWidth : 920,
                  maxHeight: isCompactRangePicker ? "calc(100vh - 130px)" : "80vh",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.16)",
                  overflow: "auto",
                }}
              >
                <Box display={isCompactRangePicker ? "grid" : "flex"}>
                  <Box
                    padding={4}
                    borderRightStyle={isCompactRangePicker ? "none" : "solid"}
                    borderRightWidth={isCompactRangePicker ? 0 : 1}
                    borderBottomStyle={isCompactRangePicker ? "solid" : "none"}
                    borderBottomWidth={isCompactRangePicker ? 1 : 0}
                    borderColor="default1"
                    style={{
                      width: isCompactRangePicker ? "100%" : 260,
                      maxHeight: isCompactRangePicker ? 190 : 520,
                      overflowY: "auto",
                    }}
                  >
                    <Text size={2} color="default2" fontWeight="bold" marginBottom={2}>
                      Presets
                    </Text>
                    {(
                      [
                        "today",
                        "yesterday",
                        "7d",
                        "30d",
                        "90d",
                        "365d",
                        "thisMonth",
                        "lastMonth",
                      ] as PresetKey[]
                    ).map((preset) => (
                      <Button
                        key={preset}
                        variant="tertiary"
                        onClick={() => openPreset(preset)}
                        style={{
                          width: "100%",
                          justifyContent: "flex-start",
                          marginBottom: 6,
                        }}
                      >
                        {presetLabels[preset]}
                      </Button>
                    ))}
                  </Box>

                  <Box padding={5} style={{ flex: 1 }}>
                    <Box display="flex" gap={2} marginBottom={4}>
                      <Button
                        size="small"
                        variant={rangeMode === "fixed" ? "primary" : "tertiary"}
                        onClick={() => setRangeMode("fixed")}
                      >
                        Fixed
                      </Button>
                      <Button
                        size="small"
                        variant={rangeMode === "rolling" ? "primary" : "tertiary"}
                        onClick={() => setRangeMode("rolling")}
                      >
                        Rolling
                      </Button>
                    </Box>

                    {rangeMode === "rolling" ? (
                      <Box display="grid" gap={3}>
                        <Text size={2} color="default2">
                          Last period
                        </Text>
                        <Box display={isCompactRangePicker ? "grid" : "flex"} gap={2}>
                          <Box style={{ width: isCompactRangePicker ? "100%" : 140 }}>
                            <Input
                              type="number"
                              value={rollingValue.toString()}
                              onChange={(e) =>
                                setRollingValue(Math.max(1, Number(e.target.value) || 1))
                              }
                            />
                          </Box>
                          <Box style={{ width: isCompactRangePicker ? "100%" : 160 }}>
                            <Select
                              value={rollingUnit}
                              onChange={(value: string) => setRollingUnit(value as RollingUnit)}
                              options={[
                                { label: "Days", value: "days" },
                                { label: "Weeks", value: "weeks" },
                                { label: "Months", value: "months" },
                              ]}
                            />
                          </Box>
                        </Box>
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={includeCurrentPeriod}
                            onChange={(e) => setIncludeCurrentPeriod(e.target.checked)}
                          />
                          <Text size={2}>Include current period</Text>
                        </label>
                      </Box>
                    ) : (
                      <Box display="grid" gap={4}>
                        <Text size={2} color="default2">
                          Custom date range
                        </Text>

                        <Box display={isCompactRangePicker ? "grid" : "flex"} gap={2}>
                          <Button size="small" variant="tertiary" onClick={() => selectFixedMonth("this")}>
                            This month
                          </Button>
                          <Button size="small" variant="tertiary" onClick={() => selectFixedMonth("last")}>
                            Last month
                          </Button>
                        </Box>

                        <Box
                          display="grid"
                          gap={2}
                          __gridTemplateColumns={isCompactRangePicker ? "1fr" : "1fr 1fr"}
                        >
                          <Box>
                            <Text size={1} color="default2" marginBottom={1}>
                              From
                            </Text>
                            <Input
                              type="date"
                              value={toDateInput(draftFrom)}
                              onChange={(e) => setDraftFrom(startOfDay(parseDateInput(e.target.value)))}
                            />
                          </Box>
                          <Box>
                            <Text size={1} color="default2" marginBottom={1}>
                              To
                            </Text>
                            <Input
                              type="date"
                              value={toDateInput(draftTo)}
                              onChange={(e) => setDraftTo(endOfDay(parseDateInput(e.target.value)))}
                            />
                          </Box>
                        </Box>

                        <Box
                          padding={3}
                          borderStyle="solid"
                          borderWidth={1}
                          borderColor="default1"
                          borderRadius={3}
                        >
                          <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={2}>
                            <Button
                              variant="tertiary"
                              size="small"
                              onClick={() => setCalendarBaseMonth((prev) => subMonths(prev, 1))}
                            >
                              <ArrowLeft size={14} />
                            </Button>
                            <Text size={2} color="default2">
                              Click start and end date
                            </Text>
                            <Button
                              variant="tertiary"
                              size="small"
                              onClick={() => setCalendarBaseMonth((prev) => addMonths(prev, 1))}
                            >
                              <ArrowRight size={14} />
                            </Button>
                          </Box>

                          <Box
                            display="grid"
                            __gridTemplateColumns={isCompactRangePicker ? "1fr" : "1fr 1fr"}
                            gap={3}
                          >
                            {[
                              calendarBaseMonth,
                              ...(isCompactRangePicker ? [] : [addMonths(calendarBaseMonth, 1)]),
                            ].map((month) => {
                              const cells = getMonthMatrix(month);
                              const normalized = normalizeRangeBounds(draftFrom, draftTo);

                              return (
                                <Box key={month.toISOString()}>
                                  <Text size={2} fontWeight="bold" marginBottom={2}>
                                    {format(month, "MMMM yyyy")}
                                  </Text>
                                  <Box display="grid" __gridTemplateColumns="repeat(7, 1fr)" gap={1} marginBottom={1}>
                                    {weekLabels.map((label) => (
                                      <Text
                                        key={label}
                                        size={1}
                                        color="default2"
                                        style={{ textAlign: "center", fontWeight: 600 }}
                                      >
                                        {label}
                                      </Text>
                                    ))}
                                  </Box>
                                  <Box display="grid" __gridTemplateColumns="repeat(7, 1fr)" gap={1}>
                                    {cells.map((day) => {
                                      const isCurrentMonth = isSameMonth(day, month);
                                      const isBoundary =
                                        isSameDay(day, normalized.from) || isSameDay(day, normalized.to);
                                      const inRange =
                                        !isBefore(day, normalized.from) && !isAfter(day, normalized.to);

                                      return (
                                        <button
                                          key={day.toISOString()}
                                          type="button"
                                          onClick={() => handleDaySelection(day)}
                                          style={{
                                            height: isCompactRangePicker ? 30 : 34,
                                            borderRadius: 6,
                                            border: "none",
                                            cursor: "pointer",
                                            fontWeight: isBoundary ? 700 : 500,
                                            color: isCurrentMonth ? "#1f2937" : "#9ca3af",
                                            backgroundColor: isBoundary
                                              ? "#0f2940"
                                              : inRange
                                                ? "#dbeafe"
                                                : "transparent",
                                            outline: "none",
                                          }}
                                        >
                                          {format(day, "d")}
                                        </button>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>
                      </Box>
                    )}

                    <Box
                      display="flex"
                      justifyContent="flex-end"
                      gap={2}
                      marginTop={4}
                      paddingTop={3}
                      borderTopStyle="solid"
                      borderTopWidth={1}
                      borderColor="default1"
                    >
                      <Button variant="tertiary" onClick={() => setRangePickerOpen(false)}>
                        Cancel
                      </Button>
                      <Button variant="primary" onClick={applyRangeSelection}>
                        Apply
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <OrdersExportDialog
        open={isExportDialogOpen}
        startDate={exportStartDate}
        endDate={exportEndDate}
        format={exportFormat}
        loading={isExportingOrders}
        error={exportOrdersError}
        onClose={closeOrdersExportDialog}
        onStartDateChange={setExportStartDate}
        onEndDateChange={setExportEndDate}
        onFormatChange={setExportFormat}
        onPresetLast7Days={() => applyExportPreset("7d")}
        onPresetLast30Days={() => applyExportPreset("30d")}
        onPresetThisMonth={() => applyExportPreset("thisMonth")}
        onExport={handleOrdersExport}
      />

      {loading ? (
        <Box padding={10} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : analyticsError ? (
        <Box padding={10} display="flex" flexDirection="column" alignItems="center" gap={4}>
          <Text size={5} color="critical1" fontWeight="bold">
            Failed to load analytics data
          </Text>
          <Text color="default2" style={{ maxWidth: 600, textAlign: "center" }}>
            {analyticsError.message}
          </Text>
          <Button variant="secondary" onClick={() => router.reload()}>
            Reload
          </Button>
        </Box>
      ) : stats === "no-channels" ? (
        <Box padding={10} display="flex" flexDirection="column" alignItems="center" gap={4}>
          {channelError ? (
            <>
              <Text size={5} color="critical1" fontWeight="bold">
                Connection Error
              </Text>
              <Text color="default2" style={{ maxWidth: 500, textAlign: "center" }}>
                {isHtmlError
                  ? "Received an HTML response instead of JSON from the Saleor API. This usually means your authentication token has expired or the API URL is incorrect. Try refreshing the page."
                  : channelError.message}
              </Text>
              <Box display="flex" gap={2}>
                <Button
                  variant="secondary"
                  onClick={() => refetchChannels({ requestPolicy: "network-only" })}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <RefreshCw size={16} /> Retry Connection
                </Button>
                <Button variant="tertiary" onClick={() => router.reload()}>
                  Full Reload
                </Button>
              </Box>
            </>
          ) : (
            <>
              <Activity size={48} color="gray" />
              <Text size={5} fontWeight="bold">
                No channels found
              </Text>
              <Text color="default2">
                We couldn't find any active channels. Please verify your Saleor configuration.
              </Text>
              <Button
                variant="secondary"
                onClick={() => refetchChannels({ requestPolicy: "network-only" })}
              >
                Refresh List
              </Button>
            </>
          )}
        </Box>
      ) : (
        stats && (
          <Box display="grid" gap={6}>
            {hasCheckoutPermissionError ? (
              <Box padding={4} borderStyle="solid" borderWidth={1} borderColor="warning1" borderRadius={4}>
                <Text size={2} fontWeight="bold">
                  Checkout analytics are partially unavailable
                </Text>
                <Text size={2} color="default2" style={{ marginTop: 4 }}>
                  Order analytics are loaded, but checkout-specific metrics are limited because the current app token
                  does not have the permissions Saleor expects for this checkout path. Reinstalling or refreshing app
                  permissions after the manifest update will restore richer checkout analytics.
                </Text>
              </Box>
            ) : null}
            <Box display="grid" gap={4} __gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))">
              <KPICard
                title="Total Sales"
                value={`${stats.currency} ${stats.totalSales.toFixed(2)}`}
                icon={DollarSign}
                color="green"
                onClick={openOrdersPage}
                onLinkClick={openSaleorOrdersPage}
                linkLabel="View orders"
              />
              <KPICard
                title="Total Orders"
                value={stats.totalOrders}
                icon={ShoppingBag}
                color="blue"
                onClick={openOrdersPage}
                onLinkClick={openSaleorOrdersPage}
                linkLabel="Open orders"
              />
              <KPICard
                title="Avg. Order Value"
                value={`${stats.currency} ${stats.avgOrderValue.toFixed(2)}`}
                icon={TrendingUp}
                color="purple"
                onClick={openOrdersPage}
                onLinkClick={openSaleorOrdersPage}
                linkLabel="Analyze orders"
              />
              <KPICard
                title="Open Checkouts"
                value={stats.totalCheckouts}
                icon={ShoppingCart}
                color="orange"
                description="Only uncompleted checkouts with email/phone in selected range"
                onClick={openCheckoutsPage}
                linkLabel="Open checkout list"
              />
            </Box>

            <Box display="grid" gap={6} __gridTemplateColumns="2fr 1fr">
              <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
                <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
                  <Text as="h3" size={4} fontWeight="bold">
                    Performance Trend ({activeChannel?.name})
                  </Text>
                  <Text size={1} color="default2">
                    Bucket: {stats.chartGranularity}
                  </Text>
                </Box>

                <Box
                  display="grid"
                  gap={2}
                  __gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
                  marginBottom={4}
                >
                  {(Object.keys(chartMetricLabels) as ChartMetric[]).map((metric) => {
                    const metricValue =
                      metric === "sales"
                        ? `${stats.currency} ${formatCompactNumber(stats.totalSales)}`
                        : metric === "orders"
                          ? formatCompactNumber(stats.totalOrders)
                          : `${stats.currency} ${formatCompactNumber(stats.avgOrderValue)}`;
                    const metricChange = stats.comparison[metric];

                    return (
                      <button
                        key={metric}
                        type="button"
                        onClick={() => setChartMetric(metric)}
                        style={{
                          border: chartMetric === metric ? "1px solid #0f2940" : "1px solid #dbe1ea",
                          background: chartMetric === metric ? "#f3f6fb" : "#fff",
                          borderRadius: 10,
                          padding: "12px 14px",
                          textAlign: "left",
                          cursor: "pointer",
                          minHeight: 98,
                          display: "grid",
                          alignContent: "start",
                          gap: 6,
                        }}
                      >
                        <Text size={2} fontWeight="bold" style={{ display: "block", lineHeight: 1.3 }}>
                          {chartMetricLabels[metric]}
                        </Text>
                        <Text size={4} fontWeight="bold" style={{ display: "block", lineHeight: 1.2 }}>
                          {metricValue}
                        </Text>
                        <Text size={1} color="default2" style={{ display: "block", lineHeight: 1.35 }}>
                          {metricChange === null
                            ? "Baseline unavailable"
                            : `${metricChange >= 0 ? "+" : "-"}${Math.abs(metricChange).toFixed(1)}% vs prior`}
                        </Text>
                      </button>
                    );
                  })}
                </Box>

                {stats.chartData.length > 0 ? (
                  <Box style={{ height: 360 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" />
                        <XAxis dataKey="label" stroke="#6b7280" fontSize={12} tickMargin={8} />
                        <YAxis
                          stroke="#6b7280"
                          fontSize={12}
                          tickFormatter={(value) =>
                            chartMetric === "orders"
                              ? `${Math.round(value)}`
                              : formatCompactNumber(Number(value))
                          }
                        />
                        <Tooltip
                          formatter={(value: number | string | undefined) => {
                            const numericValue = Number(value || 0);
                            return chartMetric === "orders"
                              ? `${Math.round(numericValue)}`
                              : `${stats.currency} ${formatCompactNumber(numericValue)}`;
                          }}
                          contentStyle={{
                            borderRadius: 8,
                            border: "1px solid #dbe1ea",
                            boxShadow: "0 6px 18px rgba(15,23,42,0.15)",
                          }}
                        />
                        <Legend />
                        <Line
                          name="Current period"
                          type="monotone"
                          dataKey={chartMetricConfig[chartMetric].currentKey}
                          stroke="#0ea5e9"
                          strokeWidth={2.8}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                        <Line
                          name="Previous period"
                          type="monotone"
                          dataKey={chartMetricConfig[chartMetric].previousKey}
                          stroke="#7dd3fc"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                ) : (
                  <Box
                    padding={10}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    backgroundColor="default1"
                    borderRadius={4}
                  >
                    <Text color="default2">No chart data for this period</Text>
                  </Box>
                )}
              </Box>

              <Box padding={6} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
                <Text as="h2" size={4} marginBottom={4} fontWeight="bold">
                  Top Selling Products
                </Text>
                <Box display="grid" gap={3}>

                  {topProductsPagination.items.length > 0 ? (
                    <Box display="grid" gap={2}>
                      {topProductsPagination.items.map((product) => (
                        <Box key={product.key} className="top-product-row">
                          <a
                            href="/orders"
                            onClick={(event) => {
                              event.preventDefault();
                              openOrdersByProduct();
                            }}
                            className="top-product-link"
                            title={product.name}
                          >
                            {product.name}
                          </a>
                          <span className="top-product-qty">{product.qty}</span>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Text size={2} color="default2">
                      No products sold
                    </Text>
                  )}

                  <Box display="flex" justifyContent="space-between" alignItems="center" marginTop={2}>
                    <Text size={2} color="default2">
                      Page {currentProductsPage} / {topProductsPagination.totalPages}
                    </Text>
                    <Box display="flex" gap={2}>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={currentProductsPage <= 1}
                        onClick={() => setTopProductsPage((prev) => Math.max(1, prev - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={currentProductsPage >= topProductsPagination.totalPages}
                        onClick={() =>
                          setTopProductsPage((prev) =>
                            Math.min(topProductsPagination.totalPages, prev + 1)
                          )
                        }
                      >
                        Next
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        )
      )}
      <style jsx>{`
        .top-product-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
          gap: 10px;
          min-width: 0;
        }

        .top-product-link {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
          color: #0f2940;
          text-decoration: none;
          font-size: 14px;
          line-height: 1.35;
          font-weight: 400;
        }

        .top-product-link:hover {
          text-decoration: underline;
        }

        .top-product-qty {
          min-width: 30px;
          height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          background: #eef2f7;
          color: #5f6f81;
          font-size: 12px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
      `}</style>
    </Box>
  );
}

type KPICardProps = {
  title: string;
  value: string | number;
  icon: any;
  color: "green" | "blue" | "purple" | "orange";
  onClick?: () => void;
  onLinkClick?: () => void;
  linkLabel?: string;
  description?: string;
};

const iconColorMap = {
  green: "#10B981",
  blue: "#3B82F6",
  purple: "#8B5CF6",
  orange: "#F59E0B",
};

const KPICard = ({
  title,
  value,
  icon: Icon,
  color,
  onClick,
  onLinkClick,
  linkLabel,
  description,
}: KPICardProps) => (
  <Box
    padding={6}
    borderStyle="solid"
    borderWidth={1}
    borderColor="default1"
    borderRadius={4}
    display="grid"
    gap={2}
    onClick={onClick}
    style={{
      minHeight: 180,
      height: 180,
      cursor: onClick ? "pointer" : "default",
      transition: "box-shadow 0.2s ease",
    }}
  >
    <Box display="flex" justifyContent="space-between" alignItems="center">
      <Text size={2} color="default2" fontWeight="bold" textTransform="uppercase">
        {title}
      </Text>
      <Box padding={2} borderRadius={4} backgroundColor="default2">
        <Icon size={20} color={iconColorMap[color]} />
      </Box>
    </Box>

    <Text size={7} fontWeight="bold" style={{ lineHeight: 1.2 }}>
      {value}
    </Text>

    <Box marginTop="auto">
      {description && (
        <Text size={1} color="default2" marginBottom={1}>
          {description}
        </Text>
      )}
      {onClick && linkLabel && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            (onLinkClick || onClick)?.();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
            color: "#5f6f81",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          {linkLabel} <ArrowUpRight size={14} />
        </button>
      )}
    </Box>
  </Box>
);

const ShoppingBag = ({ size, color }: { size: number; color: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
