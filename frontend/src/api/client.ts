import { setAuthTokenGetter } from '@api-client';

export const SESSION_EXPIRED_EVENT = 'th360:session-expired';

setAuthTokenGetter(() => getToken());

export function getToken(): string | null {
  return localStorage.getItem("th360_token");
}

export function setSession(token: string, user: unknown) {
  localStorage.setItem("th360_token", token);
  localStorage.setItem("th360_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("th360_token");
  localStorage.removeItem("th360_user");
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function getSessionUser(): { id?: string; role?: string; name?: string; email?: string; initials?: string; isOrgStaff?: boolean } | null {
  try {
    return JSON.parse(localStorage.getItem("th360_user") ?? "null");
  } catch {
    return null;
  }
}

export async function downloadContent(contentId: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/content/${contentId}/download`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Could not download file (${res.status})`);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : `download-${contentId}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSessionIcs(sessionId: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/sessions/${sessionId}/ics`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Could not download calendar file (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `session-${sessionId}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // A.3: a FormData body sets its own multipart boundary — forcing application/json on it
  // makes the request unparseable, so the JSON content type is only added for string bodies.
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? { ...(init?.headers as Record<string, string> ?? {}) }
    : { "content-type": "application/json", ...(init?.headers as Record<string, string> ?? {}) };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    throw new Error("API 401 — please log in again");
  }
  if (!res.ok) {
    let message = `API ${res.status}`;
    let body: unknown = null;
    try {
      body = await res.json();
      if (body && typeof (body as { error?: unknown }).error === "string") message = String((body as { error: string }).error);
    } catch {
      // non-JSON error body — keep the status-based message
    }
    // The status and parsed body let callers distinguish 409 (new version, already graded),
    // 403 (own attempt) and 404 (another organization) from a generic failure.
    const error = new Error(message) as Error & { status?: number; body?: unknown };
    error.status = res.status;
    error.body = body;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/csv")) return (await res.text()) as T;
  return (await res.json()) as T;
}
