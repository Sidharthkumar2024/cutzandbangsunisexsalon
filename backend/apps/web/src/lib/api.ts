// Thin API client for the browser. Reads the base URL from env; stores the
// session token in localStorage for admin/staff/customer portals.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("cutz_token");
}

export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem("cutz_token", t);
  else window.localStorage.removeItem("cutz_token");
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set a JSON content-type when we actually send a body — otherwise
  // Fastify rejects the empty body with 400.
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(`API ${status}`);
  }
}

export const money = (minor: number, cur = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: cur }).format(minor / 100);
