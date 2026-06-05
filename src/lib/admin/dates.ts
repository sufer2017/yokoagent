const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function dateParts(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateString}`);
  }
  return { year, month, day };
}

export function addDateDays(dateString: string, days: number) {
  const { year, month, day } = dateParts(dateString);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function beijingTodayDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function defaultBusinessAnchorDate(now = new Date()) {
  return addDateDays(beijingTodayDate(now), -1);
}
