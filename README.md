<p align="center"><img src="assets/auven-readme-banner.svg" alt="AUVEN - Agent control and verifiable activity" width="100%"></p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Privy-authentication-7057E8?style=flat-square" alt="Privy">
  <img src="https://img.shields.io/badge/ML--DSA--65-signed%20proofs-7057E8?style=flat-square" alt="ML-DSA-65">
  <img src="https://img.shields.io/badge/Solana-proof%20commitments-24202F?style=flat-square&logo=solana&logoColor=white" alt="Solana">
  <img src="https://img.shields.io/badge/MCP-agent%20tools-7057E8?style=flat-square" alt="MCP">
</p>

# AUVEN

AUVEN puts a control point between an AI agent and the provider requests it makes. Connect an agent you already run, set limits in a workspace, and send supported calls through the gateway. AUVEN records each decision and can sign agent passports and activity checkpoints with ML-DSA-65. Signed proofs can be checked without trusting the dashboard.

Only traffic routed through AUVEN is controlled. An agent using a separate provider key directly is outside the gateway.

## Available now

- **Workspaces and agent credentials.** Register an external agent and give it a credential scoped to the gateway. A signed passport is created at registration.
- **Request policies.** Pause or resume an agent, set daily request and estimated spending limits, cap response tokens, and require owner approval. The supported provider route is OpenAI chat completions when the server has an API key. Spending is an estimate based on token limits, not a provider invoice.
- **MCP access.** Connect Codex or Claude Code to an agent-scoped remote MCP endpoint. `auven_chat` sends the request through policy checks; `auven_action_status` retrieves the result of an approval. [Connect with MCP](docs/MCP.md).
- **Activity and proofs.** Inspect allowed, denied, pending, and failed requests. Export ML-DSA-65 signed passports and checkpoints and verify them with the standalone tool.
- **Onchain publication.** The Solana publication path records a proof commitment in a signed Memo transaction once an operator configures a funded publisher. The proof payload and signature stay offchain. Previously published records can still be verified on their original network.

The [interactive demo](https://auven.xyz/demo) shows policy decisions and owner approval with sample data. It makes no provider calls.

## Solana transition and $AUVEN

Privy email sign-in remains available. Solana wallet sign-in and wallet linking use the existing Privy application. Existing EVM wallet-only accounts have a separate recovery sign-in path so their owners can link a Solana wallet without losing their workspace.

The $AUVEN mint on Solana is [`DXf5UDjzYFEizcroAHx1jhtFLf6EEuWcSokgNfAhpump`](https://explorer.solana.com/address/DXf5UDjzYFEizcroAHx1jhtFLf6EEuWcSokgNfAhpump). Its onchain metadata identifies **Auven / AUVEN**; it uses Token-2022 with 6 decimals. The holder balance path is implemented but remains unavailable on the hosted app until the mint is configured and tested there. Token payments, holder quotas, buybacks, burns, and distributions are not active features. Agent controls and signed activity work independently of the token. The [token page](https://auven.xyz/token) describes the current state and proposed utilities.

## Run locally

Use Node.js 22.x:

```bash
npm ci
npm run build
npm test
npm start
```

Open `http://127.0.0.1:4174`. Without `DATABASE_URL`, local data is kept in SQLite under `.data/`. This directory is ignored by Git. The dashboard can create a workspace and connect an agent. Save the workspace admin token and agent credential when shown; only their hashes are stored.

Copy [`.env.example`](.env.example) into a local `.env` file and add the values needed for the flows you want to test. `AUVEN_OPENAI_API_KEY` enables real gateway requests. Without it, identity, policies, signing, export, and signature verification can still be used locally.

## Connect an agent

1. Sign in and create a workspace. Open **Agents** and choose **Connect agent**.
2. Enter the agent's name, purpose, and daily limit. Save the credential shown once.
3. Configure [MCP](docs/MCP.md) in Codex or Claude Code, or call the gateway API from your own server.
4. Review the result in **Activity**; change controls under **Policies**.

Direct API example:

```bash
curl -X POST https://YOUR_AUVEN_DOMAIN/api/gateway/chat \
  -H 'Authorization: Bearer YOUR_AGENT_CREDENTIAL' \
  -H 'Idempotency-Key: unique-request-001' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

The idempotency key must be new for each logical request. A duplicate is rejected.

## Verify a proof

Export a passport from **Proofs**, or create an activity checkpoint with `POST /api/checkpoints`. The standalone verifier checks the canonical payload, digest, and ML-DSA-65 signature:

```bash
node verify.cjs path/to/proof.json
```

When a proof has been published on Solana, you can also check its transaction using the trusted publisher address:

```bash
node verify.cjs path/to/proof.json SOLANA_TRANSACTION_SIGNATURE TRUSTED_PUBLISHER_ADDRESS
```

The chain records a commitment to the proof bytes. It does not verify the ML-DSA-65 signature or establish that the reported real-world activity was truthful.

## Hosted setup

Vercel serves the public pages and API. Supabase PostgreSQL stores hosted data; Privy handles user login. The server applies a narrow Solana compatibility migration on its first database-backed request. The full [`db/schema.sql`](db/schema.sql) remains available for manual setup. Older published proofs keep their original network metadata, and wallet addresses can be case-sensitive.

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL connection |
| `AUVEN_PRIVY_APP_ID` | Existing Privy application |
| `AUVEN_PRIVY_APP_SECRET` | Server-side Privy token verification |
| `AUVEN_PQ_SIGNING_SEED` | Stable ML-DSA-65 signing identity |
| `AUVEN_OPENAI_API_KEY` | Controlled OpenAI chat route |
| `AUVEN_MODEL` | Optional model override |
| `AUVEN_SETUP_TOKEN` | Optional legacy workspace bootstrap |
| `AUVEN_SOLANA_RPC_URL` | Dedicated Solana RPC for publication and token reads |
| `AUVEN_SOLANA_SECRET_KEY` | Dedicated funded Solana proof publisher; required only for publication |
| `AUVEN_SOLANA_TOKEN_MINT` | Confirmed $AUVEN mint shown above; enables balance reads and holder proofs |

Keep the database URL, signing seed, API key, and publisher secret in server-side secret storage. Redeploy after changing Vercel variables. See the [deployment guide](docs/DEPLOYMENT.md), [user guide](docs/USER_GUIDE.md), and [agent integration guide](docs/AGENT_INTEGRATION.md).

## Repository map

`api-handler.cjs` implements the API; `db.cjs` and `db-postgres.cjs` provide local and hosted storage; `proof.cjs` signs and verifies records; `solana.cjs` publishes and checks new commitments; `verify.cjs` is the standalone verifier. The previous chain verifier remains for already published records. Tests under `test/` cover the API, policy decisions, account isolation, proof tampering, and publication checks.
