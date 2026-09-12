import { db } from "../db.js";

export interface CompetencySample {
  createdAt: Date | string;
  completionDate: Date | string | null;
  appliedAssessmentScore: number | null;
  appliedThreshold: number;
}

export function timeToCompetencyDays(samples: CompetencySample[]): number | null {
  const days = samples
    .filter((s) => s.completionDate && (s.appliedAssessmentScore ?? 0) >= s.appliedThreshold)
    .map((s) => (+new Date(s.completionDate as Date) - +new Date(s.createdAt)) / 86400000)
    .filter((d) => d >= 0);
  if (!days.length) return null;
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

export function trainerUtilizationRate(trainers: { id: string; name: string }[], bookedTrainerNames: string[]): number {
  if (!trainers.length) return 0;
  const booked = new Set(bookedTrainerNames.map((n) => n.trim().toLowerCase()));
  const active = trainers.filter((t) => booked.has(t.name.trim().toLowerCase())).length;
  return Math.round((active / trainers.length) * 100);
}

export interface ActivityPoint { label: string; active: number; completed: number }

export function weeklyActivitySeries(messageDates: (Date | string)[], completionDates: (Date | string)[], now: Date = new Date()): ActivityPoint[] {
  const days: ActivityPoint[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toDateString();
    days.push({
      label: d.toLocaleDateString("en-GB", { weekday: "short" }),
      active: messageDates.filter((m) => new Date(m).toDateString() === key).length,
      completed: completionDates.filter((c) => new Date(c).toDateString() === key).length,
    });
  }
  return days;
}

export function dropOffHeatmap(courses: { title: string; enrolled: number; completed: number }[]): { label: string; value: number }[] {
  return courses
    .map((c) => ({ label: c.title, value: c.enrolled ? Math.round(((c.enrolled - c.completed) / c.enrolled) * 1000) / 10 : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export function satisfactionScore(ratings: number[]): { average: number | null; responses: number } {
  if (!ratings.length) return { average: null, responses: 0 };
  return { average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10, responses: ratings.length };
}

interface SummaryEnrolment {
  status: string;
  courseId: string;
  learnerId: string;
  createdAt: Date;
  completionDate: Date | null;
  appliedAssessmentScore: number | null;
  course: { appliedThreshold: number; title: string; id: string };
}

export async function buildDashboardSummary(orgId: string) {
  const [programmes, enrolments, messages, feedback, trainers, bookings, sessions] = await Promise.all([
    db.programme.findMany({ where: { orgId } }).catch(() => []),
    db.enrolment.findMany({ where: { programme: { orgId } }, include: { course: { select: { appliedThreshold: true, title: true, id: true } } }, take: 5000 }).catch(() => [] as SummaryEnrolment[]),
    db.message.findMany({ take: 2000, orderBy: { createdAt: "desc" } }).catch(() => []),
    db.courseFeedback.findMany({ where: { course: { programme: { orgId } } }, take: 2000 }).catch(() => []),
    db.user.findMany({ where: { orgId, roles: { some: { role: { name: "trainer" } } } }, select: { id: true, name: true } }).catch(() => []),
    db.booking.findMany({ take: 1000 }).catch(() => []),
    db.session.findMany({ take: 500 }).catch(() => []),
  ]);
  const rows = enrolments as SummaryEnrolment[];
  const total = rows.length || 1;
  const completed = rows.filter((e) => e.status === "completed");
  const competent = rows.filter((e) => (e.appliedAssessmentScore ?? 0) >= e.course.appliedThreshold);
  const byCourse = new Map<string, { title: string; enrolled: number; completed: number }>();
  for (const e of enrolments) {
    const row = byCourse.get(e.courseId) ?? { title: e.course.title, enrolled: 0, completed: 0 };
    row.enrolled += 1;
    if (e.status === "completed") row.completed += 1;
    byCourse.set(e.courseId, row);
  }
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 30);
  const expiring = await db.certificate.findMany({
    where: { status: "active", expiresAt: { lte: horizon }, course: { programme: { orgId } } },
    include: { course: { select: { title: true } }, learner: { select: { name: true } } },
    orderBy: { expiresAt: "asc" },
    take: 10,
  }).catch(() => []);
  const now = new Date();
  return {
    complianceHealth: total ? Math.round((competent.length / total) * 100) : 0,
    completionRate: Math.round((completed.length / total) * 100),
    competencyRate: Math.round((competent.length / total) * 100),
    expiringCredentials: expiring.length,
    dropOffRate: Math.round(((total - completed.length) / total) * 100),
    timeToCompetency: timeToCompetencyDays(rows.map((e) => ({ createdAt: e.createdAt, completionDate: e.completionDate, appliedAssessmentScore: e.appliedAssessmentScore, appliedThreshold: e.course.appliedThreshold }))) ?? 0,
    trainerUtilization: trainerUtilizationRate(trainers, bookings.map((b) => b.trainer)),
    weeklyActivity: weeklyActivitySeries(messages.map((m) => m.createdAt), completed.map((e) => e.completionDate).filter(Boolean) as Date[], now),
    dropOffHeatmap: dropOffHeatmap([...byCourse.values()]),
    expiringItems: expiring.map((c) => ({ name: c.learner.name, course: c.course.title, expires: c.expiresAt?.toISOString() ?? "", status: c.expiresAt && c.expiresAt < now ? "expired" : "expiring" })),
    satisfaction: satisfactionScore(feedback.map((f) => f.rating)),
    sessionCount: sessions.length,
    programmeCount: programmes.length,
  };
}

