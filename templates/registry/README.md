# AgentConnect Registry Template

This directory is a starter layout for a registry repo. Use it when you spin up
the public registry for AgentConnect apps.

## Structure

- `index.json` tracks all published apps and versions.
- `apps/<appId>/<version>/` stores `app.zip`, `manifest.json`, and optional `signature.json`.

## Validation

Use the CLI validator before merging:

```bash
agentconnect registry-verify --registry . --require-signature --json
```

If the CLI is not installed yet, run it from the AgentConnect repo:

```bash
bun /path/to/agent-connect/packages/cli/src/index.ts registry-verify --registry . --require-signature --json
```
