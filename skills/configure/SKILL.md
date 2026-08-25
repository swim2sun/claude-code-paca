---
name: configure
description: Set up the Paca channel — save the agent's connection credentials or check status. Use when the user wants to configure Paca, connect an agent, asks "how do I set this up," or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(chmod *)
  - Bash(curl *)
---

# /paca:configure — Paca Channel Setup

Manages credentials in `~/.claude/channels/paca/credentials.json`. Both the
`paca` channel server and the `paca-mcp` server read this file at boot.

Arguments passed: `$ARGUMENTS`

## Credentials file shape

```json
{
  "server": "https://paca.example.com",
  "agentId": "<agent uuid>",
  "bridgeToken": "<ACP bridge token — used by the channel>",
  "mcpKey": "<agent MCP key — used by paca-mcp, the agent's hands>",
  "projectId": "<optional: pin the agent to one project>"
}
```

Get these from Paca: **Project → Agents → your acp-type agent**. Generate the
**ACP bridge token** (channel auth) and the **MCP key** (`mcp-agent-key`) there;
each is shown once. `agentId` is the agent's UUID; `server` is your Paca base URL.

## Dispatch on arguments

### No args — status and guidance
1. Read `~/.claude/channels/paca/credentials.json`. Report which fields are set;
   mask `bridgeToken`/`mcpKey` (first 8 chars + `…`).
2. Give the next step:
   - Not set → "Run `/paca:configure set` and provide server, agentId, bridgeToken, mcpKey."
   - Set → "Ready. Start Claude Code with `--dangerously-load-development-channels plugin:paca@swim2sun-plugins --dangerously-skip-permissions` to enable the channel."
3. Optionally verify connectivity: `curl -s <server>/` should answer.

### `set` (interactive) — collect and write credentials
1. Ask the user for `server`, `agentId`, `bridgeToken`, `mcpKey`, and optional `projectId`
   (accept them from `$ARGUMENTS` as `key=value` pairs too).
2. `mkdir -p ~/.claude/channels/paca`
3. Write `credentials.json` (2-space JSON), then `chmod 600` it.
4. Confirm what was saved (mask the secrets) and print the launch command.

### `status`
Same as no-args status.

## Notes
- Env vars (`PACA_AGENT_ID`, `PACA_BRIDGE_TOKEN`, `PACA_SERVER`, `PACA_API_KEY`,
  `PACA_API_URL`, `PACA_PROJECT_ID`) override the file — handy for bots that set
  credentials inline in their own `.mcp.json`.
- After finishing a Paca work item, the agent must call the `paca_complete` tool
  (conversation_id + summary + status) so Paca marks the turn done; otherwise the
  conversation stays open and is eventually failed by the watchdog.
