import fs from 'fs';
import path from 'path';
import type { ObservedTracker, ObservedCapabilities } from './types.js';

export interface ObservedTrackerOptions {
  basePath: string;
  appId: string;
  requested?: string[];
}

interface ObservedSnapshot extends ObservedCapabilities {
  appId: string;
  updatedAt: string;
}

export function createObservedTracker({
  basePath,
  appId,
  requested = [],
}: ObservedTrackerOptions): ObservedTracker {
  const requestedList = Array.isArray(requested) ? requested.filter(Boolean) : [];
  const dirPath = path.join(basePath, '.agentconnect');
  const filePath = path.join(dirPath, 'observed-capabilities.json');
  const observed = new Set<string>();
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  function load(): void {
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as { observed?: unknown };
      if (Array.isArray(parsed?.observed)) {
        for (const entry of parsed.observed) {
          if (typeof entry === 'string' && entry) observed.add(entry);
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  function snapshot(): ObservedSnapshot {
    return {
      appId,
      requested: requestedList,
      observed: Array.from(observed).sort(),
      updatedAt: new Date().toISOString(),
    };
  }

  function flush(): void {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    const payload = JSON.stringify(snapshot(), null, 2);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, payload);
  }

  function scheduleFlush(): void {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      flush();
    }, 400);
  }

  function record(capability: string): void {
    const value = typeof capability === 'string' ? capability.trim() : '';
    if (!value) return;
    if (observed.has(value)) return;
    observed.add(value);
    scheduleFlush();
  }

  function list(): string[] {
    return Array.from(observed).sort();
  }

  load();

  return {
    record,
    list,
    snapshot,
    flush,
  };
}
