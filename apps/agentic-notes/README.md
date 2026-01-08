# Agentic Notes

Reference app for AgentConnect that turns local notes into a conversational workspace.

## Run locally

From the repo root:

```bash
bun install
bun --cwd apps/agentic-notes run dev
```

NPM alternative:

```bash
npm install
npm --prefix apps/agentic-notes run dev
```

## Connect to the local host

```bash
agentconnect dev --app apps/agentic-notes --ui http://localhost:5173
```

If the CLI is not installed yet, run it from the SDK repo:

```bash
bun ./packages/cli/src/index.ts dev --app apps/agentic-notes --ui http://localhost:5173
```

## What it demonstrates

- Drag and drop notes or folders to build local context.
- Chat with a connected agent using citations.
- Generate a reusable knowledge snapshot.

## UI components

This app uses the `agentconnect-connect` Web Component from `@agentconnect/ui`.
