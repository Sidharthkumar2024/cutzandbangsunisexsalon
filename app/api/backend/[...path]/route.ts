const backendBase = () => (process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const base = backendBase();
  if (!base) return Response.json({ error: 'backend_not_configured' }, { status: 503 });

  const { path } = await context.params;
  const incoming = new URL(request.url);
  const backendPath = path.length === 1 && path[0] === 'health'
    ? '/health'
    : `/api/v1/${path.map(encodeURIComponent).join('/')}`;
  const headers = new Headers();
  for (const name of ['authorization', 'content-type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(`${base}${backendPath}${incoming.search}`, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return Response.json({ error: 'backend_unavailable' }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
