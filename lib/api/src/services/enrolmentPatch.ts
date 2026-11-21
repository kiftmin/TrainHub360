// Round 9 / Phase 1. What a caller may change on an enrolment, and nothing else.
//
// The route this replaces accepted any key in the body, let the learner set their own status,
// and computed the scores from `{ ...current, ...patch }` — so a `deadlineDate` in the request
// silently moved `timelinessScore` and `enrolmentScore`, and a learner who sent
// `status: "completed"` with a long enough reason got a certificate for content and assessments
// they had not done.
//
// The rules here are deliberately narrow:
//   - an unknown key is a 400, never silently ignored;
//   - each field has exactly one role that may set it, checked against the database;
//   - the scores are computed from the stored row plus only the validated fields the caller was
//     allowed to change, never from the raw body.

export type PatchRole = "learner" | "programme_staff" | "line_manager";

// [CONFIRM] 2026-11-22: `status` is limited to these three. "grading" and anything else is a
// system state and must not be settable by a person.
export const STAFF_STATUSES = ["enrolled", "completed", "withdrawn"] as const;

const STAFF_FIELDS = [
  "status",
  "completionDate",
  "deadlineDate",
  "appliedAssessmentScore",
  "applicationScore",
  "reason",
] as const;
const MANAGER_FIELDS = ["managerSignOff"] as const;

export type StaffPatch = {
  status?: (typeof STAFF_STATUSES)[number];
  completionDate?: Date | null;
  deadlineDate?: Date | null;
  appliedAssessmentScore?: number;
  applicationScore?: number | null;
  reason?: string;
};

export type ManagerPatch = { managerSignOff?: boolean };

export interface ParsedPatch {
  staff: StaffPatch;
  manager: ManagerPatch;
  // True when the caller asked for something they are not allowed to do. The route answers 403
  // rather than quietly dropping it: a silent drop would look like it worked.
  forbidden: string[];
  unknown: string[];
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return undefined;
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseScore(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  return value;
}

/**
 * Validate a PATCH body against the caller's roles. A field the caller may not set is reported in
 * `forbidden`; a value that fails validation is a 400 (`error`), because "score = 300" is not a
 * permission problem.
 */
export function parseEnrolmentPatch(
  body: unknown,
  roles: { staff: boolean; lineManager: boolean },
): { error: string } | ParsedPatch {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: "a JSON object is required" };
  const raw = body as Record<string, unknown>;
  const known = new Set<string>([...STAFF_FIELDS, ...MANAGER_FIELDS]);
  // A key that is not a field of this endpoint at all is a programming mistake in the caller: 400.
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length) return { error: `unknown field(s): ${unknown.join(", ")}` };
  // A real field the caller's role does not cover is a permission problem: 403, so the answer says
  // "you may not" rather than "that does not exist".
  const out: ParsedPatch = { staff: {}, manager: {}, forbidden: [], unknown: [] };
  for (const key of Object.keys(raw)) {
    const allowed = (roles.staff && (STAFF_FIELDS as readonly string[]).includes(key)) || (roles.lineManager && (MANAGER_FIELDS as readonly string[]).includes(key));
    if (!allowed) out.forbidden.push(key);
  }
  if (out.forbidden.length) return out;

  if (raw.status !== undefined) {
    const s = String(raw.status);
    if (!(STAFF_STATUSES as readonly string[]).includes(s)) {
      return { error: `status must be one of ${STAFF_STATUSES.join(", ")}` };
    }
    out.staff.status = s as (typeof STAFF_STATUSES)[number];
  }
  for (const key of ["completionDate", "deadlineDate"] as const) {
    if (raw[key] === undefined) continue;
    const d = parseDate(raw[key]);
    if (d === undefined) return { error: `${key} must be a valid date or null` };
    out.staff[key] = d;
  }
  for (const key of ["appliedAssessmentScore", "applicationScore"] as const) {
    if (raw[key] === undefined) continue;
    const n = parseScore(raw[key]);
    if (n === undefined) return { error: `${key} must be a number between 0 and 100, or null` };
    if (key === "appliedAssessmentScore" && n === null) return { error: "appliedAssessmentScore cannot be null" };
    out.staff[key] = n as number;
  }
  if (raw.reason !== undefined) out.staff.reason = String(raw.reason);
  if (raw.managerSignOff !== undefined) {
    if (typeof raw.managerSignOff !== "boolean") return { error: "managerSignOff must be true or false" };
    out.manager.managerSignOff = raw.managerSignOff;
  }
  return out;
}

/** The fields whose change actually moves a score or a completion — the ones that clear a sign-off. */
export function scoreInputsChanged(
  before: { appliedAssessmentScore: number | null; completionDate: Date | null; deadlineDate: Date | null; applicationScore: number | null },
  after: { appliedAssessmentScore: number | null; completionDate: Date | null; deadlineDate: Date | null; applicationScore: number | null },
): boolean {
  const same = (a: number | Date | null, b: number | Date | null) =>
    a instanceof Date || b instanceof Date
      ? (a instanceof Date ? a.getTime() : null) === (b instanceof Date ? b.getTime() : null)
      : a === b;
  return (
    !same(before.appliedAssessmentScore, after.appliedAssessmentScore) ||
    !same(before.completionDate, after.completionDate) ||
    !same(before.deadlineDate, after.deadlineDate) ||
    !same(before.applicationScore, after.applicationScore)
  );
}
