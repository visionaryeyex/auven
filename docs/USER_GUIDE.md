# Use AUVEN

AUVEN lets you create a text agent in your workspace or connect an agent running in your own application. It currently supports OpenAI chat requests routed through the gateway or `auven_chat` MCP tool. Calls sent directly to a provider are outside AUVEN's control.

## Sign in and create a workspace

Open [AUVEN](https://auven.xyz) and choose **Open workspace**. Sign in with an email code or a Solana wallet through Privy. Create a workspace when prompted. Save the admin token shown once; it is a recovery and API credential.
The setup window has a **Copy** button and masks the token until you choose **Show**. If you later need to replace it, use **Profile → Replace admin token**. The previous token stops working immediately.

In **Profile**, you can link a Solana wallet to an email account or link an email to a wallet account. Do this while signed in so both methods stay on the same Privy profile and workspace. Existing signed proofs are not changed by wallet linking.

If **Profile** instead says **Workspace access**, the browser is using an admin token without a personal sign-in. Sign in with email or a Solana wallet and choose **Link the workspace open in this browser** if prompted. The account can claim an existing workspace only when it does not already own one.

## Create an agent in AUVEN

1. Open **Create agent** in your workspace. Pick a starting template or enter a name, purpose, and instructions for a text agent.
2. Set its initial estimated daily limit and choose **Create agent**. AUVEN stores the instructions in the workspace, issues a one-time credential, and creates an ML-DSA-65 signed passport that includes a digest of those instructions.
3. Copy the credential from the setup window. Open **Run agent** on the same page to try a request. The response uses the agent's saved instructions and passes through its policy. It appears in **Activity**.
4. Use **Policies** to change request limits, response size, and owner approval. Use **Agents** to stop or resume the agent. When approval is enabled, a request waits in **Approvals** before reaching OpenAI.
5. To use the agent from Codex or Claude Code, follow the [MCP guide](MCP.md) with its credential. From your own application, call the [gateway API](AGENT_INTEGRATION.md). Only calls routed through AUVEN use its instructions and limits.

The builder currently creates text agents for the supported OpenAI chat route. It does not run arbitrary code, browse the web, or connect to third-party tools on its own. Other agent types and paid agent rentals appear on the [roadmap](https://auven.xyz/roadmap); they are not available in the dashboard.

## Connect an agent

1. Open **Agents** and choose **Register agent**. This creates an identity; it does not connect an external client yet.
2. Enter a name, purpose, and estimated daily spending limit in USD.
3. Copy the agent credential from the setup window. Store it on your agent application's server, never in frontend code or a public repository.
4. Use **Connect / test** in the agent row to copy PowerShell setup commands for Codex CLI or Claude Code. Run them on the computer where that client is installed, and paste the credential when prompted. A web page cannot install an MCP server into your local client by itself. The provider API key stays on the AUVEN server.
5. In Codex or Claude Code, ask it to call `auven_connection_test`. Choose **Refresh status** in AUVEN. The recorded test time confirms the client authenticated through MCP; no OpenAI call or budget is used.
6. Ask the client to call `auven_chat` for a real gateway request. **Agents** then shows “Gateway request seen”; the result appears in **Activity**. If the credential is lost or exposed, open **Connect / test → Replace credential**. The old credential stops working immediately.

For Codex or Claude Code, follow the [MCP setup guide](MCP.md). The tool `auven_chat` uses the connected agent's credential. The coding assistant's other model calls remain outside AUVEN.

For a direct request:

```bash
curl -X POST https://YOUR_AUVEN_DOMAIN/api/gateway/chat \
  -H 'Authorization: Bearer YOUR_AGENT_CREDENTIAL' \
  -H 'Idempotency-Key: request-unique-to-this-call' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

Use a new idempotency key of 8–128 characters for each logical request. A repeated key returns a conflict.

## Set controls and review activity

- **Agents:** stop or resume a registered agent.
- **Policies:** set its daily request count, maximum response tokens per call, estimated daily spending limit, and optional owner approval.
- **Approvals:** review requests held by policy. Approve to send the saved request to OpenAI or deny before the provider call. The agent can check its result with `GET /api/actions/ACTION_ID` or `auven_action_status`.
- **Activity:** inspect allowed, pending, denied, and failed requests with reasons.

The [interactive demo](https://auven.xyz/demo) shows an allowed request, a reached limit, and owner approval using sample data. It makes no provider calls.

## Proofs

Agent registration creates an ML-DSA-65 signed passport. Create an activity checkpoint with `POST /api/checkpoints` and `{"agent_id":"AGENT_ID"}` using a workspace session or admin token. Export either proof from **Proofs**.

Verify its signature and digest locally:

```bash
node verify.cjs auven-proof.json
```

If a Solana publisher has been configured and funded, **Publish** records the proof commitment in a Solana Memo transaction. Then **Verify** checks its inclusion. The full proof and private activity details stay offchain. You can also use:

```bash
node verify.cjs auven-proof.json SOLANA_TRANSACTION_SIGNATURE TRUSTED_SOLANA_PUBLISHER
```

Older published records remain verifiable through their original transaction. The verifier selects that path for a legacy `0x` transaction hash.

## $AUVEN

The $AUVEN mint is `DXf5UDjzYFEizcroAHx1jhtFLf6EEuWcSokgNfAhpump` on Solana. Link a Solana wallet in **Profile**, then open **$AUVEN** to read its balance. If the wallet holds tokens, choose one of your agents and create an ML-DSA-65 signed holder proof. It records a balance at one observed slot and does not move or lock tokens. Agent identity, controls, and signed activity do not require the token.

When the operator enables holder model access, the **$AUVEN** page shows the required balance and whether your linked wallet qualifies. Eligible users can choose the holder model in **Create agent → Run a controlled request**, or pass `model_tier: "holder"` to the gateway or MCP tool. AUVEN rechecks the linked wallet and balance before that request runs. Your agent's limits and approval rules still apply. If the page says holder benefits are in development, the model tier is not enabled yet. Token payments, extra request quotas, agent rentals, buybacks, and burns are not active. See the [product and token roadmap](https://auven.xyz/roadmap) for the proposed flow.

## Common errors

| Message | What to do |
| --- | --- |
| `invalid_session` | Sign in again through Privy. |
| `workspace_not_found` | Create or claim your workspace. |
| `provider_not_configured` | The operator must add the OpenAI API key. |
| `chain_signer_not_configured` | Export your proof; Solana publication is not enabled yet. |
| `token_mint_not_configured` | The site operator must configure the confirmed mint. |
| `wallet_not_linked` | Link a Solana wallet in Profile. |
| `token_balance_required` | The linked wallet has no balance of the configured mint at the observed slot. |
| `holder_model_not_available` | The operator has not enabled the optional holder model tier. Use the standard model. |
| `holder_balance_required` | Link an eligible Solana wallet or use the standard model. |
