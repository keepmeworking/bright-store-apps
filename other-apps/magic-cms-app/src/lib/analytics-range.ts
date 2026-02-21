import { format, parseISO, startOfDay, endOfDay } from "date-fns";

export type AppliedRange = {
  label: string;
  startDate: Date;
  endDate: Date;
};

export const toDateQuery = (date: Date) => format(date, "yyyy-MM-dd");

export const resolveRangeFromQuery = (
  start?: string | string[],
  end?: string | string[],
  fallback?: AppliedRange
): AppliedRange => {
  const startRaw = Array.isArray(start) ? start[0] : start;
  const endRaw = Array.isArray(end) ? end[0] : end;

  if (!startRaw || !endRaw) {
    return (
      fallback || {
        label: "Selected range",
        startDate: startOfDay(new Date()),
        endDate: endOfDay(new Date()),
      }
    );
  }

  const parsedStart = startOfDay(parseISO(startRaw));
  const parsedEnd = endOfDay(parseISO(endRaw));

  if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
    return (
      fallback || {
        label: "Selected range",
        startDate: startOfDay(new Date()),
        endDate: endOfDay(new Date()),
      }
    );
  }

  return {
    label: `${format(parsedStart, "dd MMM yyyy")} - ${format(parsedEnd, "dd MMM yyyy")}`,
    startDate: parsedStart,
    endDate: parsedEnd,
  };
};
