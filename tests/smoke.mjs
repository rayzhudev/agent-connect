import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const HOST_URL = 'ws://127.0.0.1:9630';
const TIMEOUT_MS = 15000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function waitForHost(attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const socket = new WebSocket(HOST_URL);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 300);
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeAllListeners();
        };
        socket.on('open', () => {
          cleanup();
          resolve();
        });
        socket.on('error', (err) => {
          cleanup();
          reject(err);
        });
      });
      socket.close();
      return true;
    } catch {
      socket.terminate?.();
    }
    await sleep(200);
  }
  throw new Error('Dev host did not start.');
}

async function shutdownProcess(proc) {
  if (!proc) return;
  if (proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  const exited = await withTimeout(
    new Promise((resolve) => {
      proc.on('exit', resolve);
      proc.on('close', resolve);
    }),
    'Host shutdown'
  ).catch(() => false);
  if (!exited) {
    proc.kill('SIGKILL');
    proc.unref();
  }
}

async function run() {
  console.log('Smoke: starting dev host');
  const hostProcess = spawn('bun', ['./packages/cli/src/index.ts', 'dev'], {
    cwd: rootDir,
    stdio: 'pipe',
  });

  hostProcess.stdout.on('data', () => undefined);
  hostProcess.stderr.on('data', () => undefined);

  try {
    await withTimeout(waitForHost(), 'Host startup');
    console.log('Smoke: host ready');
    const { AgentConnect } = await import('../packages/sdk/src/index.ts');
    const client = await AgentConnect.connect({ webSocket: WebSocket });
    const hello = await withTimeout(client.hello(), 'Hello');
    if (!hello.hostId) throw new Error('Host hello failed.');

    const providers = await withTimeout(client.providers.list(), 'Providers list');
    if (!Array.isArray(providers)) throw new Error('Provider list failed.');

    const session = await withTimeout(
      client.sessions.create({ model: 'claude-opus' }),
      'Session create'
    );
    if (!session?.id) throw new Error('Session create failed.');

    await withTimeout(session.close(), 'Session close');
    client.close();
    console.log('Smoke: ok');
  } finally {
    console.log('Smoke: shutting down');
    await shutdownProcess(hostProcess);
    console.log('Smoke: complete');
  }
}

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
