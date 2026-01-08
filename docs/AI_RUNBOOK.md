# AI Runbook (Command Only)

Use this as a strict step-by-step script for a coding agent.
If `agentconnect` is not installed yet, replace it with `bun /path/to/agent-connect/packages/cli/src/index.ts`.

```bash
AGENTCONNECT_REPO="/path/to/agent-connect"
APP_NAME="My App"
APP_DIR="$HOME/projects/my-app"
DEV_URL="http://localhost:5173"
REGISTRY_REPO="<registry-repo-url>"
SIGNING_KEY="/path/to/private.key"
SIGNATURE_PATH="$APP_DIR/dist/app.sig.json"

cd "$AGENTCONNECT_REPO"

# Scaffold a new app
bun scripts/new-app.mjs --name "$APP_NAME" --out "$APP_DIR"

# Install dependencies
cd "$APP_DIR"
bun install

# Start the app dev server
bun run dev &

# Start the AgentConnect host
agentconnect dev --app . --ui "$DEV_URL" &

# Build
bun run build

# Package
agentconnect pack --app . --out dist/app.zip

# Verify
agentconnect verify --app dist/app.zip

# Sign
agentconnect sign --app dist/app.zip --key "$SIGNING_KEY"

# Publish
cd "$REGISTRY_REPO"
agentconnect publish --app "$APP_DIR/dist/app.zip" --registry . --signature "$SIGNATURE_PATH"
```
