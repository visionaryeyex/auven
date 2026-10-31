const {createHash}=require('node:crypto');
const {JsonRpcProvider,Wallet,Interface,getAddress}=require('ethers');

const CHAIN_ID=4663;
const RPC_URL=process.env.AUVEN_RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const MARKER=Buffer.from('AUVEN1','ascii');
const HEX32=/^0x[0-9a-fA-F]{64}$/;
const HEX_TX=/^0x[0-9a-fA-F]{64}$/;
const HEX_ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const REGISTRY_INTERFACE=new Interface(['function commit(bytes32 commitment)','event ProofCommitted(bytes32 indexed commitment,address indexed publisher)']);

function commitment(bundle){
  if(!bundle||typeof bundle!=='object')throw Error('invalid_proof');
  return '0x'+createHash('sha256').update(Buffer.from('AUVEN-PROOF-v1\0'+JSON.stringify(bundle))).digest('hex');
}
function calldata(bundle){return '0x'+Buffer.concat([MARKER,Buffer.from(commitment(bundle).slice(2),'hex')]).toString('hex')}
function config(){const key=process.env.AUVEN_RH_PRIVATE_KEY,registry=process.env.AUVEN_RH_REGISTRY_ADDRESS;return {configured:!!key,rpc_url:RPC_URL,chain_id:CHAIN_ID,registry:registry||null,mode:registry?'registry':'transaction'}}
function provider(){return new JsonRpcProvider(RPC_URL)}
async function assertChain(rpc){const network=await rpc.getNetwork();if(Number(network.chainId)!==CHAIN_ID)throw Error('wrong_chain');return network}
async function publish(bundle,{rpc=provider(),key=process.env.AUVEN_RH_PRIVATE_KEY}={}){
  if(!key)throw Error('chain_signer_not_configured');
  await assertChain(rpc);
  const signer=new Wallet(key,rpc);
  const registry=process.env.AUVEN_RH_REGISTRY_ADDRESS;
  if(registry&&!HEX_ADDRESS.test(registry))throw Error('invalid_registry_address');
  const target=registry?getAddress(registry):signer.address;
  const data=registry?REGISTRY_INTERFACE.encodeFunctionData('commit',[commitment(bundle)]):calldata(bundle);
  const tx=await signer.sendTransaction({to:target,value:0n,data,chainId:CHAIN_ID});
  return {tx_hash:tx.hash,signer:signer.address,target,commitment:commitment(bundle),status:'pending'};
}
async function verifyInclusion(bundle,txHash,{rpc=provider(),expectedSigner,expectedTarget}={}){
  if(!HEX_TX.test(txHash||''))return {included:false,reason:'invalid_transaction_hash'};
  if(!HEX32.test(commitment(bundle)))return {included:false,reason:'invalid_commitment'};
  await assertChain(rpc);
  const [tx,receipt]=await Promise.all([rpc.getTransaction(txHash),rpc.getTransactionReceipt(txHash)]);
  if(!tx||!receipt)return {included:false,reason:'pending_or_missing'};
  if(receipt.status!==1)return {included:false,reason:'transaction_failed'};
  if(Number(tx.chainId)!==CHAIN_ID)return {included:false,reason:'wrong_chain'};
  if(!tx.from||!tx.to)return {included:false,reason:'unexpected_recipient'};
  if(expectedSigner&&tx.from.toLowerCase()!==expectedSigner.toLowerCase())return {included:false,reason:'unexpected_signer'};
  const target=expectedTarget||tx.from;
  if(tx.to.toLowerCase()!==target.toLowerCase())return {included:false,reason:'unexpected_recipient'};
  if(target.toLowerCase()===tx.from.toLowerCase()){
    if(tx.data.toLowerCase()!==calldata(bundle).toLowerCase())return {included:false,reason:'commitment_mismatch'};
  }else{
    if(tx.data.toLowerCase()!==REGISTRY_INTERFACE.encodeFunctionData('commit',[commitment(bundle)]).toLowerCase())return {included:false,reason:'commitment_mismatch'};
    const event=(receipt.logs||[]).some(log=>{try{const parsed=REGISTRY_INTERFACE.parseLog(log);return log.address.toLowerCase()===target.toLowerCase()&&parsed?.name==='ProofCommitted'&&parsed.args.commitment.toLowerCase()===commitment(bundle).toLowerCase()&&parsed.args.publisher.toLowerCase()===tx.from.toLowerCase()}catch{return false}});
    if(!event)return {included:false,reason:'registry_event_missing'};
  }
  return {included:true,chain_id:CHAIN_ID,block_number:receipt.blockNumber,tx_hash:txHash,signer:tx.from,target:tx.to,commitment:commitment(bundle)};
}
module.exports={CHAIN_ID,config,commitment,calldata,publish,verifyInclusion};
