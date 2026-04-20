export type GenbiRange = {
  start: string;
  end: string;
  label: string;
  compareStart?: string;
  compareEnd?: string;
};

function getShanghaiToday(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '');
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function getLastWeekRange(): GenbiRange {
  const today = getShanghaiToday();
  const day = today.getUTCDay() || 7;
  const thisWeekMonday = shiftDays(today, -(day - 1));
  const lastWeekMonday = shiftDays(thisWeekMonday, -7);
  const lastWeekSunday = shiftDays(thisWeekMonday, -1);
  return {
    start: formatDate(lastWeekMonday),
    end: formatDate(lastWeekSunday),
    compareStart: formatDate(shiftDays(lastWeekMonday, -7)),
    compareEnd: formatDate(shiftDays(lastWeekSunday, -7)),
    label: '上周',
  };
}

export function getLastMonthRange(): GenbiRange {
  const today = getShanghaiToday();
  const firstDayThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const lastDayLastMonth = shiftDays(firstDayThisMonth, -1);
  const firstDayLastMonth = new Date(Date.UTC(lastDayLastMonth.getUTCFullYear(), lastDayLastMonth.getUTCMonth(), 1));
  const lastDayPrevMonth = shiftDays(firstDayLastMonth, -1);
  const firstDayPrevMonth = new Date(Date.UTC(lastDayPrevMonth.getUTCFullYear(), lastDayPrevMonth.getUTCMonth(), 1));
  return {
    start: formatDate(firstDayLastMonth),
    end: formatDate(lastDayLastMonth),
    compareStart: formatDate(firstDayPrevMonth),
    compareEnd: formatDate(lastDayPrevMonth),
    label: '上月',
  };
}

export function getYesterdayRange(): GenbiRange {
  const today = getShanghaiToday();
  const yesterday = shiftDays(today, -1);
  const previous = shiftDays(today, -2);
  return {
    start: formatDate(yesterday),
    end: formatDate(yesterday),
    compareStart: formatDate(previous),
    compareEnd: formatDate(previous),
    label: '昨日',
  };
}

function getRecent7DayRange(): GenbiRange {
  const today = getShanghaiToday();
  const end = shiftDays(today, -1);
  const start = shiftDays(end, -6);
  return {
    start: formatDate(start),
    end: formatDate(end),
    label: '近7天',
  };
}

function normalizeExplicitDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!valid) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDefaultQuestionYear(): number {
  return getShanghaiToday().getUTCFullYear();
}

function getMonthRange(year: number, month: number): GenbiRange | null {
  const start = normalizeExplicitDate(year, month, 1);
  if (!start) return null;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstDayNextMonth = new Date(Date.UTC(nextMonthYear, nextMonth - 1, 1));
  firstDayNextMonth.setUTCDate(firstDayNextMonth.getUTCDate() - 1);
  const end = `${firstDayNextMonth.getUTCFullYear()}-${String(firstDayNextMonth.getUTCMonth() + 1).padStart(2, '0')}-${String(firstDayNextMonth.getUTCDate()).padStart(2, '0')}`;
  return { start, end, label: `${start} 至 ${end}` };
}

function detectExplicitDateRange(question: string): GenbiRange | null {
  const normalized = question.replace(/\s+/g, '');
  const year = getDefaultQuestionYear();
  const fullRangeMatch = normalized.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:到|至|-|~)(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if (fullRangeMatch) {
    const start = normalizeExplicitDate(Number.parseInt(fullRangeMatch[1], 10), Number.parseInt(fullRangeMatch[2], 10), Number.parseInt(fullRangeMatch[3], 10));
    const end = normalizeExplicitDate(Number.parseInt(fullRangeMatch[4], 10), Number.parseInt(fullRangeMatch[5], 10), Number.parseInt(fullRangeMatch[6], 10));
    if (start && end && start <= end) return { start, end, label: `${start} 至 ${end}` };
  }

  const sameYearRangeMatch = normalized.match(/(\d{1,2})月(\d{1,2})日?(?:到|至|-|~)(\d{1,2})月(\d{1,2})日?/);
  if (sameYearRangeMatch) {
    const start = normalizeExplicitDate(year, Number.parseInt(sameYearRangeMatch[1], 10), Number.parseInt(sameYearRangeMatch[2], 10));
    const end = normalizeExplicitDate(year, Number.parseInt(sameYearRangeMatch[3], 10), Number.parseInt(sameYearRangeMatch[4], 10));
    if (start && end && start <= end) return { start, end, label: `${start} 至 ${end}` };
  }

  const sameMonthRangeMatch = normalized.match(/(\d{1,2})月(\d{1,2})日?(?:到|至|-|~)(\d{1,2})日/);
  if (sameMonthRangeMatch) {
    const month = Number.parseInt(sameMonthRangeMatch[1], 10);
    const start = normalizeExplicitDate(year, month, Number.parseInt(sameMonthRangeMatch[2], 10));
    const end = normalizeExplicitDate(year, month, Number.parseInt(sameMonthRangeMatch[3], 10));
    if (start && end && start <= end) return { start, end, label: `${start} 至 ${end}` };
  }

  const singleFullMatch = normalized.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if (singleFullMatch) {
    const date = normalizeExplicitDate(Number.parseInt(singleFullMatch[1], 10), Number.parseInt(singleFullMatch[2], 10), Number.parseInt(singleFullMatch[3], 10));
    if (date) return { start: date, end: date, label: date };
  }

  const singleMonthDayMatch = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  if (singleMonthDayMatch) {
    const date = normalizeExplicitDate(year, Number.parseInt(singleMonthDayMatch[1], 10), Number.parseInt(singleMonthDayMatch[2], 10));
    if (date) return { start: date, end: date, label: date };
  }

  const explicitYearMonthMatch = normalized.match(/(\d{4})[-/年](\d{1,2})月?/);
  if (explicitYearMonthMatch) {
    const monthRange = getMonthRange(Number.parseInt(explicitYearMonthMatch[1], 10), Number.parseInt(explicitYearMonthMatch[2], 10));
    if (monthRange) return monthRange;
  }

  const singleMonthMatch = normalized.match(/(\d{1,2})月/);
  if (singleMonthMatch) {
    const monthRange = getMonthRange(year, Number.parseInt(singleMonthMatch[1], 10));
    if (monthRange) return monthRange;
  }

  return null;
}

export function detectDateRange(question: string): GenbiRange {
  const explicitRange = detectExplicitDateRange(question);
  if (explicitRange) return explicitRange;
  if (/上周/.test(question)) return getLastWeekRange();
  if (/上月/.test(question)) return getLastMonthRange();
  if (/昨日|昨天/.test(question)) return getYesterdayRange();
  return getRecent7DayRange();
}
