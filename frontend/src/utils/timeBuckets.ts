export interface MinuteRange {
  start: number;
  end: number;
}

export function parseTimeSlotRangeMinutes(timeSlot: string): MinuteRange | null {
  const normalized = timeSlot.trim().toLowerCase();
  const match = normalized.match(/^(\d{1,2}):(\d{2})(am|pm)\s*[–-]\s*(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;

  const toMinutes = (hRaw: string, mRaw: string, period: string): number => {
    let hour = Number(hRaw);
    const minute = Number(mRaw);
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour * 60 + minute;
  };

  const start = toMinutes(match[1], match[2], match[3]);
  const end = toMinutes(match[4], match[5], match[6]);
  return end > start ? { start, end } : null;
}

export function getBucketWindowFromHour(hour: number, bucketMinutes: number): MinuteRange {
  const start = Math.floor(hour) * 60 + (hour % 1 >= 0.5 ? 30 : 0);
  return { start, end: start + bucketMinutes };
}

export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.start < b.end && a.end > b.start;
}

export function normalizePriceToBucket(totalPrice: number, sourceMinutes: number, bucketMinutes: number): number {
  if (sourceMinutes <= 0) return totalPrice;
  return (totalPrice / sourceMinutes) * bucketMinutes;
}
