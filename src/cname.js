import fs from 'node:fs/promises';
import path from 'node:path';

export const CNAME_FILE = 'CNAME';

const LABEL = '(?!-)[a-z0-9-]{1,63}(?<!-)';
const HOSTNAME_PATTERN = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

/**
 * Validates a GitHub Pages custom domain and returns its normalized form.
 * Only bare hostnames are accepted: no scheme, port, path, query, or
 * trailing slash, so the value can never escape the single-line CNAME file.
 */
export function normalizeCname(value, field = 'cname') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`Config ${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const hostname = trimmed.toLowerCase();
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new Error(
      `Config ${field} "${value}" is not a valid hostname. Use a bare domain such as storybook.example.com (no scheme, port, path, or trailing slash).`
    );
  }
  return hostname;
}

export async function writeCnameFile(directory, cname) {
  const hostname = normalizeCname(cname);
  if (!hostname) return false;
  await fs.writeFile(path.join(directory, CNAME_FILE), `${hostname}\n`, 'utf8');
  return true;
}

export async function readCnameFile(directory) {
  try {
    return await fs.readFile(path.join(directory, CNAME_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
