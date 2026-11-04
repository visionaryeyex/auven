CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, name text NOT NULL, admin_hash text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, purpose text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')), daily_limit integer NOT NULL CHECK (daily_limit >= 0), credential_hash text NOT NULL UNIQUE, created_at text NOT NULL);
CREATE TABLE IF NOT EXISTS marketplace_listings (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), agent_id text NOT NULL UNIQUE REFERENCES agents(id), category text NOT NULL, description text NOT NULL, passport text NOT NULL, created_at text NOT NULL);
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_listings FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS agents_workspace_idx ON agents(workspace_id);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS daily_request_limit integer NOT NULL DEFAULT 100 CHECK (daily_request_limit BETWEEN 0 AND 10000);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_tokens_per_request integer NOT NULL DEFAULT 4096 CHECK (max_tokens_per_request BETWEEN 1 AND 4096);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_last_seen timestamptz;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'external';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS instructions text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), agent_id text NOT NULL REFERENCES agents(id), request_id text NOT NULL, decision text NOT NULL, reason text NOT NULL, reserved integer NOT NULL DEFAULT 0, actual integer NOT NULL DEFAULT 0, created_at text NOT NULL, UNIQUE(agent_id,request_id));
CREATE INDEX IF NOT EXISTS events_workspace_time_idx ON events(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS events_agent_time_idx ON events(agent_id,created_at);
CREATE TABLE IF NOT EXISTS action_requests (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), agent_id text NOT NULL REFERENCES agents(id), event_id text NOT NULL UNIQUE REFERENCES events(id), messages_json text NOT NULL, max_tokens integer NOT NULL, status text NOT NULL CHECK (status IN ('pending','processing','completed','denied','failed')), result_json text, created_at text NOT NULL, decided_at text);
ALTER TABLE events ADD COLUMN IF NOT EXISTS model_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS model_tier text NOT NULL DEFAULT 'standard';
CREATE INDEX IF NOT EXISTS action_requests_workspace_time_idx ON action_requests(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS action_requests_agent_time_idx ON action_requests(agent_id,created_at DESC);
CREATE TABLE IF NOT EXISTS proofs (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), agent_id text NOT NULL REFERENCES agents(id), kind text NOT NULL, payload text NOT NULL, signature text NOT NULL, public_key text NOT NULL, created_at text NOT NULL, tx_hash text, chain_status text, chain_signer text, chain_network text NOT NULL DEFAULT 'solana');
CREATE INDEX IF NOT EXISTS proofs_workspace_time_idx ON proofs(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS proofs_agent_idx ON proofs(agent_id);
ALTER TABLE proofs ADD COLUMN IF NOT EXISTS chain_target text;
ALTER TABLE proofs ADD COLUMN IF NOT EXISTS chain_network text;
UPDATE proofs SET chain_network = 'robinhood' WHERE chain_network IS NULL AND tx_hash IS NOT NULL;
UPDATE proofs SET chain_network = 'solana' WHERE chain_network IS NULL;
ALTER TABLE proofs ALTER COLUMN chain_network SET DEFAULT 'solana';
ALTER TABLE proofs ALTER COLUMN chain_network SET NOT NULL;

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_auth_users (
  auth_user_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_auth_users_account_idx ON account_auth_users(account_id);
CREATE TABLE IF NOT EXISTS account_privy_users (
  privy_user_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_privy_users_did CHECK (privy_user_id LIKE 'did:privy:%')
);
CREATE INDEX IF NOT EXISTS account_privy_users_account_idx ON account_privy_users(account_id);
CREATE TABLE IF NOT EXISTS account_wallets (
  address text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_wallets_address_present CHECK (length(address) > 0)
);
ALTER TABLE account_wallets DROP CONSTRAINT IF EXISTS account_wallets_lowercase;
CREATE INDEX IF NOT EXISTS account_wallets_account_idx ON account_wallets(account_id);
CREATE TABLE IF NOT EXISTS wallet_link_challenges (
  nonce text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  address text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS wallet_link_challenges_expiry_idx ON wallet_link_challenges(expires_at);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS account_id text REFERENCES accounts(id);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_account_idx ON workspaces(account_id) WHERE account_id IS NOT NULL;

-- These tables are written by the AUVEN server, not the Supabase Data API.
-- The owner connection used by the server can still access them; browser roles
-- have no policies and, when present, no table privileges.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_privy_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_link_challenges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE workspaces, agents, events, action_requests, proofs, accounts, account_auth_users, account_privy_users, account_wallets, wallet_link_challenges FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE workspaces, agents, events, action_requests, proofs, accounts, account_auth_users, account_privy_users, account_wallets, wallet_link_challenges FROM authenticated;
  END IF;
END
$$;
