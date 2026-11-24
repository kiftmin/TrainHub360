import { db } from "../db.js";

const DAY_MS = 86_400_000;

function dateKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function utcDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function minutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!match) return null;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value < 1440 ? value : null;
}

function atTime(day: Date, mins: number): Date {
  return new Date(day.getTime() + mins * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date | null, bEnd: Date | null): boolean {
  if (!bStart) return false;
  const bEndValue = bEnd ?? new Date(bStart.getTime() + 30 * 60_000);
  return aStart < bEndValue && bStart < aEnd;
}

export async function availableSlotsForTrainer(options: {
  orgId: string;
  trainerId: string;
  from: string;
  to: string;
  programmeIds: string[] | null;
}) {
  const from = utcDate(options.from);
  const to = utcDate(options.to);
  if (!from || !to) return { error: "from and to must be YYYY-MM-DD" as const };
  if (to < from) return { error: "to must not be before from" as const };
  const days = Math.min(Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1, 35);
  const rangeEnd = new Date(from.getTime() + days * DAY_MS);

  const [availabilities, exceptions, bookings, sessions, trainer] = await Promise.all([
    db.trainerAvailability.findMany({
      where: {
        trainerId: options.trainerId,
        orgId: options.orgId,
        isActive: true,
        ...(options.programmeIds ? { OR: [{ programmeId: null }, { programmeId: { in: options.programmeIds } }] } : {}),
      },
    }),
    db.trainerAvailabilityException.findMany({
      where: {
        trainerId: options.trainerId,
        orgId: options.orgId,
        date: { gte: from, lt: rangeEnd },
        ...(options.programmeIds ? { OR: [{ programmeId: null }, { programmeId: { in: options.programmeIds } }] } : {}),
      },
    }),
    db.booking.findMany({
      where: {
        trainerId: options.trainerId,
        status: "confirmed",
        startsAt: { not: null, gte: from, lt: rangeEnd },
      },
      select: { startsAt: true, endsAt: true },
    }),
    db.session.findMany({
      where: {
        trainerId: options.trainerId,
        status: "scheduled",
        startsAt: { not: null, gte: from, lt: rangeEnd },
      },
      select: { startsAt: true, endsAt: true },
    }),
    db.user.findFirst({ where: { id: options.trainerId, orgId: options.orgId }, select: { id: true } }),
  ]);
  if (!trainer) return { error: "trainer not found in your organization" as const };

  const busy = [...bookings, ...sessions];
  const slots: Array<{
    availabilityId: string | null;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    durationMinutes: number;
    available: boolean;
  }> = [];

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(from.getTime() + offset * DAY_MS);
    const key = dateKey(day);
    for (const rule of availabilities) {
      if (rule.dayOfWeek !== day.getUTCDay()) continue;
      if (rule.validFrom && dateKey(rule.validFrom) > key) continue;
      if (rule.validTo && dateKey(rule.validTo) < key) continue;
      const startMin = minutes(rule.startTime);
      const endMin = minutes(rule.endTime);
      if (startMin === null || endMin === null || endMin <= startMin) continue;
      for (let mins = startMin; mins + rule.slotMinutes <= endMin; mins += rule.slotMinutes) {
        const startsAt = atTime(day, mins);
        const endsAt = new Date(startsAt.getTime() + rule.slotMinutes * 60_000);
        const blocked = exceptions.some((exception) => {
          if (dateKey(exception.date) !== key || exception.isAvailable) return false;
          if (!exception.startsAt) return true;
          return overlaps(startsAt, endsAt, exception.startsAt, exception.endsAt);
        });
        slots.push({
          availabilityId: rule.id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timeZone: rule.timeZone,
          durationMinutes: rule.slotMinutes,
          available: !blocked && !busy.some((item) => overlaps(startsAt, endsAt, item.startsAt, item.endsAt)),
        });
      }
    }
    for (const exception of exceptions.filter((item) => dateKey(item.date) === key && item.isAvailable && item.startsAt)) {
      const startsAt = new Date(exception.startsAt!);
      const endsAt = exception.endsAt ?? new Date(startsAt.getTime() + 30 * 60_000);
      slots.push({
        availabilityId: null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone: "UTC",
        durationMinutes: Math.max(15, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)),
        available: !busy.some((item) => overlaps(startsAt, endsAt, item.startsAt, item.endsAt)),
      });
    }
  }

  return { slots: slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}

export async function bookingConflicts(options: {
  trainerId: string;
  learnerId: string;
  startsAt: Date;
  endsAt: Date;
  excludeBookingId?: string;
}) {
  const [bookings, sessions] = await Promise.all([
    db.booking.findMany({
      where: {
        status: "confirmed",
        id: options.excludeBookingId ? { not: options.excludeBookingId } : undefined,
        OR: [{ trainerId: options.trainerId }, { learnerId: options.learnerId }],
        startsAt: { lt: options.endsAt },
        endsAt: { gt: options.startsAt },
      },
      select: { id: true },
      take: 1,
    }),
    db.session.findMany({
      where: {
        trainerId: options.trainerId,
        status: "scheduled",
        startsAt: { lt: options.endsAt },
        endsAt: { gt: options.startsAt },
      },
      select: { id: true },
      take: 1,
    }),
  ]);
  return bookings.length > 0 || sessions.length > 0;
}
