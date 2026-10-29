CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, name text NOT NULL, admin_hash text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, purpose text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')), daily_limit integer NOT NULL CHECK (daily_limit >= 0), credential_hash text NOT NULL UNIQUE, created_at text NOT NULL);
CREATE INDEX IF NOT EXISTS agents_workspace_idx ON agents(workspace_id);
CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), agent_id text NOT NULL REFERENCES agents(id), request_id text NOT NULL, decision text NOT NULL, reason text NOT NULL, reserved integer NOT NULL DEFAULT 0, actual integer NOT NULL DEFAULT 0, created_at text NOT NULL, UNIQUE(agent_id,request_id));
CREATE INDEX IF NOT EXISTS events_workspace_time_idx ON events(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS events_agent_time_idx ON events(agent_id,created_at);
CREATE TABLE IF NOT EXISTS proofs (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), agent_id text NOT NULL REFERENCES agents(id), kind text NOT NULL, payload text NOT NULL, signature text NOT NULL, public_key text NOT NULL, created_at text NOT NULL, tx_hash text, chain_status text, chain_signer text);
CREATE INDEX IF NOT EXISTS proofs_workspace_time_idx ON proofs(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS proofs_agent_idx ON proofs(agent_id);

-- These tables are written by the AUVEN server, not the Supabase Data API.
-- The owner connection used by the server can still access them; browser roles
-- have no policies and, when present, no table privileges.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE proofs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE workspaces, agents, events, proofs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE workspaces, agents, events, proofs FROM authenticated;
  END IF;
END
$$;
