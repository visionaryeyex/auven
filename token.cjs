const { Interface, getAddress, formatUnits } = require('ethers');

const CHAIN_ID = 4663;
const ADDRESS = getAddress('0x6e6e172ad5d06f6ca79f9c9b355fd8cdc2afb64d');
const EXPLORER = `https://robinhoodchain.blockscout.com/token/${ADDRESS}`;
const ABI = new Interface(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)']);
const RPC_URL = process.env.AUVEN_RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';

async function rpc(method, params = [], url = RPC_URL) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error('token_rpc_unavailable');
  const result = await response.json();
  if (result.error || typeof result.result !== 'string') throw Error('token_rpc_unavailable');
  return result.result;
}

async function readWallets(addresses, call = rpc) {
  if (!Array.isArray(addresses) || addresses.length > 25) throw Error('invalid_wallets');
  const wallets = [...new Set(addresses.map(address => getAddress(address.toLowerCase())))];
  if (!wallets.length) return { chain_id: CHAIN_ID, token_address: ADDRESS, symbol: 'AUVEN', decimals: 18, block_number: null, checked_at: null, total_balance_raw: '0', total_balance: '0.0', holder: false, wallets: [] };

  const chain = Number(BigInt(await call('eth_chainId')));
  if (chain !== CHAIN_ID) throw Error('wrong_token_chain');
  const block = await call('eth_blockNumber');
  const [symbolRaw, decimalsRaw] = await Promise.all([
    call('eth_call', [{ to: ADDRESS, data: ABI.encodeFunctionData('symbol') }, block]),
    call('eth_call', [{ to: ADDRESS, data: ABI.encodeFunctionData('decimals') }, block])
  ]);
  const symbol = ABI.decodeFunctionResult('symbol', symbolRaw)[0];
  const decimals = Number(ABI.decodeFunctionResult('decimals', decimalsRaw)[0]);
  if (symbol !== 'AUVEN' || decimals !== 18) throw Error('unexpected_token_contract');

  const balances = await Promise.all(wallets.map(async address => {
    const raw = ABI.decodeFunctionResult('balanceOf', await call('eth_call', [{ to: ADDRESS, data: ABI.encodeFunctionData('balanceOf', [address]) }, block]))[0];
    return { address, balance_raw: raw.toString(), balance: formatUnits(raw, decimals) };
  }));
  const total = balances.reduce((sum, wallet) => sum + BigInt(wallet.balance_raw), 0n);
  return { chain_id: CHAIN_ID, token_address: ADDRESS, symbol, decimals, block_number: Number(BigInt(block)), checked_at: new Date().toISOString(), total_balance_raw: total.toString(), total_balance: formatUnits(total, decimals), holder: total > 0n, wallets: balances };
}

module.exports = { CHAIN_ID, ADDRESS, EXPLORER, readWallets };
