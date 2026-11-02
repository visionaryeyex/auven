# Connect Codex or Claude Code to AUVEN

AUVEN exposes a remote MCP server at `https://auven.xyz/mcp`. Its `auven_chat` tool sends a chat request through your registered agent's gateway credential. AUVEN checks the agent's status and policy, records the decision in **Activity**, and returns the model response or a pending approval ID. The currently supported provider route is OpenAI chat.

MCP does **not** put every Codex or Claude Code action under AUVEN. Their own model calls and other tools stay outside this gateway. Use `auven_chat` when you want a particular request checked and recorded by AUVEN.

## 1. Get an agent credential

1. Sign in to [AUVEN](https://auven.xyz) and open your workspace. Use **Create agent** to define a text agent with saved instructions, or **Agents → Register agent** to connect an agent you already run.
2. Set its initial daily limit and save it. Creating an identity does not connect your MCP client by itself.
3. Copy the credential from the one-time setup window. It belongs to that agent, not to your whole workspace. Keep it private. The same window has copyable MCP setup commands. If you lose the credential, choose **Connect / test → Replace credential** in the agent row; the previous credential stops working.

For each agent, **Connect / test** shows commands with its own MCP server name and environment variable. Copy those commands into PowerShell. They prompt you for the credential instead of saving it in the command or Git. The examples below use a generic name for one agent:

```powershell
$env:AUVEN_AGENT_CREDENTIAL = Read-Host 'Paste your AUVEN agent credential'
```

Run the client from that same PowerShell session so it inherits the variable. Set it again in a new terminal. Restart an already-open client after adding the server. Do not paste the credential into a Git-tracked file or a public issue.

## 2. Add the MCP server

### Codex CLI

```powershell
codex mcp add auven --url https://auven.xyz/mcp --bearer-token-env-var AUVEN_AGENT_CREDENTIAL
codex mcp get auven
codex
```

### Claude Code

```powershell
claude mcp add-json auven '{"type":"http","url":"https://auven.xyz/mcp","headers":{"Authorization":"Bearer ${AUVEN_AGENT_CREDENTIAL}"}}'
claude mcp get auven
claude
```

Claude Code expands the credential from the environment when it connects. This command stores the variable reference in its local MCP configuration, not the credential value. These commands configure the **CLI** clients. If you launch a desktop client separately, make sure its process receives the same environment variable.

## 3. Try it

First ask Codex or Claude Code: “Call the `auven_connection_test` tool.” It confirms the agent credential without calling OpenAI or using the agent budget. In AUVEN, choose **Agents → Connect / test → Refresh status** to see the recorded test time. This proves the MCP client reached AUVEN; registering the agent alone does not.

Then ask your coding agent: “Use AUVEN's `auven_chat` tool to summarize the purpose of our project in two sentences.” Open **Activity** in AUVEN. The call should appear under the registered agent. Stop the agent in **Agents** and try again to confirm the policy blocks another call. Calls made directly by Codex or Claude Code outside `auven_chat` are not controlled by AUVEN.

For an agent created in AUVEN, `auven_chat` also applies the instructions saved in its workspace. MCP callers cannot replace those instructions with their own system or developer message. External registered agents keep their instructions in their own application.

In **Policies**, set each agent's daily request cap, maximum response tokens per call, estimated USD budget, and optional owner approval. When approval is on, `auven_chat` returns an action ID without calling OpenAI. Open **Approvals** in your workspace to approve or deny the request. Then ask your coding agent to use `auven_action_status` with that action ID. An approved request returns the provider result; a denied one reports the denial. Keep the same action ID when checking again; repeating `auven_chat` creates a new request.

Each tool call gets a unique request ID. The server does not expose workspace administration, proofs, or other agents through this credential. AUVEN generates a separate gateway call for every `auven_chat` invocation, so asking the client to retry the tool starts a new request and may use more budget.

If you need to route calls from your own application rather than a coding agent, use the [direct gateway API](AGENT_INTEGRATION.md).

## Troubleshooting

| Message | Action |
| --- | --- |
| `invalid_agent_credential` | Set the environment variable in the terminal that runs the client. Check that you used the agent credential, not a workspace token. |
| `agent_stopped` | Resume the agent in **Agents**. |
| `budget_exceeded` | Review its estimated daily budget and Activity in AUVEN. |
| `request_limit_exceeded` | Increase the agent's daily request cap in **Policies**, or wait until the next UTC day. |
| `token_limit_exceeded` | Lower `max_tokens` for the call or raise the per-call cap in **Policies**. |
| `provider_not_configured` | The AUVEN operator must configure its OpenAI API key. |
| MCP server unavailable | Check `https://auven.xyz/mcp` connectivity and your client's MCP server status. |
