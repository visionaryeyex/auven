<p align="center">
  <img src="assets/auven-x-banner.png" alt="AUVEN — Control what agents do. Verify what happened." width="100%">
</p>

<p align="center">
  <a href="#run-locally"><img src="https://img.shields.io/badge/Node.js-22-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22"></a>
  <a href="#hosted-setup"><img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"></a>
  <a href="#proofs"><img src="https://img.shields.io/badge/ML--DSA--65-post--quantum-7057E8?style=flat-square" alt="ML-DSA-65"></a>
  <a href="#proofs"><img src="https://img.shields.io/badge/Robinhood%20Chain-4663-24202F?style=flat-square" alt="Robinhood Chain 4663"></a>
  <a href="#hosted-setup"><img src="https://img.shields.io/badge/Vercel-deployed-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel"></a>
</p>

# AUVEN

AUVEN is a gateway for AI agents that run in your own applications. It gives each connected agent a credential and a daily spending limit, checks supported requests before they reach the provider, and records the decision. Agent passports and activity checkpoints can be signed with ML-DSA-65 and verified independently.

The gateway controls traffic sent through it. An agent that calls a provider directly with another key is outside that control.

## What works

- **Agent identity.** Register an external agent in a workspace and issue a credential. The agent's passport is signed when it is registered.
- **Request control.** Stop or resume an agent, reserve against its daily limit, reject duplicate request IDs, and record allowed and denied calls. The supported provider route is OpenAI chat completions when a server key is configured.
- **Verifiable records.** Sign activity checkpoints with ML-DSA-65, export proofs, and reject changed payloads or signatures with the standalone verifier.
- **Mainnet commitment.** Submit the hash of a signed proof on Robinhood Chain mainnet, then check the receipt, signer, target, and commitment. A small registry contract is included; publication uses it after deployment and configuration. Until then, the existing signer transaction mode remains available.

AUVEN registers and controls agents you already run; it does not host or create their runtime. Spending is estimated from the requested token limit and is not a provider invoice.

## Run locally

Use Node.js 22.x.

```bash
npm ci
npm test
npm start
```

Open `http://127.0.0.1:4174`. Local data is stored in SQLite under `.data/`, which Git ignores. The dashboard can create a workspace and register an agent. Save the workspace admin token and the agent credential when they appear: only hashes are stored, so neither can be recovered later.

Set `AUVEN_OPENAI_API_KEY` to exercise the supported provider route. With no provider key, identity, policy, signing, export, and verification remain available locally.

## Connect an agent

1. Sign in and create a workspace in the dashboard. If hosted authentication has not been configured, use the operator's `AUVEN_SETUP_TOKEN` to create a legacy workspace.
2. Save the admin token shown once as a recovery and API credential.
3. Open **Agents** and select **Connect agent**. Enter its name, purpose, and daily limit.
4. Save the credential shown once, then use it in requests from the agent you run.

The equivalent API call is:

```bash
curl -X POST http://127.0.0.1:4174/api/agents \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Research assistant","purpose":"Summarize research","daily_limit_cents":1000}'
```

A controlled provider request needs the agent credential and a new idempotency key:

```bash
curl -X POST http://127.0.0.1:4174/api/gateway/chat \
  -H 'Authorization: Bearer YOUR_AGENT_CREDENTIAL' \
  -H 'Idempotency-Key: unique-request-001' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

The gateway checks the agent's status and budget before calling the provider. Stop an agent from **Agents**, or call `PATCH /api/agents/:id/status` with `{"status":"stopped"}`. Activity appears under **Activity**.

## Proofs

The signed format contains the canonical payload, ML-DSA-65 signature, public key, format version, and SHA-256 digest. Export a passport from **Proofs**, or create an activity checkpoint with `POST /api/checkpoints`.

```bash
node verify.cjs path/to/proof.json
node verify.cjs path/to/proof.json 0xTRANSACTION_HASH 0xTRUSTED_PUBLISHER [0xREGISTRY_ADDRESS]
```

The first command checks the signature and digest. The second also checks inclusion on Robinhood Chain mainnet (chain ID 4663) against the publisher address you trust. Supply the registry address if that proof was published through the deployed registry. Without a registry configured, the server writes the commitment in a zero-value transaction to its dedicated signer. The chain does not verify the ML-DSA signature. A valid proof establishes that its bytes match the signature and recorded commitment; it does not establish that the underlying activity was truthful.

| Route | Purpose |
| --- | --- |
| `POST /api/workspaces` | Create a workspace; return its admin token once |
| `GET /api/agents`, `POST /api/agents` | List or register connected agents |
| `PATCH /api/agents/:id/status` | Stop or resume an agent |
| `POST /api/gateway/chat` | Apply policy and forward a supported request |
| `GET /api/events` | Read the workspace activity log |
| `POST /api/checkpoints`, `GET /api/proofs` | Sign a checkpoint and inspect proofs |
| `POST /api/proofs/:id/publish` | Submit a proof commitment when a mainnet signer is configured |
| `GET /api/proofs/:id/inclusion` | Check the transaction and commitment |
| `POST /api/verify` | Verify a signed proof without database access |

## Hosted setup

`vercel.json` serves `dist/` and the API Function. Hosted data uses PostgreSQL; set `DATABASE_URL` and apply `db/schema.sql` with `npm run db:migrate` before using database-backed routes. The server will return `database_not_configured` until a connection string is present.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; use Supabase's transaction pooler on port 6543 for Vercel |
| `AUVEN_SUPABASE_URL` | Supabase project URL for email and wallet sign-in |
| `AUVEN_SUPABASE_PUBLISHABLE_KEY` | Public Supabase client key for Auth; never use a service role key here |
| `AUVEN_SETUP_TOKEN` | Required header value for hosted workspace creation |
| `AUVEN_PQ_SIGNING_SEED` | Stable signing identity: 32 random bytes encoded as 64 hex characters |
| `AUVEN_OPENAI_API_KEY` | Enables the supported OpenAI gateway route |
| `AUVEN_MODEL` | Optional model name; defaults to `gpt-4o-mini` |
| `AUVEN_RH_PRIVATE_KEY` | Dedicated funded signer for mainnet publication |
| `AUVEN_RH_RPC_URL` | Optional Robinhood Chain RPC override |
| `AUVEN_RH_REGISTRY_ADDRESS` | Optional deployed proof registry; required to use the contract route |

Configure sensitive values as server-side Vercel secrets and redeploy after changing them. The Supabase URL and publishable key are public client configuration; never substitute a service role key. Back up the PQ seed: changing it creates a different signing identity. See [SECURITY.md](SECURITY.md).

Supabase Auth also needs email sign-in, Ethereum Web3 sign-in, the app's allowed redirect URLs, a Magic Link email template, and production SMTP configured in its dashboard. See [Deployment guide](docs/DEPLOYMENT.md) and [User guide](docs/USER_GUIDE.md) for the exact steps.

For request examples and error handling in an existing agent application, see the [Agent integration guide](docs/AGENT_INTEGRATION.md).

The email and wallet profile flow is implemented in this repository but needs live verification after Auth and the database are configured on the hosted deployment. The registry is compiled and deployable, but no live contract address is claimed here.

## Code

`api-handler.cjs` implements the API; `db.cjs` and `db-postgres.cjs` provide local and hosted storage; `proof.cjs` signs and verifies records; `chain.cjs` submits and checks mainnet commitments; `verify.cjs` is the standalone verifier. Tests under `test/` cover the API flow, policy decisions, workspace isolation, proof tampering, and receipt checks.
