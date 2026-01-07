import path from 'path';
import { promises as fs } from 'fs';
import type { CollectFilesOptions } from './types.js';

export interface CollectedFile {
  fullPath: string;
  rel: string;
}

export async function collectFiles(
  root: string,
  options: CollectFilesOptions = {}
): Promise<CollectedFile[]> {
  const ignoreNames = new Set(options.ignoreNames || []);
  const ignorePaths = new Set(options.ignorePaths || []);
  const files: CollectedFile[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath);
      if (ignorePaths.has(rel)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push({ fullPath, rel });
      }
    }
  }

  await walk(root);
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
