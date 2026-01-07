import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export function resolveAppPath(input?: string): string {
  const candidate = input ? path.resolve(input) : process.cwd();
  return candidate;
}

export async function findSchemaDir(): Promise<string | null> {
  const envDir = process.env.AGENTCONNECT_SCHEMA_DIR;
  if (envDir && (await exists(envDir))) return envDir;

  const start = path.dirname(fileURLToPath(import.meta.url));
  const roots = [start, process.cwd()];

  for (const root of roots) {
    let current = root;
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(current, 'schemas');
      if (await exists(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return null;
}
