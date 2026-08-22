'use client';

export type BackendUser = { id: string; email: string; role: string; branchId: string };
export type BackendToday = { appointments: number; walkIns: number; bills: number; salesMinor: number; avgBillMinor: number; lowStockCount: number };
export type BackendAppointment = {
  id: string; status: string; startAt: string; endAt: string; guestName?: string | null; guestPhone?: string | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
  items: Array<{ serviceId: string; staffId: string; service: { name: string }; staff: { displayName: string } }>;
};
export type BackendCustomer = { id: string; name: string; phone?: string | null; visitCount: number; totalSpent: number; lastVisitAt?: string | null; segments: string[] };
export type BackendMembershipPlan = { id: string; name: string; payMinor: number; creditMinor: number; validityDays?: number | null; memberDiscountBps: number };
export type BackendProduct = { id: string; name: string; brand?: string | null; sku?: string | null; stockQty: number; reorderLevel: number; sellMinor: number };
export type BackendConversation = { id: string; unread: boolean; lastMessageAt: string; customer?: { id: string; name: string; phone?: string | null } | null; channel: { type: string } };
export type BackendCampaign = { id: string; name: string; channel: string; segment?: string | null; status: string; createdAt: string; _count: { recipients: number } };
export type BackendStaff = { id: string; displayName: string; branchId: string };
export type BackendService = { id: string; name: string; durationMin: number; priceMinor: number; taxRateBps: number; serviceStaff: Array<{ staff: { id: string; displayName: string } }> };
export type BackendCategory = { id: string; name: string; services: BackendService[] };
export type BackendRangeReport = { salesMinor: number; bills: number; paymentMix: Record<string, number>; topServices: Array<[string, number]>; topStaff: Array<[string, number]>; customers: { new: number; repeat: number; lapsed: number; total: number } };

export type BackendSnapshot = {
  user: BackendUser | null;
  today: BackendToday | null;
  appointments: BackendAppointment[];
  customers: BackendCustomer[];
  membershipPlans: BackendMembershipPlan[];
  products: BackendProduct[];
  conversations: BackendConversation[];
  campaigns: BackendCampaign[];
  staff: BackendStaff[];
  categories: BackendCategory[];
  range: BackendRangeReport | null;
};

const emptySnapshot: BackendSnapshot = { user: null, today: null, appointments: [], customers: [], membershipPlans: [], products: [], conversations: [], campaigns: [], staff: [], categories: [], range: null };

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`/api/backend${path}`, { ...options, headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Backend request failed (${response.status})`);
  return data as T;
}

export const backendApi = {
  health: () => request<{ status: string }>('/health'),
  login: (email: string, password: string) => request<{ token: string; user: BackendUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: (token: string) => request<BackendUser>('/auth/me', {}, token),
  snapshot: async (token: string): Promise<BackendSnapshot> => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const paths = [
      ['/reports/today?branchId=main', 'today'], ['/appointments?branchId=main', 'appointments'], ['/customers?branchId=main&take=200', 'customers'],
      ['/membership-plans', 'membershipPlans'], ['/products', 'products'], ['/inbox', 'conversations'], ['/campaigns', 'campaigns'],
      ['/staff?branchId=main', 'staff'], ['/services?branchId=main', 'categories'], [`/reports/range?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'range'],
    ] as const;
    const [user, ...results] = await Promise.all([request<BackendUser>('/auth/me', {}, token), ...paths.map(([path]) => request<unknown>(path, {}, token).catch(() => null))]);
    const snapshot = { ...emptySnapshot, user };
    results.forEach((value, index) => { if (value !== null) (snapshot as Record<string, unknown>)[paths[index][1]] = value; });
    return snapshot;
  },
  checkout: (token: string, payload: unknown) => request<{ number: string; id: string }>('/pos/checkout', { method: 'POST', body: JSON.stringify(payload) }, token),
};

export { emptySnapshot };
