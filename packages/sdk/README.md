# @agentconnect/sdk

AgentConnect SDK for talking to a local AgentConnect host from browser or Node.

## Install

```bash
bun add @agentconnect/sdk
```

```bash
npm install @agentconnect/sdk
```

```bash
pnpm add @agentconnect/sdk
```

## Quick start (browser)

```ts
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect();
const session = await client.sessions.create({ model: 'default' });

let output = '';
session.on('delta', (event) => {
  output += event.text;
});

session.on('final', (event) => {
  console.log('Final:', event.text);
});

session.on('error', (event) => {
  console.error('Agent error:', event.message);
});

await session.send('Summarize this draft in 3 bullets.');
```

## Session context and resume

```ts
const session = await client.sessions.create({
  model: 'codex',
  cwd: '/path/to/project',
  repoRoot: '/path/to/project',
});

session.on('final', (event) => {
  console.log('Session id:', event.providerSessionId);
});

await session.send('Audit the README for clarity.', {
  cwd: '/path/to/project/docs',
});

const resumed = await client.sessions.resume('sess_123', {
  providerSessionId: 'provider-session-id',
  cwd: '/path/to/project',
});
```

## Additional session events

```ts
session.on('raw_line', (event) => {
  console.log('CLI:', event.line);
});

session.on('provider_event', (event) => {
  if (event.provider === 'codex') {
    console.log('Codex event:', event.event);
  }
});
```

## Node usage

```ts
import { WebSocket } from 'ws';
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect({ webSocket: WebSocket });
const session = await client.sessions.create({ model: 'codex', reasoningEffort: 'medium' });

await session.send('Draft a product description for a local AI writing assistant.');
await session.close();
client.close();
```

## Provider and model helpers

```ts
const providers = await client.providers.list();
const claude = await client.providers.status('claude');

if (!claude.loggedIn) {
  await client.providers.ensureInstalled('claude');
  await client.providers.login('claude');
}

const models = await client.models.list('claude');
const recent = await client.models.recent('claude');
```

## Requirements

- Node 20+ for Node usage.
- Browser usage relies on WebSocket support.

## Docs

See `docs/SDK.md` in the repo for the full SDK reference and `SPEC.md` for the protocol contract.
