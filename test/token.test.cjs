const test = require('node:test');
const assert = require('node:assert/strict');
const { Interface, getAddress } = require('ethers');
const Token = require('../token.cjs');

const ABI = new Interface(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)']);
const A = getAddress('0x0000000000000000000000000000000000000001');
const B = getAddress('0x0000000000000000000000000000000000000002');

test('reads linked token balances at one Robinhood Chain block', async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_blockNumber') return '0x100';
    const selector = params[0].data.slice(0, 10);
    if (selector === ABI.getFunction('symbol').selector) return ABI.encodeFunctionResult('symbol', ['AUVEN']);
    if (selector === ABI.getFunction('decimals').selector) return ABI.encodeFunctionResult('decimals', [18]);
    if (selector === ABI.getFunction('balanceOf').selector) return ABI.encodeFunctionResult('balanceOf', [params[0].data.endsWith('1') ? 1250000000000000000n : 0n]);
    throw Error('unexpected_call');
  };
  const status = await Token.readWallets([A, B, A], rpc);
  assert.equal(status.chain_id, 4663);
  assert.equal(status.block_number, 256);
  assert.equal(status.wallets.length, 2);
  assert.equal(status.total_balance, '1.25');
  assert.equal(status.holder, true);
  assert.ok(calls.filter(call => call.method === 'eth_call').every(call => call.params[1] === '0x100'));
  assert.ok(calls.filter(call => call.method === 'eth_call').every(call => call.params[0].to === Token.ADDRESS));
});

test('rejects a wrong chain before reading any token contract state', async () => {
  const calls = [];
  await assert.rejects(Token.readWallets([A], async method => { calls.push(method); return '0x1'; }), /wrong_token_chain/);
  assert.deepEqual(calls, ['eth_chainId']);
});

test('an unlinked profile has no holder status and makes no RPC calls', async () => {
  const status = await Token.readWallets([], () => { throw Error('should_not_call_rpc'); });
  assert.equal(status.holder, false);
  assert.equal(status.total_balance_raw, '0');
  assert.equal(status.block_number, null);
});
