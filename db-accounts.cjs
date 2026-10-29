const { randomBytes, createHash } = require('node:crypto');
const { getAddress, verifyMessage } = require('ethers');
const { pool } = require('./db-postgres.cjs');

const id = () => randomBytes(16).toString('hex');
const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');

async function resolveAccount(user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT account_id FROM account_auth_users WHERE auth_user_id=$1', [user.id]);
    if (current.rows[0]) { await client.query('COMMIT'); return current.rows[0].account_id; }

    let accountId;
    if (user.wallet) {
      const linked = await client.query('SELECT account_id FROM account_wallets WHERE address=$1', [user.wallet]);
      accountId = linked.rows[0]?.account_id;
    }
    if (!accountId) {
      accountId = id();
      await client.query('INSERT INTO accounts(id) VALUES($1)', [accountId]);
      if (user.wallet) await client.query(
        'INSERT INTO account_wallets(address,account_id) VALUES($1,$2) ON CONFLICT (address) DO NOTHING',
        [user.wallet, accountId]
      );
      if (user.wallet) {
        const linked = await client.query('SELECT account_id FROM account_wallets WHERE address=$1', [user.wallet]);
        accountId = linked.rows[0].account_id;
      }
    }
    await client.query('INSERT INTO account_auth_users(auth_user_id,account_id) VALUES($1,$2) ON CONFLICT (auth_user_id) DO NOTHING', [user.id, accountId]);
    const result = await client.query('SELECT account_id FROM account_auth_users WHERE auth_user_id=$1', [user.id]);
    await client.query('COMMIT');
    return result.rows[0].account_id;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function profile(accountId, user) {
  const [workspace, wallets] = await Promise.all([
    pool.query('SELECT id,name FROM workspaces WHERE account_id=$1 LIMIT 1', [accountId]),
    pool.query('SELECT address FROM account_wallets WHERE account_id=$1 ORDER BY created_at', [accountId])
  ]);
  return { account_id: accountId, email: user.email, wallets: wallets.rows.map(row => row.address), workspace: workspace.rows[0] || null };
}

async function workspaceForAccount(accountId) {
  return (await pool.query('SELECT id,name FROM workspaces WHERE account_id=$1 LIMIT 1', [accountId])).rows[0] || null;
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

async function createWalletChallenge(accountId, rawAddress, origin) {
  const address = getAddress(rawAddress).toLowerCase();
  const nonce = secret();
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  const message = [
    'Link this wallet to your AUVEN profile.',
    'Origin: ' + origin,
    'Account: ' + accountId,
    'Wallet: ' + address,
    'Robinhood Chain ID: 4663',
    'Nonce: ' + nonce,
    'Expires: ' + expires.toISOString()
  ].join('\n');
  await pool.query('INSERT INTO wallet_link_challenges(nonce,account_id,address,message,expires_at) VALUES($1,$2,$3,$4,$5)', [nonce, accountId, address, message, expires]);
  return { nonce, address, message, expires_at: expires.toISOString() };
}

async function linkWallet(accountId, nonce, signature) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const challenge = (await client.query(
      'SELECT address,message FROM wallet_link_challenges WHERE nonce=$1 AND account_id=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',
      [nonce, accountId]
    )).rows[0];
    if (!challenge) { await client.query('ROLLBACK'); return { error: 'invalid_or_expired_challenge' }; }
    let recovered;
    try { recovered = getAddress(verifyMessage(challenge.message, signature)).toLowerCase(); }
    catch { await client.query('ROLLBACK'); return { error: 'invalid_wallet_signature' }; }
    if (recovered !== challenge.address) { await client.query('ROLLBACK'); return { error: 'invalid_wallet_signature' }; }
    const existing = (await client.query('SELECT account_id FROM account_wallets WHERE address=$1', [recovered])).rows[0];
    if (existing && existing.account_id !== accountId) { await client.query('ROLLBACK'); return { error: 'wallet_already_linked' }; }
    await client.query('INSERT INTO account_wallets(address,account_id) VALUES($1,$2) ON CONFLICT (address) DO NOTHING', [recovered, accountId]);
    const linked = (await client.query('SELECT account_id FROM account_wallets WHERE address=$1', [recovered])).rows[0];
    if (linked?.account_id !== accountId) { await client.query('ROLLBACK'); return { error: 'wallet_already_linked' }; }
    await client.query('UPDATE wallet_link_challenges SET consumed_at=now() WHERE nonce=$1', [nonce]);
    await client.query('COMMIT');
    return { address: recovered };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

module.exports = { resolveAccount, profile, workspaceForAccount, createWorkspaceForAccount, claimWorkspace, createWalletChallenge, linkWallet };
