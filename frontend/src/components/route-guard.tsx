import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { clearSession, getSessionUser } from "@/api/client";
import { canAccessRoute, redirectFor } from "@/auth/routePolicy";

export function RequireRouteAccess({ path, children }: { path: string; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const user = getSessionUser();
  const allowed = canAccessRoute(user, location || path);

  useEffect(() => {
    if (allowed) return;
    if (!user?.role) {
      clearSession();
      return;
    }
    setLocation(redirectFor(user, location || path), { replace: true });
  }, [allowed, user, location, path, setLocation]);

  return allowed ? <>{children}</> : null;
}
