const { PublicKey } = require('@solana/web3.js');

const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const RPC_URL = process.env.AUVEN_SOLANA_RPC_URL || 'https://api.mainnet.solana.com';
const MINT = process.env.AUVEN_SOLANA_TOKEN_MINT || '';

function address(value) {
  try { const key = new PublicKey(value); if (key.toBase58() === value) return value; } catch {}
  throw Error('invalid_solana_address');
}
function configured() { return Boolean(MINT); }
function format(raw, decimals) {
  const digits = BigInt(raw).toString().padStart(decimals + 1, '0');
  if (!decimals) return digits;
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
async function rpc(method, params = [], url = RPC_URL) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error('token_rpc_unavailable');
  const result = await response.json();
  if (result.error || result.result == null) throw Error('token_rpc_unavailable');
  return result.result;
}
async function readWallets(addresses, call = rpc, mint = MINT) {
  if (!mint) return { configured: false, network: 'solana', symbol: 'AUVEN', wallets: [] };
  address(mint);
  if (!Array.isArray(addresses) || addresses.length > 25) throw Error('invalid_wallets');
  const wallets = [...new Set(addresses)].map(value => address(value));
  if (await call('getGenesisHash') !== GENESIS) throw Error('wrong_token_chain');
  const supply = await call('getTokenSupply', [mint, { commitment: 'finalized' }]);
  const decimals = supply?.value?.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw Error('invalid_token_mint');
  const balances = await Promise.all(wallets.map(async wallet => {
    const response = await call('getTokenAccountsByOwner', [wallet, { mint }, { encoding: 'jsonParsed', commitment: 'finalized', minContextSlot: supply.context.slot }]);
    if (!Array.isArray(response?.value) || !Number.isInteger(response?.context?.slot)) throw Error('invalid_token_response');
    const raw = response.value.reduce((total, item) => {
      const info = item?.account?.data?.parsed?.info;
      if (info?.owner !== wallet || info?.mint !== mint || info?.tokenAmount?.decimals !== decimals || !/^\d+$/.test(info?.tokenAmount?.amount || '')) throw Error('invalid_token_response');
      return total + BigInt(info.tokenAmount.amount);
    }, 0n);
    return { address: wallet, balance_raw: raw.toString(), balance: format(raw, decimals), slot: response.context.slot };
  }));
  const total = balances.reduce((sum, item) => sum + BigInt(item.balance_raw), 0n);
  return { configured: true, network: 'solana', token_mint: mint, symbol: 'AUVEN', decimals, slot: Math.max(supply.context.slot, ...balances.map(item => item.slot)), checked_at: new Date().toISOString(), total_balance_raw: total.toString(), total_balance: format(total, decimals), holder: total > 0n, wallets: balances };
}
module.exports = { GENESIS, RPC_URL, MINT, configured, address, format, readWallets };
