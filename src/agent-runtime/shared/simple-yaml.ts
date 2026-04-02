export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

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
    const rawValue = line.slice(colonIdx + 1).trimStart();

    // This helper intentionally supports only the YAML subset used in current
    // harness spec blocks. Folded block scalars (`>`) are supported, but
    // literal block scalars (`|`) are not yet implemented.
    if (rawValue.trimEnd() === '>') {
      i++;
      const parts: string[] = [];
      while (i < lines.length && ((lines[i] ?? '').startsWith('  ') || (lines[i] ?? '').trim() === '')) {
        parts.push((lines[i] ?? '').trim());
        i++;
      }
      result[key] = parts.join(' ').trim();
      continue;
    }

    if (rawValue.trimEnd().startsWith('[')) {
      const arrayStr = rawValue.trimEnd();
      const inner = arrayStr.slice(1, arrayStr.lastIndexOf(']'));
      if (inner.trim() === '') {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map((item) => {
          const trimmed = item.trim();
          if (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
          ) {
            return trimmed.slice(1, -1);
          }
          return trimmed;
        });
      }
      i++;
      continue;
    }

    if (rawValue.trim() === '') {
      i++;
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('- ')) {
        items.push((lines[i] ?? '').trimStart().slice(2).trim());
        i++;
      }
      result[key] = items;
      continue;
    }

    result[key] = parseScalar(rawValue.trim());
    i++;
  }

  return result;
}

function parseScalar(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~' || value === '') return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  return value;
}

export function normalizeStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? [] : [trimmed];
  }
  return [String(value)];
}
