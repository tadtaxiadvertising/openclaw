# OpenClaw — EasyPanel Deployment Guide

Deploy OpenClaw as an autonomous gateway on your EasyPanel-managed server.

## Overview

OpenClaw runs as a Docker container with a gateway server that provides an AI agent platform. In autonomous server mode, it operates 24/7 without your laptop, connecting to channels (Telegram, Discord, Slack, etc.) and model providers (NVIDIA, OpenRouter, OpenAI, etc.).

## Prerequisites

- EasyPanel installed on your server
- Docker and Docker Compose available (EasyPanel provides these)
- At least 2GB RAM and 2 CPU cores for the gateway (1GB RAM minimum with Chromium disabled)
- A domain or subdomain pointed to your server (optional, for web UI)

## Step 1: Create the App in EasyPanel

1. **EasyPanel UI → Apps → Create App**
2. **Source**: Git Repository
   - URL: `git@github.com:tadtaxiadvertising/openclaw.git`
   - Branch: `main` (or your preferred branch)
3. **Build Configuration**:
   - Dockerfile path: `/` (root — uses the project's `Dockerfile`)
   - Build args:
     - `OPENCLAW_EXTENSIONS=nvidia` — NVIDIA free-tier model provider (default)
     - `OPENCLAW_INSTALL_BROWSER=` — **OFF by default** for constrained VPS (~300MB savings). Set `1` only if browser automation is needed.
     - Add more extensions: `OPENCLAW_EXTENSIONS=nvidia,telegram` for channels
   - The Dockerfile is a multi-stage build that produces a minimal runtime image (~500-600MB with browser)

## Step 2: Set Environment Variables

In EasyPanel → App → Environment Variables, set these **required** variables:

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | **YES** | Auth token for gateway access. Generate: `openssl rand -hex 32` |
| `OPENCLAW_GATEWAY_BIND` | YES | Set to `lan` so EasyPanel's proxy can reach it |
| `OPENCLAW_DISABLE_BONJOUR` | YES | Set to `1` (Bonjour doesn't work in containers) |
| `OPENCLAW_TZ` | Optional | Server timezone (e.g. `America/New_York`) |

**Model provider keys** (set at least one):

| Variable | Provider | Notes |
|---|---|---|
| `NVIDIA_API_KEY` | NVIDIA | Free-tier models — you'll provide this |
| `NVIDIA_BASE_URL` | NVIDIA | `https://integrate.api.nvidia.com/v1` |
| `OPENROUTER_API_KEY` | OpenRouter | Aggregates many providers |
| `OPENAI_API_KEY` | OpenAI | GPT models |
| `ANTHROPIC_API_KEY` | Anthropic | Claude models |
| `GEMINI_API_KEY` | Google | Gemini models |

**Channel tokens** (set only what you enable):

| Variable | Channel |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram |
| `DISCORD_BOT_TOKEN` | Discord |
| `SLACK_BOT_TOKEN` | Slack |

## Step 3: Configure Persistent Volumes

EasyPanel needs persistent volumes for OpenClaw state. Create these:

| Volume | Mount Path | Purpose |
|---|---|---|
| `openclaw-data` | `/home/node/.openclaw` | Config, state, agent sessions, SQLite DB |
| `openclaw-workspace` | `/home/node/.openclaw/workspace` | Agent workspace files |
| `openclaw-config` | `/home/node/.config/openclaw` | Auth profile secrets |

## Step 4: Port Mapping

| Container Port | Protocol | Purpose |
|---|---|---|
| `18789` | HTTP | Gateway API + Control UI |
| `18790` | WebSocket | Bridge (node-to-node comms) |

EasyPanel will auto-assign external ports or map to a domain. The gateway serves:
- `/healthz` — liveness probe
- `/readyz` — readiness probe
- `/openclaw` — Control UI (web dashboard)

## Step 5: Initial Config (openclaw.json)

On first start, the gateway auto-generates a default config. For server-mode customization, you can seed the config by mounting the template:

```bash
# After first start, copy the template into the persistent volume
docker cp deploy/openclaw.json.easypanel <container_id>:/home/node/.openclaw/openclaw.json
```

Or use the CLI from inside the container:

```bash
docker exec -it <container_id> node dist/index.js config set --batch-json \
  '[{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"}]'
```

### Key config adjustments:

- **Model selection**: Set `agents.defaults.model.primary` to your preferred provider/model
- **Channels**: Enable Telegram/Discord/Slack in `channels` section
- **Heartbeat**: Configure `agents.defaults.heartbeat` for autonomous periodic checks
- **Session reset**: Set `session.reset.mode` to `daily` with `idleMinutes` for auto-cleanup

## Step 6: Verify Deployment

1. Check health: `curl http://localhost:18789/healthz` → should return 200
2. Open Control UI: `http://localhost:18789/openclaw` (use your gateway token to log in)
3. Check logs: EasyPanel → App → Logs

## Step 7: NVIDIA Free-Tier Setup

The `deploy/openclaw.json.easypanel` already configures NVIDIA as primary provider. Just add the API key:

1. Add `NVIDIA_API_KEY` in EasyPanel → App → Environment Variables (secure, not in files)
2. Set `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1`
3. Restart the container from EasyPanel UI

### Available NVIDIA Free Models

All use the OpenAI-compatible API (`/v1/chat/completions`). The config includes all 10 models with aliases:

| Model ID | Alias | Max Tokens | Reasoning | Recommended Use |
|---|---|---|---|---|
| `deepseek-ai/deepseek-v4-flash` | `flash` | 16384 | ✅ | **Primary** — fast + reasoning |
| `deepseek-ai/deepseek-v4-pro` | `pro` | 16384 | ✅ | Deep reasoning tasks |
| `meta/llama-3.3-70b-instruct` | `llama` | 1024 | ❌ | Fallback |
| `mistralai/mixtral-8x7b-instruct-v0.1` | `mixtral` | 1024 | ❌ | Lightweight tasks |
| `google/gemma-2-2b-it` | `gemma` | 1024 | ❌ | Ultra-fast tiny tasks |
| `z-ai/glm-5.2` | `glm` | 16384 | ❌ | Long context |
| `minimaxai/minimax-m3` | `m3` | 8192 | ❌ | General |
| `minimaxai/minimax-m2.7` | `m2` | 8192 | ❌ | General |
| `moonshotai/kimi-k2.6` | `kimi` | 16384 | ❌ | Long context |
| `sarvamai/sarvam-m` | `sarvam` | 16384 | ❌ | General |

**Default model chain**: DeepSeek V4 Flash → MiniMax M2.7 → Llama 3.3 70B

## Step 8: Browser Automation

The config includes headless Chromium for autonomous web control. The docker-compose builds with `OPENCLAW_INSTALL_BROWSER=1` by default (~300MB added to image).

If you want to **disable** browser automation to save space:

1. Set `OPENCLAW_INSTALL_BROWSER=""` as build arg in EasyPanel
2. In `openclaw.json`, set `browser.enabled: false` (or remove the `browser` section entirely)

The browser config in `openclaw.json.easypanel`:

```json5
{
  browser: {
    enabled: true,
    headless: true,
    noSandbox: true,
    defaultProfile: "openclaw",
    profiles: {
      openclaw: { cdpPort: 18800 },
    },
  },
}
```

## Resource Optimization for Constrained VPS

The docker-compose.easypanel.yml now includes built-in resource limits:

- **Memory**: 1GB limit, 512MB reservation (adjust `deploy.resources.limits.memory` based on your VPS)
- **CPU**: 1 core limit, 0.25 core reservation
- **V8 heap**: `NODE_OPTIONS=--max-old-space-size=768` caps Node.js memory (adjust: 1536m for 2GB+ VPS)
- **Chromium**: OFF by default (`OPENCLAW_INSTALL_BROWSER=""`), saves ~300MB + avoids CPU-heavy browser sessions
- **Log rotation**: 5MB per file, 2 rotated copies max for command logs

To adjust for a 2GB VPS, change these values in EasyPanel env vars:

```
NODE_OPTIONS=--max-old-space-size=1536
```

And in docker-compose.easypanel.yml, increase the resource limits:

```yaml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: '2.0'
```

## Docker Compose Alternative

If EasyPanel supports custom docker-compose, use `deploy/docker-compose.easypanel.yml`:

```bash
cd /path/to/openclaw
docker compose -f deploy/docker-compose.easypanel.yml up -d
```

## Troubleshooting

| Issue | Solution |
|---|---|
| Gateway unreachable from host | Ensure `OPENCLAW_GATEWAY_BIND=lan` is set |
| Auth errors | Verify `OPENCLAW_GATEWAY_TOKEN` is set and matches client |
| OOM during build | Increase Docker memory limit or use pre-built image |
| OOM at runtime | Increase `NODE_OPTIONS=--max-old-space-size=` or increase Docker memory limit |
| High VPS CPU/memory usage | Ensure Chromium is disabled (`OPENCLAW_INSTALL_BROWSER=""`); check `deploy.resources.limits` |
| NVIDIA models not responding | Check `NVIDIA_API_KEY` and `NVIDIA_BASE_URL` env vars |
| Channel not connecting | Verify bot token and channel config in openclaw.json |
| Container keeps restarting | Check logs via `docker logs`; likely OOM — increase memory limit or heap size |

## Security Notes

- The container runs as non-root user (`node`, uid 1000)
- Security options: `no-new-privileges:true`, `cap_drop: NET_RAW, NET_ADMIN`
- Gateway token is required for LAN bind — never use `mode: "none"` on a public server
- Use EasyPanel's HTTPS/TLS termination for secure external access
- **NEVER put real secrets in git-tracked files** — use EasyPanel's secure env var storage only
- Docker resource limits (`deploy.resources.limits`) prevent the container from consuming all VPS resources
- `NODE_OPTIONS=--max-old-space-size=768` caps V8 heap growth to prevent OOM scenarios
