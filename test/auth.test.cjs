const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.AUVEN_PRIVY_APP_ID = 'test-app-id';
process.env.AUVEN_PRIVY_APP_SECRET = 'test-secret';
const Auth = require('../auth.cjs');

const address = '0x1234567890123456789012345678901234567890';

test('Privy identities include only verified EVM wallet and email linked accounts', () => {
  assert.deepEqual(Auth.identities({ linkedAccounts: [
    { type: 'email', address: 'test@example.com' },
    { type: 'wallet', chainType: 'ethereum', address },
    { type: 'wallet', chainType: 'solana', address: 'solana-address' },
    { type: 'wallet', chainType: 'ethereum', address: 'bad-address' }
  ] }), { email: 'test@example.com', wallets: [address] });
  assert.deepEqual(Auth.identities({ linkedAccounts: [] }), { email: null, wallets: [] });
});

test('public auth config never exposes the Privy app secret', () => {
  assert.deepEqual(Auth.publicConfig(), { enabled: true, appId: 'test-app-id', chainId: 4663 });
  assert.equal(JSON.stringify(Auth.publicConfig()).includes('test-secret'), false);
});

test('server rejects missing and malformed identity tokens before any Privy request', async () => {
  assert.equal(await Auth.userFromToken(''), null);
  assert.equal(await Auth.userFromToken('not-a-jwt'), null);
});

test('access token fallback verifies the session before loading linked accounts', async () => {
  const calls = [];
  const sdk = {
    users: () => ({
      get: async () => { calls.push('identity'); throw Error('not an identity token'); },
      _get: async id => { calls.push('lookup:' + id); return { id, linked_accounts: [{ type: 'email', address: 'test@example.com' }] }; }
    }),
    utils: () => ({ auth: () => ({
      verifyAccessToken: async () => { calls.push('verify'); return { user_id: 'did:privy:abc123' }; }
    }) })
  };
  assert.deepEqual(await Auth.userFromToken('header.payload.signature', sdk), {
    id: 'did:privy:abc123', email: 'test@example.com', wallets: []
  });
  assert.deepEqual(calls, ['identity', 'verify', 'lookup:did:privy:abc123']);
});

test('unverified access tokens cannot trigger a Privy user lookup', async () => {
  let lookedUp = false;
  const sdk = {
    users: () => ({
      get: async () => { throw Error('not an identity token'); },
      _get: async () => { lookedUp = true; }
    }),
    utils: () => ({ auth: () => ({ verifyAccessToken: async () => { throw Error('invalid signature'); } }) })
  };
  assert.equal(await Auth.userFromToken('header.payload.signature', sdk), null);
  assert.equal(lookedUp, false);
});
