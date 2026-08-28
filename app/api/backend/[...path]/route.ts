const backendBase = () => (process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '')
  .replace(/\/+$/, '')
  .replace(/\/api\/v1$/i, '');
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = isProduction ? '__Host-cutz_session' : 'cutz_session';
const sessionMarker = 'cookie-session';

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sessionCookie(value: string, maxAge: number) {
  const secure = isProduction ? '; Secure' : '';
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function sameSiteOrigins(request: Request, incoming: URL) {
  const origins = new Set([incoming.origin]);
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? incoming.protocol.replace(':', '');
  if (forwardedHost) origins.add(`${forwardedProto}://${forwardedHost}`);
  for (const raw of [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.PUBLIC_SITE_URL,
    process.env.APP_ORIGIN,
    process.env.CORS_ORIGIN,
  ]) {
    for (const value of (raw ?? '').split(',')) {
      const trimmed = value.trim().replace(/\/+$/, '');
      if (trimmed && trimmed !== '*') origins.add(trimmed);
    }
  }
  if (isProduction) {
    origins.add('https://cutzandbangs.com');
    origins.add('https://www.cutzandbangs.com');
  }
  return origins;
}

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const encodedPath = path.map(encodeURIComponent).join('/');
  const backendPath = path.length === 1 && path[0] === 'health'
    ? '/health'
    : path[0] === 'api' && path[1] === 'v1'
      ? `/${encodedPath}`
      : `/api/v1/${encodedPath}`;
  const isLogout = request.method === 'POST' && backendPath === '/api/v1/auth/logout';
  const base = backendBase();
  if (!base) {
    const headers = isLogout ? { 'set-cookie': sessionCookie('', 0) } : undefined;
    return Response.json({ error: 'backend_not_configured' }, { status: 503, headers });
  }
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const origin = request.headers.get('origin');
  if (isMutation && origin && !sameSiteOrigins(request, incoming).has(origin.replace(/\/+$/, ''))) {
    return Response.json({ error: 'cross_site_request_rejected' }, { status: 403 });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const sessionToken = readCookie(request, sessionCookieName);
  if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`);

  try {
    const response = await fetch(`${base}${backendPath}${incoming.search}`, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
    });
    const responseHeaders = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store, private',
      'vary': 'Cookie',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    const isSessionIssue = request.method === 'POST' && (
      backendPath === '/api/v1/auth/login' || backendPath === '/api/v1/auth/register'
    );
    const body = await response.arrayBuffer();

    if (isSessionIssue && response.ok) {
      try {
        const payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
        const token = typeof payload.token === 'string' ? payload.token : undefined;
        if (token) {
          responseHeaders.set(
            'set-cookie',
            sessionCookie(token, Number(process.env.SESSION_COOKIE_TTL_SECONDS ?? 604_800)),
          );
          payload.token = sessionMarker;
        }
        return new Response(JSON.stringify(payload), { status: response.status, headers: responseHeaders });
      } catch {
        // Preserve the backend response when it is unexpectedly not JSON.
      }
    }
    if (isLogout || (sessionToken && response.status === 401)) {
      responseHeaders.set('set-cookie', sessionCookie('', 0));
    }
    return new Response(body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    const headers = isLogout ? { 'set-cookie': sessionCookie('', 0) } : undefined;
    return Response.json({ error: 'backend_unavailable' }, { status: 502, headers });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
