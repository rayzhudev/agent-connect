import fs from 'fs';
import path from 'path';

export interface StorageStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  flush(): void;
}

export interface StorageOptions {
  basePath: string;
  appId: string;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function createStorage({ basePath, appId }: StorageOptions): StorageStore {
  const dirPath = path.join(basePath, '.agentconnect', 'storage');
  const filePath = path.join(dirPath, `${sanitizeFileName(appId)}.json`);
  const data: Record<string, unknown> = {};
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  function load(): void {
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return;
      for (const [key, value] of Object.entries(parsed)) {
        data[key] = value;
      }
    } catch {
      // ignore corrupted storage
    }
  }

  function flush(): void {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function scheduleFlush(): void {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      flush();
    }, 400);
  }

  function get(key: string): unknown {
    return data[key];
  }

  function set(key: string, value: unknown): void {
    data[key] = value;
    scheduleFlush();
  }

  load();

  return {
    get,
    set,
    flush,
  };
}
