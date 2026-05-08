# DevForgeAI — Installation Guide

> Works on **Windows**, **macOS**, and **Linux**.
> Estimated setup time: 5–10 minutes.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Install](#quick-install)
- [Manual Install](#manual-install)
- [Configuration](#configuration)
- [Starting the App](#starting-the-app)
- [Platform Notes](#platform-notes)
- [Docker Install (Alternative)](#docker-install-alternative)
- [Troubleshooting](#troubleshooting)
- [Updating](#updating)

---

## Prerequisites

| Tool | Version | Download |
|---|---|---|
| **Python** | 3.11 or newer | https://www.python.org/downloads/ |
| **Node.js** | 18 or newer | https://nodejs.org/ |
| **Git** | Any recent | https://git-scm.com/ |

> **At least one provider connection is required** to chat. Ollama works locally with no cloud credential at all.
> The easiest way to connect providers is Settings → API Keys, which now shows each provider's supported methods and live status.

Supported connection methods:
- Anthropic: API key
- Google / Gemini: API key
- OpenRouter: OAuth or API key
- OpenAI / Codex: API key or local Codex OAuth session
- GitHub Copilot: Copilot device flow, GitHub OAuth, or GitHub CLI import

### Installing Prerequisites

#### Windows
```powershell
# Check what you have
python --version
node --version
git --version
```
If missing, install from the links above. Use the official installers — they add to PATH automatically.

> ⚠️ During Python install, check **"Add Python to PATH"**.

#### macOS
```bash
# Using Homebrew (recommended)
brew install python node git

# Or install manually from the links above
```

#### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv nodejs npm git
```

#### Linux (Fedora/RHEL)
```bash
sudo dnf install -y python3 python3-pip nodejs npm git
```

---

## Quick Install

```bash
# 1. Clone the repository
git clone https://github.com/chriskesler35/model_mesh.git
cd model_mesh

# 2. Run bootstrap (installer + guided config)
python devforgeai.py bootstrap

# 3. Start app
python devforgeai.py start
```

That's it. Bootstrap will:
- Verify Python 3.11+ and Node.js 18+
- Create a Python virtual environment in `backend/venv/`
- Install all Python dependencies (`backend/requirements.txt`)
- Install all Node.js dependencies (`frontend/node_modules/`)
- Create/normalize `backend/.env` with a guided walkthrough
- Auto-migrate legacy env names to current names
- Generate platform-specific start scripts (`start.bat` or `start.sh`)

After it finishes, start the app and open http://localhost:3001.

Then open Settings → API Keys and connect the providers you want to use. The page shows a per-provider setup card so you can see which method is supported and what is still missing.

---

## Manual Install

If you prefer doing it step by step:

```bash
# 1. Clone
git clone https://github.com/chriskesler35/model_mesh.git
cd model_mesh

# 2. Backend — create venv and install deps
cd backend
python -m venv venv

# Activate the venv:
#   Windows:  venv\Scripts\activate
#   macOS/Linux: source venv/bin/activate

pip install -r requirements.txt

# 3. Frontend — install node packages
cd ../frontend
npm install

# 4. Environment
cd ..
cp backend/.env.example backend/.env
# Edit backend/.env and add at least one API key

# 5. Create data directory
mkdir -p data
```

---

## Configuration

Edit `backend/.env`. At minimum, add **one** AI provider key:

```env
# Pick any combination you have access to:
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
GEMINI_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-v1-...
OPENAI_API_KEY=sk-...

# Ollama (local, no key needed — just have Ollama running)
OLLAMA_BASE_URL=http://localhost:11434
```

### Ollama gotchas before first launch

- DevForgeAI does not start Ollama for you. Make sure the Ollama app or daemon is already running before starting DevForgeAI.
- Confirm the endpoint responds before blaming the app:
  ```bash
  curl http://localhost:11434/api/tags
  ```
- If DevForgeAI is running in Docker or another containerized environment, `localhost` points at the container, not your host machine. In that case set `OLLAMA_BASE_URL=http://host.docker.internal:11434`.
- If you use Ollama on another machine, point `OLLAMA_BASE_URL` at that server instead, for example `http://192.168.1.50:11434` or a private Tailscale address.
- Some local models simply will not fit in available VRAM. DevForgeAI now guards against loading models that exceed free memory and may reject them or fall back to another model instead of hanging the request.
- Very long chats can exceed a model's context window. Current builds auto-compact the conversation and you can also run `/compact` manually.
- If a tool-using model ever prints raw tool-call JSON instead of actually doing the work, update to the latest build and run `python devforgeai.py sync`. Older builds could truncate large tool-call payloads on some Ollama-routed models.

### Remote Ollama

Remote Ollama works the same at the API level as local Ollama. DevForgeAI can still discover models, send chat requests, and stream responses as long as the remote server exposes the normal Ollama HTTP API.

What changes when you go remote:
- `OLLAMA_BASE_URL` must point to the remote machine, not `localhost`
- latency is higher, so streaming and tool-heavy tasks may feel slower
- failures become network-sensitive, so a dropped connection looks like provider downtime
- VRAM fit depends on the remote server's GPU, not the client machine running DevForgeAI

Recommended setup:
- keep the Ollama endpoint on a private network, VPN, or Tailscale instead of exposing it directly to the public internet
- if you must expose it, put it behind a reverse proxy and access control
- test reachability from the same machine that runs DevForgeAI:
  ```bash
  curl http://YOUR-OLLAMA-HOST:11434/api/tags
  ```
- then set `OLLAMA_BASE_URL` to that exact reachable address

**Full `.env` reference:**

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | *(auto: SQLite)* | Leave blank for SQLite. Set to Postgres URL for production. |
| `ANTHROPIC_API_KEY` | — | Anthropic Claude API key |
| `GOOGLE_API_KEY` | — | Google AI / Gemini key |
| `GEMINI_API_KEY` | — | Alternative Gemini key (either works) |
| `OPENROUTER_API_KEY` | — | OpenRouter unified key |
| `OPENAI_API_KEY` | — | OpenAI key |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama instance |
| `COMFYUI_URL` | `http://localhost:8188` | ComfyUI for image generation (optional) |
| `MODELMESH_API_KEY` | `modelmesh_local_dev_key` | Internal API auth key |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot (optional) |
| `TELEGRAM_CHAT_IDS` | — | Comma-separated authorized Telegram chat IDs |

---

## Starting the App

### Option A — CLI (recommended, hardened)

```bash
# Start everything
python devforgeai.py start

# Start only the backend
python devforgeai.py start backend

# Start only the frontend
python devforgeai.py start frontend

# Check status
python devforgeai.py status

# Stop everything
python devforgeai.py stop
```

`python devforgeai.py start` is the preferred path because it performs startup hardening (single-instance cleanup + readiness checks) before declaring the app ready.

### Option B — Platform scripts

**Windows:** Double-click `start.bat` (generated by the installer).
This delegates to the same hardened CLI path above.

**macOS/Linux:**
```bash
./start.sh
```

### Option C — Manual (two terminals, debug only)

**Terminal 1 — Backend:**
```bash
cd backend
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

uvicorn app.main:app --host 0.0.0.0 --port 19001 --reload
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

### Access

| Service | URL |
|---|---|
| **App (frontend)** | http://localhost:3001 |
| **API** | http://localhost:19001 |
| **API Docs (Swagger)** | http://localhost:19001/docs |

On first launch, DevForgeAI will run a short onboarding flow to set up your profile.

---

## Platform Notes

### Windows

- Python must be in your PATH. Re-run the Python installer and check **"Add Python to PATH"** if needed.
- Run `start.bat` or `python devforgeai.py start` from the project root.
- If you see "Execution Policy" errors in PowerShell, run:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
- To allow remote access through Windows Firewall (run as Administrator):
  ```powershell
  netsh advfirewall firewall add rule name="DevForgeAI API" dir=in action=allow protocol=tcp localport=19000
  netsh advfirewall firewall add rule name="DevForgeAI Frontend" dir=in action=allow protocol=tcp localport=3001
  ```

### macOS

- If `python` is not found, try `python3`:
  ```bash
  python3 install.py
  python3 devforgeai.py start
  ```
- Gatekeeper may block unsigned scripts. If so:
  ```bash
  chmod +x start.sh
  xattr -d com.apple.quarantine start.sh   # if downloaded via browser
  ```

### Linux

- Use `python3` if `python` isn't aliased to Python 3.
- Ensure `python3-venv` is installed:
  ```bash
  sudo apt install -y python3-venv   # Debian/Ubuntu
  ```
- To run as a background service, see [Running as a Service](#running-as-a-service) below.

### Running as a Service (Linux / macOS)

Create a simple systemd service (Linux):

```ini
# /etc/systemd/system/devforgeai-backend.service
[Unit]
Description=DevForgeAI Backend
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/model_mesh/backend
ExecStart=/path/to/model_mesh/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 19000
Restart=on-failure
EnvironmentFile=/path/to/model_mesh/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable devforgeai-backend
sudo systemctl start devforgeai-backend
```

---

## Docker Install (Alternative)

If you have Docker and Docker Compose installed:

```bash
# 1. Clone
git clone https://github.com/chriskesler35/model_mesh.git
cd model_mesh

# 2. Configure
cp .env.example .env        # (root-level .env for Docker)
# Edit .env and add API keys

# 3. Start
docker compose up -d

# 4. Access
open http://localhost:3001   # frontend
open http://localhost:19000  # API
```

> ⚠️ The Docker Compose setup uses PostgreSQL + Redis by default (more production-like).
> The manual/quick install uses SQLite (simpler, zero-config).

---

## Troubleshooting

### Ollama connection and model gotchas

| Problem | What it usually means | What to do |
|---|---|---|
| Ollama models do not appear in the app | Ollama is not reachable from the backend | Verify `OLLAMA_BASE_URL`, then run `curl http://localhost:11434/api/tags` on the same machine that runs the backend |
| `connection refused` / `failed to connect to Ollama` | Ollama is not running, wrong port, or wrong host | Start Ollama and confirm it is listening on `11434`; if backend is in Docker use `host.docker.internal` instead of `localhost` |
| Model shows up but requests fail immediately | The model may not fit into available VRAM/RAM | Pull a smaller model, free GPU memory, or pick a cloud model fallback |
| Long chat suddenly stops answering or says the context is too long | The conversation exceeded the active model's context window | Use `/compact` or continue after the automatic compaction message; older builds may require starting a new conversation |
| Model returns raw JSON that looks like a tool call | The tool-call response was truncated before the parser could execute it | Update to the latest DevForgeAI build and run `python devforgeai.py sync`, then restart |
| Ollama works on host but not from Docker | Container cannot reach the host's `localhost` | Set `OLLAMA_BASE_URL=http://host.docker.internal:11434` |

### "python: command not found" / "python3: command not found"
- Install Python 3.11+ from https://www.python.org/downloads/
- Windows: re-run installer with "Add Python to PATH" checked
- macOS: `brew install python`

### "node: command not found"
- Install Node.js 18+ from https://nodejs.org/
- Or via Homebrew: `brew install node`

### "pip install failed" / "No module named venv"
On Ubuntu/Debian:
```bash
sudo apt install -y python3-pip python3-venv
```

### Backend starts but returns 500 errors
- Check that `backend/.env` exists and has at least one API key
- View logs in the terminal running the backend
- SQLite DB is auto-created at `data/devforgeai.db` on first run

### Frontend shows "Cannot connect to backend"
- Make sure the backend is running on port 19000
- Check for firewall rules blocking local connections

### Port already in use
```bash
# Find what's using port 19000 (macOS/Linux)
lsof -ti:19000 | xargs kill

# Windows
netstat -ano | findstr :19000
taskkill /PID <PID> /F
```

### Image generation not working
- Image generation requires a valid `GOOGLE_API_KEY` (Gemini Imagen) or a running ComfyUI instance at `COMFYUI_URL`
- Falls back gracefully if neither is available

---

## Updating

After every `git pull`, run:

```bash
python devforgeai.py sync
```

Then restart:

```bash
python devforgeai.py start
```

```bash
# Pull latest changes
git pull

# Re-run dependencies (picks up any new packages)
python install.py

# Or manually:
cd backend && source venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install
```

The SQLite database (`data/devforgeai.db`) is not touched by updates. Your data is preserved.

---

## Project Structure

```
model_mesh/
├── backend/              Python FastAPI backend
│   ├── app/
│   │   ├── main.py       App entry point
│   │   ├── config.py     Settings (reads .env)
│   │   ├── routes/       API endpoints
│   │   ├── models/       SQLAlchemy ORM models
│   │   └── services/     Business logic
│   ├── requirements.txt  Python dependencies
│   ├── .env.example      Environment template
│   └── venv/             Python virtual environment (created by installer)
├── frontend/             Next.js 14 frontend
│   ├── src/app/          React pages
│   └── package.json      Node dependencies
├── data/                 Runtime data (auto-created)
│   ├── devforgeai.db     SQLite database
│   ├── images/           Generated images
│   ├── soul.md           AI identity
│   └── user.md           Your profile
├── install.py            Cross-platform installer ← run this first
├── devforgeai.py         CLI runner (start/stop/status)
├── start.bat             Windows start script (generated)
├── start.sh              macOS/Linux start script (generated)
├── INSTALL.md            This file
└── README.md             Feature overview
```

---

## Need Help?

- **Docs:** See `README.md` for feature documentation
- **API:** http://localhost:19000/docs (Swagger UI, auto-generated)
- **Logs:** Check the terminal windows running the backend/frontend
