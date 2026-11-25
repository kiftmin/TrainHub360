import { db, Prisma } from "../db.js";
import {
  addDays,
  calendarDateKey,
  localDateKey,
  localTimeKey,
  resolveTimeZone,
  startOfLocalDay,
  weekdayForDateKey,
  zonedTimeToUtc,
} from "./timeZone.js";

const DAY_MS = 86_400_000;

function minutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!match) return null;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value < 1440 ? value : null;
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
  const from = /^\d{4}-\d{2}-\d{2}$/.test(options.from) ? options.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(options.to) ? options.to : null;
  if (!from || !to) return { error: "from and to must be YYYY-MM-DD" as const };
  if (to < from) return { error: "to must not be before from" as const };

  const [timeZoneRule, availabilities, exceptions, bookings, sessions, trainer] = await Promise.all([
    db.trainerAvailability.findFirst({
      where: { trainerId: options.trainerId, orgId: options.orgId, isActive: true },
      select: { timeZone: true },
      orderBy: { createdAt: "asc" },
    }),
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
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        ...(options.programmeIds ? { OR: [{ programmeId: null }, { programmeId: { in: options.programmeIds } }] } : {}),
      },
    }),
    db.booking.findMany({
      where: {
        trainerId: options.trainerId,
        status: "confirmed",
        startsAt: { not: null },
      },
      select: { startsAt: true, endsAt: true },
    }),
    db.session.findMany({
      where: {
        trainerId: options.trainerId,
        status: "scheduled",
        startsAt: { not: null },
      },
      select: { startsAt: true, endsAt: true },
    }),
    db.user.findFirst({ where: { id: options.trainerId, orgId: options.orgId }, select: { id: true } }),
  ]);
  if (!trainer) return { error: "trainer not found in your organization" as const };

  const timeZone = resolveTimeZone(timeZoneRule?.timeZone);
  const rangeStart = startOfLocalDay(from, timeZone) ?? new Date(`${from}T00:00:00.000Z`);
  const rangeEnd = startOfLocalDay(addDays(to, 1), timeZone) ?? new Date(`${addDays(to, 1)}T00:00:00.000Z`);
  const busy = [...bookings, ...sessions].filter((item) => item.startsAt && item.startsAt < rangeEnd && (item.endsAt ?? new Date(item.startsAt.getTime() + DAY_MS)) > rangeStart);
  const slots: Array<{
    availabilityId: string | null;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    durationMinutes: number;
    available: boolean;
  }> = [];

  const days = Math.min(Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS) + 1, 35);
  for (let offset = 0; offset < days; offset += 1) {
    const key = addDays(from, offset);
    for (const rule of availabilities) {
      if (rule.dayOfWeek !== weekdayForDateKey(key)) continue;
      const ruleTimeZone = resolveTimeZone(rule.timeZone, timeZone);
      const validFrom = calendarDateKey(rule.validFrom);
      const validTo = calendarDateKey(rule.validTo);
      if (validFrom && validFrom > key) continue;
      if (validTo && validTo < key) continue;
      const startMin = minutes(rule.startTime);
      const endMin = minutes(rule.endTime);
      if (startMin === null || endMin === null || endMin <= startMin) continue;
      for (let mins = startMin; mins + rule.slotMinutes <= endMin; mins += rule.slotMinutes) {
        const startsAt = zonedTimeToUtc(key, `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`, ruleTimeZone);
        if (!startsAt) continue;
        const endsAt = new Date(startsAt.getTime() + rule.slotMinutes * 60_000);
        const blocked = exceptions.some((exception) => {
          if (calendarDateKey(exception.date) !== key || exception.isAvailable) return false;
          if (!exception.startsAt) return true;
          return overlaps(startsAt, endsAt, exception.startsAt, exception.endsAt);
        });
        slots.push({
          availabilityId: rule.id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timeZone: ruleTimeZone,
          durationMinutes: rule.slotMinutes,
          available: !blocked && !busy.some((item) => overlaps(startsAt, endsAt, item.startsAt, item.endsAt)),
        });
      }
    }
    for (const exception of exceptions.filter((item) => calendarDateKey(item.date) === key && item.isAvailable && item.startsAt)) {
      const startsAt = new Date(exception.startsAt!);
      const endsAt = exception.endsAt ?? new Date(startsAt.getTime() + 30 * 60_000);
      slots.push({
        availabilityId: null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone,
        durationMinutes: Math.max(15, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)),
        available: !busy.some((item) => overlaps(startsAt, endsAt, item.startsAt, item.endsAt)),
      });
    }
  }

  return { timeZone, slots: slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}

export async function bookingConflicts(options: {
  trainerId: string;
  learnerId: string;
  startsAt: Date;
  endsAt: Date;
  excludeBookingId?: string;
  client?: Prisma.TransactionClient | typeof db;
  lock?: boolean;
}) {
  const client = options.client ?? db;
  if (options.lock) {
    await client.$queryRaw`
      SELECT id FROM dbo.bookings WITH (UPDLOCK, HOLDLOCK)
      WHERE status = N'confirmed'
        AND starts_at < ${options.endsAt}
        AND ends_at > ${options.startsAt}
        AND (trainer_id = ${options.trainerId} OR learner_id = ${options.learnerId})
      ORDER BY id
    `;
    await client.$queryRaw`
      SELECT id FROM dbo.sessions WITH (UPDLOCK, HOLDLOCK)
      WHERE status = N'scheduled'
        AND starts_at < ${options.endsAt}
        AND ends_at > ${options.startsAt}
        AND trainer_id = ${options.trainerId}
      ORDER BY id
    `;
  }
  const [bookings, sessions] = await Promise.all([
    client.booking.findMany({
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
    client.session.findMany({
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

export function bookingLocalFields(startsAt: Date, timeZone: string): { date: string; time: string } {
  return { date: localDateKey(startsAt, timeZone), time: localTimeKey(startsAt, timeZone) };
}
