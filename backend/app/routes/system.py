"""Self-healing and recovery endpoints."""

import os
import sys
import asyncio
import time
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from app.middleware.auth import verify_api_key
from app.services.self_healing import self_healing
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/system", tags=["system"], dependencies=[Depends(verify_api_key)])

# Track startup time for uptime calculation
_START_TIME = time.time()
_UPDATE_STATUS_CACHE: dict | None = None
_UPDATE_STATUS_CACHE_TS: float = 0.0
_UPDATE_STATUS_CACHE_TTL_SECONDS = 300


@router.get("/health")
async def get_health():
    """Get comprehensive system health status."""
    return await self_healing.check_health()


@router.post("/snapshots")
async def create_snapshot(name: str = None):
    """Create a system snapshot for recovery point."""
    return await self_healing.create_snapshot(name)


@router.get("/snapshots")
async def list_snapshots():
    """List all available snapshots."""
    return {"snapshots": self_healing.list_snapshots()}


@router.post("/recover")
async def trigger_recovery():
    """Trigger automatic recovery from unhealthy state."""
    return await self_healing.recover()


@router.post("/rollback/{snapshot_name}")
async def rollback_to_snapshot(snapshot_name: str):
    """Rollback to a specific snapshot."""
    return await self_healing.restore_snapshot(snapshot_name)


def _root_dir() -> Path:
    return Path(__file__).parent.parent.parent.parent


def _run_git(args: list[str]) -> tuple[int, str, str]:
    """Run git command from repo root with short timeout."""
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(_root_dir()),
            capture_output=True,
            text=True,
            timeout=8,
        )
        return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip()
    except Exception as exc:
        return 1, "", str(exc)


def _remote_web_url() -> str | None:
    code, out, _err = _run_git(["config", "--get", "remote.origin.url"])
    if code != 0 or not out:
        return None
    url = out.strip()
    if url.startswith("git@github.com:"):
        url = "https://github.com/" + url.split(":", 1)[1]
    if url.endswith(".git"):
        url = url[:-4]
    return url if url.startswith("http") else None


def _collect_update_status() -> dict:
    code, current_commit, err = _run_git(["rev-parse", "HEAD"])
    if code != 0 or not current_commit:
        return {
            "status": "unavailable",
            "error": err or "Unable to determine current commit.",
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "update_available": False,
            "current_commit": None,
            "latest_commit": None,
            "branch": None,
            "remote": None,
            "compare_url": None,
        }

    code, branch, _err = _run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    if code != 0 or not branch:
        branch = "main"

    latest_commit = None
    for candidate in [branch, "main", "master"]:
        code, out, _err = _run_git(["ls-remote", "--heads", "origin", candidate])
        if code == 0 and out:
            latest_commit = out.split()[0]
            break

    remote = _remote_web_url()
    compare_url = None
    if remote and latest_commit and current_commit and latest_commit != current_commit:
        compare_url = f"{remote}/compare/{current_commit[:12]}...{latest_commit[:12]}"

    return {
        "status": "ok" if latest_commit else "degraded",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "update_available": bool(latest_commit and latest_commit != current_commit),
        "current_commit": current_commit,
        "latest_commit": latest_commit,
        "branch": branch,
        "remote": remote,
        "compare_url": compare_url,
        "error": None if latest_commit else "Unable to read remote HEAD from origin.",
        "app_version": "0.2.0",
    }


@router.get("/update-status")
async def update_status(force: bool = False):
    """Report whether a newer commit exists on origin for this branch."""
    global _UPDATE_STATUS_CACHE, _UPDATE_STATUS_CACHE_TS

    now = time.time()
    if not force and _UPDATE_STATUS_CACHE and (now - _UPDATE_STATUS_CACHE_TS) < _UPDATE_STATUS_CACHE_TTL_SECONDS:
        return {**_UPDATE_STATUS_CACHE, "cached": True}

    status = _collect_update_status()
    _UPDATE_STATUS_CACHE = status
    _UPDATE_STATUS_CACHE_TS = now
    return {**status, "cached": False}


def _backend_port() -> int:
    raw = (os.environ.get("DEVFORGEAI_BACKEND_PORT", "") or "").strip()
    if raw.isdigit():
        return int(raw)
    return 19001


def _read_pids() -> dict:
    pids_file = _root_dir() / ".devforgeai.pids"
    if pids_file.exists():
        import json as _json
        try:
            return _json.loads(pids_file.read_text())
        except Exception:
            pass
    return {}


def _process_info(pid: int, name: str) -> dict:
    """Get info about a running process by PID."""
    import subprocess
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=5
        )
        running = str(pid) in result.stdout
        mem_mb = None
        if running:
            parts = result.stdout.strip().strip('"').split('","')
            if len(parts) >= 5:
                mem_str = parts[4].replace(",", "").replace(" K", "").strip()
                try:
                    mem_mb = round(int(mem_str) / 1024, 1)
                except ValueError:
                    pass
        return {
            "name": name,
            "pid": pid if running else None,
            "status": "online" if running else "stopped",
            "memory_mb": mem_mb,
        }
    except Exception:
        return {"name": name, "pid": None, "status": "unknown", "memory_mb": None}


@router.get("/processes")
async def get_processes():
    """Get status of DevForgeAI background processes."""
    pids = _read_pids()
    processes = []

    port_checks = {
        "devforgeai-backend": _backend_port(),
        "devforgeai-frontend": 3001,
    }

    # Check each service — by PID if we have it, by port as fallback
    import subprocess
    for svc_name, port in port_checks.items():
        pid = pids.get("backend" if "backend" in svc_name else "frontend")

        # Check if port is listening (most reliable signal)
        port_result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=5
        )
        listening_pids = [
            line.strip().split()[-1]
            for line in port_result.stdout.splitlines()
            if f":{port} " in line and "LISTENING" in line
        ]
        is_running = len(listening_pids) > 0
        actual_pid = int(listening_pids[0]) if listening_pids else pid

        info = {"name": svc_name, "status": "online" if is_running else "stopped",
                "pid": actual_pid if is_running else None, "port": port,
                "memory_mb": None, "restarts": 0, "cpu": None}

        if is_running and actual_pid:
            details = _process_info(actual_pid, svc_name)
            info["memory_mb"] = details.get("memory_mb")

        processes.append(info)

    return {"pm2": False, "managed": True, "processes": processes}


@router.get("/logs")
async def get_logs(lines: int = 80, service: str = "backend"):
    """Read recent log lines from log files."""
    log_dir = _root_dir() / "logs"
    # Support both naming conventions
    candidates = [
        log_dir / f"{service}.log",
        log_dir / f"{service}-out.log",
    ]
    err_candidates = [
        log_dir / f"{service}-error.log",
    ]

    out_lines, err_lines = [], []
    for f in candidates:
        if f.exists():
            all_lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
            out_lines = all_lines[-lines:]
            break
    for f in err_candidates:
        if f.exists():
            all_lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
            err_lines = all_lines[-lines:]
            break

    return {"service": service, "out": out_lines, "err": err_lines, "log_dir": str(log_dir)}


@router.post("/processes/{action}")
async def control_process(action: str, service: str = "all"):
    """Control DevForgeAI processes: start, stop, restart."""
    import subprocess
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail="action must be start, stop, or restart")

    root = _root_dir()
    stop_script  = root / "Stop-DevForgeAI.ps1"
    start_script = root / "Start-DevForgeAI.ps1"

    def run_ps(script: Path):
        return subprocess.run(
            ["powershell", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
             "-File", str(script)],
            capture_output=True, text=True, timeout=30
        )

    try:
        if action == "stop":
            r = run_ps(stop_script)
            return {"ok": r.returncode == 0, "output": r.stdout + r.stderr}
        elif action == "start":
            r = run_ps(start_script)
            return {"ok": r.returncode == 0, "output": r.stdout + r.stderr}
        elif action == "restart":
            run_ps(stop_script)
            import asyncio as _asyncio
            await _asyncio.sleep(2)
            r = run_ps(start_script)
            return {"ok": r.returncode == 0, "output": r.stdout + r.stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/info")
async def server_info():
    """Return server uptime, Python version, and process info."""
    uptime_seconds = int(time.time() - _START_TIME)
    hours, remainder = divmod(uptime_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{hours}h {minutes}m {seconds}s" if hours else f"{minutes}m {seconds}s"

    return {
        "status": "running",
        "pid": os.getpid(),
        "python_version": sys.version.split()[0],
        "uptime_seconds": uptime_seconds,
        "uptime": uptime_str,
        "started_at": datetime.fromtimestamp(_START_TIME, tz=timezone.utc).isoformat(),
    }


@router.post("/restart")
async def restart_server():
    """
    Restart the backend by spawning a new process and exiting the current one.
    Works without --reload flag.
    """
    logger.info("Restart requested via API — spawning new process and exiting")

    async def _do_restart():
        await asyncio.sleep(0.5)  # Let the HTTP response go out first

        import subprocess

        backend_dir = Path(__file__).parent.parent.parent
        # Venv lives at repo root (.venv), with legacy backend/venv fallback.
        repo_root = backend_dir.parent
        venv_python = repo_root / ".venv" / "Scripts" / "python.exe"
        if not venv_python.exists():
            venv_python = backend_dir / "venv" / "Scripts" / "python.exe"
        python_exe = str(venv_python if venv_python.exists() else Path(sys.executable))
        backend_port = str(_backend_port())
        restart_script = str(Path(backend_dir) / "restart.py")

        # Spawn the restart helper (detached) — it waits for port to free, then starts uvicorn
        if sys.platform == "win32":
            subprocess.Popen(
                [python_exe, restart_script],
                cwd=str(backend_dir),
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env={**os.environ, "DEVFORGEAI_BACKEND_PORT": backend_port},
            )
        else:
            subprocess.Popen(
                [python_exe, restart_script],
                cwd=str(backend_dir),
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env={**os.environ, "DEVFORGEAI_BACKEND_PORT": backend_port},
            )

        logger.info("Restart helper spawned — exiting current process")
        await asyncio.sleep(0.3)
        os._exit(0)

    asyncio.create_task(_do_restart())

    return JSONResponse({"status": "restarting", "message": "Server restarting — will be back in a few seconds."})
