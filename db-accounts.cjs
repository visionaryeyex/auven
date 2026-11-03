const { randomBytes, createHash } = require('node:crypto');
const { pool } = require('./db-postgres.cjs');

const id = () => randomBytes(16).toString('hex');
const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');

async function resolveAccount(user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT account_id FROM account_privy_users WHERE privy_user_id=$1', [user.id]);
    if (current.rows[0]) { await client.query('COMMIT'); return current.rows[0].account_id; }

    let accountId;
    const addresses = user.wallets || [];
    if (addresses.length) {
      const linked = await client.query('SELECT account_id FROM account_wallets WHERE address=ANY($1) LIMIT 1', [addresses]);
      accountId = linked.rows[0]?.account_id;
    }
    if (!accountId) {
      accountId = id();
      await client.query('INSERT INTO accounts(id) VALUES($1)', [accountId]);
    }
    await client.query('INSERT INTO account_privy_users(privy_user_id,account_id) VALUES($1,$2) ON CONFLICT (privy_user_id) DO NOTHING', [user.id, accountId]);
    const result = await client.query('SELECT account_id FROM account_privy_users WHERE privy_user_id=$1', [user.id]);
    for (const address of addresses) await client.query(
      'INSERT INTO account_wallets(address,account_id) VALUES($1,$2) ON CONFLICT (address) DO NOTHING',
      [address, result.rows[0].account_id]
    );
    await client.query('COMMIT');
    return result.rows[0].account_id;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function profile(accountId, user) {
  const workspace = await pool.query('SELECT id,name FROM workspaces WHERE account_id=$1 LIMIT 1', [accountId]);
  return { account_id: accountId, email: user.email, wallets: user.wallets, workspace: workspace.rows[0] || null };
}

async function workspaceForAccount(accountId) {
  return (await pool.query('SELECT id,name FROM workspaces WHERE account_id=$1 LIMIT 1', [accountId])).rows[0] || null;
}

async function privyIdsForWorkspace(workspaceId) {
  const result = await pool.query('SELECT p.privy_user_id FROM account_privy_users p JOIN workspaces w ON w.account_id=p.account_id WHERE w.id=$1', [workspaceId]);
  return result.rows.map(row => row.privy_user_id);
}

async function createWorkspaceForAccount(accountId, name) {
  const token = secret();
  const row = { id: id(), name, account_id: accountId };
  await pool.query('INSERT INTO workspaces(id,name,admin_hash,account_id) VALUES($1,$2,$3,$4)', [row.id, name, hash(token), accountId]);
  return { ...row, admin_token: token };
}

async function claimWorkspace(accountId, adminToken) {
  const result = await pool.query('UPDATE workspaces SET account_id=$1 WHERE admin_hash=$2 AND account_id IS NULL RETURNING id,name', [accountId, hash(adminToken)]);
  return result.rows[0] || null;
}

async function rotateWorkspaceToken(accountId) {
  const token = secret();
  const result = await pool.query('UPDATE workspaces SET admin_hash=$1 WHERE account_id=$2 RETURNING id', [hash(token), accountId]);
  return result.rowCount ? token : null;
}

module.exports = { resolveAccount, profile, workspaceForAccount, privyIdsForWorkspace, createWorkspaceForAccount, claimWorkspace, rotateWorkspaceToken };
