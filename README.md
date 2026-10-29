<div align="center">
  <img src="dist/logo-horizontal.svg" alt="AUVEN" width="320">
  <p><strong>Identity, spending controls, and verifiable records for external AI agents.</strong></p>
</div>

## Why AUVEN

An agent can use a paid API in seconds. Knowing which agent made the call, whether it was allowed, and what it cost is harder. AUVEN puts a controlled route between an external agent and a supported provider. Each agent has its own credential and daily limit. The gateway decides whether to forward a request and records the decision.

The same workspace can issue a signed passport for an agent and signed checkpoints of its activity. These records can be exported and verified without access to the AUVEN server.

AUVEN controls requests sent through its gateway. Direct calls made with another provider key are outside its reach.

## What is in this repository

- A public site and workspace dashboard in `dist/`.
- Registration for workspaces and external agents, with separate credentials.
- Agent stop/resume, daily budget reservation, idempotency, and an activity log.
- An OpenAI chat completion route that runs when a server-side provider key is configured.
- ML-DSA-65 signing for agent passports and activity checkpoints, plus a standalone verifier.
- Code to submit a signed proof commitment to Robinhood Chain mainnet and verify its transaction. A funded signer is required to use that route.

The API and core checks have been tested locally. The PostgreSQL and Vercel setup is included for deployment; it still needs validation against the project's hosted environment.

## Run locally

Use Node.js 22.x.

```bash
npm ci
npm test
npm start
```

Open `http://127.0.0.1:4174`. By default, local data is stored in `.data/` using SQLite. The directory is ignored by Git. Create a workspace in the dashboard, save the admin token displayed once, then register an agent and save its gateway credential. Tokens are stored as hashes and cannot be recovered from the database.

To use PostgreSQL, set `DATABASE_URL`, run `npm run db:migrate`, then start the server. The schema is in `db/schema.sql`.

## Connect an agent

The agent runs in your application. AUVEN gives it a credential for the gateway; registration does not run or host the agent.

Create an agent with the workspace admin token:

```bash
curl -X POST http://127.0.0.1:4174/api/agents \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Research assistant","purpose":"Summarize research","daily_limit_cents":1000}'
```

With `AUVEN_OPENAI_API_KEY` configured on the server, the agent can make a controlled request:

```bash
curl -X POST http://127.0.0.1:4174/api/gateway/chat \
  -H 'Authorization: Bearer YOUR_AGENT_CREDENTIAL' \
  -H 'Idempotency-Key: unique-request-001' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

The gateway checks the agent's status and reserves budget before calling the provider. A repeated idempotency key returns a conflict. Stop an agent with `PATCH /api/agents/:id/status` and `{ "status": "stopped" }`; subsequent gateway requests are denied. Workspace owners can inspect decisions with `GET /api/events`.

| Route | Purpose |
| --- | --- |
| `POST /api/workspaces` | Create a workspace and receive its admin token once |
| `GET /api/agents`, `POST /api/agents` | List or register external agents |
| `PATCH /api/agents/:id/status` | Stop or resume an agent |
| `POST /api/gateway/chat` | Apply policy and forward a supported provider call |
| `GET /api/events` | Read workspace activity |
| `POST /api/checkpoints`, `GET /api/proofs` | Sign a checkpoint and inspect proofs |
| `POST /api/proofs/:id/publish` | Submit a proof commitment when a mainnet signer is configured |
| `GET /api/proofs/:id/inclusion` | Check the mainnet transaction and commitment |
| `POST /api/verify` | Check a proof signature |

## Verify a proof

AUVEN signs the canonical passport or checkpoint payload with ML-DSA-65. The exported proof contains its payload, signature, public key, format version, and SHA-256 digest.

```bash
node verify.cjs path/to/proof.json
node verify.cjs path/to/proof.json 0xTRANSACTION_HASH
```

The first command verifies the document against the included public key. The second additionally checks the transaction on Robinhood Chain mainnet (chain ID 4663), including the receipt and exact commitment bytes. The onchain transaction records a hash of the signed proof; it does not execute ML-DSA verification in a smart contract. A valid signature also does not establish who controlled the public key or whether the agent behaved correctly.

## Deploy

`vercel.json` serves `dist/` and the API Function in `api/[...path].js`. Hosted data uses PostgreSQL. Run `npm run db:migrate` against the database before deploying, then configure these server-side environment variables in Vercel:

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `AUVEN_SETUP_TOKEN` | Workspace creation control |
| `AUVEN_PQ_SIGNING_SEED` | Stable ML-DSA-65 signing identity; 32 random bytes as 64 hex characters |
| `AUVEN_OPENAI_API_KEY` | Supported provider calls |
| `AUVEN_MODEL` | Model name; defaults to `gpt-4o-mini` |
| `AUVEN_RH_PRIVATE_KEY` | Dedicated, funded mainnet signer for proof publication |
| `AUVEN_RH_RPC_URL` | Robinhood Chain RPC; a production endpoint is recommended |

Use `.env.example` as a field guide. Keep real values in server-side secret storage, never in the repository or browser bundle. The signing seed must be backed up: changing it creates a different signing identity. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Code map

`api-handler.cjs` handles the API; `db.cjs` and `db-postgres.cjs` provide local and hosted storage; `proof.cjs` signs documents; `chain.cjs` handles the mainnet commitment; `verify.cjs` verifies exported proofs. The tests in `test/` cover the API flow, policy decisions, workspace isolation, tampering, and chain receipt checks.
