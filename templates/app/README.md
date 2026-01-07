# **APP_NAME**

This is a starter AgentConnect app scaffolded from the template.

## Run locally

```bash
bun install
bun run dev
```

NPM alternative:

```bash
npm install
npm run dev
```

## Connect to the local host

```bash
agentconnect dev --app . --ui http://localhost:5173
```

If the CLI is not installed yet, run it from the SDK repo:

```bash
bun ./packages/cli/src/index.mjs dev --app . --ui http://localhost:5173
```

## Customize

- Update `agentconnect.app.json` with your capabilities and metadata.
- Edit `src/main.js` and `index.html` to fit your UI.
- Add a backend block to the manifest if you need a local service.

## UI components

This template uses the `agentconnect-connect` Web Component from `@agentconnect/ui`.
