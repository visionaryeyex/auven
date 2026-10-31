const { ContractFactory, JsonRpcProvider, Wallet } = require('ethers');
const { compile } = require('./compile-registry.cjs');

async function main() {
  const key = process.env.AUVEN_RH_PRIVATE_KEY;
  const rpcUrl = process.env.AUVEN_RH_RPC_URL;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key || '')) throw new Error('Set a dedicated AUVEN_RH_PRIVATE_KEY');
  if (!rpcUrl) throw new Error('Set AUVEN_RH_RPC_URL to a production endpoint');
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 4663) throw new Error('RPC is not Robinhood Chain (4663)');
  const signer = new Wallet(key, provider);
  if ((await provider.getBalance(signer.address)) === 0n) throw new Error('Dedicated signer needs ETH on Robinhood Chain for gas');
  const { abi, bytecode } = compile();
  const contract = await new ContractFactory(abi, bytecode, signer).deploy(signer.address);
  await contract.waitForDeployment();
  const transaction = contract.deploymentTransaction();
  console.log(JSON.stringify({ chain_id: 4663, publisher: signer.address, registry: await contract.getAddress(), tx_hash: transaction.hash }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
