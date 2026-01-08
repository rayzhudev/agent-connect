# AgentConnect Registry (GitHub)

This registry is a GitHub-first catalog of AgentConnect apps. Anyone can submit apps via pull request. Hosts can consume the registry by pointing to the repo URL and reading `index.json`.

## Repository layout

```
index.json
apps/
  <app-id>/
    <version>/
      app.zip
      manifest.json
      signature.json (optional)
```

## Add or update an app

1. Package your app.

```bash
agentconnect pack --app . --out dist/app.zip
```

2. (Optional) Sign it.

```bash
agentconnect sign --app dist/app.zip --key /path/to/private.key
```

3. Publish into the registry repo.

```bash
agentconnect publish --app dist/app.zip --registry . --signature dist/app.sig.json
```

This will:
- Copy the zip into `apps/<app-id>/<version>/app.zip`
- Write `manifest.json` next to it
- Update `index.json`

4. Run validation before opening a PR.

```bash
agentconnect registry-verify --registry .
```

## Hosting on GitHub

Create a public GitHub repo (example: `agentconnect-registry`). Contributors open PRs and maintainers merge them. GitHub provides integrity via commit history, PR review, and CI checks.

Recommended PR checks:
- `agentconnect registry-verify --registry .`
- Hash and signature verification

## Consuming the registry

Hosts should:
1. Fetch `index.json` from the repo.
2. Verify hashes and signatures.
3. Download app zips from the corresponding paths.
