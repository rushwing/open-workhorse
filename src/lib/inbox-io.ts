import { readdir, readFile, writeFile, rename, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentName, Envelope, RequestEnvelope } from '../contracts/inbox-envelope.js';

export interface LegacyMessage {
  message_id?: string;
  from?: string;
  to?: string;
  action?: string;
  req_id?: string;
  [key: string]: unknown;
}

/** Agent names supported by the inbox system. */
const AGENTS: AgentName[] = ['pandas', 'menglan', 'huahua'];

/** Lifecycle subdirectories for each agent's inbox. */
const LIFECYCLE_DIRS = ['pending', 'claimed', 'done', 'failed'] as const;

/**
 * Initialize the inbox directory structure (idempotent).
 */
export async function inboxInit(sharedResourcesRoot: string): Promise<void> {
  for (const agent of AGENTS) {
    for (const dir of LIFECYCLE_DIRS) {
      const dirPath = join(sharedResourcesRoot, 'inbox', `for-${agent}`, dir);
      await mkdir(dirPath, { recursive: true });
    }
  }
}

/**
 * Serialize an Envelope to a YAML frontmatter markdown string.
 */
function envelopeToMarkdown(envelope: Envelope): string {
  const lines: string[] = ['---'];

  const appendField = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}: [${value.map(String).join(', ')}]`);
      }
    } else if (value === null) {
      lines.push(`${key}: `);
    } else {
      const str = String(value);
      // Quote strings that contain special YAML characters
      if (/[:#\[\]{}|>&*!,?@`'"]/.test(str) || str.includes('\n') || str.trim() !== str) {
        lines.push(`${key}: "${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${str}`);
      }
    }
  };

  // Base fields
  appendField('message_id', envelope.message_id);
  appendField('type', envelope.type);
  appendField('from', envelope.from);
  appendField('to', envelope.to);
  appendField('created_at', envelope.created_at);
  appendField('thread_id', envelope.thread_id);
  appendField('correlation_id', envelope.correlation_id);
  appendField('priority', envelope.priority);

  if (envelope.type === 'request') {
    const req = envelope as RequestEnvelope;
    appendField('action', req.action);
    appendField('response_required', req.response_required);
    appendField('objective', req.objective);
    appendField('scope', req.scope);
    appendField('expected_output', req.expected_output);
    appendField('done_criteria', req.done_criteria);
    if (req.context_summary !== undefined) appendField('context_summary', req.context_summary);
    if (req.references !== undefined) appendField('references', req.references);
    if (req.delegation_incomplete !== undefined) {
      appendField('delegation_incomplete', req.delegation_incomplete);
    }
  } else if (envelope.type === 'response') {
    const res = envelope as import('../contracts/inbox-envelope.js').ResponseEnvelope;
    appendField('in_reply_to', res.in_reply_to);
    appendField('status', res.status);
    if (res.summary !== undefined) appendField('summary', res.summary);
  } else if (envelope.type === 'notification') {
    const notif = envelope as import('../contracts/inbox-envelope.js').NotificationEnvelope;
    appendField('event_type', notif.event_type);
    appendField('severity', notif.severity);
  }

  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

/**
 * Check if a RequestEnvelope has any missing delegation required fields.
 */
function isDelegationIncomplete(envelope: RequestEnvelope): boolean {
  return (
    !envelope.objective ||
    !envelope.scope ||
    !envelope.expected_output ||
    !envelope.done_criteria
  );
}

/**
 * Write an Envelope to the pending/ inbox of the target agent.
 * Returns the path of the written file.
 */
export async function inboxWrite(
  sharedResourcesRoot: string,
  to: AgentName,
  envelope: Envelope
): Promise<string> {
  // Ensure directory exists
  const pendingDir = join(sharedResourcesRoot, 'inbox', `for-${to}`, 'pending');
  await mkdir(pendingDir, { recursive: true });

  // Apply delegation_incomplete flag for request envelopes
  let envelopeToWrite = envelope;
  if (envelope.type === 'request') {
    const req = envelope as RequestEnvelope;
    const incomplete = isDelegationIncomplete(req);
    if (incomplete !== req.delegation_incomplete) {
      envelopeToWrite = { ...req, delegation_incomplete: incomplete };
    }
  }

  const filename = `${envelope.message_id}.md`;
  const filePath = join(pendingDir, filename);
  const content = envelopeToMarkdown(envelopeToWrite);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Parse YAML frontmatter from a file string.
 * Returns null if the file doesn't have frontmatter.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = content.slice(4, end);
  return parseYaml(fm);
}

function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trimStart().trimEnd();

    if (rawValue === '>') {
      i++;
      const parts: string[] = [];
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        parts.push(lines[i].trim());
        i++;
      }
      result[key] = parts.join(' ').trim();
      continue;
    }

    if (rawValue.startsWith('[')) {
      const inner = rawValue.slice(1, rawValue.lastIndexOf(']'));
      if (inner.trim() === '') {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      }
      i++;
      continue;
    }

    if (rawValue === '') {
      i++;
      const items: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('- ')) {
        items.push(lines[i].trimStart().slice(2).trim());
        i++;
      }
      result[key] = items;
      continue;
    }

    result[key] = parseScalarValue(rawValue);
    i++;
  }

  return result;
}

function parseScalarValue(value: string): unknown {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

/**
 * Atomically claim the oldest pending message for an agent.
 * Returns { path, envelope } or null if no messages are pending.
 */
export async function inboxClaim(
  sharedResourcesRoot: string,
  agent: AgentName
): Promise<{ path: string; envelope: Envelope } | null> {
  const pendingDir = join(sharedResourcesRoot, 'inbox', `for-${agent}`, 'pending');
  const claimedDir = join(sharedResourcesRoot, 'inbox', `for-${agent}`, 'claimed');

  await mkdir(pendingDir, { recursive: true });
  await mkdir(claimedDir, { recursive: true });

  let files: string[];
  try {
    files = await readdir(pendingDir);
  } catch {
    return null;
  }

  const mdFiles = files.filter((f) => f.endsWith('.md')).sort();
  if (mdFiles.length === 0) return null;

  for (const filename of mdFiles) {
    const srcPath = join(pendingDir, filename);
    const dstPath = join(claimedDir, filename);

    try {
      // Atomic move: on Linux, rename() within same fs is atomic
      await rename(srcPath, dstPath);
      // Read the claimed file
      const content = await readFile(dstPath, 'utf8');
      const raw = parseFrontmatter(content);
      if (!raw) continue;

      return {
        path: dstPath,
        envelope: raw as unknown as Envelope,
      };
    } catch {
      // File was already claimed by a concurrent process, try next
      continue;
    }
  }

  return null;
}

/**
 * Finalize a claimed message: move to done/ or failed/.
 * On failure, appends the error summary to the file before moving.
 */
export async function inboxFinalize(
  claimedPath: string,
  result: 'done' | 'failed',
  errorSummary?: string
): Promise<void> {
  if (result === 'failed' && errorSummary) {
    await appendFile(claimedPath, `\n${errorSummary}`, 'utf8');
  }

  // Replace /claimed/ with /done/ or /failed/ in the path
  const destPath = claimedPath.replace(/\/claimed\//, `/${result}/`);
  const destDir = destPath.slice(0, destPath.lastIndexOf('/'));

  if (!existsSync(destDir)) {
    await mkdir(destDir, { recursive: true });
  }

  await rename(claimedPath, destPath);
}

/**
 * Read a legacy inbox message file (no 'type' field).
 * Returns null if file doesn't exist or has no frontmatter.
 */
export async function inboxReadLegacy(filePath: string): Promise<LegacyMessage | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  if (!content || content.trim() === '') return null;

  const raw = parseFrontmatter(content);
  if (!raw) return null;

  return raw as LegacyMessage;
}
