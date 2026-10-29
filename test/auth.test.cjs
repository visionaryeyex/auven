const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.AUVEN_SUPABASE_URL = 'https://example.supabase.co';
process.env.AUVEN_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
const Auth = require('../auth.cjs');

const id = '7e91a8be-45be-42f8-a3c7-feb4c83286e2';
const address = '0x1234567890123456789012345678901234567890';
const verifiedWallet = {
  provider: 'web3',
  identity_data: { chain: 'ethereum', network: '4663', address }
};

test('wallet access uses verified Supabase identity on Robinhood Chain', () => {
  assert.equal(Auth.walletIdentity({ identities: [verifiedWallet] }), address);
  assert.equal(Auth.walletIdentity({ identities: [{ ...verifiedWallet, identity_data: { ...verifiedWallet.identity_data, network: '1' } }] }), null);
  assert.equal(Auth.walletIdentity({ user_metadata: { address }, identities: [] }), null);
});

test('server rejects unverified email and unsupported wallet identity', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ id, email: 'test@example.com', email_confirmed_at: null, identities: [] }) });
    assert.equal(await Auth.userFromToken('one.two.three'), null);
    global.fetch = async () => ({ ok: true, json: async () => ({ id, email: 'test@example.com', email_confirmed_at: '2026-10-29T00:00:00Z', identities: [] }) });
    assert.equal((await Auth.userFromToken('one.two.three')).email, 'test@example.com');
  } finally { global.fetch = originalFetch; }
});
