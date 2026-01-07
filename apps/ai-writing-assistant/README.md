# AI Writing Assistant

Reference app that demonstrates the AgentConnect SDK with a consumer writing flow.

## Run locally

From the repo root:

```bash
bun install
bun --cwd apps/ai-writing-assistant run dev
```

NPM alternative:

```bash
npm install
npm --prefix apps/ai-writing-assistant run dev
```

## Connect to the local host

```bash
agentconnect dev --app . --ui http://localhost:5173
```

If the CLI is not installed yet, run it from the SDK repo:

```bash
bun ./packages/cli/src/index.ts dev --app apps/ai-writing-assistant --ui http://localhost:5173
```

## What to edit

- `agentconnect.app.json`: update capabilities and metadata.
- `src/main.js`: plug in your app logic.
- `index.html`: replace the UI.

## UI components

This app uses the `agentconnect-connect` Web Component from `@agentconnect/ui`.
