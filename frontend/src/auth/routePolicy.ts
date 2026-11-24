export type Role = "owner" | "admin" | "trainer" | "stakeholder" | "learner";

export type SessionUser = {
  id?: string;
  role?: string;
  name?: string;
  email?: string;
  initials?: string;
  isOrgStaff?: boolean;
};

export type RoutePermission =
  | "public"
  | "anyAuthenticated"
  | "staff"
  | "staffOrStakeholder"
  | "orgStaff"
  | "verifier"
  | "nonStakeholder"
  | "stakeholder";

type RouteRule = { prefix: string; permission: RoutePermission };

const ROUTE_POLICY: RouteRule[] = [
  { prefix: "/assessments/grading", permission: "staff" },
  { prefix: "/programmes/", permission: "staff" },
  { prefix: "/my-learning", permission: "nonStakeholder" },
  { prefix: "/review-credit", permission: "orgStaff" },
  { prefix: "/learning", permission: "staff" },
  { prefix: "/programmes", permission: "staff" },
  { prefix: "/people", permission: "orgStaff" },
  { prefix: "/assessments", permission: "nonStakeholder" },
  { prefix: "/verification", permission: "verifier" },
  { prefix: "/calendar", permission: "nonStakeholder" },
  { prefix: "/messages", permission: "nonStakeholder" },
  { prefix: "/reports", permission: "orgStaff" },
  { prefix: "/governance", permission: "orgStaff" },
  { prefix: "/settings", permission: "orgStaff" },
  { prefix: "/profile", permission: "anyAuthenticated" },
  { prefix: "/", permission: "staffOrStakeholder" },
];

const STAFF_ROLES: Role[] = ["owner", "admin", "trainer"];
const ORG_STAFF_ROLES: Role[] = ["owner", "admin"];

function isRole(user: SessionUser | null, roles: Role[]): boolean {
  return !!user && !!user.role && roles.includes(user.role as Role);
}

export function permissionForPath(path: string): RoutePermission {
  const rule = ROUTE_POLICY.find((item) => path === item.prefix || path.startsWith(`${item.prefix}/`) || (item.prefix === "/" && path === "/"));
  return rule?.permission ?? "staff";
}

export function canAccessRoute(user: SessionUser | null, path: string): boolean {
  if (!user?.role) return false;
  const permission = permissionForPath(path);
  switch (permission) {
    case "public":
      return true;
    case "anyAuthenticated":
      return true;
    case "staff":
      return isRole(user, STAFF_ROLES);
    case "staffOrStakeholder":
      return isRole(user, [...STAFF_ROLES, "stakeholder"]);
    case "orgStaff":
      return isRole(user, ORG_STAFF_ROLES) || user.isOrgStaff === true;
    case "verifier":
      return isRole(user, ["owner", "admin", "trainer"]);
    case "nonStakeholder":
      return user.role !== "stakeholder";
    case "stakeholder":
      return user.role === "stakeholder";
    default:
      return false;
  }
}

export function homeFor(user: SessionUser | null): string {
  if (user?.role === "learner") return "/my-learning";
  if (user?.role === "stakeholder") return "/";
  return "/";
}

export function redirectFor(user: SessionUser | null, path: string): string {
  return homeFor(user) === path ? "/" : homeFor(user);
}
