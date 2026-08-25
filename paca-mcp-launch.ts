#!/usr/bin/env bun
// paca-mcp-launch — launches the Paca MCP server (@paca-ai/paca-mcp), the agent's
// "hands" for acting on Paca (tasks/comments/status/git). Reads the SAME
// credentials.json as the channel and sets the env @paca-ai/paca-mcp expects,
// then runs it transparently over this process's stdio (the MCP transport).
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

const CRED_PATH = join(homedir(), ".claude", "channels", "paca", "credentials.json");
function loadCreds(): Record<string, string> {
  try { if (existsSync(CRED_PATH)) return JSON.parse(readFileSync(CRED_PATH, "utf8")); } catch {}
  return {};
}
const c = loadCreds();
const server = process.env.PACA_API_URL || process.env.PACA_SERVER || c.server || "https://paca.xswl.top:1314";
const agentId = process.env.PACA_AGENT_ID || c.agentId || "";
const apiKey = process.env.PACA_API_KEY || c.mcpKey || "";
const projectId = process.env.PACA_PROJECT_ID || c.projectId || "";

if (!apiKey || !agentId) {
  process.stderr.write("[paca-mcp-launch] FATAL: need agentId + mcpKey (run /paca:configure, or set PACA_API_KEY + PACA_AGENT_ID)\n");
  process.exit(1);
}

const env: Record<string, string> = { ...process.env as Record<string, string>, PACA_API_URL: server, PACA_AGENT_ID: agentId, PACA_API_KEY: apiKey };
if (projectId) env.PACA_PROJECT_ID = projectId;

// stdio inherited → @paca-ai/paca-mcp speaks MCP to Claude Code directly through us.
const child = spawn("npx", ["-y", "@paca-ai/paca-mcp"], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) => { process.stderr.write(`[paca-mcp-launch] failed to start: ${e}\n`); process.exit(1); });
