#!/usr/bin/env bun
// mock-cc — stands in for a real Claude Code session to validate the paca-channel
// server end-to-end WITHOUT needing a live CC. It:
//   1. spawns paca-channel.ts as an MCP stdio server (exactly as CC would)
//   2. verifies it advertises the claude/channel capability + tools
//   3. listens for notifications/claude/channel (the injected Paca triggers)
//   4. on each, simulates "handling" then calls the paca_complete tool
//
// Env passed through to the server: PACA_SERVER, PACA_AGENT_ID, PACA_BRIDGE_TOKEN

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const log = (s: string) => process.stderr.write(`[mock-cc] ${s}\n`);

const transport = new StdioClientTransport({
  command: "bun",
  args: ["paca-channel.ts"],
  env: process.env as Record<string, string>,
  stderr: "inherit", // surface the server's stderr logs
});

const client = new Client({ name: "mock-cc", version: "0.0.1" }, { capabilities: {} });

const ChannelNote = z.object({
  method: z.literal("notifications/claude/channel"),
  params: z.object({
    content: z.string(),
    meta: z.record(z.string(), z.string()).optional(),
  }),
});

client.setNotificationHandler(ChannelNote, async ({ params }) => {
  const cid = params.meta?.conversation_id;
  log(`⭑ channel note conv=${cid} trigger=${params.meta?.trigger_type}`);
  log(`   content(head): ${params.content.slice(0, 140).replace(/\n/g, " ")}`);
  if (!cid) return;
  // simulate doing the work, then report completion via the tool
  setTimeout(async () => {
    try {
      const r = await client.callTool({
        name: "paca_complete",
        arguments: {
          conversation_id: cid,
          summary: "✅ [mock CC] Received the Paca trigger via claude/channel, 'handled' it, and reported completion through the paca_complete tool.",
          status: "finished",
        },
      });
      log(`-> paca_complete(${cid}) returned: ${JSON.stringify(r.content)}`);
    } catch (e) {
      log("paca_complete call failed: " + (e as Error).message);
    }
  }, 500);
});

await client.connect(transport);
const caps = client.getServerCapabilities();
log("connected. server capabilities: " + JSON.stringify(caps));
const tools = await client.listTools();
log("server tools: " + tools.tools.map((t) => t.name).join(", "));
log("waiting for Paca triggers — now assign a task / send chat to the agent...");
await new Promise(() => {}); // keep alive
