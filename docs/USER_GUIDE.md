# Use AUVEN

AUVEN controls requests from agents you run in your own application. It currently supports OpenAI chat requests routed through the gateway or `auven_chat` MCP tool. Calls sent directly to a provider are outside AUVEN's control.

## Sign in and create a workspace

Open [AUVEN](https://auven.xyz) and choose **Open workspace**. Sign in with an email code or a Solana wallet through Privy. Create a workspace when prompted. Save the admin token shown once; it is a recovery and API credential.

In **Profile**, you can link a Solana wallet to an email account or link an email to a wallet account. Do this while signed in so both methods stay on the same Privy profile and workspace. An older account that used only an EVM wallet can use **Existing EVM account? Sign in to link Solana**, then link a Solana wallet from Profile. Existing signed proofs are not changed by wallet linking.

## Connect an agent

1. Open **Agents** and choose **Connect agent**.
2. Enter a name, purpose, and estimated daily spending limit in USD.
3. Save the agent credential shown once. Store it on your agent application's server, never in frontend code or a public repository.
4. Route supported requests through AUVEN with that credential. The provider API key stays on the AUVEN server.

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

The $AUVEN mint is `DXf5UDjzYFEizcroAHx1jhtFLf6EEuWcSokgNfAhpump` on Solana. Link a Solana wallet in **Profile**, then open **$AUVEN** to read its balance. If the wallet holds tokens, choose one of your registered agents and create an ML-DSA-65 signed holder proof. It records a balance at one observed slot and does not move or lock tokens. Agent identity, controls, and signed activity do not require the token. Token payments, holder benefits, buybacks, and burns are not active.

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
