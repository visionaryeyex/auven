# Use AUVEN

For Codex or Claude Code, follow the [MCP setup guide](MCP.md) after connecting an agent. MCP tool calls use that agent's gateway credential and appear in Activity.

AUVEN connects to agents that run in your application. It does not host an agent or create one for you. Requests are controlled only when your agent sends them through the AUVEN gateway.

## Sign in and set up a workspace

If the deployment has Privy enabled, open **Explore dashboard** and choose one method:

- **Email:** enter your address in the Privy modal, then enter the one-time code from the email. First verified sign-in creates your AUVEN profile.
- **Wallet:** connect an EVM wallet in the Privy modal and sign the login message. AUVEN sets Robinhood Chain (chain ID 4663) as its default network. Signing in is offchain and does not spend gas.

Create a workspace when prompted. If you already have a workspace created with an admin token, select **Claim existing workspace** and enter that token. Save the admin token shown when a new workspace is created; it appears once. Email and wallet sessions can then access the workspace without pasting it again.

In **Profile**, a wallet-first account can link an email through Privy. An email-first account can select **Link wallet** and sign Privy's wallet challenge. Link the second method while signed in to keep one Privy profile and one AUVEN workspace. A wallet already linked to another Privy profile cannot be linked again automatically.

If Privy has not been configured, the dashboard uses the legacy workspace admin token. The deployment operator may also require its setup token for new legacy workspaces.

## Connect an external agent

1. Open **Agents** and select **Connect agent**.
2. Enter the agent's name, purpose, and daily limit in USD.
3. Save the gateway credential shown once. Put it in the agent application's server-side secret store, never in a browser bundle or public repository.
4. Send supported requests to the AUVEN gateway with that credential. Keep your provider API key on the AUVEN server; do not give it to the agent.

The agent uses this request shape for the supported OpenAI route:

```bash
curl -X POST https://YOUR_AUVEN_DOMAIN/api/gateway/chat \
  -H 'Authorization: Bearer YOUR_AGENT_CREDENTIAL' \
  -H 'Idempotency-Key: request-unique-to-this-call' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

Every request needs a unique idempotency key of 8–128 characters. A repeated key returns a conflict. A stopped agent or one without enough daily budget is denied. AUVEN logs the decision under **Activity**. The daily amount is a request estimate, not exact provider billing.

## Control and review

- **Overview** shows connected agents, gateway events, and the target network.
- **Agents** lists registered external agents. Use **Stop** to block new gateway calls or **Resume** to allow them again.
- **Policies** explains the current deterministic rule: registered active agent, sufficient daily budget, and an idempotency key.
- **Activity** shows recorded gateway decisions and reasons.
- **Proofs** shows signed passports and activity checkpoints. Export a proof as JSON. If the backend chain signer is configured and funded, **Publish** submits its commitment and **Verify** checks inclusion.
- **$AUVEN** reads the balance of wallets linked to your verified Privy account on Robinhood Chain. If you hold the token and have a registered agent, select that agent and create an ML-DSA-65 holder proof. Find the new proof in **Proofs** to export or publish it.
- **Profile** manages sign-in methods and sign-out when Privy is configured.

An activity checkpoint can be created through `POST /api/checkpoints` with a workspace session or admin token and an `agent_id`. The UI then shows the resulting proof in **Proofs**.

The holder proof records the wallet, token balance, block, and agent at the time of the read. It exposes the holder wallet and observed balance when exported. It does not move or lock tokens, and it does not prove that a wallet still holds the same amount later. The token is optional for all other AUVEN features. Token payments, bonus quotas, and burns are not active.

## Verify a proof

Export the JSON from **Proofs**, then run:

```bash
node verify.cjs auven-proof.json
node verify.cjs auven-proof.json 0xTRANSACTION_HASH 0xTRUSTED_PUBLISHER [0xREGISTRY_ADDRESS]
```

The first command verifies the ML-DSA-65 signature and digest. The second also checks the Robinhood Chain transaction against a publisher address you trust. Supply the registry address if the proof was published through the deployed registry. The chain stores a commitment, not the private activity details or an onchain ML-DSA verification.

## Troubleshooting

| Message | Meaning |
| --- | --- |
| `database_not_configured` | The deployment is missing `DATABASE_URL`; contact the operator. |
| `invalid_session` | Sign in again; the Privy session may have expired or its token could not be verified. |
| `workspace_not_found` | Create a workspace or claim a legacy one. |
| `provider_not_configured` | The operator has not set the OpenAI key. |
| `chain_signer_not_configured` | Proof publication is not enabled. Export and verify the proof offchain meanwhile. |
| `wallet_not_linked` | Link an EVM wallet to your Privy account in **Profile**. |
| `token_balance_required` | The verified linked wallet has no $AUVEN at the checked chain block. |
| `token_rpc_unavailable` | The Robinhood Chain RPC could not be reached; try the balance read again. |
