export async function POST(request: Request) {
  const body = await request.json() as { services?: unknown[]; date?: string; time?: string; customer?: { name?: string; phone?: string } };
  if (!body.services?.length || !body.date || !body.time || !body.customer?.name || !body.customer?.phone) {
    return Response.json({ error: 'Missing required booking details' }, { status: 400 });
  }
  return Response.json({ reference: `CB-${Date.now().toString().slice(-6)}`, status: 'confirmed' }, { status: 201 });
}
