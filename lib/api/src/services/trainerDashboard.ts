import { db } from "../db.js";

export interface TrainerDashboardProgramme {
  id: string;
  name: string;
  courseCount: number;
  learnerCount: number;
  enrolmentCount: number;
}

export interface TrainerDashboardCourse {
  id: string;
  title: string;
  programmeId: string;
  programmeName: string;
  progress: number;
  status: string;
  dueDate: string | null;
  enrolmentCount: number;
  completedEnrolmentCount: number;
}

export interface TrainerDashboardLearner {
  id: string;
  name: string;
  programmeId: string;
  programmeName: string;
  enrolmentCount: number;
  activeEnrolmentCount: number;
  completedEnrolmentCount: number;
}

export interface TrainerDashboardEnrolment {
  id: string;
  learnerId: string;
  learnerName: string;
  programmeId: string;
  programmeName: string;
  courseId: string;
  courseTitle: string;
  status: string;
  progress: number;
  completionDate: string | null;
}

export interface TrainerDashboardSession {
  id: string;
  title: string;
  programmeId: string;
  programmeName: string;
  courseId: string | null;
  courseTitle: string | null;
  date: string;
  time: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  mode: string;
  attendees: number;
  capacity: number | null;
}

export interface TrainerDashboardSummary {
  programmes: TrainerDashboardProgramme[];
  courses: TrainerDashboardCourse[];
  learners: TrainerDashboardLearner[];
  enrolments: TrainerDashboardEnrolment[];
  sessions: TrainerDashboardSession[];
  summary: {
    programmeCount: number;
    courseCount: number;
    learnerCount: number;
    enrolmentCount: number;
    activeEnrolmentCount: number;
    completedEnrolmentCount: number;
    upcomingSessionCount: number;
  };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function buildTrainerDashboardSummary(trainerId: string, orgId: string, programmeIds: string[]): Promise<TrainerDashboardSummary> {
  const now = new Date();
  const sessionWhere = {
    orgId,
    programmeId: { in: programmeIds },
    trainerId,
    startsAt: { gte: now },
    status: { notIn: ["cancelled", "completed"] },
  };
  const [programmes, courses, enrolments, sessions, upcomingSessionCount] = await Promise.all([
    db.programme.findMany({
      where: { orgId, id: { in: programmeIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.course.findMany({
      where: {
        programmeId: { in: programmeIds },
        programme: { orgId },
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        programmeId: true,
        programme: { select: { name: true } },
        progress: true,
        status: true,
        dueDate: true,
      },
      orderBy: { title: "asc" },
      take: 500,
    }),
    db.enrolment.findMany({
      where: {
        programmeId: { in: programmeIds },
        programme: { orgId },
        status: { not: "withdrawn" },
        withdrawnAt: null,
      },
      select: {
        id: true,
        learnerId: true,
        courseId: true,
        programmeId: true,
        status: true,
        progress: true,
        completionDate: true,
        learner: { select: { id: true, name: true } },
        course: { select: { id: true, title: true } },
        programme: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.session.findMany({
      where: sessionWhere,
      select: {
        id: true,
        title: true,
        programmeId: true,
        programmeRef: { select: { name: true } },
        courseId: true,
        courseRef: { select: { title: true } },
        date: true,
        time: true,
        startsAt: true,
        endsAt: true,
        status: true,
        mode: true,
        attendees: true,
        capacity: true,
      },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
    db.session.count({ where: sessionWhere }),
  ]);

  const coursesByProgramme = new Map<string, number>();
  for (const course of courses) coursesByProgramme.set(course.programmeId, (coursesByProgramme.get(course.programmeId) ?? 0) + 1);

  const enrolmentsByProgramme = new Map<string, number>();
  const enrolmentsByCourse = new Map<string, { total: number; completed: number }>();
  const learnerRows = new Map<string, TrainerDashboardLearner>();
  const learnerIds = new Set<string>();
  for (const enrolment of enrolments) {
    learnerIds.add(enrolment.learnerId);
    enrolmentsByProgramme.set(enrolment.programmeId, (enrolmentsByProgramme.get(enrolment.programmeId) ?? 0) + 1);
    const courseCounts = enrolmentsByCourse.get(enrolment.courseId) ?? { total: 0, completed: 0 };
    courseCounts.total += 1;
    if (enrolment.status === "completed") courseCounts.completed += 1;
    enrolmentsByCourse.set(enrolment.courseId, courseCounts);

    const learnerKey = `${enrolment.learnerId}:${enrolment.programmeId}`;
    const learner = learnerRows.get(learnerKey) ?? {
      id: enrolment.learner.id,
      name: enrolment.learner.name,
      programmeId: enrolment.programmeId,
      programmeName: enrolment.programme.name,
      enrolmentCount: 0,
      activeEnrolmentCount: 0,
      completedEnrolmentCount: 0,
    };
    learner.enrolmentCount += 1;
    if (enrolment.status === "completed") learner.completedEnrolmentCount += 1;
    else learner.activeEnrolmentCount += 1;
    learnerRows.set(learnerKey, learner);
  }

  const learnerCountsByProgramme = new Map<string, Set<string>>();
  for (const learner of learnerRows.values()) {
    const set = learnerCountsByProgramme.get(learner.programmeId) ?? new Set<string>();
    set.add(learner.id);
    learnerCountsByProgramme.set(learner.programmeId, set);
  }

  const programmeRows: TrainerDashboardProgramme[] = programmes.map((programme) => ({
    id: programme.id,
    name: programme.name,
    courseCount: coursesByProgramme.get(programme.id) ?? 0,
    learnerCount: learnerCountsByProgramme.get(programme.id)?.size ?? 0,
    enrolmentCount: enrolmentsByProgramme.get(programme.id) ?? 0,
  }));

  const courseRows: TrainerDashboardCourse[] = courses.map((course) => ({
    id: course.id,
    title: course.title,
    programmeId: course.programmeId,
    programmeName: course.programme.name,
    progress: course.progress,
    status: course.status,
    dueDate: course.dueDate,
    enrolmentCount: enrolmentsByCourse.get(course.id)?.total ?? 0,
    completedEnrolmentCount: enrolmentsByCourse.get(course.id)?.completed ?? 0,
  }));

  const sessionRows: TrainerDashboardSession[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    programmeId: session.programmeId!,
    programmeName: session.programmeRef?.name ?? "",
    courseId: session.courseId,
    courseTitle: session.courseRef?.title ?? null,
    date: session.date,
    time: session.time,
    startsAt: iso(session.startsAt),
    endsAt: iso(session.endsAt),
    status: session.status,
    mode: session.mode,
    attendees: session.attendees,
    capacity: session.capacity,
  }));

  const completedEnrolmentCount = enrolments.filter((e) => e.status === "completed").length;
  return {
    programmes: programmeRows,
    courses: courseRows,
    learners: [...learnerRows.values()],
    enrolments: enrolments.map((e) => ({
      id: e.id,
      learnerId: e.learner.id,
      learnerName: e.learner.name,
      programmeId: e.programmeId,
      programmeName: e.programme.name,
      courseId: e.courseId,
      courseTitle: e.course.title,
      status: e.status,
      progress: e.progress,
      completionDate: iso(e.completionDate),
    })),
    sessions: sessionRows,
    summary: {
      programmeCount: programmeRows.length,
      courseCount: courseRows.length,
      learnerCount: learnerIds.size,
      enrolmentCount: enrolments.length,
      activeEnrolmentCount: enrolments.length - completedEnrolmentCount,
      completedEnrolmentCount,
      upcomingSessionCount,
    },
  };
}
