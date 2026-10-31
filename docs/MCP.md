# Connect Codex or Claude Code to AUVEN

AUVEN exposes a remote MCP server at `https://auven.xyz/mcp`. Its `auven_chat` tool sends a chat request through your registered agent's gateway credential. AUVEN checks the agent's status and daily limit, records the decision in **Activity**, and returns the model response. The currently supported provider route is OpenAI chat.

MCP does **not** put every Codex or Claude Code action under AUVEN. Their own model calls and other tools stay outside this gateway. Use `auven_chat` when you want a particular request checked and recorded by AUVEN.

## 1. Get an agent credential

1. Sign in to [AUVEN](https://auven.xyz), open your workspace, and go to **Agents**.
2. Select **Connect agent**, enter a name, purpose, and daily limit, then submit.
3. Copy the credential shown once. It belongs to that agent, not to your whole workspace. Keep it private. If you lose it, connect a new agent.

In PowerShell, put the credential in an environment variable for the current terminal session:

```powershell
$env:AUVEN_AGENT_CREDENTIAL = Read-Host 'Paste your AUVEN agent credential'
```

Run the client from that same PowerShell session. Set the variable again in a new terminal. Do not paste the credential into a Git-tracked file or a public issue.

## 2. Add the MCP server

### Codex CLI

```powershell
codex mcp add auven --url https://auven.xyz/mcp --bearer-token-env-var AUVEN_AGENT_CREDENTIAL
codex mcp list
```

### Claude Code

```powershell
claude mcp add-json auven '{"type":"http","url":"https://auven.xyz/mcp","headers":{"Authorization":"Bearer ${AUVEN_AGENT_CREDENTIAL}"}}'
claude mcp list
```

Claude Code expands the credential from the environment when it connects. This command stores the variable reference in its local MCP configuration, not the credential value.

## 3. Try it

Ask your coding agent: “Use AUVEN's `auven_chat` tool to summarize the purpose of our project in two sentences.” Then open **Activity** in AUVEN. The call should appear under the agent you registered. Stop the agent in **Agents** and try again to confirm the policy blocks another call.

Each tool call gets a unique request ID. The server does not expose workspace administration, proofs, or other agents through this credential. AUVEN generates a separate gateway call for every `auven_chat` invocation, so asking the client to retry the tool starts a new request and may use more budget.

If you need to route calls from your own application rather than a coding agent, use the [direct gateway API](AGENT_INTEGRATION.md).

## Troubleshooting

| Message | Action |
| --- | --- |
| `invalid_agent_credential` | Set the environment variable in the terminal that runs the client. Check that you used the agent credential, not a workspace token. |
| `agent_stopped` | Resume the agent in **Agents**. |
| `budget_exceeded` | Review its daily limit and Activity in AUVEN. |
| `provider_not_configured` | The AUVEN operator must configure its OpenAI API key. |
| MCP server unavailable | Check `https://auven.xyz/mcp` connectivity and your client's MCP server status. |
