// No Node imports: also used in the browser, with the viewer's own time zone.
/**
 * Free slots at fixed local hours, skipping already-booked hours for the account. Deliberately labelled
 * "free slots", not "best times": there is no engagement data yet to rank them (J6 analytics).
 */
export function freeSlots(now: Date, booked: Date[], hours = [12, 18, 20], count = 3, tzOffsetMin = 0): Date[] {
  const taken = new Set(booked.map((d) => Math.floor(d.getTime() / 3_600_000)));
  const out: Date[] = [];
  for (let day = 0; out.length < count && day < 14; day++) {
    for (const h of hours) {
      const local = new Date(now.getTime() - tzOffsetMin * 60_000);
      const slot = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, h) + tzOffsetMin * 60_000);
      if (slot.getTime() > now.getTime() + 15 * 60_000 && !taken.has(Math.floor(slot.getTime() / 3_600_000))) out.push(slot);
      if (out.length === count) break;
    }
  }
  return out;
}


/** Days shown, in the viewer's local time: a Monday-first week, or the weeks covering a month. */
export function visibleDays(view: "week" | "month", anchor: string): Date[] {
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  const a = new Date(y, m - 1, d);
  const first = view === "week" ? a : new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const count = view === "week" ? 7 : Math.ceil(((first.getDay() + 6) % 7 + new Date(y, m, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

