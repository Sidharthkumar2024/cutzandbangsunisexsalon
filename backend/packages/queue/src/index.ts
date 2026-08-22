// Shared queue definitions used by both the API (producer) and worker
// (consumer). Keeping job names + payload types here prevents drift.

import { Queue, JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export function makeConnection(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null });
}

export const QUEUES = {
  reminders: "reminders",
  email: "email",
  campaigns: "campaigns",
} as const;

export type ReminderType = "prev_day" | "hours_before";

export interface ReminderJob {
  appointmentId: string;
  type: ReminderType;
}
export interface EmailJob {
  branchId?: string;
  to: string;
  subject: string;
  html: string;
  dedupeKey?: string;
  // Attachments reference a storage key (resolved to bytes by the worker) or a
  // path/URL the transport can fetch. Job data must stay JSON-serializable.
  attachments?: { filename: string; storageKey?: string; path?: string }[];
}
export interface CampaignJob {
  campaignId: string;
  recipientId: string;
}

let _conn: Redis | undefined;
function conn() {
  return (_conn ??= makeConnection());
}

const _queues: Record<string, Queue> = {};
function q(name: string): Queue {
  return (_queues[name] ??= new Queue(name, { connection: conn() }));
}

/** Enqueue a reminder with a deterministic id => safe to call repeatedly. */
export async function enqueueReminder(job: ReminderJob, runAt: Date) {
  const opts: JobsOptions = {
    jobId: `reminder:${job.appointmentId}:${job.type}`,
    delay: Math.max(0, runAt.getTime() - Date.now()),
    removeOnComplete: true,
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 },
  };
  await q(QUEUES.reminders).add(job.type, job, opts);
}

/** Cancel reminders for an appointment (e.g. on cancel/reschedule). */
export async function cancelReminders(appointmentId: string) {
  for (const type of ["prev_day", "hours_before"] as ReminderType[]) {
    const job = await q(QUEUES.reminders).getJob(`reminder:${appointmentId}:${type}`);
    if (job) await job.remove().catch(() => {});
  }
}

export async function enqueueEmail(job: EmailJob) {
  await q(QUEUES.email).add("send", job, {
    jobId: job.dedupeKey, // dedupe when a key is provided
    removeOnComplete: true,
    attempts: 5,
    backoff: { type: "exponential", delay: 15_000 },
  });
}

export async function enqueueCampaignRecipient(job: CampaignJob, runAt?: Date) {
  await q(QUEUES.campaigns).add("send-recipient", job, {
    jobId: `campaign:${job.campaignId}:${job.recipientId}`,
    delay: runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0,
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
  });
}
