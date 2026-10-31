const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
const Auth = require('../auth.cjs');
const Accounts = require('../db-accounts.cjs');
const D = require('../db-postgres.cjs');
const Token = require('../token.cjs');
const Proof = require('../proof.cjs');
const { handler } = require('../api-handler.cjs');

const LINKED = '0x0000000000000000000000000000000000000001';
const SPOOFED = '0x0000000000000000000000000000000000000002';
const original = {
  userFromToken: Auth.userFromToken,
  resolveAccount: Accounts.resolveAccount,
  workspaceForAccount: Accounts.workspaceForAccount,
  agentOwned: D.agentOwned,
  createProof: D.createProof,
  readWallets: Token.readWallets,
  sign: Proof.sign
};

async function call(method, url, body) {
  let status, output;
  await handler({ method, url, headers: { authorization: 'Bearer verified-token' }, body }, {
    writeHead(code) { status = code; },
    end(text) { output = JSON.parse(text); }
  });
  return { status, ...output };
}

test('holder proof uses only the verified Privy wallet and an owned agent', async () => {
  const observed = [];
  let stored;
  Auth.userFromToken = async () => ({ id: 'did:privy:test', email: 'test@example.com', wallets: [LINKED] });
  Accounts.resolveAccount = async () => 'account-1';
  Accounts.workspaceForAccount = async () => ({ id: 'workspace-1' });
  D.agentOwned = async (_workspace, agent) => agent === 'agent-1';
  D.createProof = async (_workspace, _agent, kind, proof) => { stored = { kind, proof }; return 'proof-1'; };
  Token.readWallets = async wallets => {
    observed.push(wallets);
    return { holder: true, symbol: 'AUVEN', decimals: 18, chain_id: 4663, block_number: 123, checked_at: '2026-10-31T00:00:00Z', wallets: [{ address: LINKED, balance_raw: '1' }] };
  };
  Proof.sign = async payload => ({ algorithm: 'ML-DSA-65', payload });
  try {
    const forbidden = await call('POST', '/api/token/attest', { agent_id: 'other-agent', wallet: SPOOFED });
    assert.equal(forbidden.status, 404);
    assert.equal(observed.length, 0);
    const result = await call('POST', '/api/token/attest', { agent_id: 'agent-1', wallet: SPOOFED });
    assert.equal(result.status, 201);
    assert.deepEqual(observed, [[LINKED]]);
    assert.equal(stored.kind, 'token_holder');
    assert.equal(stored.proof.payload.wallet_address, LINKED);
    assert.equal(stored.proof.payload.agent_id, 'agent-1');
    assert.equal(stored.proof.payload.block_number, 123);
    Token.readWallets = async () => ({ holder: false, wallets: [], symbol: 'AUVEN' });
    const empty = await call('POST', '/api/token/attest', { agent_id: 'agent-1' });
    assert.equal(empty.status, 422);
    assert.equal(empty.error, 'token_balance_required');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (key === 'userFromToken') Auth[key] = value;
      else if (['resolveAccount', 'workspaceForAccount'].includes(key)) Accounts[key] = value;
      else if (['agentOwned', 'createProof'].includes(key)) D[key] = value;
      else if (key === 'readWallets') Token[key] = value;
      else Proof[key] = value;
    }
    await D.pool.end();
  }
});
