# Security

Report suspected vulnerabilities privately to the repository owner. Do not include live credentials in an issue. This project is under development and has not undergone an independent security audit.

Keep `DATABASE_URL`, `AUVEN_SETUP_TOKEN`, `AUVEN_PQ_SIGNING_SEED`, `AUVEN_OPENAI_API_KEY`, and `AUVEN_RH_PRIVATE_KEY` in server-side secret storage. Never expose them through public `NEXT_PUBLIC_` or `VITE_` variables. Do not publish `.data/` or database dumps. Back up the PQ signing seed securely; losing it prevents future signatures under the same identity.

`AUVEN_SUPABASE_URL` and `AUVEN_SUPABASE_PUBLISHABLE_KEY` are public Auth configuration. Never put a Supabase service role key in either variable. AUVEN verifies each Supabase access token with Supabase Auth before using it to access a workspace; wallet addresses are taken only from verified Web3 identities on Robinhood Chain (4663), not editable user metadata.
