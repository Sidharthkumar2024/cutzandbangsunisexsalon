export async function POST(request: Request) {
  const body = await request.json() as { services?: unknown[]; date?: string; time?: string; customer?: { name?: string; phone?: string } };
  if (!body.services?.length || !body.date || !body.time || !body.customer?.name || !body.customer?.phone) {
    return Response.json({ error: 'Missing required booking details' }, { status: 400 });
  }
  const backendBase = (process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (backendBase) {
    try {
      const response = await fetch(`${backendBase}/api/bookings`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
      });
      const result = await response.json() as { id?: string; status?: string; error?: string };
      if (!response.ok) return Response.json(result, { status: response.status });
      return Response.json({ reference: result.id ?? `CB-${Date.now().toString().slice(-6)}`, status: result.status ?? 'confirmed' }, { status: response.status });
    } catch {
      return Response.json({ error: 'Booking system is temporarily unavailable.' }, { status: 502 });
    }
  }
  return Response.json({ reference: `CB-${Date.now().toString().slice(-6)}`, status: 'confirmed' }, { status: 201 });
}
