const test = require('node:test');
const assert = require('node:assert/strict');
const Holder = require('../holder-access.cjs');

test('holder eligibility uses raw token units and stays off without both settings', () => {
  const previous = { minimum: process.env.AUVEN_HOLDER_MIN_TOKENS, model: process.env.AUVEN_HOLDER_MODEL, multiplier: process.env.AUVEN_HOLDER_ESTIMATE_MULTIPLIER };
  try {
    delete process.env.AUVEN_HOLDER_MIN_TOKENS;
    process.env.AUVEN_HOLDER_MODEL = 'approved-model';
    assert.equal(Holder.config().enabled, false);
    process.env.AUVEN_HOLDER_MIN_TOKENS = '12.5';
    process.env.AUVEN_HOLDER_ESTIMATE_MULTIPLIER = '2';
    assert.equal(Holder.rawMinimum('12.5', 6), 12500000n);
    assert.equal(Holder.evaluate({ total_balance_raw: '12499999', decimals: 6 }).eligible, false);
    assert.equal(Holder.evaluate({ total_balance_raw: '12500000', decimals: 6 }).eligible, true);
    assert.throws(() => Holder.rawMinimum('0.0000001', 6), /invalid_holder_minimum/);
  } finally {
    for (const [key, value] of Object.entries({ AUVEN_HOLDER_MIN_TOKENS: previous.minimum, AUVEN_HOLDER_MODEL: previous.model, AUVEN_HOLDER_ESTIMATE_MULTIPLIER: previous.multiplier })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('workspace holder lookup uses current Privy-linked wallets, not request-provided addresses', async () => {
  const previous = { minimum: process.env.AUVEN_HOLDER_MIN_TOKENS, model: process.env.AUVEN_HOLDER_MODEL, multiplier: process.env.AUVEN_HOLDER_ESTIMATE_MULTIPLIER };
  process.env.AUVEN_HOLDER_MIN_TOKENS = '10';
  process.env.AUVEN_HOLDER_MODEL = 'approved-model';
  process.env.AUVEN_HOLDER_ESTIMATE_MULTIPLIER = '2';
  const calls = [];
  try {
    const result = await Holder.forWorkspace('workspace-1',
      { privyIdsForWorkspace: async id => { assert.equal(id, 'workspace-1'); return ['did:privy:owner']; } },
      { walletsForUser: async id => { assert.equal(id, 'did:privy:owner'); return ['verified-wallet']; } },
      { readWallets: async wallets => { calls.push(wallets); return { total_balance_raw: '10000000', total_balance: '10', decimals: 6, slot: 123 }; } }
    );
    assert.equal(result.eligible, true);
    assert.deepEqual(calls, [['verified-wallet']]);
  } finally {
    for (const [key, value] of Object.entries({ AUVEN_HOLDER_MIN_TOKENS: previous.minimum, AUVEN_HOLDER_MODEL: previous.model, AUVEN_HOLDER_ESTIMATE_MULTIPLIER: previous.multiplier })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
