# Raspberry Pi Setup Guide

Step-by-step instructions for deploying open-workhorse on a headless Raspberry Pi running OpenClaw.

## Prerequisites

- OpenClaw gateway running on the Pi (`systemctl --user status openclaw-gateway`)
- Node.js 22+ with nvm: `source ~/.nvm/nvm.sh && node --version`
- Tailscale connected to your tailnet
- `gh` CLI installed (for github-kb skill)

## 1. Clone and Build

```bash
source ~/.nvm/nvm.sh
git clone https://github.com/rushwing/open-workhorse.git ~/open-workhorse
cd ~/open-workhorse
npm install
npm run build
```

## 2. Configure Environment

```bash
cp .env.example .env
# Edit .env — required values:
#   LOCAL_API_TOKEN      — generate with: openssl rand -hex 24
#   OPENCLAW_HOME        — absolute path to your .openclaw dir
#   MONITOR_CONTINUOUS   — set to true (required for healthz to stay "ok")
nano .env
```

Minimum `.env` for Pi deployment (substitute your actual home path):

```dotenv
GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_HOME=/path/to/.openclaw
LOCAL_API_TOKEN=<openssl rand -hex 24>
LOCAL_TOKEN_AUTH_REQUIRED=true
READONLY_MODE=true
APPROVAL_ACTIONS_ENABLED=false
APPROVAL_ACTIONS_DRY_RUN=true
IMPORT_MUTATION_ENABLED=false
IMPORT_MUTATION_DRY_RUN=false
UI_MODE=true
UI_PORT=4310
MONITOR_CONTINUOUS=true
```

## 3. Expose via Tailscale

Grant operator permissions (one-time), then serve port 4310:

```bash
sudo tailscale set --operator=$USER
tailscale serve --bg 4310
tailscale serve status
```

Expected output:
```
https://<your-hostname>.tail<id>.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:4310
```

## 4. Systemd User Service (auto-start on reboot)

The service uses `%h` (systemd's home directory specifier) so no absolute paths are needed.
Run `which node` after `source ~/.nvm/nvm.sh` to get your actual node binary path.

```bash
NODE_BIN=$(source ~/.nvm/nvm.sh && which node)

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/open-workhorse.service << EOF
[Unit]
Description=Open Workhorse Control Center
After=network.target openclaw-gateway.service

[Service]
Type=simple
WorkingDirectory=%h/open-workhorse
ExecStart=${NODE_BIN} --env-file-if-exists=.env --import tsx src/index.ts
Restart=always
RestartSec=3
StandardOutput=append:%h/open-workhorse/runtime/ow.log
StandardError=append:%h/open-workhorse/runtime/ow.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable open-workhorse
systemctl --user start open-workhorse
```

Verify:

```bash
systemctl --user status open-workhorse
curl -s http://localhost:4310/healthz \
  -H "Authorization: Bearer <LOCAL_API_TOKEN>" | python3 -m json.tool
```

Expected: `"ok": true, "status": "ok"`

## 5. Shared GitHub KB (optional)

Create a shared repository cache accessible by all agents:

```bash
mkdir -p ~/github-kb
cat > ~/github-kb/CLAUDE.md << 'EOF'
# GitHub KB — Repository Index

Local path: ~/github-kb

## Repositories

EOF
```

Clone repos with shallow history to save disk space:

```bash
gh repo clone <owner>/<repo> ~/github-kb/<repo> -- --depth 1
# or without gh CLI:
git clone --depth 1 https://github.com/<owner>/<repo>.git ~/github-kb/<repo>
```

## 6. Switch Default Workspace (optional)

To change the default agent workspace (e.g. to `workspace-lion`):

```bash
# Backup first
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak.$(date +%Y%m%d)

# Update with jq (substitute your actual workspace path)
jq '.agents.defaults.workspace = "/path/to/workspace-lion"' \
  ~/.openclaw/openclaw.json > /tmp/oc.json && mv /tmp/oc.json ~/.openclaw/openclaw.json

# Restart gateway to apply
systemctl --user restart openclaw-gateway
systemctl --user status openclaw-gateway
```

## Verification Checklist

```bash
# 1. Gateway up
systemctl --user status openclaw-gateway

# 2. open-workhorse up
systemctl --user status open-workhorse

# 3. Health check
curl -s http://localhost:4310/healthz \
  -H "Authorization: Bearer <LOCAL_API_TOKEN>" | python3 -m json.tool

# 4. Tailscale accessible
# Open in browser: https://<hostname>.tail<id>.ts.net/
```
