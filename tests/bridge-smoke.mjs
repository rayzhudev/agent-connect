import http from 'http';
import { AgentConnect } from '../packages/sdk/src/index.ts';
import { createHostBridge } from '@agentconnect/host';

const TIMEOUT_MS = 15000;

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

function startLocalApi() {
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
      }
      if (!body) {
        res.statusCode = 400;
        res.end('missing body');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind local model server.'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
    });
  });
}

async function run() {
  console.log('Smoke: starting embedded host bridge');
  const { server, baseUrl } = await startLocalApi();
  process.env.AGENTCONNECT_LOCAL_BASE_URL = baseUrl;
  process.env.AGENTCONNECT_LOCAL_MODEL = 'mock-model';

  try {
    const bridge = createHostBridge({ mode: 'embedded' });
    globalThis.__AGENTCONNECT_BRIDGE__ = bridge;

    const client = await AgentConnect.connect({ preferInjected: true });
    const hello = await withTimeout(client.hello(), 'Hello');
    if (!hello.hostId) throw new Error('Host hello failed.');

    const providers = await withTimeout(client.providers.list(), 'Providers list');
    if (!Array.isArray(providers)) throw new Error('Provider list failed.');

    const session = await withTimeout(client.sessions.create({ model: 'local' }), 'Session create');
    if (!session?.id) throw new Error('Session create failed.');

    const finalEvent = new Promise((resolve, reject) => {
      const offFinal = session.on('final', (event) => {
        offFinal();
        offError();
        resolve(event);
      });
      const offError = session.on('error', (event) => {
        offFinal();
        offError();
        reject(new Error(event.message));
      });
    });

    await withTimeout(session.send('hello from bridge'), 'Session send');
    await withTimeout(finalEvent, 'Session final');

    await withTimeout(session.close(), 'Session close');
    client.close();
    console.log('Smoke: bridge ok');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
