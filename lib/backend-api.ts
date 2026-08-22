'use client';

export type BackendUser = { id: string; email: string; role: string; branchId: string };
export type BackendToday = { appointments: number; walkIns: number; bills: number; salesMinor: number; avgBillMinor: number; lowStockCount: number };
export type BackendAppointment = {
  id: string; status: string; startAt: string; endAt: string; guestName?: string | null; guestPhone?: string | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
  items: Array<{ serviceId: string; staffId: string; startAt: string; endAt: string; service: { name: string }; staff: { displayName: string } }>;
};
export type BackendWaitlistEntry = { id: string; status: string; serviceId: string; staffId?: string | null; customerId?: string | null; guestName?: string | null; guestPhone?: string | null; desiredDate: string; note?: string | null; createdAt: string };
export type BackendCustomer = { id: string; name: string; phone?: string | null; visitCount: number; totalSpent: number; lastVisitAt?: string | null; segments: string[] };
export type BackendMembershipPlan = { id: string; name: string; payMinor: number; creditMinor: number; validityDays?: number | null; memberDiscountBps: number };
export type BackendProduct = { id: string; name: string; brand?: string | null; sku?: string | null; stockQty: number; reorderLevel: number; sellMinor: number };
export type BackendAttendance = { id: string; staffId: string; checkInAt?: string | null; checkOutAt?: string | null; lateMinutes: number; overtimeMin: number; selfieUrl?: string | null; staff: { id: string; displayName: string; branchId: string; commissionRate: number } };
export type BackendPayrollRow = { staffId: string; displayName: string; presentDays: number; workedMinutes: number; lateMinutes: number; overtimeMinutes: number; serviceRevenueMinor: number; commissionRateBps: number; commissionMinor: number };
export type BackendVendor = { id: string; name: string; phone?: string | null; email?: string | null };
export type BackendPurchaseBill = { id: string; billNumber?: string | null; totalMinor: number; photoUrl?: string | null; ocrRaw?: { confidence?: number; warnings?: string[] } | null; confirmedAt?: string | null; createdAt: string; vendor: BackendVendor; items: Array<{ id: string; productId: string; qty: number; unitMinor: number; product: BackendProduct }> };
export type BackendInventoryMovement = { id: string; reason: string; qtyDelta: number; stockAfter: number; createdAt: string; product: { id: string; name: string; sku?: string | null } };
export type BackendReconciliation = { id: string; provider: string; externalRef: string; amountMinor: number; status: string; paymentId?: string | null; createdAt: string };
export type BackendBranch = { id: string; name: string; timezone: string; currency: string; address?: string | null; latitude?: number | null; longitude?: number | null };
export type BackendConversation = { id: string; unread: boolean; lastMessageAt: string; customer?: { id: string; name: string; phone?: string | null } | null; channel: { type: string } };
export type BackendCampaign = { id: string; name: string; channel: string; segment?: string | null; status: string; createdAt: string; _count: { recipients: number } };
export type BackendStaff = { id: string; displayName: string; branchId: string };
export type BackendService = { id: string; name: string; durationMin: number; priceMinor: number; taxRateBps: number; serviceStaff: Array<{ staff: { id: string; displayName: string } }> };
export type BackendCategory = { id: string; name: string; services: BackendService[] };
export type BackendRangeReport = { salesMinor: number; bills: number; paymentMix: Record<string, number>; topServices: Array<[string, number]>; topStaff: Array<[string, number]>; customers: { new: number; repeat: number; lapsed: number; total: number } };
export type CustomerPortalOverview = BackendCustomer & { appointments: Array<BackendAppointment>; invoices: Array<{ id: string; number: string; status: string; totalMinor: number; paidMinor: number; createdAt: string; pdfUrl?: string | null; items: Array<{ id: string; description: string; lineTotalMinor: number }>; payments: Array<{ id: string; method: string; amountMinor: number }> }>; memberships: Array<{ id: string; balanceMinor: number; expiresAt?: string | null; plan: BackendMembershipPlan; ledger: Array<{ id: string; type: string; deltaMinor: number; balanceAfter: number; createdAt: string }> }>; walletLedger: Array<{ id: string; type: string; deltaMinor: number; balanceAfter: number; createdAt: string }> };
export type StaffPortalDay = { staff: BackendStaff & { commissionRate: number }; appointments: BackendAppointment[]; attendance: BackendAttendance[]; notifications: Array<{ id: string; title: string; body?: string | null; createdAt: string }>; performance: { serviceRevenueMinor: number; commissionRateBps: number; estimatedCommissionMinor: number } };

export type BackendSnapshot = {
  user: BackendUser | null;
  today: BackendToday | null;
  appointments: BackendAppointment[];
  waitlist: BackendWaitlistEntry[];
  customers: BackendCustomer[];
  membershipPlans: BackendMembershipPlan[];
  products: BackendProduct[];
  attendance: BackendAttendance[];
  payroll: BackendPayrollRow[];
  vendors: BackendVendor[];
  purchaseBills: BackendPurchaseBill[];
  inventoryMovements: BackendInventoryMovement[];
  reconciliations: BackendReconciliation[];
  branches: BackendBranch[];
  conversations: BackendConversation[];
  campaigns: BackendCampaign[];
  staff: BackendStaff[];
  categories: BackendCategory[];
  range: BackendRangeReport | null;
};

const emptySnapshot: BackendSnapshot = { user: null, today: null, appointments: [], waitlist: [], customers: [], membershipPlans: [], products: [], attendance: [], payroll: [], vendors: [], purchaseBills: [], inventoryMovements: [], reconciliations: [], branches: [], conversations: [], campaigns: [], staff: [], categories: [], range: null };

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
  registerCustomer: (payload: { name: string; email: string; phone?: string; password: string; branchId: string }) => request<{ token: string; user: BackendUser }>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  me: (token: string) => request<BackendUser>('/auth/me', {}, token),
  snapshot: async (token: string): Promise<BackendSnapshot> => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const paths = [
      ['/reports/today?branchId=main', 'today'], ['/appointments?branchId=main', 'appointments'], ['/waitlist?branchId=main&status=WAITING', 'waitlist'], ['/customers?branchId=main&take=200', 'customers'],
      ['/membership-plans', 'membershipPlans'], ['/products', 'products'], ['/inbox', 'conversations'], ['/campaigns', 'campaigns'],
      ['/staff?branchId=main', 'staff'], ['/services?branchId=main', 'categories'], [`/reports/range?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'range'],
      [`/attendance?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'attendance'], [`/payroll/summary?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'payroll'],
      ['/vendors', 'vendors'], ['/purchase-bills', 'purchaseBills'], ['/inventory-movements?take=100', 'inventoryMovements'], ['/payments/reconciliation?take=100', 'reconciliations'], ['/branches', 'branches'],
    ] as const;
    const [user, ...results] = await Promise.all([request<BackendUser>('/auth/me', {}, token), ...paths.map(([path]) => request<unknown>(path, {}, token).catch(() => null))]);
    const snapshot = { ...emptySnapshot, user };
    results.forEach((value, index) => { if (value !== null) (snapshot as Record<string, unknown>)[paths[index][1]] = value; });
    return snapshot;
  },
  checkout: (token: string, payload: unknown) => request<{ number: string; id: string }>('/pos/checkout', { method: 'POST', body: JSON.stringify(payload) }, token),
  rescheduleAppointment: (token: string, appointmentId: string, payload: { items: Array<{ serviceId: string; staffId: string; startAt: string }>; override: boolean }) => request<BackendAppointment>(`/appointments/${appointmentId}/reschedule`, { method: 'PATCH', body: JSON.stringify(payload) }, token),
  promoteWaitlist: (token: string, waitlistId: string, payload: { staffId: string; startAt: string }) => request<BackendAppointment>(`/waitlist/${waitlistId}/promote`, { method: 'POST', body: JSON.stringify(payload) }, token),
  uploadMedia: (token: string, payload: { purpose: 'attendance-selfie' | 'vendor-bill' | 'inbox'; contentType: string; base64: string; consent?: boolean }) => request<{ key: string; url: string; expiresIn: number }>('/media', { method: 'POST', body: JSON.stringify(payload) }, token),
  attendance: (token: string, mode: 'check-in' | 'check-out', payload: { staffId: string; lat: number; lng: number; selfieKey: string; consent: true }) => request<BackendAttendance & { workedMinutes?: number; distanceMeters?: number }>(`/attendance/${mode}`, { method: 'POST', body: JSON.stringify(payload) }, token),
  createVendor: (token: string, payload: { name: string; phone?: string; email?: string }) => request<BackendVendor>('/vendors', { method: 'POST', body: JSON.stringify(payload) }, token),
  scanVendorBill: (token: string, payload: { vendorId: string; photoUrl: string }) => request<BackendPurchaseBill>('/purchase-bills/ocr', { method: 'POST', body: JSON.stringify(payload) }, token),
  confirmPurchaseBill: (token: string, billId: string) => request<{ confirmed: boolean }>(`/purchase-bills/${billId}/confirm`, { method: 'POST', body: '{}' }, token),
  customerOverview: (token: string) => request<CustomerPortalOverview>('/portal/customer/overview', {}, token),
  staffMyDay: (token: string) => request<StaffPortalDay>('/portal/staff/my-day', {}, token),
  updateAppointmentStatus: (token: string, appointmentId: string, status: string) => request<BackendAppointment>(`/appointments/${appointmentId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token),
};

export { emptySnapshot };
