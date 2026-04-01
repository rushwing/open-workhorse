import { readFile, writeFile } from 'node:fs/promises';

export type ReqStatus =
  | 'draft'
  | 'ready'
  | 'review_ready'
  | 'test_designed'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'done';

export interface ReqFrontmatter {
  req_id: string;
  title: string;
  status: ReqStatus;
  priority: string;
  phase: string;
  owner: string;
  blocked_reason?: string;
  blocked_from_status?: string;
  blocked_from_owner?: string;
  depends_on: string[];
  test_case_ref: string[];
  tc_policy: 'required' | 'exempt' | 'optional';
  tc_exempt_reason?: string;
  scope: string;
  acceptance: string;
  pending_bugs: string[];
  pr_number?: string;
  review_round?: number;
  branch_name?: string;
  [key: string]: unknown;
}

/**
 * Split a markdown file into frontmatter string and body string.
 * Returns null for frontmatter if the file doesn't start with '---'.
 */
function splitFrontmatter(content: string): { fm: string; body: string } | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = content.slice(4, end); // skip opening "---\n"
  const body = content.slice(end + 4); // skip closing "\n---"
  return { fm, body };
}

/**
 * Parse a minimal YAML subset used in REQ frontmatter files.
 * Supports: string scalars, quoted strings, booleans, integers, inline arrays, block scalars (>).
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // Key: value
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trimStart();

    // Block scalar (>): collect continuation lines
    if (rawValue.trimEnd() === '>') {
      i++;
      const parts: string[] = [];
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        parts.push(lines[i].trim());
        i++;
      }
      result[key] = parts.join(' ').trim();
      continue;
    }

    // Inline array: [a, b, c]
    if (rawValue.trimEnd().startsWith('[')) {
      const arrayStr = rawValue.trimEnd();
      const inner = arrayStr.slice(1, arrayStr.lastIndexOf(']'));
      if (inner.trim() === '') {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map((s) => {
          const t = s.trim();
          // Strip surrounding quotes
          if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            return t.slice(1, -1);
          }
          return t;
        });
      }
      i++;
      continue;
    }

    // Block list (- item)
    if (rawValue.trim() === '') {
      i++;
      const items: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('- ')) {
        items.push(lines[i].trimStart().slice(2).trim());
        i++;
      }
      if (items.length > 0) {
        result[key] = items;
      } else {
        result[key] = [];
      }
      continue;
    }

    // Scalar
    result[key] = parseScalar(rawValue.trim());
    i++;
  }

  return result;
}

function parseScalar(value: string): unknown {
  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Null
  if (value === 'null' || value === '~' || value === '') return null;
  // Integer
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  // Float
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Plain string
  return value;
}

/**
 * Serialize a value back to YAML inline format.
 */
function serializeValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[' + value.map((v) => String(v)).join(', ') + ']';
  }
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Use quotes if string contains special characters or is empty
    if (value === '' || /[:#\[\]{}|>&*!,?@`'"]/.test(value) || value.includes('\n')) {
      return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return value;
  }
  return String(value);
}

/**
 * Reconstruct the frontmatter YAML string from an object,
 * preserving the original key order where possible.
 */
function serializeFrontmatter(
  originalFm: string,
  patch: Record<string, unknown>
): string {
  const lines = originalFm.split('\n');
  const patchedKeys = new Set(Object.keys(patch));
  const writtenKeys = new Set<string>();
  const resultLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Blank lines / comments: preserve
    if (line.trim() === '' || line.trim().startsWith('#')) {
      resultLines.push(line);
      i++;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      resultLines.push(line);
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trimStart();

    // Detect block scalar
    const isBlockScalar = rawValue.trimEnd() === '>';
    // Detect empty value that might be followed by block list
    const isEmptyValue = rawValue.trim() === '';

    if (patchedKeys.has(key)) {
      // Replace with patched value
      const newVal = patch[key];
      writtenKeys.add(key);
      resultLines.push(`${key}: ${serializeValue(newVal)}`);

      // Skip original continuation lines for block scalar
      if (isBlockScalar) {
        i++;
        while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
          i++;
        }
      } else if (isEmptyValue) {
        // Skip block list items if they exist
        i++;
        while (i < lines.length && lines[i].trimStart().startsWith('- ')) {
          i++;
        }
      } else {
        i++;
      }
    } else {
      // Preserve original line(s)
      resultLines.push(line);
      i++;
      if (isBlockScalar) {
        while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
          resultLines.push(lines[i]);
          i++;
        }
      } else if (isEmptyValue) {
        while (i < lines.length && lines[i].trimStart().startsWith('- ')) {
          resultLines.push(lines[i]);
          i++;
        }
      }
    }
  }

  // Append any new keys not present in original
  for (const key of Object.keys(patch)) {
    if (!writtenKeys.has(key)) {
      resultLines.push(`${key}: ${serializeValue(patch[key])}`);
    }
  }

  return resultLines.join('\n');
}

/**
 * Parse the YAML frontmatter of a REQ markdown file.
 */
export async function parseReqFrontmatter(filePath: string): Promise<ReqFrontmatter> {
  const content = await readFile(filePath, 'utf8');
  const split = splitFrontmatter(content);
  if (!split) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }
  const raw = parseSimpleYaml(split.fm);

  // Coerce array fields
  const ensureArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (v === null || v === undefined || v === '') return [];
    return [String(v)];
  };

  return {
    ...raw,
    req_id: String(raw['req_id'] ?? ''),
    title: String(raw['title'] ?? ''),
    status: (raw['status'] as ReqStatus) ?? 'draft',
    priority: String(raw['priority'] ?? ''),
    phase: String(raw['phase'] ?? ''),
    owner: String(raw['owner'] ?? ''),
    depends_on: ensureArray(raw['depends_on']),
    test_case_ref: ensureArray(raw['test_case_ref']),
    tc_policy: (raw['tc_policy'] as ReqFrontmatter['tc_policy']) ?? 'optional',
    scope: String(raw['scope'] ?? ''),
    acceptance: String(raw['acceptance'] ?? ''),
    pending_bugs: ensureArray(raw['pending_bugs']),
  } as ReqFrontmatter;
}

/**
 * Update specific fields in a REQ markdown file, preserving all other content.
 */
export async function patchReqFrontmatter(
  filePath: string,
  patch: Partial<ReqFrontmatter>
): Promise<void> {
  const content = await readFile(filePath, 'utf8');
  const split = splitFrontmatter(content);
  if (!split) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }
  const newFm = serializeFrontmatter(split.fm, patch as Record<string, unknown>);
  const newContent = '---\n' + newFm + '\n---' + split.body;
  await writeFile(filePath, newContent, 'utf8');
}
