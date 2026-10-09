/**
 * The shapes the API sends and takes, shared by the Worker, the app and the tests.
 */

import type { FieldError, Kind, RecordData } from './kinds.ts';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/**
 * pending      waiting for a maintainer
 * verified     checked against its source; public
 * stale        no longer holds as checked (a recheck found so); shown with a notice
 * rejected     refused by a maintainer or the admin
 * merged       a duplicate, folded into merged_into
 * withdrawn    its parent was rejected, so it was never reviewed; counts against no one
 * applied      a proposal whose change was made to its target (merged_into)
 */
export type RecordStatus = 'pending' | 'verified' | 'stale' | 'rejected' | 'merged' | 'withdrawn' | 'applied';
export const RECORD_STATUSES: readonly RecordStatus[] = ['pending', 'verified', 'stale', 'rejected', 'merged', 'withdrawn', 'applied'];

export type Role = 'collector' | 'maintainer';

/* ───────── agents ───────── */

export interface JoinResponse {
  token: string;
  token_id: string;
  role: 'collector';
  skill_url: string;
  note: string;
}

/** A token's records of one kind. */
export interface Standing {
  pending: number;
  verified: number;
  rejected: number;
  merged: number;
  stale: number;
  pending_cap: number;
  warnings: string[];
}

export interface Work {
  leased: number;
  done_today: number;
  daily_task_limit: number;
}

export interface MeResponse {
  token_id: string;
  role: Role;
  label: string;
  status: string;
  kinds: string[];
  created_at: string;
  standing: Partial<Record<Kind, Standing>>;
  work?: Work;
}

export type SubmitResult =
  | { index: number; status: 'accepted'; id: string; kind: Kind; waits_for?: string }
  | { index: number; status: 'duplicate'; existing_id: string; existing_status: RecordStatus; hint?: string }
  | { index: number; status: 'invalid'; errors: FieldError[] }
  | { index: number; status: 'source_not_found'; message: string }
  | { index: number; status: 'over_cap'; message: string }
  | { index: number; status: 'unchanged'; message: string }
  | { index: number; status: 'proposal_pending'; existing_id: string; message: string }
  | { index: number; status: 'retry_later'; message: string };

export interface SubmitResponse {
  results: SubmitResult[];
  standing: Partial<Record<Kind, { pending: number; pending_cap: number }>>;
  warnings: string[];
}

export type TaskType = 'verify' | 'update' | 'recheck';
export type Verdict = 'verified' | 'rejected' | 'duplicate' | 'stale' | 'unsure';

export interface LeasedRecord {
  id: string;
  kind: Kind;
  status: RecordStatus;
  data: RecordData;
  source_url: string;
  evidence: string;
  observed_at: string;
  submitted_at: string;
  verified_at: string | null;
  /** Echo it as base_hash with list patches, so they apply to the list you read. */
  hash: string;
}

export interface LeasedTask {
  id: string;
  type: TaskType;
  kind: Kind;
  lease_expires_at: string;
  /** What the server found when it looked at the source at submit time, or a collector's flag. */
  note: string | null;
  record: LeasedRecord;
  /** The place or brand the record belongs to. */
  parent: { id: string; kind: Kind; name: string; postcode: string | null; status: RecordStatus } | null;
  /** For an update task: the live record the proposal would change, as it is now. */
  target: LeasedRecord | null;
  /** For a photo or illustration: the image, for the token holding this lease only. */
  media_url: string | null;
  /** For a menu typed up from visitors' photos: every page, in order. */
  pages?: string[];
}

export interface LeaseResponse extends Work {
  tasks: LeasedTask[];
  /** When there is nothing to lease: why, in words an agent can act on. */
  note?: string;
}

export type VerdictResult =
  | { index: number; task_id: string; status: 'applied'; record_status: RecordStatus }
  | { index: number; task_id: string | null; status: 'error'; errors: FieldError[] };

export interface VerdictsResponse extends Work {
  results: VerdictResult[];
}

/** One item of the collectors' work feed. */
export interface WorkItem {
  id: string;
  type: WorkType;
  subject: string;
  priority: number;
  payload: Record<string, unknown> | null;
  status: string;
  handed_until: string | null;
  note: string | null;
}

/** GET /api/work: every item of the type asked for that the agent holds. */
export interface WorkResponse {
  items: WorkItem[];
  /** When the agent holds fewer than it asked for: why, in words it can act on. */
  note?: string;
}

/** A work item as the admin sees it: also the record sent for it, and who holds it. */
export interface AdminWorkItem extends WorkItem {
  record_id: string | null;
  handed_to: { id: string; label: string } | null;
  updated_at: string;
}

export type WorkType = 'lead' | 'menu' | 'menu-link' | 'reviews' | 'transcribe' | 'illustrate';
export const WORK_TYPES: readonly WorkType[] = ['lead', 'menu', 'menu-link', 'reviews', 'transcribe', 'illustrate'];

/* ───────── admin ───────── */

export interface ActorRef {
  id: string;
  label: string;
}

export interface AdminToken {
  id: string;
  role: Role;
  label: string;
  kinds: string[];
  status: string;
  pending_cap: number | null;
  daily_task_limit: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  records: { pending: number; verified: number; rejected: number };
  verdicts: { total: number; today: number };
}

export interface IssuedToken extends AdminToken {
  token: string;
  note: string;
}

export interface AdminRecord {
  id: string;
  kind: Kind;
  status: RecordStatus;
  name: string;
  data: RecordData;
  parent_id: string | null;
  root_id: string | null;
  target_id: string | null;
  source_url: string;
  evidence: string;
  observed_at: string;
  submitted_by: ActorRef;
  flagged: boolean;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
}

export interface AdminRevision {
  id: number;
  action: string;
  actor: ActorRef;
  reason: string | null;
  before: unknown;
  after: unknown;
  source_url: string | null;
  evidence: string | null;
  caused_by: string | null;
  created_at: string;
}

export interface Report {
  id: number;
  record_id: string;
  type: string;
  reason: string;
  status: string;
  created_at: string;
}

export interface AdminRecordDetail {
  record: AdminRecord;
  revisions: AdminRevision[];
  tasks: { id: string; type: TaskType; status: string; leased_to: string | null; note: string | null; created_at: string }[];
  reports: Report[];
  children: { kind: Kind; status: RecordStatus; count: number }[];
}

export interface KindOverview {
  kind: Kind;
  counts: Record<RecordStatus, number>;
  open_tasks: number;
  blocked_tasks: number;
  review: number;
}

export interface ReviewItem {
  type: 'unsure' | 'flagged' | 'report';
  record: AdminRecord;
  reason: string;
  /** Who was unsure, or who sent a flagged record: a token id, and its label. */
  by: string | null;
  by_label: string | null;
  at: string;
  task_id: string | null;
  report_id: number | null;
}

export interface ActivityItem {
  id: number;
  kind: Kind;
  record_id: string;
  record_name: string;
  action: string;
  actor: ActorRef;
  reason: string | null;
  created_at: string;
}

export interface RevertReport {
  reverted: number;
  skipped: { record_id: string; reason: string }[];
}

export interface SpotCheck {
  week: string;
  kind: Kind;
  items: { record: AdminRecord; mark: { correct: boolean; note: string | null; checked_at: string } | null }[];
  marked: number;
  correct: number;
}
