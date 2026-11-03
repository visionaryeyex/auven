# Deploy AUVEN

The hosted app uses Vercel, Supabase PostgreSQL, Privy, and an optional OpenAI gateway. Solana wallet sign-in and $AUVEN balance reads are integrated. Solana proof publication requires a separate funded signer and RPC.

## 1. Database

The existing AUVEN Supabase project remains the database. Keep `DATABASE_URL` in Vercel Production as a Sensitive variable using the Supabase Transaction pooler URI on port 6543. Never put it in browser code or Git.

The server applies the narrow Solana compatibility migration on its first database-backed request, using the existing PostgreSQL owner connection. It removes the old lowercase-only wallet constraint, tags older published proofs for legacy verification, and defaults new proofs to Solana. The same changes are in [`db/schema.sql`](../db/schema.sql), which you can apply with `npm run db:migrate` from a trusted machine or in the Supabase SQL Editor. The existing tables and owner connection must already be present; browser roles still receive no table grants.

After deployment, `/api/ready` must return `{"ok":true,"database":"ready"}`. A successful `/api/health` response alone does not test the database.

## 2. Privy

Use the existing AUVEN app in [Privy Dashboard](https://dashboard.privy.io/). Keep **Email** login enabled. In **User management → Authentication → Wallets**, enable Solana wallets, including Backpack if you want it offered to users. Do not create a second Privy app, since that would give existing users new Privy IDs and separate workspaces.

Keep the production domain in Allowed origins. Leave **Return user data in an identity token** enabled if available. AUVEN verifies Privy tokens on the server and reads linked Solana addresses only from the verified user record. The frontend offers Solana wallet login and linking.

The existing `AUVEN_PRIVY_APP_ID` and `AUVEN_PRIVY_APP_SECRET` remain unchanged. No new Privy secret is needed. Email sign-in still uses Privy's code.

## 3. Vercel Production variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL connection |
| `AUVEN_PRIVY_APP_ID` | Privy application ID, a public identifier |
| `AUVEN_PRIVY_APP_SECRET` | Server verification and linked account lookup |
| `AUVEN_SETUP_TOKEN` | Optional legacy admin-token workspace setup |
| `AUVEN_PQ_SIGNING_SEED` | Stable ML-DSA-65 signing identity, 32 bytes as 64 hex characters |
| `AUVEN_OPENAI_API_KEY` | Enables controlled OpenAI chat requests |
| `AUVEN_MODEL` | Optional model override; defaults to `gpt-6.1-sol` |
| `AUVEN_HOLDER_MIN_TOKENS` | Minimum $AUVEN balance in a Privy-linked Solana wallet for the optional holder model tier |
| `AUVEN_HOLDER_MODEL` | Provider model for eligible holder requests; must support the configured Chat Completions route |
| `AUVEN_HOLDER_ESTIMATE_MULTIPLIER` | Multiplier from 1 to 100 for the holder model's estimated budget |
| `AUVEN_HOLDER_DAILY_REQUEST_LIMIT` | Maximum holder model requests per workspace per UTC day, from 1 to 100; all four holder settings are required |
| `AUVEN_SOLANA_RPC_URL` | Dedicated Solana RPC for proof publication and future token balance reads |
| `AUVEN_SOLANA_SECRET_KEY` | Dedicated proof publisher's Base58 private key or 64-byte JSON secret array; required for publication only |
| `AUVEN_SOLANA_TOKEN_MINT` | Optional override for the public $AUVEN mint embedded in the app |

Keep server credentials Sensitive. The Solana RPC endpoint may itself contain a provider key, so keep it server-side. The Solana secret must belong to a new, dedicated wallet funded with enough SOL for transaction fees. Never use your personal wallet secret or a Privy user wallet secret.

The initial holder-tier launch configuration is **1,000,000 $AUVEN** held across verified wallets linked to the workspace, `gpt-6-astra` as the holder model, an estimated budget multiplier of `5`, and **3 holder requests per workspace per UTC day**. Set all four `AUVEN_HOLDER_*` variables to enable it. The daily cap applies across the workspace's agents; individual agent budgets, request limits, and approvals can be stricter. Holding tokens does not spend or lock them. Before enabling this route, confirm that the OpenAI project can call the model, check provider spend limits, and run a real request in a production workspace.

The old `AUVEN_RH_PRIVATE_KEY`, `AUVEN_RH_RPC_URL`, and `AUVEN_RH_REGISTRY_ADDRESS` are not used for new publications. The old RPC can remain temporarily if you need to verify existing records, because the legacy verifier still reads it. Remove the old private key from Vercel after verifying that no old publication path uses it. Changing Vercel variables requires a redeploy.

## 4. Solana proof publication

New publication uses a signed Solana transaction containing one Memo instruction. The memo holds an `AUVEN1` proof commitment, not the proof payload or its ML-DSA signature. AUVEN verifies the exported signature offchain and verifies the transaction, signer, exact memo, and Solana network separately. There is no new program to deploy for this path.

1. Provision a dedicated Solana RPC and set `AUVEN_SOLANA_RPC_URL` in Vercel.
2. Use a dedicated Solana wallet and fund its public address with a small amount of SOL. Export that wallet's private key in Backpack or another wallet, then put its Base58 private key in `AUVEN_SOLANA_SECRET_KEY` as a Sensitive Vercel variable. A 64-byte JSON secret array is also accepted. Never enter a recovery phrase here or use a personal wallet. Confirm that the public publisher address returned by `/api/health` matches the funded wallet before publishing.
3. Redeploy, create an activity checkpoint in AUVEN, and publish it from **Proofs**.
4. Open the transaction in [Solana Explorer](https://explorer.solana.com/) and use **Verify** in AUVEN. A confirmed inclusion must report `included: true`.

The $AUVEN Solana mint is `DXf5UDjzYFEizcroAHx1jhtFLf6EEuWcSokgNfAhpump`. It is embedded as the app default, so no Vercel mint variable is required. AUVEN checks the RPC genesis hash before reading the mint. Holder proofs record the linked wallet, mint, raw balance, observed slot, and time; they are snapshots and do not lock tokens. For reliable production reads, set `AUVEN_SOLANA_RPC_URL` to a dedicated Solana RPC endpoint.

The holder model tier stays disabled until all three holder settings are provided. Before enabling it, confirm that the selected provider model is available to the OpenAI project and choose a conservative budget multiplier. AUVEN checks the current Privy-linked wallets and $AUVEN balance for every holder request and again before an approved request runs. The existing agent spending and approval policies still apply. This is model access only: it does not charge tokens or raise daily request limits.

## 5. Release check

1. Run `npm ci`, `npm run build`, and `npm test`.
2. Confirm `/api/ready` on the production domain after applying the schema.
3. Sign in through Privy with an email account, link a Solana wallet from **Profile**, and confirm the same workspace remains accessible after refresh.
5. Register an agent; check policy limits, owner approval, MCP status, Activity, export, and local ML-DSA verification.
6. With the funded Solana publisher configured, publish one proof and verify the commitment through the UI and Explorer.
7. Check the $AUVEN balance of a linked wallet and create one holder proof. If the holder model tier is configured, run one eligible holder request and confirm its model in Activity and the provider response. Do not advertise payments or burns as active.
