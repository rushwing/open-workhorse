/**
 * ATM Envelope type definitions for the open-workhorse inbox IPC system.
 * Implements the spec defined in harness/inbox-protocol.md §2.
 */

export type AgentName = 'pandas' | 'menglan' | 'huahua';

export type RequestAction =
  | 'implement'
  | 'req_review'
  | 'review'
  | 'code_review'
  | 'tc_design'
  | 'bugfix'
  | 'fix_review'
  | 'tc_complete'
  | 'review_complete'
  | 'tg_pr_ready'
  | 'tg_decision'
  | 'tg_notify'
  | 'archive'
  | 'keep_alive';

export type ResponseStatus =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'rejected'
  | 'deferred';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface ReferenceItem {
  type: 'req' | 'pr' | 'bug' | 'doc' | 'file';
  id: string;
  url?: string;
}

export interface BaseEnvelope {
  message_id: string;
  type: 'request' | 'response' | 'notification';
  from: AgentName;
  to: AgentName;
  created_at: string;
  thread_id: string;
  correlation_id: string;
  priority: Priority;
}

export interface RequestEnvelope extends BaseEnvelope {
  type: 'request';
  action: RequestAction;
  response_required: boolean;
  objective: string;
  scope: string;
  expected_output: string;
  done_criteria: string;
  context_summary?: string;
  references?: ReferenceItem[];
  delegation_incomplete?: boolean;
}

export interface ResponseEnvelope extends BaseEnvelope {
  type: 'response';
  in_reply_to: string;
  status: ResponseStatus;
  summary?: string;
}

export interface NotificationEnvelope extends BaseEnvelope {
  type: 'notification';
  event_type: string;
  severity: 'info' | 'warn' | 'action-required';
}

export type Envelope = RequestEnvelope | ResponseEnvelope | NotificationEnvelope;

/**
 * Generate a unique message ID.
 * Format: msg_{from}_{yyyymmddHHMMSS}_{rand4}
 */
export function generateMessageId(from: AgentName): string {
  const now = new Date();
  const ts = formatTimestamp(now);
  const rand4 = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `msg_${from}_${ts}_${rand4}`;
}

/**
 * Generate a thread ID for a task chain.
 * Format: thread_{req_id}_{epoch}
 * Thread IDs are stable per req_id (not random) to track the same task chain.
 */
export function generateThreadId(reqId: string): string {
  const epoch = Math.floor(Date.now() / 1000);
  return `thread_${reqId}_${epoch}`;
}

/**
 * Generate a correlation ID for a single request-response pair.
 * Format: corr_{req_id}_{epoch}_{rand4}
 */
export function generateCorrelationId(reqId: string): string {
  const epoch = Math.floor(Date.now() / 1000);
  const rand4 = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `corr_${reqId}_${epoch}_${rand4}`;
}

/**
 * Format a Date as yyyymmddHHMMSS in UTC.
 */
function formatTimestamp(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}
