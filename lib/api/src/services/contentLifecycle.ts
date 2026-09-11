export interface ArchivableCourse {
  id: string;
  version: number;
  isArchived: boolean;
  lastActiveEnrolmentAt: Date | string | null;
  hasNewerVersion: boolean;
}

const STALE_DAYS = 365;

export function shouldArchive(course: ArchivableCourse, now: Date = new Date()): { archive: boolean; reason: string | null } {
  if (course.isArchived) return { archive: false, reason: "already archived" };
  if (!course.hasNewerVersion) return { archive: false, reason: "no updated version exists" };
  if (!course.lastActiveEnrolmentAt) return { archive: true, reason: "no active enrolments and updated version exists" };
  const days = (now.getTime() - new Date(course.lastActiveEnrolmentAt).getTime()) / 86400000;
  if (days > STALE_DAYS) return { archive: true, reason: `no active enrolments for ${Math.floor(days)} days and updated version exists` };
  return { archive: false, reason: "recently active" };
}

export function flagStaleCourses(courses: ArchivableCourse[], now: Date = new Date()): { id: string; reason: string }[] {
  return courses.flatMap((c) => {
    const r = shouldArchive(c, now);
    return r.archive && r.reason ? [{ id: c.id, reason: r.reason }] : [];
  });
}
