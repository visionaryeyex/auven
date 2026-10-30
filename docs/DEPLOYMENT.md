# Deploy AUVEN

This guide describes the current application, its Supabase project, and the production Vercel project. AUVEN can publish proof commitments in a transaction to the dedicated signer or through the included registry contract after it is deployed. A token is not required for this release.

## 1. Supabase database

The AUVEN Supabase project is in EU West. Its project reference is `ibgmxmwackefalnpjklp`.

1. Open **Supabase → AUVEN → Connect → Transaction pooler**. Copy the complete URI on port **6543**. Replace `[YOUR-PASSWORD]` with the database password. Percent-encode reserved characters in the password. Copy the host and username from Supabase; do not construct them from the region.
2. In **Vercel → auven-wxk9 → Settings → Environment Variables**, add the URI as `DATABASE_URL` for **Production**. Use the Sensitive type.
3. Apply `db/schema.sql` with `npm run db:migrate` while `DATABASE_URL` is available locally, or run that exact SQL in the Supabase SQL Editor. The script is idempotent: it creates the agent tables, profile tables, wallet links, indexes, and access restrictions.
4. Redeploy the production project. `GET /api/ready` must return `{"ok":true,"database":"ready"}`. `GET /api/health` only reports whether the variable exists; it does not test a connection.

The browser does not receive the database URI. AUVEN's server connects to PostgreSQL directly; its app tables have RLS enabled with no `anon` or `authenticated` grants.

## 2. Privy authentication

Create an AUVEN application in the [Privy Dashboard](https://dashboard.privy.io/). In **User management → Authentication**, enable **Email** and **Wallet** login. In **Advanced**, enable **Return user data in an identity token**. AUVEN sends that signed identity token to its API so the server can verify the user's email and linked EVM wallets. Add the production domain and local development origin to the app's allowed origins. Set the app's name and purple appearance in Privy.

In **Configuration → App settings → Basics**, copy the app ID and generate a read-only server app secret. AUVEN uses it to verify identity tokens and does not use Privy wallet-management APIs. Add both to Vercel Production:

| Name | Value | Visibility |
| --- | --- | --- |
| `AUVEN_PRIVY_APP_ID` | Privy app ID | Public identifier served by `/api/auth/config` |
| `AUVEN_PRIVY_APP_SECRET` | Privy app secret | Sensitive, server only |

Privy sends an **email code**, not a Magic Link. The app presents Privy's email and EVM wallet login modal. The default and supported EVM network is Robinhood Chain mainnet (chain ID **4663**). A wallet can still decline a network switch during connection; check its network before any onchain transaction. Wallet login itself is an offchain signature and does not spend gas.

In **Profile**, link an email to a wallet-first profile or link an EVM wallet to an email-first profile using Privy's account linking. Do this while signed in so both methods resolve to the same Privy user ID and AUVEN workspace. The backend never trusts a wallet address supplied by the browser; it reads linked accounts from the verified Privy identity token.

The existing Supabase project remains the PostgreSQL database. Supabase Auth email, Web3, redirect URL, SMTP, URL and publishable-key settings are no longer used by AUVEN.

## 3. Vercel Production variables

The production project is **auven-wxk9**. Set variables for **Production**, then redeploy; changes do not affect an existing deployment.

| Variable | Needed for | Source |
| --- | --- | --- |
| `DATABASE_URL` | Every database-backed route | Supabase Transaction pooler URI, port 6543 |
| `AUVEN_PRIVY_APP_ID` | Email and wallet sign-in | Privy app ID |
| `AUVEN_PRIVY_APP_SECRET` | Server verification of signed identity tokens | Privy app secret |
| `AUVEN_SETUP_TOKEN` | Legacy workspace bootstrap by admin token | 32 random bytes; already configured in the current Vercel project |
| `AUVEN_PQ_SIGNING_SEED` | Stable ML-DSA-65 signing identity | 32 random bytes encoded as 64 hex characters; already configured |
| `AUVEN_OPENAI_API_KEY` | Controlled OpenAI chat requests | OpenAI Platform project API key |
| `AUVEN_MODEL` | Optional model override | Defaults to `gpt-4o-mini` in code |
| `AUVEN_RH_PRIVATE_KEY` | Mainnet proof publication | Dedicated AUVEN backend wallet, funded with ETH on Robinhood Chain |
| `AUVEN_RH_RPC_URL` | Optional production RPC | Robinhood Chain RPC provider endpoint; code has a public fallback |
| `AUVEN_RH_REGISTRY_ADDRESS` | Optional registry mode | Deployed and verified `AuvenProofRegistry` address on chain 4663 |

Keep `DATABASE_URL`, `AUVEN_PRIVY_APP_SECRET`, `AUVEN_SETUP_TOKEN`, `AUVEN_PQ_SIGNING_SEED`, `AUVEN_OPENAI_API_KEY`, and `AUVEN_RH_PRIVATE_KEY` as Sensitive server-side variables. The Privy app ID is a public identifier. Do not add a Supabase service role key, wallet seed phrase, or your personal wallet private key to this application. Remove the obsolete `AUVEN_SUPABASE_URL` and `AUVEN_SUPABASE_PUBLISHABLE_KEY` variables after Privy sign-in succeeds.

The PQ seed must be backed up securely. Replacing it changes the signing public key for future proofs.

## 4. OpenAI provider

Create a project API key in OpenAI Platform, enable billing for that project, and add it as `AUVEN_OPENAI_API_KEY` in Vercel Production. The agent never receives this key: it sends its AUVEN gateway credential to `/api/gateway/chat`, and the server calls the OpenAI Chat Completions API. Configure `AUVEN_MODEL` only if the chosen model supports this request shape and is available to the project.

The current budget is an estimate based on `max_tokens`; it is not exact OpenAI billing. Test with a small daily limit and a small request before relying on the policy.

## 5. Robinhood Chain mainnet

Use a **new dedicated backend signer wallet**, separate from the wallet you use to sign in to your profile. Add Robinhood Chain mainnet to the wallet: chain ID **4663**, currency **ETH**. Fund that address with a small amount of ETH on Robinhood Chain for gas. Put only its private key in Vercel as `AUVEN_RH_PRIVATE_KEY`. For a production RPC, set `AUVEN_RH_RPC_URL` to an endpoint from your infrastructure provider; the public Robinhood RPC is rate limited.

The AUVEN registry was deployed at [`0xEAc2A9D6389ea558eF04191fC99b7AB94A90fc22`](https://robinhoodchain.blockscout.com/address/0xEAc2A9D6389ea558eF04191fC99b7AB94A90fc22) by publisher `0x3D47AcCc4D2d4C82ca75a6ae80A264665955Cbf4`. The [deployment transaction](https://robinhoodchain.blockscout.com/tx/0x55b020f047af499e5c46de1c17d7a41bc6a99ea3d06860fc465264e872148102) succeeded on chain 4663. Set this address as `AUVEN_RH_REGISTRY_ADDRESS`. The Vercel signer must be the same publisher, because the registry rejects any other caller.

Publishing a proof is an actual mainnet transaction and costs gas. With no `AUVEN_RH_REGISTRY_ADDRESS`, AUVEN sends a zero-value transaction to its own signer address with `AUVEN1` and the proof commitment in calldata. To use the included proof registry:

1. From a trusted machine, set `AUVEN_RH_PRIVATE_KEY` for the dedicated funded signer and `AUVEN_RH_RPC_URL` for a production RPC. Run `npm run contract:compile` and `npm run contract:deploy`. The deploy script refuses a chain other than 4663 and prints the contract address and deployment transaction.
2. Check the deployed address, publisher and transaction on a Robinhood Chain explorer. The publisher is permanently set to the deploying signer. Keep that key available for publication and fund it for gas.
3. Add the address to Vercel Production as `AUVEN_RH_REGISTRY_ADDRESS` and redeploy. New proofs go through the registry. Existing signer transactions remain verifiable because each proof record stores the original target.
4. Publish one small proof and confirm `/api/proofs/:id/inclusion` returns `included: true`. The verifier checks the registry call and `ProofCommitted` event. For an exported proof, use `node verify.cjs proof.json TX_HASH TRUSTED_PUBLISHER REGISTRY_ADDRESS`.

The ML-DSA signature is checked offchain by AUVEN's verifier; the contract records only the commitment. There is no token contract or token economics in this repository. Do not describe a mainnet commitment as an onchain post-quantum signature check.

## 6. Release check

1. `npm ci`, `npm run build`, and `npm test` pass.
2. `/api/ready` returns 200 on the production Vercel URL.
3. An email code arrives at a non-team address; a new user enters it in Privy's modal and creates a workspace.
4. An EVM wallet signs in. From an email profile, linking that wallet requires its signature; later wallet sign-in opens the same workspace. The default network is Robinhood Chain mainnet, chain ID 4663.
5. Register an external agent, save its credential, stop and resume it, and confirm activity and signed passport appear.
6. With an OpenAI key, send one small gateway request. Confirm duplicate idempotency keys and stopped agents are denied.
7. Export a proof and verify it locally. After funding the backend signer, publish one proof and verify its mainnet inclusion.

Do not mark a step complete based only on environment variables being present. The user flow must pass against the hosted database and the actual external services.
