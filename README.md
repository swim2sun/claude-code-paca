# claude-code-paca

A Claude Code **channel** that connects a persistent Claude Code session to a
[Paca](https://github.com/Paca-AI/paca) `acp`-type agent. Tasks, @mentions, chat,
and automation messages from Paca arrive in your session; the agent acts back
through the Paca MCP tools and reports each turn done. One session can run this
alongside other channels (e.g. Discord), so a single Claude Code is reachable
from Paca *and* your chat app.

```
Paca agent-runner  <==WS==>  paca (channel)  <==stdio/MCP==>  Claude Code
                             paca-mcp (hands, @paca-ai/paca-mcp)
```

## Install (as a plugin)

```
/plugin marketplace add swim2sun/swim2sun-plugins
/plugin install paca@swim2sun-plugins
```

Then set your agent's credentials and start Claude Code with the channel:

```
/paca:configure set          # server, agentId, bridgeToken, mcpKey (from Paca → Agents)
claude --dangerously-load-development-channels plugin:paca@swim2sun-plugins --dangerously-skip-permissions
```

- Custom channels aren't on the approved allowlist yet, so the
  `--dangerously-load-development-channels` flag is required (research preview).
- `--dangerously-skip-permissions` is recommended so the agent doesn't prompt for
  every edit/command — those prompts only appear in the terminal, not in Paca.
- Stack with other channels: add `--channels plugin:discord@claude-plugins-official`.

### Credentials
`/paca:configure` writes `~/.claude/channels/paca/credentials.json`:
```json
{ "server": "https://paca.example.com", "agentId": "…", "bridgeToken": "…", "mcpKey": "…", "projectId": "…(optional)" }
```
Get the **ACP bridge token** and **MCP key** from Paca → Project → Agents → your
acp agent. Env vars (`PACA_AGENT_ID`, `PACA_BRIDGE_TOKEN`, `PACA_SERVER`,
`PACA_API_KEY`, `PACA_API_URL`, `PACA_PROJECT_ID`) override the file.

## What's inside
- `paca-channel.ts` — the channel: a WS client to Paca's `/agent-bridge/ws` **and** a
  `claude/channel` MCP server. Injects Paca triggers as `<channel source="paca" …>`
  messages; exposes `paca_complete` / `paca_progress` tools for reporting results.
- `paca-mcp-launch.ts` — runs `@paca-ai/paca-mcp` (the agent's "hands") with the same
  credentials, so the agent can create/update tasks, comment, change status, push branches, etc.
- `skills/configure` — the `/paca:configure` setup skill.
- `mock-cc.ts` — a test harness standing in for Claude Code (validates the whole loop with no real CC).

## How a turn works
1. Paca dispatches a trigger → the channel injects `<channel source="paca" conversation_id="…" trigger_type="…">`.
2. Claude does the work (via the Paca MCP tools).
3. Claude calls **`paca_complete(conversation_id, summary, status)`** → the channel sends the
   result + turn status back to Paca, which marks the conversation finished.
   (If it isn't called, Paca leaves the conversation open and eventually marks it failed —
   so keep a habit/skill that always finishes with `paca_complete`.)

## Manual / bot setup (without the plugin)
Register the servers yourself in a project `.mcp.json` with inline env — see the
`env` keys above. This is how a headless bot (its own launcher) wires it in.

## Run the test harness (no real Claude Code)
```
bun install
PACA_SERVER=… PACA_AGENT_ID=… PACA_BRIDGE_TOKEN=… bun mock-cc.ts
# then assign a task / chat the agent in Paca and watch the round-trip
```

## License
MIT
