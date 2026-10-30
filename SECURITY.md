# Security

Report suspected vulnerabilities privately to the repository owner. Do not include live credentials in an issue. This project is under development and has not undergone an independent security audit.

Keep `DATABASE_URL`, `AUVEN_PRIVY_APP_SECRET`, `AUVEN_SETUP_TOKEN`, `AUVEN_PQ_SIGNING_SEED`, `AUVEN_OPENAI_API_KEY`, and `AUVEN_RH_PRIVATE_KEY` in server-side secret storage. Never expose them through public `NEXT_PUBLIC_` or `VITE_` variables. Do not publish `.data/` or database dumps. Back up the PQ signing seed securely; losing it prevents future signatures under the same identity.

`AUVEN_PRIVY_APP_ID` is a public identifier. AUVEN verifies Privy's signed identity token on the server before granting workspace access. Linked EVM wallet addresses come from that verified token, never from editable browser state. The Supabase database is accessed only by the AUVEN server; its tables have RLS enabled and browser roles have no grants.
