// Extracted from settings/page.tsx. Server-management settings panel:
// shows backend health/info, exposes restart, snapshot creation, etc.

'use client'

import { useState, useEffect, useCallback } from 'react'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'

export function ServerTab() {
  const [info, setInfo] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const [processes, setProcesses] = useState<any>(null)
  const [logs, setLogs] = useState<{ out: string[]; err: string[] }>({ out: [], err: [] })
  const [logService, setLogService] = useState<'backend' | 'frontend'>('backend')
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const [restartMsg, setRestartMsg] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [infoRes, healthRes, backendStatus] = await Promise.all([
        fetch(`${API_BASE}/v1/system/info`, { headers: AUTH_HEADERS }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/v1/system/health`, { headers: AUTH_HEADERS }).then(r => r.json()).catch(() => null),
        fetch('/api/backend').then(r => r.json()).catch(() => null),
      ])
      setInfo(infoRes)
      setHealth(healthRes)
      // Build process list from backend status + assume frontend is running (we're talking to it)
      setProcesses({
        managed: true,
        processes: [
          {
            name: 'devforgeai-backend',
            status: backendStatus?.healthy
              ? 'online'
              : (backendStatus?.running ? 'degraded' : 'stopped'),
            pid: backendStatus?.pid ?? null,
            port: backendStatus?.port ?? 19001,
            memory_mb: null,
            restarts: 0,
          },
          {
            name: 'devforgeai-frontend',
            status: 'online',
            pid: null,
            port: 3001,
            memory_mb: null,
            restarts: 0,
          },
        ]
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLogs = useCallback(async (service: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/system/logs?service=${service}&lines=80`, { headers: AUTH_HEADERS })
      const data = await res.json()
      setLogs({ out: data.out || [], err: data.err || [] })
    } catch { setLogs({ out: [], err: [] }) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { fetchLogs(logService) }, [logService, fetchLogs])

  const restart = async () => {
    if (!confirm('Restart the backend server? It will be unavailable for a few seconds.')) return
    setRestarting(true)
    setRestartMsg('Restarting backend…')
    try {
      const res = await fetch('/api/backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' })
      }).then(r => r.json())
      setRestartMsg(res.ok ? '✅ Back online!' : `⚠️ ${res.message || 'Restart timed out'}`)
    } catch {
      setRestartMsg('⚠️ Restart failed')
    }
    setRestarting(false)
    fetchAll()
  }

  const pmControl = async (action: string, service = 'all') => {
    setActionMsg(`${action}ing…`)
    setPendingAction(action)
    try {
      // Use the Next.js API route — works even when backend is down
      const res = await fetch('/api/backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action === 'restart' ? 'restart' : action === 'stop' ? 'stop' : 'start' })
      }).then(r => r.json())
      setTimeout(() => { fetchAll(); setActionMsg(res.ok ? '' : res.message || 'Failed'); setPendingAction(null) }, 2000)
    } catch { setActionMsg('Failed'); setPendingAction(null) }
  }

  const statusColor = (s: string) => s === 'online' ? 'text-green-600' : s === 'stopped' ? 'text-gray-400' : 'text-red-500'
  const statusIcon  = (s: string) => s === 'online' ? '●' : s === 'stopped' ? '○' : '✗'

  if (loading) return <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>

  return (
    <div className="space-y-5">

      {/* PM2 Processes */}
      <div className="bg-white shadow sm:rounded-lg overflow-hidden">
        <div className="px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-900">Processes</h3>
            <div className="flex gap-2">
              {actionMsg && <span className="text-xs text-gray-500 self-center">{actionMsg}</span>}
              <button onClick={() => pmControl('restart')} className="text-xs px-2.5 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50" disabled={!!pendingAction}>
                {pendingAction === 'restart' ? <><svg className="animate-spin h-3 w-3 inline mr-1" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Restarting…</> : '🔄 Restart All'}
              </button>
              <button onClick={() => pmControl('stop')} className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50" disabled={!!pendingAction}>
                {pendingAction === 'stop' ? <><svg className="animate-spin h-3 w-3 inline mr-1" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Stopping…</> : '⏹ Stop All'}
              </button>
              <button onClick={() => pmControl('start', 'ecosystem.config.js')} className="text-xs px-2.5 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50" disabled={!!pendingAction}>
                {pendingAction === 'start' ? <><svg className="animate-spin h-3 w-3 inline mr-1" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Starting…</> : '▶ Start All'}
              </button>
              <button onClick={fetchAll} className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">↻</button>
            </div>
          </div>

          {processes?.processes && processes.processes.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {processes.processes.map((p: any) => (
                <div key={p.name} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`text-lg leading-none ${statusColor(p.status)}`}>{statusIcon(p.status)}</span>
                    <div>
                      <p className="font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-400">PID {p.pid || '—'} · {p.restarts} restart{p.restarts !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    {p.cpu != null && <span>{p.cpu}% CPU</span>}
                    {p.memory_mb != null && <span>{p.memory_mb} MB</span>}
                    <span className={`font-medium capitalize ${statusColor(p.status)}`}>{p.status}</span>
                    <div className="flex gap-1">
                      <button onClick={() => pmControl('restart', p.name)} className="px-2 py-0.5 rounded border border-amber-200 text-amber-600 hover:bg-amber-50">⟳</button>
                      <button onClick={() => pmControl('stop', p.name)}    className="px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">■</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 py-3">No process info available.</div>
          )}
        </div>
      </div>

      {/* Info + Health side by side */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white shadow sm:rounded-lg overflow-hidden">
          <div className="px-4 py-4 sm:px-6">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Backend Info</h3>
            {info ? (
              <div className="space-y-2 text-sm">
                {([
                  ['Status',  info.status,          'text-green-600'],
                  ['Uptime',  info.uptime,           ''],
                  ['PID',     info.pid,              'font-mono'],
                  ['Python',  info.python_version,   'font-mono'],
                ] as [string, any, string][]).filter(([, val]) => val != null).map(([label, val, cls]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-400">{label}</span>
                    <span className={`font-medium text-gray-800 ${cls}`}>{String(val)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-red-500">⚠️ Backend unreachable</p>}
          </div>
        </div>

        <div className="bg-white shadow sm:rounded-lg overflow-hidden">
          <div className="px-4 py-4 sm:px-6">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Health</h3>
            {health ? (
              <div className="space-y-2 text-sm">
                {Object.entries(health).filter(([,v]) => typeof v !== 'object').map(([k, v]: any) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-400 capitalize">{k.replace(/_/g,' ')}</span>
                    <span className={`font-medium ${String(v).startsWith('healthy')||v===true?'text-green-600':v==='degraded'?'text-amber-500':'text-gray-700'}`}>{String(v)}</span>
                  </div>
                ))}
                {Object.entries(health).filter(([,v]) => v && typeof v === 'object').map(([gk, gv]: any) => (
                  Object.entries(gv).map(([ck, cv]: any) => {
                    const s = String(cv); const ok = s.startsWith('healthy'); const bad = s.startsWith('unhealthy')||s.startsWith('error')
                    const [status, ...rest] = s.split(':'); const detail = rest.join(':').trim()
                    return (
                      <div key={ck} className="flex justify-between">
                        <span className="text-gray-400 capitalize">{ck.replace(/_/g,' ')}</span>
                        <div className="text-right">
                          <span className={`font-medium ${ok?'text-green-600':bad?'text-red-500':'text-amber-500'}`}>{ok?'✓':bad?'✗':'⚠'} {status.trim()}</span>
                          {detail && <p className="text-xs text-gray-400">{detail}</p>}
                        </div>
                      </div>
                    )
                  })
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">—</p>}
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white shadow sm:rounded-lg overflow-hidden">
        <div className="px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-900">Logs</h3>
            <div className="flex gap-2">
              <select value={logService} onChange={e => setLogService(e.target.value as any)}
                className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600">
                <option value="backend">Backend</option>
                <option value="frontend">Frontend</option>
              </select>
              <button onClick={() => fetchLogs(logService)} className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">↻ Refresh</button>
            </div>
          </div>
          <div className="bg-gray-950 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5">
            {[...logs.out, ...logs.err].length > 0
              ? [...logs.out, ...logs.err].map((line, i) => (
                  <div key={i} className={line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback') ? 'text-red-400' : line.toLowerCase().includes('warn') ? 'text-yellow-400' : 'text-gray-300'}>
                    {line}
                  </div>
                ))
              : <span className="text-gray-500">No logs yet — start the app with PM2 to see output here.</span>
            }
          </div>
        </div>
      </div>

      {/* Restart backend worker */}
      <div className="bg-white shadow sm:rounded-lg overflow-hidden border border-amber-100">
        <div className="px-4 py-4 sm:px-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Restart Backend Worker</h3>
          <p className="text-sm text-gray-500 mb-3">
            Triggers a graceful worker reload (touches <code className="bg-gray-100 px-1 rounded text-xs">main.py</code>). Useful after editing <code className="bg-gray-100 px-1 rounded text-xs">.env</code>. Use the PM2 controls above to start/stop the entire process.
          </p>
          {restartMsg && (
            <div className={`mb-3 text-sm px-3 py-2 rounded-lg ${restartMsg.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              {restartMsg}
            </div>
          )}
          <button onClick={restart} disabled={restarting || !info}
            className="inline-flex items-center gap-2 px-4 py-2 border border-amber-300 text-sm font-medium rounded-md text-amber-700 bg-white hover:bg-amber-50 disabled:opacity-50">
            {restarting ? (
  <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg> Restarting…</>
) : (
  <>🔄 Reload Worker</>
)}
          </button>
        </div>
      </div>
    </div>
  )
}
