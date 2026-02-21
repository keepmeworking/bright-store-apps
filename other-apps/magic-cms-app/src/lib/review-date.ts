const EXCEL_EPOCH_OFFSET = 25569;
const MILLISECONDS_PER_DAY = 86_400_000;

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const normalizeMonth = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) {
    return Number.NaN;
  }
  return parsed - 1;
};

const normalizeDay = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 31) {
    return Number.NaN;
  }
  return parsed;
};

const normalizeYear = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }
  if (value.length === 2) {
    return parsed >= 70 ? 1900 + parsed : 2000 + parsed;
  }
  return parsed;
};

const normalizeTime = (hourRaw?: string, minuteRaw?: string, secondRaw?: string, ampmRaw?: string) => {
  let hour = hourRaw ? Number.parseInt(hourRaw, 10) : 0;
  const minute = minuteRaw ? Number.parseInt(minuteRaw, 10) : 0;
  const second = secondRaw ? Number.parseInt(secondRaw, 10) : 0;

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isFinite(second) || second < 0 || second > 59) return null;

  if (ampmRaw) {
    const ampm = ampmRaw.toLowerCase();
    if (hour < 1 || hour > 12) return null;
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }

  return { hour, minute, second };
};

const tryParseByParts = (value: string) => {
  const match = value.match(
    /^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})(?:[T\s,]+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(AM|PM|am|pm)?)?(?:\s*(UTC|GMT|Z))?$/
  );
  if (!match) {
    return undefined;
  }

  const first = match[1];
  const second = match[2];
  const third = match[3];
  const time = normalizeTime(match[4], match[5], match[6], match[7]);
  if (!time) {
    return undefined;
  }

  const hasUtc = Boolean(match[8]);
  let year = Number.NaN;
  let month = Number.NaN;
  let day = Number.NaN;

  if (first.length === 4) {
    year = normalizeYear(first);
    month = normalizeMonth(second);
    day = normalizeDay(third);
  } else if (third.length === 4) {
    year = normalizeYear(third);
    const firstNumber = Number.parseInt(first, 10);
    const secondNumber = Number.parseInt(second, 10);

    if (firstNumber > 12 && secondNumber <= 12) {
      day = normalizeDay(first);
      month = normalizeMonth(second);
    } else if (secondNumber > 12 && firstNumber <= 12) {
      day = normalizeDay(second);
      month = normalizeMonth(first);
    } else {
      // Prefer day-first for ambiguous values.
      day = normalizeDay(first);
      month = normalizeMonth(second);
    }
  } else {
    return undefined;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }

  const parsed = hasUtc
    ? new Date(Date.UTC(year, month, day, time.hour, time.minute, time.second))
    : new Date(year, month, day, time.hour, time.minute, time.second);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
};

export const parseImportReviewDateToIso = (value: string) => {
  const raw = value.trim();
  if (!raw) return undefined;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const excelSerial = toNumber(raw);
    if (Number.isFinite(excelSerial) && excelSerial > 0) {
      const parsed = new Date((excelSerial - EXCEL_EPOCH_OFFSET) * MILLISECONDS_PER_DAY);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  const normalized = raw
    .replace(/\s+UTC$/i, "Z")
    .replace(/\s+GMT$/i, "Z")
    .replace(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/, "$1T$2");

  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  return tryParseByParts(raw);
};
