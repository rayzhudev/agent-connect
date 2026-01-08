# Contributing

Thanks for helping improve AgentConnect.

## Prerequisites

- Node 20+
- bun

## Setup

```bash
bun install
bun run build
```

## Run locally

```bash
bun run dev:host
```

## Tests and linting

```bash
bun run test:smoke
bun run lint
bun run format:check
```

## Guidelines

- Keep changes small and focused.
- Prefer clear TypeScript types and predictable APIs.
- Avoid adding new tracking systems or TODO lists in markdown files.
- If you touch protocol behavior, update `SPEC.md`.
