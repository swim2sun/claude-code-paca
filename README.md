# paca-channel (B2 PoC)

A Claude Code **channel** that connects a persistent CC session to a Paca `acp`-type agent.
One process is both a WS client to Paca's `/agent-bridge/ws` and an MCP `claude/channel`
server that Claude Code spawns over stdio.

```
Paca agent-runner  <==WS==>  paca-channel.ts  <==stdio/MCP==>  Claude Code (your session)
   start_turn  ───────────────►  notifications/claude/channel  ──►  <channel source="paca" ...>
   event + turn_status  ◄──────  paca_complete / paca_progress tool  ◄──  Claude
```

## Why a channel (B2)
- Channels **stack**: run `--channels plugin:discord plugin:paca` so ONE session serves Paca
  *and* is remote-commandable from Discord.
- Trade-offs (inherent to `claude/channel`): the channel only sees what Claude sends via a
  tool (no auto streaming of tool-calls/thinking to Paca), there's no native turn-end signal,
  and events serialize. We work around the turn-end gap with the **`paca_complete` tool**
  (enforced by instructions/skill). Live tool-call visibility would need a PostToolUse hook (TODO).

## Status: validated
Against the real Paca instance with a **mock CC** (`mock-cc.ts`, plays Claude's role):
online ✓ · Paca chat → injected as `<channel>` ✓ · `paca_complete` → conversation `finished`
+ reply event stored ✓. The real-CC run below is the remaining manual step.

## Run with real Claude Code
1. Generate the agent's bridge token in Paca (Agents UI → ACP bridge), and its MCP key.
2. `.mcp.json` in your project (so CC spawns the channel + can act on Paca):
   ```json
   {
     "mcpServers": {
       "paca": {
         "command": "bun",
         "args": ["/abs/path/paca-channel.ts"],
         "env": {
           "PACA_SERVER": "https://paca.xswl.top:1314",
           "PACA_AGENT_ID": "<agent-uuid>",
           "PACA_BRIDGE_TOKEN": "<bridge-token>"
         }
       },
       "paca-mcp": { "...": "the Paca MCP server, authed with the agent's MCP key — this is the agent's HANDS" }
     }
   }
   ```
3. Start CC with the channel (research preview needs the dev flag):
   ```sh
   claude --dangerously-load-development-channels server:paca
   ```
   Add `plugin:discord@...` etc. to also take Discord in the same session.
4. Assign a task / @mention / chat the agent in Paca → it appears as `<channel source="paca" …>`
   in your session; Claude works via the Paca MCP tools and calls `paca_complete` when done.

## Recommended: a tiny skill to enforce completion
Add a project skill instructing: "For every `<channel source=\"paca\">` message, after finishing,
call `paca_complete` with that conversation_id + a summary (status finished/failed)." Without it,
a turn that ends in plain text leaves Paca's conversation open (watchdog later marks it failed).

## Env
- `PACA_SERVER` (default `http://192.168.15.161:8099`) — Paca base URL; `/agent-bridge/ws` is derived.
- `PACA_AGENT_ID`, `PACA_BRIDGE_TOKEN` — from the agent's ACP bridge token (shown once).

## Files
- `paca-channel.ts` — the channel server (WS↔Paca + MCP claude/channel + paca_complete/paca_progress).
- `mock-cc.ts` — test harness standing in for Claude Code (validates the whole loop, no real CC needed).

## TODO (next)
- PostToolUse hook → forward tool-calls as Paca `event`s (process visibility in Paca UI).
- Skill packaging + plugin wrapper (`/plugin install`, `--channels plugin:paca@...`).
- Map Paca `stop_turn`/`pause_turn` to a real interrupt (channel can only inject a note today).
- Optional: `claude/channel/permission` relay to approve tool use from Discord.
