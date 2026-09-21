#!/usr/bin/env node
// dcph-mcp-server: local stdio MCP server for operating the DCPH-Tracker app.
// APP_DIR resolves as the parent of this file (no hardcoding).
// Never reads or returns secret values; .env.local is checked by NAME only.

import { spawn, execFile } from "node:child_process";
import { promises as fsp, openSync, closeSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.dirname(SERVER_DIR);
const LOG_FILE = path.join(SERVER_DIR, ".dcph-dev.log");
const PID_FILE = path.join(SERVER_DIR, ".dcph-dev.pid");
const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const HTTP_TIMEOUT_MS = 15 * 1000;
const PERF_TARGETS = ["/", "/tracker", "/api/health", "/api/tracker"];

// ---------- helpers ----------

function portServing(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function readManagedPid() {
  try {
    const raw = (await fsp.readFile(PID_FILE, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function timedGet(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const start = Date.now();
  const ctrl = new AbortController();
  return new Promise((resolve) => {
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal }).then(
      async (res) => {
        clearTimeout(t);
        let bytes = 0;
        let body = "";
        try {
          const buf = Buffer.from(await res.arrayBuffer());
          bytes = buf.length;
          body = buf.toString("utf8");
        } catch {
          // ignore body read errors; status/timing still valid
        }
        resolve({ ok: true, status: res.status, ms: Date.now() - start, bytes, body });
      },
      (err) => {
        clearTimeout(t);
        resolve({
          ok: false,
          status: null,
          ms: Date.now() - start,
          bytes: 0,
          error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
        });
      },
    );
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarizeLatencies(samples) {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
  const bytes = samples.filter((s) => s.ok).map((s) => s.bytes);
  const failures = samples.length - ok.length;
  const avg = ok.length > 0 ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
  return {
    count: ok.length,
    failures,
    p50Ms: percentile(ok, 50),
    p95Ms: percentile(ok, 95),
    avgMs: avg === null ? null : Math.round(avg * 100) / 100,
    avgBytes: bytes.length > 0 ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : null,
    totalBytes: bytes.reduce((a, b) => a + b, 0),
  };
}

async function dirSizeSummary(dir) {
  // Returns file count + byte total for a build dir, or { present: false }.
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return { present: false };
  } catch {
    return { present: false };
  }
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        files += 1;
        try {
          bytes += (await fsp.stat(full)).size;
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  return { present: true, files, bytes };
}

function normalizeBaseUrl(baseUrl, port) {
  if (typeof baseUrl === "string" && baseUrl.trim() !== "") {
    return baseUrl.trim().replace(/\/+$/, "");
  }
  return `http://127.0.0.1:${port}`;
}

function tailLines(text, n) {
  const lines = String(text).split("\n");
  return lines
    .slice(-n)
    .map((l) => (l.length > 500 ? l.slice(0, 500) + "…[truncated]" : l))
    .join("\n");
}

// ---------- tool handlers ----------

async function handleStatus({ port = 3000 } = {}) {
  const serving = await portServing(port);
  const managedPid = await readManagedPid();
  return {
    port,
    serving,
    managedPid,
    managedAlive: managedPid === null ? false : pidAlive(managedPid),
    nodeVersion: process.version,
    envLocalPresent: existsSync(path.join(APP_DIR, ".env.local")),
    appDir: APP_DIR,
  };
}

async function handleStart({ port = 3000 } = {}) {
  const serving = await portServing(port);
  const managedPid = await readManagedPid();
  if (serving) {
    if (managedPid !== null && pidAlive(managedPid)) {
      return { started: false, alreadyRunning: true, managed: true, pid: managedPid, port };
    }
    throw new Error(
      `Port ${port} is already in use by another process (no managed dev server pid is alive). ` +
        `Stop that process or choose a different port; refusing to take over a foreign listener.`,
    );
  }
  // Stale pid file pointing at a dead process: safe to replace.
  const fd = openSync(LOG_FILE, "a");
  let child;
  try {
    child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
      cwd: APP_DIR,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
  }
  if (!child.pid) throw new Error("Failed to spawn dev server: no child pid.");
  child.unref();
  await fsp.writeFile(PID_FILE, String(child.pid), "utf8");
  return { started: true, pid: child.pid, port, logFile: LOG_FILE, pidFile: PID_FILE };
}

async function handleStop() {
  const pid = await readManagedPid();
  if (pid === null) {
    return { stopped: false, reason: "No managed dev server pid recorded." };
  }
  if (!pidAlive(pid)) {
    await fsp.unlink(PID_FILE).catch(() => {});
    return { stopped: false, pid, reason: "Recorded pid is not running; pid file cleared." };
  }
  let signalUsed = "SIGTERM";
  try {
    // Negative pid targets the whole process group (npm + next child).
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (pidAlive(pid)) {
    signalUsed = "SIGKILL";
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
    const deadline2 = Date.now() + 3000;
    while (Date.now() < deadline2) {
      if (!pidAlive(pid)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const stillAlive = pidAlive(pid);
  if (!stillAlive) await fsp.unlink(PID_FILE).catch(() => {});
  return { stopped: !stillAlive, pid, signalUsed };
}

async function handleHealth({ port = 3000, baseUrl } = {}) {
  const base = normalizeBaseUrl(baseUrl, port);
  const r = await timedGet(`${base}/api/health`);
  if (!r.ok) {
    return { base, httpStatus: null, latencyMs: r.ms, reachable: false, error: r.error ?? "request failed" };
  }
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(r.body);
  } catch (e) {
    parseError = String(e?.message ?? e);
  }
  return {
    base,
    reachable: true,
    httpStatus: r.status,
    latencyMs: r.ms,
    status: parsed?.status ?? null,
    checks: parsed?.checks ?? null,
    durationMs: parsed?.durationMs ?? null,
    ...(parseError ? { parseError, rawHead: r.body.slice(0, 2000) } : {}),
  };
}

async function handlePerf({ port = 3000, baseUrl, rounds = 5 } = {}) {
  const n = Math.max(1, Math.min(20, Number.isInteger(rounds) ? rounds : 5));
  const base = normalizeBaseUrl(baseUrl, port);
  const targets = [];
  for (const t of PERF_TARGETS) {
    const samples = [];
    for (let i = 0; i < n; i += 1) {
      // Sequential timed GETs per spec.
      // eslint-disable-next-line no-await-in-loop
      samples.push(await timedGet(`${base}${t}`));
    }
    targets.push({ target: t, attempts: n, ...summarizeLatencies(samples) });
  }
  const nextBuildDir = await dirSizeSummary(path.join(APP_DIR, ".next"));
  return { base, rounds: n, targets, nextBuildDir };
}

function handleBuild() {
  const wallStart = Date.now();
  return new Promise((resolve) => {
    execFile(
      "npm",
      ["run", "build"],
      { cwd: APP_DIR, timeout: BUILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const wallSeconds = Math.round(((Date.now() - wallStart) / 1000) * 100) / 100;
        const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
        const timedOut = Boolean(err && err.killed);
        resolve({
          pass: !err,
          timedOut,
          wallSeconds,
          ...(err && !timedOut ? { exitCode: err.code ?? null } : {}),
          tail: tailLines(combined.trim() === "" ? "(no output)" : combined, 60),
        });
      },
    );
  });
}

async function handleLogs({ lines = 100 } = {}) {
  const n = Math.max(1, Math.min(1000, Number.isInteger(lines) ? lines : 100));
  if (!existsSync(LOG_FILE)) {
    return { present: false, logFile: LOG_FILE, text: "" };
  }
  const content = await fsp.readFile(LOG_FILE, "utf8").catch(() => "");
  const all = content === "" ? [] : content.split("\n");
  const totalLines = all.length;
  const last = all.slice(-n);
  return {
    present: true,
    logFile: LOG_FILE,
    requested: n,
    returned: last.length,
    totalLines,
    text: last.join("\n"),
  };
}

// ---------- tool registry ----------

const TOOLS = [
  {
    name: "dcph_status",
    description: "Probe whether the dev server port is serving, check the managed dev server pid, node version, and .env.local presence (name only, values never read).",
    inputSchema: {
      type: "object",
      properties: { port: { type: "integer", description: "Dev server port to probe.", default: 3000 } },
    },
  },
  {
    name: "dcph_start",
    description: "Start `npm run dev` detached in the app dir on the given port. No-op with pid if the managed server already serves the port; errors if the port is held by another process.",
    inputSchema: {
      type: "object",
      properties: { port: { type: "integer", description: "Port for the dev server.", default: 3000 } },
    },
  },
  {
    name: "dcph_stop",
    description: "Gracefully stop the managed dev server (SIGTERM, then SIGKILL fallback) and clear its pid file.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dcph_health",
    description: "GET /api/health and return its parsed status/checks/durationMs plus client-measured latencyMs.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "integer", description: "Dev server port.", default: 3000 },
        baseUrl: { type: "string", description: "Optional base URL override (e.g. http://127.0.0.1:3000)." },
      },
    },
  },
  {
    name: "dcph_perf",
    description: "Sequential timed GETs (rounds, default 5) against /, /tracker, /api/health, /api/tracker; per-target count/p50Ms/p95Ms/avgMs/bytes plus .next build dir size summary.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "integer", description: "Dev server port.", default: 3000 },
        baseUrl: { type: "string", description: "Optional base URL override." },
        rounds: { type: "integer", description: "Timed GET rounds per target (1-20).", default: 5 },
      },
    },
  },
  {
    name: "dcph_build",
    description: "Run `npm run build` in the app dir with a 10-minute timeout; returns pass/fail, wall seconds, and tail of output.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dcph_logs",
    description: "Return the last K lines (default 100) of the managed dev server log.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "integer", description: "Number of trailing log lines (1-1000).", default: 100 },
      },
    },
  },
];

const HANDLERS = {
  dcph_status: handleStatus,
  dcph_start: handleStart,
  dcph_stop: handleStop,
  dcph_health: handleHealth,
  dcph_perf: handlePerf,
  dcph_build: handleBuild,
  dcph_logs: handleLogs,
};

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

const server = new Server({ name: "dcph-mcp-server", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params ?? {};
  const handler = HANDLERS[name];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return textResult(await handler(args));
  } catch (err) {
    return { content: [{ type: "text", text: err?.message ?? String(err) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
