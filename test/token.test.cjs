const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@solana/web3.js');
const Token = require('../token.cjs');

const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();

test('reads verified Solana wallets and keeps their observed slots', async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getGenesisHash') return Token.GENESIS;
    if (method === 'getTokenSupply') return { context: { slot: 100 }, value: { decimals: 6 } };
    const wallet = params[0];
    return { context: { slot: wallet === A ? 101 : 102 }, value: wallet === A ? [{ account: { data: { parsed: { info: { owner: A, mint, tokenAmount: { decimals: 6, amount: '1250000' } } } } } }] : [] };
  };
  const status = await Token.readWallets([A, B, A], rpc, mint);
  assert.equal(status.network, 'solana');
  assert.equal(status.slot, 102);
  assert.equal(status.wallets.length, 2);
  assert.equal(status.total_balance, '1.25');
  assert.equal(status.holder, true);
  assert.ok(calls.filter(call => call.method === 'getTokenAccountsByOwner').every(call => call.params[2].minContextSlot === 100));
});

test('rejects a wrong Solana network before reading the mint', async () => {
  const calls = [];
  await assert.rejects(Token.readWallets([A], async method => { calls.push(method); return 'wrong-genesis'; }, mint), /wrong_token_chain/);
  assert.deepEqual(calls, ['getGenesisHash']);
});

test('unconfigured mint never reads RPC or claims a holder balance', async () => {
  const status = await Token.readWallets([A], () => { throw Error('should_not_call_rpc'); }, '');
  assert.equal(status.configured, false);
  assert.deepEqual(status.wallets, []);
});
