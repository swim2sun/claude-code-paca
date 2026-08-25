#!/usr/bin/env bun
// paca-channel — a Claude Code CHANNEL (B2) that bridges a persistent CC session
// to a Paca `acp`-type agent.
//
//   Paca agent-runner  <--WS-->  [this process]  <--stdio/MCP-->  Claude Code
//
// It is one process that is BOTH:
//   • a WS client to Paca's /agent-bridge/ws (receive start_turn, send event/turn_status)
//   • an MCP `claude/channel` server (inject triggers into the CC session, expose
//     paca_complete/paca_progress tools so CC reports results back)
//
// Run (research preview): register in .mcp.json then
//   claude --dangerously-load-development-channels server:paca
//
// Env: PACA_SERVER (default http://192.168.15.161:8099), PACA_AGENT_ID, PACA_BRIDGE_TOKEN
//
// IMPORTANT: stdout is the MCP JSON-RPC transport — never write logs there. Use stderr.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Credentials: env wins (used by manual/env-based setups like a bot's own
// .mcp.json); otherwise fall back to the file written by /paca:configure.
export const CRED_PATH = join(homedir(), ".claude", "channels", "paca", "credentials.json");
function loadCreds(): { server?: string; agentId?: string; bridgeToken?: string } {
  try { if (existsSync(CRED_PATH)) return JSON.parse(readFileSync(CRED_PATH, "utf8")); } catch {}
  return {};
}
const cred = loadCreds();
const SERVER = process.env.PACA_SERVER || cred.server || "https://paca.xswl.top:1314";
const AGENT_ID = process.env.PACA_AGENT_ID || cred.agentId || "";
const TOKEN = process.env.PACA_BRIDGE_TOKEN || cred.bridgeToken || "";
const log = (s: string) => process.stderr.write(`[paca-channel] ${s}\n`);
if (!AGENT_ID || !TOKEN) {
  log(`FATAL: no agent credentials. Set PACA_AGENT_ID + PACA_BRIDGE_TOKEN in env, or run /paca:configure to write ${CRED_PATH}`);
  process.exit(1);
}

// ── MCP channel server ────────────────────────────────────────────────────────
const mcp = new Server(
  { name: "paca", version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions:
      'Work items from your Paca project manager arrive as <channel source="paca" conversation_id="..." trigger_type="..."> tags. ' +
      "Do the work using the Paca MCP tools (create/update tasks, comment, change status, push branches, etc.). " +
      "When you finish handling ONE such message you MUST call the `paca_complete` tool with that exact conversation_id, a short summary of what you did, and status \"finished\" (or \"failed\" plus an error). " +
      "This is the ONLY way Paca learns the turn is done — if you skip it, Paca shows the task stuck and eventually marks it failed. " +
      "Use `paca_progress` for optional interim updates on a long task.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "paca_complete",
      description:
        "Report that you finished handling a Paca <channel> message. Call exactly once per conversation_id when done.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "the conversation_id from the <channel> tag" },
          summary: { type: "string", description: "short summary of what you did (shown in Paca)" },
          status: { type: "string", enum: ["finished", "failed"], description: "turn outcome (default finished)" },
          error: { type: "string", description: "error message when status is failed" },
        },
        required: ["conversation_id"],
      },
    },
    {
      name: "paca_progress",
      description: "Optional: post an interim progress note for a Paca conversation while still working.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          text: { type: "string" },
        },
        required: ["conversation_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments || {}) as Record<string, string>;
  if (req.params.name === "paca_complete") {
    const cid = a.conversation_id;
    const pid = inflight.get(cid)?.projectId || "";
    const status = a.status === "failed" ? "failed" : "finished";
    if (a.summary) emitEvent(cid, pid, "agent_message_chunk", "agent", { content: { type: "text", text: a.summary } });
    const st: Record<string, unknown> = { type: "turn_status", conversation_id: cid, project_id: pid, status };
    if (status === "failed" && a.error) st.error_message = a.error;
    sendPaca(st);
    inflight.delete(cid);
    log(`paca_complete ${status} conv=${cid}`);
    return { content: [{ type: "text", text: `reported ${status} for ${cid}` }] };
  }
  if (req.params.name === "paca_progress") {
    const cid = a.conversation_id;
    const pid = inflight.get(cid)?.projectId || "";
    emitEvent(cid, pid, "agent_message_chunk", "agent", { content: { type: "text", text: a.text } });
    return { content: [{ type: "text", text: "progress posted" }] };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

// ── WS client to Paca agent-runner ────────────────────────────────────────────
type Inflight = { projectId: string };
const inflight = new Map<string, Inflight>();
let ws: WebSocket | null = null;
let keepalive: ReturnType<typeof setInterval> | null = null;

function wsURL(server: string): string {
  const u = new URL(server);
  const scheme = u.protocol === "https:" || u.protocol === "wss:" ? "wss" : "ws";
  return `${scheme}://${u.host}/agent-bridge/ws`;
}
function sendPaca(obj: unknown) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    else log("drop (ws not open): " + JSON.stringify(obj).slice(0, 80));
  } catch (e) {
    log("send error: " + (e as Error).message);
  }
}
function emitEvent(cid: string, pid: string, eventType: string, source: string, payload: unknown) {
  sendPaca({ type: "event", conversation_id: cid, project_id: pid, event_type: eventType, event_source: source, payload });
}

function connectPaca() {
  const url = wsURL(SERVER);
  log(`connecting ${url} as agent ${AGENT_ID}`);
  ws = new WebSocket(url);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: "hello", agent_id: AGENT_ID, token: TOKEN }));
    keepalive = setInterval(() => { try { ws?.send(JSON.stringify({ type: "ping" })); } catch {} }, 15000);
  };
  ws.onmessage = async (ev) => {
    let m: any;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    switch (m.type) {
      case "hello_ack": log("ONLINE (authenticated to Paca)"); break;
      case "pong": break;
      case "start_turn": {
        const { conversation_id, project_id, message, trigger_type } = m;
        inflight.set(conversation_id, { projectId: project_id });
        log(`start_turn conv=${conversation_id} trigger=${trigger_type} -> injecting into CC session`);
        await mcp
          .notification({
            method: "notifications/claude/channel",
            params: { content: String(message ?? ""), meta: { conversation_id, project_id, trigger_type } },
          })
          .catch((e) => log("notify error: " + (e as Error).message));
        break;
      }
      case "stop_turn":
      case "pause_turn":
        log(`${m.type} conv=${m.conversation_id}`);
        await mcp
          .notification({
            method: "notifications/claude/channel",
            params: {
              content: `[control] Paca requested ${m.type} for conversation ${m.conversation_id}. Wrap up and call paca_complete.`,
              meta: { conversation_id: m.conversation_id, control: "1" },
            },
          })
          .catch(() => {});
        break;
      default: log("unknown from paca: " + m.type);
    }
  };
  ws.onclose = (e) => {
    if (keepalive) clearInterval(keepalive);
    log(`ws closed code=${(e as CloseEvent).code}; reconnecting in 3s`);
    setTimeout(connectPaca, 3000);
  };
  ws.onerror = (e: any) => log("ws error: " + (e?.message || e));
}

// ── boot ──────────────────────────────────────────────────────────────────────
await mcp.connect(new StdioServerTransport());
log("MCP channel connected over stdio");
connectPaca();
