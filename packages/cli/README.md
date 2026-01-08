# @agentconnect/cli

AgentConnect CLI host for local development and registry workflows.

## Install

```bash
bun add -g @agentconnect/cli
```

```bash
npm install -g @agentconnect/cli
```

```bash
pnpm add -g @agentconnect/cli
```

## Dev host

```bash
agentconnect dev --app . --ui http://localhost:5173
```

## Packaging

```bash
agentconnect pack --app . --out dist/app.zip
agentconnect verify --app dist/app.zip
agentconnect sign --app dist/app.zip --key /path/to/private.key
```

## Publishing

```bash
agentconnect publish --app dist/app.zip --registry /path/to/registry --signature dist/app.sig.json
```

## Provider commands

The CLI can install and log in to providers on demand. You can override commands with:

- `AGENTCONNECT_CLAUDE_COMMAND`
- `AGENTCONNECT_CLAUDE_INSTALL`
- `AGENTCONNECT_CLAUDE_LOGIN`
- `AGENTCONNECT_CLAUDE_STATUS`
- `AGENTCONNECT_CODEX_COMMAND`
- `AGENTCONNECT_CODEX_INSTALL`
- `AGENTCONNECT_CODEX_LOGIN`
- `AGENTCONNECT_CODEX_STATUS`

## Requirements

- Node 20+

## Docs

See `docs/SDK.md` in the repo for the full SDK reference and `SPEC.md` for the protocol contract.
