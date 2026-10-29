const {createHash}=require('node:crypto');
const {JsonRpcProvider,Wallet}=require('ethers');

const CHAIN_ID=4663;
const RPC_URL=process.env.AUVEN_RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const MARKER=Buffer.from('AUVEN1','ascii');
const HEX32=/^0x[0-9a-fA-F]{64}$/;
const HEX_TX=/^0x[0-9a-fA-F]{64}$/;

function commitment(bundle){
  if(!bundle||typeof bundle!=='object')throw Error('invalid_proof');
  return '0x'+createHash('sha256').update(Buffer.from('AUVEN-PROOF-v1\0'+JSON.stringify(bundle))).digest('hex');
}
function calldata(bundle){return '0x'+Buffer.concat([MARKER,Buffer.from(commitment(bundle).slice(2),'hex')]).toString('hex')}
function config(){const key=process.env.AUVEN_RH_PRIVATE_KEY;return {configured:!!key,rpc_url:RPC_URL,chain_id:CHAIN_ID}}
function provider(){return new JsonRpcProvider(RPC_URL)}
async function assertChain(rpc){const network=await rpc.getNetwork();if(Number(network.chainId)!==CHAIN_ID)throw Error('wrong_chain');return network}
async function publish(bundle,{rpc=provider(),key=process.env.AUVEN_RH_PRIVATE_KEY}={}){
  if(!key)throw Error('mainnet_signer_not_configured');
  await assertChain(rpc);
  const signer=new Wallet(key,rpc);
  const tx=await signer.sendTransaction({to:signer.address,value:0n,data:calldata(bundle),chainId:CHAIN_ID});
  return {tx_hash:tx.hash,signer:signer.address,commitment:commitment(bundle),status:'pending'};
}
async function verifyInclusion(bundle,txHash,{rpc=provider(),expectedSigner}={}){
  if(!HEX_TX.test(txHash||''))return {included:false,reason:'invalid_transaction_hash'};
  if(!HEX32.test(commitment(bundle)))return {included:false,reason:'invalid_commitment'};
  await assertChain(rpc);
  const [tx,receipt]=await Promise.all([rpc.getTransaction(txHash),rpc.getTransactionReceipt(txHash)]);
  if(!tx||!receipt)return {included:false,reason:'pending_or_missing'};
  if(receipt.status!==1)return {included:false,reason:'transaction_failed'};
  if(Number(tx.chainId)!==CHAIN_ID)return {included:false,reason:'wrong_chain'};
  if(!tx.from||!tx.to||tx.from.toLowerCase()!==tx.to.toLowerCase())return {included:false,reason:'unexpected_recipient'};
  if(expectedSigner&&tx.from.toLowerCase()!==expectedSigner.toLowerCase())return {included:false,reason:'unexpected_signer'};
  if(tx.data.toLowerCase()!==calldata(bundle).toLowerCase())return {included:false,reason:'commitment_mismatch'};
  return {included:true,chain_id:CHAIN_ID,block_number:receipt.blockNumber,tx_hash:txHash,signer:tx.from,commitment:commitment(bundle)};
}
module.exports={CHAIN_ID,config,commitment,calldata,publish,verifyInclusion};
