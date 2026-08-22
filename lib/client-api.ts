export type BookingPayload = {
  audience: string;
  services: Array<{ id: string; staffId: string }>;
  date: string;
  time: string;
  customer: { name: string; phone: string; email?: string };
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function submitBooking(payload: BookingPayload) {
  const response = await fetch(`${apiBase}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('We could not confirm that time. Please try again.');
  return response.json() as Promise<{ reference: string; status: string }>;
}
