# Publishing Apps

This flow packages an app for a registry that supports AgentConnect app manifests.

## Build

```bash
bun run build
```

## Package

```bash
agentconnect pack --app . --out dist/app.zip
```

## Verify

```bash
agentconnect verify --app dist/app.zip
```

## Sign

```bash
agentconnect sign --app dist/app.zip --key /path/to/private.key
```

## Publish to a GitHub registry

```bash
git clone <registry-repo-url>
cd <registry-repo>
agentconnect publish --app dist/app.zip --registry . --signature dist/app.sig.json
```

For local testing, you can publish into the repo registry folder:

```bash
agentconnect publish --app dist/app.zip --registry registry --signature dist/app.sig.json
```
