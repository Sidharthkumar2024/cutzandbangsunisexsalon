"use client";

export type BackendUser = {
  id: string;
  email: string;
  role: string;
  activeTenantId?: string | null;
  branchId: string;
  permissionKeys?: string[];
  twoFactorEnabled?: boolean;
};
export type BackendLoginResult =
  | { token: string; user: BackendUser; twoFactorRequired?: false }
  | { twoFactorRequired: true };
export type BackendCustomerOtpResult = {
  accepted: true;
  expiresInSeconds: number;
};
export type BackendTwoFactorStatus = {
  enabled: boolean;
  enabledAt?: string | null;
  setupPending: boolean;
  recoveryCodesRemaining: number;
};
export type BackendPlan = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  monthlyPriceMinor: number;
  yearlyPriceMinor: number;
  currency: string;
  maxBranches: number;
  maxStaff: number;
  maxInvoicesPerMonth?: number | null;
  features: string[];
  isActive: boolean;
};
export type BackendTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  primaryDomain?: string | null;
  timezone: string;
  currency: string;
  plan?: BackendPlan | null;
  membershipRole?: string;
  membershipBranchId?: string | null;
  branches?: BackendBranch[];
};
export type BackendSubscription = {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  interval: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  plan?: BackendPlan;
};
export type BackendTenantDomain = {
  id: string;
  tenantId: string;
  hostname: string;
  status: string;
  verifiedAt?: string | null;
};
export type BackendToday = {
  appointments: number;
  walkIns: number;
  bills: number;
  salesMinor: number;
  avgBillMinor: number;
  lowStockCount: number;
  newCustomers: number;
};
export type BackendAppointment = {
  id: string;
  status: string;
  isWalkIn: boolean;
  startAt: string;
  endAt: string;
  guestName?: string | null;
  guestPhone?: string | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
  items: Array<{
    serviceId: string;
    staffId: string;
    startAt: string;
    endAt: string;
    service: { name: string };
    staff: { displayName: string };
  }>;
};
export type BackendWaitlistEntry = {
  id: string;
  status: string;
  serviceId: string;
  staffId?: string | null;
  customerId?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  desiredDate: string;
  note?: string | null;
  createdAt: string;
};
export type BackendCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  source?: string | null;
  referralName?: string | null;
  referralPhone?: string | null;
  visitCount: number;
  totalSpent: number;
  loyaltyPoints: number;
  waConsent?: boolean;
  emailConsent?: boolean;
  customerSince: string;
  lastVisitAt?: string | null;
  segments: string[];
};
export type BackendCustomerDirectory = {
  customers: BackendCustomer[];
  total: number;
  skip: number;
  take: number;
  hasMore: boolean;
  counts: Record<"ALL" | "NEW" | "REPEAT" | "AT_RISK" | "LAPSED", number>;
};
export type BackendMembershipPlan = {
  id: string;
  name: string;
  payMinor: number;
  creditMinor: number;
  validityDays?: number | null;
  memberDiscountBps: number;
  eligibleCategoryIds: string[];
  excludedServiceIds: string[];
};
export type BackendServicePackage = {
  id: string;
  name: string;
  priceMinor: number;
  validityDays?: number | null;
  isActive: boolean;
  items: Array<{
    id: string;
    serviceId: string;
    qty: number;
    service: BackendService;
  }>;
};
export type BackendCustomerServicePackage = {
  id: string;
  expiresAt?: string | null;
  isActive: boolean;
  package: BackendServicePackage;
  ledger: Array<{
    id: string;
    serviceId: string;
    type: string;
    qtyDelta: number;
    balanceAfter: number;
    createdAt: string;
    service: { id: string; name: string };
  }>;
};
export type BackendProduct = {
  id: string;
  name: string;
  brand?: string | null;
  sku?: string | null;
  stockQty: number;
  reorderLevel: number;
  sellMinor: number;
  purchaseMinor: number;
  mrpMinor: number;
  discountBps: number;
  commissionBps: number;
  taxRateBps: number;
  isActive: boolean;
};
export type BackendAttendance = {
  id: string;
  staffId: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  lateMinutes: number;
  overtimeMin: number;
  source?: string;
  selfieUrl?: string | null;
  staff: {
    id: string;
    displayName: string;
    branchId: string;
    commissionRate: number;
  };
};
export type BackendPayrollRow = {
  staffId: string;
  displayName: string;
  designation?: string;
  presentDays: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  serviceRevenueMinor: number;
  productRevenueMinor: number;
  commissionRateBps: number;
  commissionThresholdMinor?: number;
  serviceCommissionMinor: number;
  productCommissionMinor: number;
  commissionMinor: number;
  baseSalaryMinor?: number;
  lateDays?: number;
  halfDays?: number;
  excessiveLateHalfDays?: number;
  recurringLateHalfDays?: number;
  shortShiftHalfDays?: number;
  lateDeductionMinor?: number;
  halfDayDeductionMinor?: number;
  overtimePaid?: boolean;
  estimatedPayMinor?: number;
};
export type BackendVendor = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};
export type BackendPurchaseBill = {
  id: string;
  billNumber?: string | null;
  totalMinor: number;
  photoUrl?: string | null;
  ocrRaw?: { confidence?: number; warnings?: string[] } | null;
  confirmedAt?: string | null;
  createdAt: string;
  vendor: BackendVendor;
  items: Array<{
    id: string;
    productId: string;
    qty: number;
    unitMinor: number;
    product: BackendProduct;
  }>;
};
export type BackendInventoryMovement = {
  id: string;
  reason: string;
  qtyDelta: number;
  stockAfter: number;
  createdAt: string;
  product: { id: string; name: string; sku?: string | null };
};
export type BackendReconciliation = {
  id: string;
  provider: string;
  externalRef: string;
  amountMinor: number;
  status: string;
  paymentId?: string | null;
  createdAt: string;
};
export type BackendBranch = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};
export type BackendConversation = {
  id: string;
  unread: boolean;
  lastMessageAt: string;
  customer?: { id: string; name: string; phone?: string | null; avatarUrl?: string | null } | null;
  channel: { type: string };
};
export type BackendChannel = {
  id: string;
  type: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" | "EMAIL" | "SMS" | "WEB_CHAT";
  label: string;
  isActive: boolean;
  _count?: { conversations: number; templates: number };
};
export type BackendWhatsAppTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  body: string;
  createdAt: string;
};
export type BackendWhatsAppStatus = {
  official: {
    configured: boolean;
    connected: boolean;
    active: boolean;
    detail?: string;
    templates?: BackendWhatsAppTemplate[];
  };
  unofficial: {
    configured: boolean;
    connected: boolean;
    active: boolean;
    status?: string;
    detail?: string;
    session?: string;
    accountName?: string;
    accountNumber?: string;
    qrDataUrl?: string;
    risk?: {
      score: number;
      label: "moderate" | "high" | "critical";
      heuristic: boolean;
      failureRate24h: number;
      sent24h: number;
      failed24h: number;
      safeguards: {
        consentRequired: boolean;
        optOutHonoured: boolean;
        intervalSeconds: number;
        dailyCap: number;
        deliveryWindow: string;
      };
    };
  };
};
export type BackendMessage = {
  id: string;
  direction: string;
  body?: string | null;
  status?: string | null;
  createdAt: string;
};
export type BackendConversationDetail = BackendConversation & {
  messages: BackendMessage[];
  customer?: BackendCustomer | null;
};
export type BackendCampaign = {
  id: string;
  name: string;
  channel: string;
  segment?: string | null;
  status: string;
  intervalSeconds?: number | null;
  dailyCap?: number | null;
  riskLevel?: string | null;
  deliveryRisk?: { score: number; label: string };
  ctaJson?: BackendCampaignCtaButton[] | null;
  recurrenceEnabled?: boolean;
  recurrenceRule?: BackendCampaignRecurrence | null;
  recurrenceNextAt?: string | null;
  recurrenceLastAt?: string | null;
  recurrenceParentId?: string | null;
  mediaKey?: string | null;
  mediaType?: string | null;
  audienceLabel?: string;
  manualRecipientCount?: number;
  engagement?: { total: number; sent: number; delivered: number; read: number; replied: number; failed: number };
  createdAt: string;
  _count: { recipients: number };
};
export type BackendCampaignCtaButton = {
  type: "CALL" | "WEBSITE" | "LOCATION";
  label: string;
  value: string;
  secondary?: string;
};
export type BackendCampaignRecurrence = {
  enabled: boolean;
  frequency: "WEEKLY" | "MONTHLY";
  daysOfWeek?: number[];
  daysOfMonth?: number[];
  time: string;
  endDate?: string;
};
export type BackendShift = {
  id?: string;
  weekday: number;
  startMin: number;
  endMin: number;
  breakStartMin?: number | null;
  breakEndMin?: number | null;
};
export type BackendLeave = {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  reason: string;
  approved: boolean;
  createdAt: string;
  staff?: { id: string; displayName: string; designation?: string };
};
export type BackendBiometricDevice = {
  id: string;
  branchId: string;
  name: string;
  provider: string;
  isActive: boolean;
  lastSeenAt?: string | null;
  createdAt: string;
};
export type BackendStaff = {
  id: string;
  displayName: string;
  branchId: string;
  phone?: string | null;
  designation?: string;
  baseSalaryMinor?: number;
  commissionRate?: number;
  commissionThresholdMinor?: number;
  lateGraceMinutes?: number;
  lateDeductionMinor?: number;
  halfDayAfterMinutes?: number;
  overtimePaid?: boolean;
  biometricCode?: string | null;
  weeklyOff?: number[];
  shifts?: BackendShift[];
  leaves?: BackendLeave[];
  user?: { id: string; email?: string | null; role: string; isActive: boolean; permissionKeys?: string[] } | null;
  invites?: Array<{ id: string; email: string; role: string; permissionKeys: string[]; expiresAt: string; createdAt: string }>;
};
export type BackendCashSession = {
  id: string;
  branchId: string;
  businessDate: string;
  openingCashMinor: number;
  openingBreakdown?: Record<string, number> | null;
  closingCashMinor?: number | null;
  closingBreakdown?: Record<string, number> | null;
  expectedCashMinor: number;
  varianceMinor?: number | null;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt?: string | null;
  cashSalesMinor: number;
  upiSalesMinor: number;
  cardSalesMinor: number;
  paymentTotalsMinor: Record<string, number>;
  cashExpensesMinor: number;
};

export type CashBreakdown = Record<string, number>;
export type WebsiteChatMessage = {
  id: string;
  direction: "in" | "out";
  body?: string | null;
  status?: string | null;
  createdAt: string;
};
export type BackendExpense = {
  id: string;
  branchId: string;
  cashSessionId?: string | null;
  category: string;
  description: string;
  amountMinor: number;
  paymentMethod: "CASH" | "UPI" | "CARD";
  vendorName?: string | null;
  occurredAt: string;
};
export type BackendHistoricalDailySummary = {
  id: string;
  branchId: string;
  businessDate: string;
  openingCashMinor?: number | null;
  cashSalesMinor?: number | null;
  upiSalesMinor?: number | null;
  cardSalesMinor?: number | null;
  totalSalesMinor?: number | null;
  availableCashMinor?: number | null;
  cashAdjustmentMinor?: number | null;
  reviewRequired: boolean;
  reviewNote?: string | null;
  notes?: string | null;
  source: string;
  sourceRef?: string | null;
  expenses: BackendExpense[];
};
export type BackendCustomerRetentionMatrix = {
  generatedAt: string;
  branchId: string;
  timezone: string;
  from: string;
  to: string;
  bucket: "day" | "week" | "month";
  inactiveDays: number;
  columns: string[];
  totals: { customers: number; visits: number; revenueMinor: number; statuses: Record<string, number> };
  rows: Array<{
    customerId: string;
    name: string;
    phone?: string | null;
    createdAt: string;
    firstVisitAt?: string | null;
    lastVisitAt?: string | null;
    lifetimeVisits: number;
    rangeVisits: number;
    rangeRevenueMinor: number;
    status: "NEVER_VISITED" | "NEW" | "REPEAT" | "AT_RISK" | "LAPSED";
    buckets: Record<string, number>;
  }>;
};
export type BackendNotification = {
  id: string;
  userId?: string | null;
  title: string;
  body?: string | null;
  readAt?: string | null;
  createdAt: string;
};
export type BackendCustomerHistoryEntry = {
  id: string;
  visitedAt: string;
  serviceName: string;
  amountMinor: number;
  staffName?: string | null;
  notes?: string | null;
  source: string;
};
export type BackendService = {
  id: string;
  categoryId: string;
  name: string;
  durationMin: number;
  priceMinor: number;
  taxRateBps: number;
  bufferMin: number;
  isActive: boolean;
  serviceStaff: Array<{ staff: { id: string; displayName: string } }>;
};
export type BackendCategory = {
  id: string;
  name: string;
  gender?: string | null;
  parentId?: string | null;
  parent?: { id: string; name: string; gender?: string | null; parentId?: string | null; sortOrder: number } | null;
  children?: Array<{ id: string; name: string; gender?: string | null; parentId?: string | null; sortOrder: number }>;
  sortOrder: number;
  services: BackendService[];
};
export type BackendLoyaltyRules = {
  enabled: boolean;
  welcomePoints: number;
  earnPoints: number;
  earnEveryMinor: number;
  redeemMinorPerPoint: number;
  minRedeemPoints: number;
};
export type BackendLoyaltyEntry = {
  id: string;
  type: string;
  deltaPoints: number;
  balanceAfter: number;
  invoiceId?: string | null;
  reason: string;
  createdAt: string;
};
export type BackendCoupon = {
  id: string;
  branchId: string;
  code: string;
  name: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minSpendMinor: number;
  maxDiscountMinor?: number | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  usedCount: number;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive: boolean;
  createdAt: string;
};
export type BackendRangeReport = {
  salesMinor: number;
  bills: number;
  paymentMix: Record<string, number>;
  topServices: Array<[string, number]>;
  topStaff: Array<[string, number]>;
  customers: { new: number; repeat: number; lapsed: number; total: number };
};
export type BackendDashboardInsights = {
  generatedAt: string;
  timezone: string;
  thresholds: { inactiveDays: number; repeatMinVisits: number };
  selectedRange?: {
    source: "custom" | "rolling";
    from: string;
    to: string;
    days: number;
    salesMinor: number;
    liveSalesMinor: number;
    historicalSalesMinor: number;
    collectedMinor: number;
    bills: number;
    appointments: number;
    completedAppointments: number;
    walkIns: number;
    newCustomers: number;
    tickets: { minimumMinor: number; maximumMinor: number; averageMinor: number };
    maxDaily: { date: string; salesMinor: number };
  };
  sales: {
    todayMinor: number;
    rolling10Minor: number;
    rolling15Minor: number;
    monthMinor: number;
    maxDaily: { date: string; salesMinor: number };
  };
  tickets: { minimumMinor: number; maximumMinor: number; averageMinor: number };
  customers: {
    total: number;
    repeat: number;
    repeatRate: number;
    inactive: number;
    neverVisited: number;
    inactiveList: Array<{
      id: string;
      name: string;
      phone?: string | null;
      email?: string | null;
      visitCount: number;
      totalSpent: number;
      loyaltyPoints: number;
      lastVisitAt?: string | null;
      daysSinceVisit?: number | null;
    }>;
  };
  dailySales: Array<{ date: string; salesMinor: number; collectedMinor: number; bills: number }>;
};
export type BackendAuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  createdAt: string;
  actor?: { id: string; email?: string | null; role: string } | null;
};
export type BackendProviderConfig = {
  smtp: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    from: string;
    hasPassword: boolean;
  };
  whatsappOfficial: {
    enabled: boolean;
    phoneId: string;
    wabaId: string;
    graphVersion: string;
    hasToken: boolean;
    hasAppSecret: boolean;
    hasWebhookVerifyToken: boolean;
  };
  whatsappUnofficial: {
    enabled: boolean;
    baseUrl: string;
    callbackUrl: string;
    session: string;
    intervalSeconds: number;
    dailyCap: number;
    windowStartHour: number;
    windowEndHour: number;
    hasApiKey: boolean;
    hasWebhookSecret: boolean;
  };
};
export type BackendSystemHealth = {
  status: "healthy" | "degraded";
  checkedAt: string;
  uptimeSeconds: number;
  checks: {
    database: { ok: boolean; latencyMs: number; detail: string };
    redis: { ok: boolean; latencyMs: number; detail: string };
    smtp: { configured: boolean; detail: string };
    whatsappOfficial: { configured: boolean; detail: string };
    whatsappUnofficial: { configured: boolean };
  };
  security: {
    productionMode: boolean;
    explicitCorsAllowlist: boolean;
    independentSecretsKey: boolean;
    providerSecretsEncrypted: boolean;
    strictAuthRateLimit: boolean;
    securityHeaders: boolean;
    authenticator2faEnabled: boolean;
    passwordResetConfigured: boolean;
  };
  failures24h: { email: number; automation: number };
};
export type BackendInvoice = {
  id: string;
  number: string;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  pdfUrl?: string | null;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
  } | null;
  items: Array<{
    id: string;
    kind: string;
    description: string;
    qty: number;
    lineTotalMinor: number;
    unitMinor?: number;
    discountMinor?: number;
    companionId?: string | null;
    servedFor?: string | null;
    staffId?: string | null;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amountMinor: number;
    reference?: string | null;
    createdAt: string;
  }>;
};
export type BackendInvoiceArchiveItem = {
  id: string;
  number: string;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  createdAt: string;
  issuedAt?: string | null;
  pdfReady: boolean;
  downloadPath: string;
  customer?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
  } | null;
};
export type BackendInvoiceArchive = {
  items: BackendInvoiceArchiveItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: {
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
  };
};
export type BackendNonReturningAutomationRun = {
  enabled: boolean;
  eligible: number;
  queued: number;
  skippedDuplicate: number;
  campaigns: string[];
};
export type BackendCustomerDetail = Omit<BackendCustomer, "segments"> & {
  notes?: string | null;
  tags: string[];
  appointments: BackendAppointment[];
  invoices: BackendInvoice[];
  memberships: Array<{
    id: string;
    balanceMinor: number;
    isActive: boolean;
    expiresAt?: string | null;
    plan: BackendMembershipPlan;
    ledger: Array<{
      id: string;
      type: string;
      deltaMinor: number;
      balanceAfter: number;
      reason?: string | null;
      createdAt: string;
    }>;
  }>;
  servicePackages: BackendCustomerServicePackage[];
  walletLedger: Array<{
    id: string;
    type: string;
    deltaMinor: number;
    balanceAfter: number;
    createdAt: string;
  }>;
  loyaltyLedger: BackendLoyaltyEntry[];
  historyEntries: BackendCustomerHistoryEntry[];
  companions: Array<{
    id: string;
    name: string;
    relation?: string | null;
    phone?: string | null;
    notes?: string | null;
    visitCount: number;
    lastVisitAt?: string | null;
  }>;
};
export type PublicCatalog = Array<{
  id: string;
  name: string;
  gender?: string | null;
  parentId?: string | null;
  parent?: { id: string; name: string; gender?: string | null } | null;
  services: Array<BackendService>;
}>;
export type CustomerPortalOverview = BackendCustomer & {
  appointments: Array<BackendAppointment>;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    totalMinor: number;
    paidMinor: number;
    createdAt: string;
    pdfUrl?: string | null;
    items: Array<{ id: string; description: string; lineTotalMinor: number }>;
    payments: Array<{ id: string; method: string; amountMinor: number }>;
  }>;
  memberships: Array<{
    id: string;
    balanceMinor: number;
    expiresAt?: string | null;
    plan: BackendMembershipPlan;
    ledger: Array<{
      id: string;
      type: string;
      deltaMinor: number;
      balanceAfter: number;
      createdAt: string;
    }>;
  }>;
  servicePackages: BackendCustomerServicePackage[];
  walletLedger: Array<{
    id: string;
    type: string;
    deltaMinor: number;
    balanceAfter: number;
    createdAt: string;
  }>;
  loyaltyLedger: BackendLoyaltyEntry[];
  loyaltyRules: BackendLoyaltyRules;
  marketingSettings?: {
    rewardRules?: {
      stampEveryVisits?: number;
      stampMinInvoiceMinor?: number;
      stampRewardDiscountPercent?: number;
      stampRewardMaxServiceMinor?: number;
      stampRewardPoints?: number;
      spinChancePercent?: number;
      spinPrizeLabels?: string[];
      scratchEveryVisits?: number;
      scratchChancePercent?: number;
      scratchRewardPoints?: number;
    };
  } | null;
};
export type CustomerRewardDrawResult = {
  kind: "spin" | "scratch";
  attempted: boolean;
  won: boolean;
  points: number;
  prizeLabel?: string;
  balanceAfter: number;
  message: string;
  roll: number;
  chancePercent: number;
  dateKey: string;
  nextAvailableAt: string;
};
export type StaffPortalDay = {
  staff: BackendStaff & { commissionRate: number };
  appointments: BackendAppointment[];
  attendance: BackendAttendance[];
  notifications: Array<{
    id: string;
    title: string;
    body?: string | null;
    createdAt: string;
  }>;
  performance: {
    serviceRevenueMinor: number;
    productRevenueMinor: number;
    commissionRateBps: number;
    commissionThresholdMinor?: number;
    serviceCommissionMinor: number;
    productCommissionMinor: number;
    estimatedCommissionMinor: number;
    membershipsSold?: number;
    packagesSold?: number;
  };
};

export type BackendSnapshot = {
  user: BackendUser | null;
  today: BackendToday | null;
  appointments: BackendAppointment[];
  waitlist: BackendWaitlistEntry[];
  customers: BackendCustomer[];
  membershipPlans: BackendMembershipPlan[];
  servicePackages: BackendServicePackage[];
  products: BackendProduct[];
  attendance: BackendAttendance[];
  payroll: BackendPayrollRow[];
  vendors: BackendVendor[];
  purchaseBills: BackendPurchaseBill[];
  inventoryMovements: BackendInventoryMovement[];
  reconciliations: BackendReconciliation[];
  branches: BackendBranch[];
  invoices: BackendInvoice[];
  conversations: BackendConversation[];
  channels: BackendChannel[];
  campaigns: BackendCampaign[];
  staff: BackendStaff[];
  categories: BackendCategory[];
  coupons: BackendCoupon[];
  settings: Record<string, unknown>;
  range: BackendRangeReport | null;
  dashboardInsights: BackendDashboardInsights | null;
  auditLogs: BackendAuditLog[];
  systemHealth: BackendSystemHealth | null;
  currentCash: BackendCashSession | null;
  expenses: BackendExpense[];
  teamAccounts: BackendStaff[];
  notifications: BackendNotification[];
  leaves: BackendLeave[];
  biometricDevices: BackendBiometricDevice[];
};

const emptySnapshot: BackendSnapshot = {
  user: null,
  today: null,
  appointments: [],
  waitlist: [],
  customers: [],
  membershipPlans: [],
  servicePackages: [],
  products: [],
  attendance: [],
  payroll: [],
  vendors: [],
  purchaseBills: [],
  inventoryMovements: [],
  reconciliations: [],
  branches: [],
  invoices: [],
  conversations: [],
  channels: [],
  campaigns: [],
  staff: [],
  categories: [],
  coupons: [],
  settings: {},
  range: null,
  dashboardInsights: null,
  auditLogs: [],
  systemHealth: null,
  currentCash: null,
  expenses: [],
  teamAccounts: [],
  notifications: [],
  leaves: [],
  biometricDevices: [],
};

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (token && token !== "cookie-session") headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`/api/backend${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      (data as { error?: string }).error ??
        `Backend request failed (${response.status})`,
    );
  return data as T;
}

const CUSTOMER_SNAPSHOT_PAGE_SIZE = 100;

async function requestInitialCustomers(token: string, branchId = "main") {
  return request<BackendCustomer[]>(
    `/customers?branchId=${encodeURIComponent(branchId)}&take=${CUSTOMER_SNAPSHOT_PAGE_SIZE}`,
    {},
    token,
  );
}

export const backendApi = {
  health: () => request<{ status: string }>("/health"),
  publicCatalog: () => request<PublicCatalog>("/services?branchId=main"),
  websiteChat: (payload: { branchId: string; threadId: string; name: string; phone: string; message: string }) =>
    request<{ threadId: string; conversationId: string; message: WebsiteChatMessage }>("/public/chat", { method: "POST", body: JSON.stringify(payload) }),
  websiteChatThread: (threadId: string) =>
    request<{ externalThreadId: string; customer?: { name: string } | null; messages: WebsiteChatMessage[] }>(`/public/chat/${encodeURIComponent(threadId)}`),
  multiAvailability: (payload: {
    branchId: string;
    date: string;
    items: Array<{ serviceId: string; staffId: string }>;
  }) =>
    request<{ timezone: string; slots: string[] }>("/availability/multi", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (email: string, password: string, secondFactor?: { code?: string; recoveryCode?: string }) =>
    request<BackendLoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, ...secondFactor }),
    }),
  requestCustomerOtp: (phone: string, branchId = "main") =>
    request<BackendCustomerOtpResult>("/auth/customer/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone, branchId }),
    }),
  verifyCustomerOtp: (phone: string, otp: string, branchId = "main") =>
    request<{ token: string; user: BackendUser }>("/auth/customer/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, otp, branchId }),
    }),
  requestPasswordReset: (email: string) => request<{ accepted: true }>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request<unknown>("/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  previewStaffInvite: (token: string) => request<{ email: string; role: string; permissionKeys: string[]; expiresAt: string; staff: { displayName: string; designation: string } }>(`/auth/staff-invite/preview?token=${encodeURIComponent(token)}`),
  acceptStaffInvite: (token: string, password: string) => request<{ accepted: true; email: string; role: string }>("/auth/staff-invite/accept", { method: "POST", body: JSON.stringify({ token, password }) }),
  logout: (token: string) => request<unknown>("/auth/logout", { method: "POST", body: "{}" }, token),
  switchTenant: (token: string, payload: { tenantId: string; branchId?: string }) =>
    request<{ activeTenantId: string; branchId: string | null }>("/auth/tenant/switch", { method: "POST", body: JSON.stringify(payload) }, token),
  plans: () => request<BackendPlan[]>("/plans"),
  createPlan: (token: string, payload: Partial<BackendPlan> & { name: string }) =>
    request<BackendPlan>("/plans", { method: "POST", body: JSON.stringify(payload) }, token),
  tenants: (token: string) => request<BackendTenant[]>("/tenants", {}, token),
  createTenant: (token: string, payload: { name: string; slug?: string; ownerEmail?: string; planSlug?: string; timezone?: string; currency?: string; branchName?: string; primaryDomain?: string }) =>
    request<BackendTenant>("/tenants", { method: "POST", body: JSON.stringify(payload) }, token),
  updateTenant: (token: string, tenantId: string, payload: Partial<Pick<BackendTenant, "name" | "status" | "primaryDomain" | "timezone" | "currency">> & { planId?: string | null; trialEndsAt?: string | null }) =>
    request<BackendTenant>(`/tenants/${encodeURIComponent(tenantId)}`, { method: "PATCH", body: JSON.stringify(payload) }, token),
  tenantSubscription: (token: string, tenantId: string) =>
    request<BackendSubscription | null>(`/tenants/${encodeURIComponent(tenantId)}/subscription`, {}, token),
  setTenantSubscription: (token: string, tenantId: string, payload: { planId: string; status?: string; interval?: string; currentPeriodStart?: string | null; currentPeriodEnd?: string | null; cancelAtPeriodEnd?: boolean }) =>
    request<BackendSubscription>(`/tenants/${encodeURIComponent(tenantId)}/subscription`, { method: "PUT", body: JSON.stringify(payload) }, token),
  tenantDomains: (token: string, tenantId: string) =>
    request<BackendTenantDomain[]>(`/tenants/${encodeURIComponent(tenantId)}/domains`, {}, token),
  createTenantDomain: (token: string, tenantId: string, hostname: string) =>
    request<BackendTenantDomain>(`/tenants/${encodeURIComponent(tenantId)}/domains`, { method: "POST", body: JSON.stringify({ hostname }) }, token),
  registerCustomer: (payload: {
    name: string;
    email: string;
    phone?: string;
    password: string;
    branchId: string;
  }) =>
    request<{ token: string; user: BackendUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: (token: string) => request<BackendUser>("/auth/me", {}, token),
  customerDirectory: (
    token: string,
    payload: {
      branchId?: string;
      q?: string;
      segment?: "ALL" | "NEW" | "REPEAT" | "AT_RISK" | "LAPSED";
      take?: number;
      skip?: number;
    } = {},
  ) => {
    const params = new URLSearchParams({
      branchId: payload.branchId ?? "main",
      take: String(payload.take ?? CUSTOMER_SNAPSHOT_PAGE_SIZE),
      skip: String(payload.skip ?? 0),
    });
    if (payload.q?.trim()) params.set("q", payload.q.trim());
    if (payload.segment && payload.segment !== "ALL") params.set("segment", payload.segment);
    return request<BackendCustomerDirectory>(`/customers/directory?${params.toString()}`, {}, token);
  },
  twoFactorStatus: (token: string) => request<BackendTwoFactorStatus>("/auth/2fa/status", {}, token),
  setupTwoFactor: (token: string) => request<{ qrDataUrl: string; manualKey: string; otpAuthUri: string }>("/auth/2fa/setup", { method: "POST", body: "{}" }, token),
  enableTwoFactor: (token: string, code: string) => request<{ enabled: true; enabledAt: string; recoveryCodes: string[] }>("/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }, token),
  rotateTwoFactorRecoveryCodes: (token: string, password: string, code: string) => request<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", { method: "POST", body: JSON.stringify({ password, code }) }, token),
  disableTwoFactor: (token: string, payload: { password: string; code?: string; recoveryCode?: string }) => request<{ enabled: false }>("/auth/2fa/disable", { method: "POST", body: JSON.stringify(payload) }, token),
  snapshot: async (token: string): Promise<BackendSnapshot> => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const paths = [
      ["/reports/today?branchId=main", "today"],
      ["/appointments?branchId=main", "appointments"],
      ["/waitlist?branchId=main&status=WAITING", "waitlist"],
      ["/membership-plans", "membershipPlans"],
      ["/service-packages", "servicePackages"],
      ["/products", "products"],
      ["/inbox", "conversations"],
      ["/channels", "channels"],
      ["/campaigns", "campaigns"],
      ["/staff?branchId=main", "staff"],
      ["/services?branchId=main", "categories"],
      ["/coupons?branchId=main", "coupons"],
      ["/settings/main", "settings"],
      ["/reports/dashboard?branchId=main&days=15", "dashboardInsights"],
      ["/audit-logs?take=100", "auditLogs"],
      ["/system/health?branchId=main", "systemHealth"],
      [
        `/reports/range?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        "range",
      ],
      [
        `/attendance?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        "attendance",
      ],
      [
        `/payroll/summary?branchId=main&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        "payroll",
      ],
      ["/vendors", "vendors"],
      ["/purchase-bills", "purchaseBills"],
      ["/inventory-movements?take=100", "inventoryMovements"],
      ["/payments/reconciliation?take=100", "reconciliations"],
      ["/branches", "branches"],
      ["/invoices?branchId=main&take=50", "invoices"],
      ["/cash-sessions/current?branchId=main", "currentCash"],
      ["/expenses?branchId=main&take=100", "expenses"],
      ["/team-accounts", "teamAccounts"],
      ["/notifications", "notifications"],
      ["/leaves?branchId=main", "leaves"],
      ["/biometric/devices?branchId=main", "biometricDevices"],
    ] as const;
    const [user, customers, ...results] = await Promise.all([
      request<BackendUser>("/auth/me", {}, token),
      requestInitialCustomers(token, "main"),
      ...paths.map(([path]) =>
        request<unknown>(path, {}, token).catch(() => null),
      ),
    ]);
    const snapshot = { ...emptySnapshot, user, customers };
    results.forEach((value, index) => {
      if (value !== null)
        (snapshot as Record<string, unknown>)[paths[index][1]] = value;
    });
    return snapshot;
  },
  checkout: (token: string, payload: unknown) =>
    request<{
      number: string;
      id: string;
      loyalty: { redeemedPoints: number; redeemedMinor: number; earnedPoints: number; marketingRewardPoints?: number; balanceAfter: number | null };
      coupon?: { code: string; discountMinor: number } | null;
    }>(
      "/pos/checkout",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createAppointment: (token: string, payload: unknown) =>
    request<BackendAppointment>(
      "/bookings",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  appointments: (token: string, from: string, to: string, branchId = "main") =>
    request<BackendAppointment[]>(`/appointments?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {}, token),
  rangeReport: (token: string, from: string, to: string, branchId = "main", filters?: { staffId?: string; serviceId?: string }) =>
    request<BackendRangeReport>(`/reports/range?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${filters?.staffId ? `&staffId=${encodeURIComponent(filters.staffId)}` : ""}${filters?.serviceId ? `&serviceId=${encodeURIComponent(filters.serviceId)}` : ""}`, {}, token),
  dashboardReport: (token: string, from: string, to: string, branchId = "main") =>
    request<BackendDashboardInsights>(
      `/reports/dashboard?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),
  customerRetentionMatrix: (token: string, from: string, to: string, branchId = "main", bucket: "day" | "week" | "month" = "month", inactiveDays = 60) =>
    request<BackendCustomerRetentionMatrix>(`/reports/customer-retention-matrix?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}&inactiveDays=${inactiveDays}`, {}, token),
  createCustomer: (
    token: string,
    payload: {
      branchId: string;
      name: string;
      phone?: string;
      email?: string;
      source?: string;
      referralName?: string;
      referralPhone?: string;
      tags?: string[];
      notes?: string;
      waConsent?: boolean;
      emailConsent?: boolean;
      customerSince?: string;
      companions?: Array<{ name: string; relation?: string; phone?: string; notes?: string }>;
      initialVisit?: { visitedAt: string; serviceName: string; amountMinor: number; staffName?: string; notes?: string };
    },
  ) =>
    request<BackendCustomer>(
      "/customers",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  customerDetail: (token: string, customerId: string) =>
    request<BackendCustomerDetail>(`/customers/${customerId}`, {}, token),
  deleteCustomer: (token: string, customerId: string) =>
    request<void>(
      `/customers/${encodeURIComponent(customerId)}`,
      { method: "DELETE" },
      token,
    ),
  lookupCustomer: (token: string, phone: string, branchId = "main") =>
    request<(BackendCustomer & { invoices: BackendInvoice[]; historyEntries: BackendCustomerHistoryEntry[] }) | null>(
      `/customers/lookup?branchId=${encodeURIComponent(branchId)}&phone=${encodeURIComponent(phone)}`,
      {},
      token,
    ),
  addCustomerHistory: (token: string, customerId: string, payload: { visitedAt: string; serviceName: string; amountMinor: number; staffName?: string; notes?: string }) =>
    request<BackendCustomerHistoryEntry>(
      `/customers/${encodeURIComponent(customerId)}/history`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  addCustomerCompanion: (token: string, customerId: string, payload: { name: string; relation?: string; phone?: string; notes?: string }) =>
    request<BackendCustomerDetail["companions"][number]>(`/customers/${encodeURIComponent(customerId)}/companions`, { method: "POST", body: JSON.stringify(payload) }, token),
  adjustLoyalty: (token: string, customerId: string, payload: { deltaPoints: number; reason: string }) =>
    request<{ entry: BackendLoyaltyEntry; balanceAfter: number }>(
      `/customers/${encodeURIComponent(customerId)}/loyalty/adjust`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createService: (
    token: string,
    payload: {
      categoryId: string;
      name: string;
      durationMin: number;
      bufferMin: number;
      priceMinor: number;
      taxRateBps: number;
      staffIds: string[];
    },
  ) =>
    request<BackendService>(
      "/services",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  updateService: (
    token: string,
    serviceId: string,
    payload: Partial<{
      categoryId: string;
      name: string;
      durationMin: number;
      bufferMin: number;
      priceMinor: number;
      taxRateBps: number;
      isActive: boolean;
      staffIds: string[];
    }>,
  ) =>
    request<BackendService>(
      `/services/${encodeURIComponent(serviceId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    ),
  deleteService: (token: string, serviceId: string) =>
    request<BackendService>(
      `/services/${encodeURIComponent(serviceId)}`,
      { method: "DELETE" },
      token,
    ),
  createServiceCategory: (
    token: string,
    payload: { name: string; gender?: "Male" | "Female" | "Unisex" | "Kids - Unisex" | "Boys" | "Girls" | "Baby Boy" | "Baby Girl" | null; parentId?: string | null; sortOrder?: number },
  ) =>
    request<BackendCategory>(
      "/service-categories",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createCoupon: (
    token: string,
    payload: Omit<BackendCoupon, "id" | "usedCount" | "createdAt">,
  ) =>
    request<BackendCoupon>(
      "/coupons",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  updateCoupon: (token: string, couponId: string, payload: Partial<BackendCoupon>) =>
    request<BackendCoupon>(
      `/coupons/${encodeURIComponent(couponId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    ),
  createStaff: (
    token: string,
    payload: {
      branchId: string;
      displayName: string;
      phone?: string;
      designation?: string;
      baseSalaryMinor?: number;
      commissionRate?: number;
      commissionThresholdMinor?: number;
      lateGraceMinutes?: number;
      lateDeductionMinor?: number;
      halfDayAfterMinutes?: number;
      overtimePaid?: boolean;
      biometricCode?: string;
      weeklyOff?: number[];
      shifts?: Array<{ weekday: number; startMin: number; endMin: number }>;
      serviceIds: string[];
    },
  ) =>
    request<BackendStaff>(
      "/staff",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  importStaff: (token: string, payload: { branchId: string; csv?: string; rows?: Array<Record<string, unknown>> }) =>
    request<{ imported: number; created: number; updated: number; rows: Array<{ id: string; displayName: string; operation: "created" | "updated" }> }>("/staff/import", { method: "POST", body: JSON.stringify(payload) }, token),
  setStaffAccount: (token: string, staffId: string, payload: { email: string; password: string; role: "MANAGER" | "RECEPTION" | "STAFF"; commissionRate?: number; permissionKeys?: string[] }) =>
    request<BackendUser>(
      `/staff/${encodeURIComponent(staffId)}/account`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  inviteStaff: (token: string, staffId: string, payload: { email: string; role: "ADMIN" | "MANAGER" | "RECEPTION" | "STAFF"; commissionRate?: number; permissionKeys: string[] }) =>
    request<{ invited: true; email: string; role: string; permissionKeys: string[]; expiresAt: string }>(`/staff/${encodeURIComponent(staffId)}/invite`, { method: "POST", body: JSON.stringify(payload) }, token),
  updateStaffProfile: (token: string, staffId: string, payload: Partial<Omit<BackendStaff, "id" | "branchId" | "user" | "leaves">> & { shifts?: BackendShift[] }) =>
    request<BackendStaff>(
      `/staff/${encodeURIComponent(staffId)}/profile`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    ),
  createLeave: (token: string, payload: { staffId?: string; startDate: string; endDate: string; reason: string; approved?: boolean }) =>
    request<BackendLeave>("/leaves", { method: "POST", body: JSON.stringify(payload) }, token),
  reviewLeave: (token: string, leaveId: string, approved: boolean) =>
    request<BackendLeave>(`/leaves/${encodeURIComponent(leaveId)}`, { method: "PATCH", body: JSON.stringify({ approved }) }, token),
  createBiometricDevice: (token: string, payload: { branchId: string; name: string; provider?: string }) =>
    request<BackendBiometricDevice & { secret: string; webhookPath: string }>("/biometric/devices", { method: "POST", body: JSON.stringify(payload) }, token),
  enrollMembership: (
    token: string,
    payload: { customerId: string; planId: string; soldByStaffId?: string },
  ) =>
    request<{ id: string; balanceMinor: number }>(
      "/memberships",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createMembershipPlan: (
    token: string,
    payload: {
      name: string;
      payMinor: number;
      creditMinor: number;
      validityDays?: number | null;
      memberDiscountBps?: number;
      eligibleCategoryIds?: string[];
      excludedServiceIds?: string[];
    },
  ) =>
    request<BackendMembershipPlan>(
      "/membership-plans",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createServicePackage: (
    token: string,
    payload: {
      name: string;
      priceMinor: number;
      validityDays?: number | null;
      items: Array<{ serviceId: string; qty: number }>;
    },
  ) =>
    request<BackendServicePackage>(
      "/service-packages",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  enrollServicePackage: (
    token: string,
    payload: { customerId: string; packageId: string; soldByStaffId?: string },
  ) =>
    request<BackendCustomerServicePackage>(
      "/customer-packages",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  redeemServicePackage: (
    token: string,
    customerPackageId: string,
    payload: { serviceId: string; qty: number; invoiceId?: string },
  ) =>
    request<{ id: string; balanceAfter: number }>(
      `/customer-packages/${encodeURIComponent(customerPackageId)}/redeem`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  generateInvoicePdf: (token: string, invoiceId: string) =>
    request<{ url: string; key: string }>(
      `/invoices/${invoiceId}/pdf`,
      { method: "POST", body: "{}" },
      token,
    ),
  invoiceArchive: (
    token: string,
    filters: {
      branchId?: string;
      q?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<BackendInvoiceArchive>(
      `/invoices/archive${query.size ? `?${query.toString()}` : ""}`,
      {},
      token,
    );
  },
  invoicePdfBlob: async (token: string, invoiceId: string) => {
    const response = await fetch(
      `/api/backend/invoices/${encodeURIComponent(invoiceId)}/pdf`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!response.ok)
      throw new Error(
        ((await response.json().catch(() => ({}))) as { error?: string })
          .error ?? "invoice_pdf_failed",
      );
    return URL.createObjectURL(await response.blob());
  },
  sendInvoice: (token: string, invoiceId: string, channel: "EMAIL" | "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" = "EMAIL") =>
    request<{ queued: boolean; channel: string; status?: string }>(
      `/invoices/${invoiceId}/send`,
      { method: "POST", body: JSON.stringify({ channel }) },
      token,
    ),
  conversation: (token: string, conversationId: string) =>
    request<BackendConversationDetail>(`/inbox/${conversationId}`, {}, token),
  sendConversationMessage: (
    token: string,
    conversationId: string,
    payload: {
      body?: string;
      internal: boolean;
      templateName?: string;
      templateLanguage?: string;
      mediaUrl?: string;
    },
  ) =>
    request<BackendMessage>(
      `/inbox/${conversationId}/messages`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  rescheduleAppointment: (
    token: string,
    appointmentId: string,
    payload: {
      items: Array<{ serviceId: string; staffId: string; startAt: string }>;
      override: boolean;
    },
  ) =>
    request<BackendAppointment>(
      `/appointments/${appointmentId}/reschedule`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    ),
  promoteWaitlist: (
    token: string,
    waitlistId: string,
    payload: { staffId: string; startAt: string },
  ) =>
    request<BackendAppointment>(
      `/waitlist/${waitlistId}/promote`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  uploadMedia: (
    token: string,
    payload: {
      purpose: "attendance-selfie" | "vendor-bill" | "inbox" | "campaign";
      contentType: string;
      base64: string;
      consent?: boolean;
    },
  ) =>
    request<{ key: string; url: string; expiresIn: number }>(
      "/media",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  attendance: (
    token: string,
    mode: "check-in" | "check-out",
    payload: {
      staffId?: string;
      lat: number;
      lng: number;
      selfieKey: string;
      consent: true;
    },
  ) =>
    request<
      BackendAttendance & { workedMinutes?: number; distanceMeters?: number }
    >(
      `/attendance/${mode}`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createVendor: (
    token: string,
    payload: { name: string; phone?: string; email?: string },
  ) =>
    request<BackendVendor>(
      "/vendors",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createProduct: (
    token: string,
    payload: {
      name: string;
      brand?: string;
      sku?: string;
      purchaseMinor?: number;
      sellMinor?: number;
      mrpMinor?: number;
      discountBps?: number;
      commissionBps?: number;
      taxRateBps?: number;
      reorderLevel?: number;
    },
  ) =>
    request<BackendProduct>(
      "/products",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  moveProductStock: (
    token: string,
    productId: string,
    payload: {
      qtyDelta: number;
      reason: "CONSUMPTION" | "WASTAGE" | "ADJUSTMENT" | "PURCHASE";
    },
  ) =>
    request<{ stockAfter: number }>(
      `/products/${encodeURIComponent(productId)}/movement`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  draftCampaign: (
    token: string,
    payload: { goal: string; segment?: string; offer?: string },
  ) =>
    request<{ content: string }>(
      "/campaigns/draft",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  createCampaign: (
    token: string,
    payload: {
      name: string;
      channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" | "EMAIL" | "SMS";
      segment?: string;
      content: string;
      mediaKey?: string;
      mediaType?: "image" | "document" | "video";
      ctaButtons?: BackendCampaignCtaButton[];
      recurrence?: BackendCampaignRecurrence;
      couponCode?: string;
      branchId: string;
      scheduledAt?: string;
      recipientContacts?: Array<{ name?: string; phone: string; email?: string; waConsent?: boolean; emailConsent?: boolean; consentSource?: string }>;
      recipientPhones?: string[];
      manualConsentConfirmed?: boolean;
    },
  ) =>
    request<BackendCampaign>(
      "/campaigns",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  approveCampaign: (token: string, campaignId: string) =>
    request<BackendCampaign>(
      `/campaigns/${encodeURIComponent(campaignId)}/approve`,
      { method: "POST", body: "{}" },
      token,
    ),
  updateCampaignRecurrence: (
    token: string,
    campaignId: string,
    payload: { enabled: boolean; recurrence?: BackendCampaignRecurrence },
  ) =>
    request<BackendCampaign>(
      `/campaigns/${encodeURIComponent(campaignId)}/recurrence`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    ),
  openCashSession: (token: string, payload: { branchId: string; openingCashMinor: number; openingBreakdown: CashBreakdown; openingNote?: string }) =>
    request<BackendCashSession>("/cash-sessions/open", { method: "POST", body: JSON.stringify(payload) }, token),
  closeCashSession: (token: string, cashSessionId: string, payload: { closingCashMinor: number; closingBreakdown?: CashBreakdown | null; closingNote?: string }) =>
    request<BackendCashSession>(`/cash-sessions/${encodeURIComponent(cashSessionId)}/close`, { method: "POST", body: JSON.stringify(payload) }, token),
  createExpense: (token: string, payload: { branchId: string; category: string; description: string; amountMinor: number; paymentMethod: "CASH" | "UPI" | "CARD"; vendorName?: string; occurredAt?: string }) =>
    request<BackendExpense>("/expenses", { method: "POST", body: JSON.stringify(payload) }, token),
  importHistoricalRegister: (token: string, payload: { branchId: string; source?: string; csv?: string; dailyCsv?: string; expensesCsv?: string; days?: Array<Record<string, unknown>> }) =>
    request<{ imported: number; created: number; updated: number; rows: Array<{ businessDate: string; summaryId: string; operation: "created" | "updated"; expensesUpserted: number; warnings: string[] }> }>("/historical-register/import", { method: "POST", body: JSON.stringify(payload) }, token),
  historicalRegister: (token: string, branchId = "main", from?: string, to?: string) =>
    request<BackendHistoricalDailySummary[]>(`/historical-register?branchId=${encodeURIComponent(branchId)}${from ? `&from=${encodeURIComponent(from)}` : ""}${to ? `&to=${encodeURIComponent(to)}` : ""}`, {}, token),
  createConversation: (
    token: string,
    payload: { customerId: string; channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" },
  ) =>
    request<BackendConversation>(
      "/inbox",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  whatsappStatus: (token: string) =>
    request<BackendWhatsAppStatus>("/integrations/whatsapp/status", {}, token),
  providerConfig: (token: string, branchId = "main") =>
    request<BackendProviderConfig>(`/integrations/config?branchId=${encodeURIComponent(branchId)}`, {}, token),
  saveProviderConfig: (
    token: string,
    payload: {
      branchId: string;
      smtp: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password?: string; from: string };
      whatsappOfficial: { enabled: boolean; phoneId: string; wabaId: string; graphVersion: string; token?: string; appSecret?: string; webhookVerifyToken?: string };
      whatsappUnofficial: {
        enabled: boolean;
        baseUrl: string;
        callbackUrl: string;
        session: string;
        apiKey?: string;
        webhookSecret?: string;
        intervalSeconds: number;
        dailyCap: number;
        windowStartHour: number;
        windowEndHour: number;
      };
    },
  ) => request<BackendProviderConfig>("/integrations/config", { method: "PUT", body: JSON.stringify(payload) }, token),
  emailStatus: (token: string, branchId = "main") =>
    request<{ configured: boolean; connected: boolean; detail: string }>(`/integrations/email/status?branchId=${encodeURIComponent(branchId)}`, {}, token),
  testEmail: (token: string, to: string, branchId = "main") =>
    request<{ externalId: string; status: string }>("/integrations/email/test", { method: "POST", body: JSON.stringify({ branchId, to }) }, token),
  systemHealth: (token: string, branchId = "main") =>
    request<BackendSystemHealth>(`/system/health?branchId=${encodeURIComponent(branchId)}`, {}, token),
  auditLogs: (token: string, query = "take=100") =>
    request<BackendAuditLog[]>(`/audit-logs?${query}`, {}, token),
  updateChannel: (
    token: string,
    type: BackendChannel["type"],
    isActive: boolean,
  ) =>
    request<BackendChannel>(
      `/channels/${type}`,
      { method: "PATCH", body: JSON.stringify({ isActive }) },
      token,
    ),
  testWhatsApp: (
    token: string,
    payload: { channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL"; to: string; message: string },
  ) =>
    request<{ externalId: string; status: string }>(
      "/integrations/whatsapp/test",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  syncWhatsAppTemplates: (token: string) =>
    request<{ synced: number }>(
      "/integrations/whatsapp/templates/sync",
      { method: "POST", body: "{}" },
      token,
    ),
  controlWahaSession: (
    token: string,
    action: "create" | "start" | "restart" | "stop" | "logout",
    branchId = "main",
  ) => request<BackendWhatsAppStatus["unofficial"]>(
    "/integrations/whatsapp/unofficial/session",
    { method: "POST", body: JSON.stringify({ branchId, action }) },
    token,
  ),
  syncWahaContacts: (token: string, branchId = "main") =>
    request<{ fetched: number; valid?: number; created: number; updated: number; skipped: number; consentImported: boolean; mode?: string }>(
      "/integrations/whatsapp/unofficial/contacts/sync",
      { method: "POST", body: JSON.stringify({ branchId, limit: 5_000 }) },
      token,
    ),
  importCampaignContacts: (
    token: string,
    payload: {
      branchId: string;
      rows: Array<{ name?: string; phone: string; email?: string; waConsent: boolean; emailConsent: boolean; consentSource?: string }>;
    },
  ) => request<{ rows: number; valid: number; created: number; updated: number; invalid: number; duplicates: number; consented: number }>(
    "/campaigns/contacts/import",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  ),
  verifyCampaignPhones: (
    token: string,
    payload: { branchId: string; phones: string[] },
  ) => request<{ total: number; valid: number; invalid: number; duplicates: number; registered: number; unknown: number; providerConnected: boolean; detail: string }>(
    "/campaigns/contacts/verify",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  ),
  branchSettings: (token: string, branchId = "main") =>
    request<Record<string, unknown>>(`/settings/${branchId}`, {}, token),
  updateBranchSetting: (
    token: string,
    name: string,
    value: Record<string, unknown>,
    branchId = "main",
  ) =>
    request<{ key: string }>(
      `/settings/${branchId}/${encodeURIComponent(name)}`,
      { method: "PUT", body: JSON.stringify(value) },
      token,
    ),
  runNonReturningAutomation: (token: string, branchId = "main") =>
    request<BackendNonReturningAutomationRun>(
      "/automations/non-returning/run",
      { method: "POST", body: JSON.stringify({ branchId }) },
      token,
    ),
  scanVendorBill: (
    token: string,
    payload: { vendorId: string; photoUrl: string },
  ) =>
    request<BackendPurchaseBill>(
      "/purchase-bills/ocr",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  confirmPurchaseBill: (token: string, billId: string) =>
    request<{ confirmed: boolean }>(
      `/purchase-bills/${billId}/confirm`,
      { method: "POST", body: "{}" },
      token,
    ),
  customerOverview: (token: string) =>
    request<CustomerPortalOverview>("/portal/customer/overview", {}, token),
  playCustomerReward: (token: string, kind: "spin" | "scratch") =>
    request<CustomerRewardDrawResult>(
      `/portal/customer/rewards/${encodeURIComponent(kind)}/play`,
      { method: "POST", body: "{}" },
      token,
    ),
  requestCustomerReschedule: (token: string, appointmentId: string, note?: string) =>
    request<{ requested: boolean; eventId: string }>(
      `/portal/customer/appointments/${encodeURIComponent(appointmentId)}/reschedule-request`,
      { method: "POST", body: JSON.stringify({ note }) },
      token,
    ),
  markNotificationRead: (token: string, notificationId: string) =>
    request<BackendNotification>(
      `/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: "POST", body: "{}" },
      token,
    ),
  staffMyDay: (token: string, from?: string, to?: string) =>
    request<StaffPortalDay>(
      `/portal/staff/my-day${from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : ""}`,
      {},
      token,
    ),
  updateAppointmentStatus: (
    token: string,
    appointmentId: string,
    status: string,
  ) =>
    request<BackendAppointment>(
      `/appointments/${appointmentId}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
      token,
    ),
};

export { emptySnapshot };
