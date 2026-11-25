import { db } from "../db.js";
import { attemptStats } from "./assessmentAttempts.js";
import { sessionsForUser } from "./ical.js";
import { avgResponseHours } from "../jobs/slaJob.js";
import { competenceFromEvidence } from "./enrolmentOutcome.js";

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

export async function buildLearnerDashboard(learnerId: string, orgId: string) {
  const now = new Date();
  const [learner, enrolments] = await Promise.all([
    db.user.findFirst({ where: { id: learnerId, orgId }, select: { id: true, name: true, email: true, department: true, jobFunction: true } }),
    db.enrolment.findMany({
      where: { learnerId, status: { not: "withdrawn" }, withdrawnAt: null, programme: { orgId } },
      include: {
        course: {
          include: {
            programme: { select: { id: true, name: true } },
            modules: {
              where: { isArchived: false, deletedAt: null },
              orderBy: { order: "asc" },
              include: {
                contentItems: { where: { isArchived: false }, orderBy: { order: "asc" }, select: { id: true, title: true, required: true, completionMode: true, estimatedMinutes: true } },
              },
            },
          },
        },
        contentProgress: { select: { contentItemId: true, status: true, completedAt: true, startedAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!learner) return null;

  const courseIds = enrolments.map((e) => e.courseId);
  const [assessments, certificates, pendingVerifications, notifications, unreadNotificationCount, attempts, rsvps, threadRows, replyCounts] = await Promise.all([
    db.assessment.findMany({
      where: { isPublished: true, supersededAt: null, isArchived: false, deletedAt: null, module: { courseId: { in: courseIds }, isArchived: false, deletedAt: null } },
      select: { id: true, title: true, type: true, passMark: true, maxAttempts: true, supersedesId: true, changeKind: true, module: { select: { courseId: true } } },
      orderBy: { id: "asc" },
    }),
    db.certificate.findMany({
      where: { learnerId, course: { programme: { orgId } } },
      include: { course: { select: { id: true, title: true } } },
      orderBy: { issuedAt: "desc" },
    }),
    db.contentProgress.findMany({
      where: { status: "pending_verification", enrolment: { learnerId, programme: { orgId } } },
      include: { contentItem: { select: { id: true, title: true } }, enrolment: { include: { course: { select: { id: true, title: true } } } } },
      orderBy: { id: "asc" },
    }),
    db.notification.findMany({ where: { userId: learnerId, orgId, readAt: null }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.notification.count({ where: { userId: learnerId, orgId, readAt: null } }),
    db.assessmentAttempt.findMany({
      where: { learnerId, status: { in: ["submitted", "grading", "graded"] }, assessment: { module: { course: { programme: { orgId } } } } },
      include: { assessment: { select: { id: true, title: true, type: true, passMark: true, module: { select: { course: { select: { title: true, appliedThreshold: true } } } } } } },
      orderBy: { submittedAt: "desc" },
      take: 5,
    }),
    db.sessionRSVP.findMany({ where: { learnerId, status: { in: ["invited", "confirmed", "waitlisted"] } }, select: { sessionId: true, status: true } }),
    db.threadParticipant.findMany({
      where: { userId: learnerId, leftAt: null, thread: { orgId } },
      include: { thread: { include: { messages: { orderBy: { createdAt: "asc" } }, participants: { select: { userId: true, role: true } }, course: { select: { id: true, title: true } } } } },
      orderBy: { thread: { updatedAt: "desc" } },
      take: 5,
    }),
    db.$queryRaw<Array<{ awaitingTrainer: number | bigint; awaitingLearner: number | bigint }>>`
      SELECT
        SUM(CASE WHEN t.last_learner_message_at IS NOT NULL
          AND (t.last_trainer_response_at IS NULL OR t.last_learner_message_at > t.last_trainer_response_at)
          THEN 1 ELSE 0 END) AS awaitingTrainer,
        SUM(CASE WHEN t.last_trainer_response_at IS NOT NULL
          AND (t.last_learner_message_at IS NULL OR t.last_trainer_response_at > t.last_learner_message_at)
          THEN 1 ELSE 0 END) AS awaitingLearner
      FROM dbo.thread_participants tp
      JOIN dbo.message_threads t ON t.id = tp.thread_id
      WHERE tp.user_id = ${learnerId} AND tp.left_at IS NULL AND t.org_id = ${orgId}
    `,
  ]);
  const awaitingTrainerReplies = Number(replyCounts[0]?.awaitingTrainer ?? 0);
  const awaitingLearnerReplies = Number(replyCounts[0]?.awaitingLearner ?? 0);

  const rsvpBySession = new Map(rsvps.map((r) => [r.sessionId, r.status]));
  const relevantSessions = await sessionsForUser(learnerId);
  const upcomingSessions = relevantSessions
    .filter((s) => s.orgId === orgId && s.status === "scheduled")
    .map((s) => {
      const startsAt = s.startsAt ?? new Date(`${s.date}T${s.time}:00`);
      return { session: s, startsAt };
    })
    .filter(({ startsAt }) => Number.isFinite(startsAt.getTime()) && startsAt.getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 8)
    .map(({ session, startsAt }) => ({
      id: session.id,
      title: session.title,
      startsAt: startsAt.toISOString(),
      endsAt: session.endsAt ? session.endsAt.toISOString() : null,
      timezone: session.timezone,
      mode: session.mode,
      trainer: session.trainer,
      courseId: session.courseId,
      programmeId: session.programmeId,
      myRsvpStatus: rsvpBySession.get(session.id) ?? null,
      icsUrl: `/api/sessions/${session.id}/ics`,
    }));

  const courseViews = [];
  const nextActions = [];
  let outstandingActivities = 0;
  for (const enrolment of enrolments) {
    const content = enrolment.course.modules.flatMap((m) => m.contentItems.map((i) => ({ ...i, moduleId: m.id, moduleTitle: m.title })));
    const required = content.filter((i) => i.required);
    const progressByItem = new Map(enrolment.contentProgress.map((p) => [p.contentItemId, p]));
    const completedItems = content.filter((i) => progressByItem.get(i.id)?.status === "completed");
    const inProgressItems = content.filter((i) => progressByItem.get(i.id)?.status === "in_progress");
    const requiredOutstanding = required.filter((i) => progressByItem.get(i.id)?.status !== "completed");
    const pendingItems = pendingVerifications.filter((p) => p.enrolmentId === enrolment.id);
    const courseAssessments = assessments.filter((a) => a.module.courseId === enrolment.courseId);
    const assessmentViews = [];
    for (const assessment of courseAssessments) {
      const passMark = assessment.passMark ?? enrolment.course.appliedThreshold ?? 70;
      const stats = await attemptStats(db, assessment, enrolment.id, passMark);
      assessmentViews.push({ id: assessment.id, title: assessment.title, type: assessment.type, passMark, maxAttempts: assessment.maxAttempts, attemptsUsed: stats.attemptsUsed, bestScore: stats.bestScore, passed: stats.passedBefore });
    }
    const awaitingGrading = await db.assessmentAttempt.count({ where: { enrolmentId: enrolment.id, status: "grading" } });
    const appliedViews = assessmentViews.filter((a) => a.type === "applied");
    const outstandingAssessments = appliedViews.filter((a) => !a.passed && (a.maxAttempts === null || a.attemptsUsed < a.maxAttempts));
    const nextContent = requiredOutstanding[0] ?? content.find((i) => progressByItem.get(i.id)?.status !== "completed") ?? null;
    const competent = competenceFromEvidence({
      requiredContentIds: required.map((i) => i.id),
      completedContentIds: completedItems.map((i) => i.id),
      liveAppliedPassed: appliedViews.map((a) => a.passed),
    });
    const competenceStatus = competent ? "achieved" : enrolment.completionSource === "manual" ? "staff_override" : "in_progress";
    outstandingActivities += requiredOutstanding.length + outstandingAssessments.length + pendingItems.length + awaitingGrading;
    courseViews.push({
      enrolmentId: enrolment.id,
      courseId: enrolment.courseId,
      title: enrolment.course.title,
      programmeId: enrolment.programmeId,
      programmeName: enrolment.course.programme.name,
      status: enrolment.status,
      progress: Math.round(enrolment.progress),
      dueDate: enrolment.course.dueDate,
      deadlineDate: dateOnly(enrolment.deadlineDate),
      completionDate: dateOnly(enrolment.completionDate),
      completionSource: enrolment.completionSource,
      competent,
      competenceStatus,
      counts: {
        totalContent: content.length,
        completedContent: completedItems.length,
        inProgressContent: inProgressItems.length,
        requiredOutstanding: requiredOutstanding.length,
        pendingVerification: pendingItems.length,
        assessmentsOutstanding: outstandingAssessments.length,
        awaitingGrading,
      },
      modules: enrolment.course.modules.map((m) => {
        const items = m.contentItems;
        const complete = items.filter((i) => progressByItem.get(i.id)?.status === "completed").length;
        return { id: m.id, title: m.title, total: items.length, completed: complete, progress: items.length ? Math.round((complete / items.length) * 100) : 100 };
      }),
      assessments: assessmentViews,
      nextContentItemId: nextContent?.id ?? null,
    });
    if (awaitingGrading) nextActions.push({ id: `grading-${enrolment.id}`, type: "review_result", title: "Review result awaiting grading", detail: enrolment.course.title, href: "/my-learning?tab=results", priority: 20 });
    if (pendingItems.length) nextActions.push({ id: `verification-${enrolment.id}`, type: "trainer_verification", title: "Evidence awaiting trainer verification", detail: pendingItems[0].contentItem.title, href: "/my-learning?tab=progress", priority: 35 });
    if (outstandingAssessments.length) nextActions.push({ id: `assessment-${enrolment.id}`, type: "complete_assessment", title: "Complete an outstanding assessment", detail: outstandingAssessments[0].title, href: `/assessments?courseId=${enrolment.courseId}`, priority: 10 });
    if (nextContent) nextActions.push({ id: `content-${enrolment.id}`, type: "continue_content", title: "Continue learning", detail: nextContent.title, href: `/my-learning?courseId=${enrolment.courseId}&contentId=${nextContent.id}`, priority: 15 });
  }

  if (!enrolments.length) nextActions.push({ id: "book-session", type: "book_session", title: "Book a trainer session", detail: "Choose an eligible trainer and available slot.", href: "/calendar", priority: 50 });
  const awaitingReplies = threadRows.filter((row) => row.thread.lastLearnerMessageAt && (!row.thread.lastTrainerResponseAt || +new Date(row.thread.lastLearnerMessageAt) > +new Date(row.thread.lastTrainerResponseAt)));
  for (const row of awaitingReplies.slice(0, 1)) {
    nextActions.push({ id: `reply-${row.threadId}`, type: "reply_message", title: "Trainer reply pending", detail: row.thread.subject, href: `/messages?threadId=${row.threadId}`, priority: 25 });
  }
  const activeCertificate = certificates.find((c) => c.status === "active" && (!c.expiresAt || +c.expiresAt > +now));
  if (activeCertificate) nextActions.push({ id: `certificate-${activeCertificate.id}`, type: "download_certificate", title: "Download your certificate", detail: activeCertificate.course.title, href: `/api/certificates/${activeCertificate.id}/print`, priority: 60 });
  nextActions.sort((a, b) => a.priority - b.priority);

  const messages = threadRows.map((row) => {
    const participants = new Map(row.thread.participants.map((p) => [p.userId, p.role]));
    const mapped = row.thread.messages.map((m) => ({ authorId: m.authorId, authorRole: m.authorId ? participants.get(m.authorId) ?? "learner" : "learner", createdAt: m.createdAt }));
    const lastMessage = row.thread.messages[row.thread.messages.length - 1];
    const avg = avgResponseHours(mapped);
    const awaiting = Boolean(row.thread.lastLearnerMessageAt && (!row.thread.lastTrainerResponseAt || +new Date(row.thread.lastLearnerMessageAt) > +new Date(row.thread.lastTrainerResponseAt)));
    const learnerState = awaiting ? "reply_pending" : "ok";
    return {
      id: row.thread.id,
      subject: row.thread.subject,
      courseId: row.thread.courseId,
      courseTitle: row.thread.course?.title ?? null,
      urgent: row.thread.urgent,
      lastMessageAt: lastMessage?.createdAt.toISOString() ?? null,
      lastMessagePreview: lastMessage?.body.slice(0, 160) ?? null,
      averageResponseTimeHours: avg,
      slaStatus: awaiting ? "reply pending" : "up to date",
      slaState: learnerState,
      awaitingTrainerResponse: awaiting,
      href: `/messages?threadId=${row.thread.id}`,
    };
  });

  return {
    learner: { id: learner.id, name: learner.name, email: learner.email, department: learner.department, jobFunction: learner.jobFunction },
    summary: {
      assignedCourses: enrolments.length,
      completedCourses: enrolments.filter((e) => e.status === "completed").length,
      overallProgress: enrolments.length ? Math.round(enrolments.reduce((sum, e) => sum + e.progress, 0) / enrolments.length) : 0,
      outstandingActivities,
      pendingVerifications: pendingVerifications.length,
      unreadNotifications: Number(unreadNotificationCount),
      unreadMessages: 0,
      awaitingTrainerReplies,
      awaitingLearnerReplies,
      unreadMessageTracking: false,
    },
    courses: courseViews,
    upcomingSessions,
    latestResults: attempts.map((a) => ({
      attemptId: a.id,
      assessmentId: a.assessment.id,
      assessmentTitle: a.assessment.title,
      assessmentType: a.assessment.type,
      courseTitle: a.assessment.module.course.title,
      attemptNumber: a.attemptNumber,
      status: a.status,
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
      gradedAt: a.gradedAt ? a.gradedAt.toISOString() : null,
      score: a.status === "graded" ? a.score : null,
      percent: a.status === "graded" ? a.percent : null,
      passed: a.status === "graded" ? a.passed : null,
      passMark: a.assessment.passMark ?? a.assessment.module.course.appliedThreshold ?? 70,
      awaitingGrading: a.status !== "graded",
    })),
    certificates: certificates.map((c) => ({
      id: c.id,
      certificateNumber: c.certificateNumber,
      courseId: c.courseId,
      courseTitle: c.course.title,
      enrolmentId: c.enrolmentId,
      issuedAt: c.issuedAt.toISOString(),
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      status: c.status,
      active: c.status === "active" && (!c.expiresAt || +c.expiresAt > +now),
      printUrl: `/api/certificates/${c.id}/print`,
    })),
    pendingVerifications: pendingVerifications.map((p) => ({
      id: p.id,
      contentItemId: p.contentItemId,
      contentTitle: p.contentItem.title,
      courseId: p.enrolment.courseId,
      courseTitle: p.enrolment.course.title,
      enrolmentId: p.enrolmentId,
      submittedAt: p.completedAt ? p.completedAt.toISOString() : null,
    })),
    nextActions,
    notifications: notifications.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString() })),
    messages,
  };
}
