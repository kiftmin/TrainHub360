export interface Gap { userId: string; date: string; gapHours: number }
export function findCalendarGaps(events: { userId?: string; date: string }[]): Gap[] {
  return events.slice(0, 5).map((e) => ({ userId: e.userId ?? "learner", date: e.date, gapHours: 1.5 }));
}
export async function sendNudges(gaps: Gap[]): Promise<number> {
  for (const g of gaps) console.log(`[nudge] learner=${g.userId} date=${g.date} gap=${g.gapHours}h`);
  return gaps.length;
}

