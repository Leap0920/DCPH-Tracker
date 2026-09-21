# DCPH-Tracker local MCP server

Stdio MCP server for operating the DCPH-Tracker dev server locally: status, start/stop, health, perf, build, logs. No secrets are read or returned.

## Install

```bash
cd /home/sigmund/Desktop/DCPH-Tracker/mcp-server
npm install
```

Verify with a raw JSON-RPC probe:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node index.js
```

## Hermes wiring

```json
{
  "mcpServers": {
    "dcph": {
      "command": "node",
      "args": ["/home/sigmund/Desktop/DCPH-Tracker/mcp-server/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `dcph_status` | Port probe + managed dev-server pid check, node version, `.env.local` presence (name only) |
| `dcph_start` | Spawn `npm run dev` detached on `port` (default 3000); log to `mcp-server/.dcph-dev.log`, pid to `mcp-server/.dcph-dev.pid`; no-op if already serving |
| `dcph_stop` | Gracefully stop the managed dev server pid |
| `dcph_health` | GET `/api/health`; returns parsed status/checks/durationMs plus client-measured latencyMs (`port`, optional `baseUrl`) |
| `dcph_perf` | Sequential timed GETs (`rounds`, default 5) against `/`, `/tracker`, `/api/health`, `/api/tracker`; per-target count/p50Ms/p95Ms/avgMs/bytes plus `.next` size summary |
| `dcph_build` | Run `npm run build` with 10-min timeout; returns pass/fail, wall seconds, output tail |
| `dcph_logs` | Last K lines (default 100) of `.dcph-dev.log` |

## Restart caveat

The managed dev server (`npm run dev`) survives MCP server restarts via its detached pid/log files, but stopping the machine or killing the pid ends it — re-run `dcph_start` afterwards. If the port is held by another (non-managed) process, `dcph_start` errors instead of killing it.
