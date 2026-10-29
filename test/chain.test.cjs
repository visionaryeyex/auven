const {test}=require('node:test'),assert=require('node:assert/strict');const {commitment,calldata,verifyInclusion}=require('../chain.cjs');
const {Interface}=require('ethers');
test('commitment binds the entire PQ signed bundle',()=>{const bundle={algorithm:'ML-DSA-65',payload:{id:'a'},signature:'one'};assert.notEqual(commitment(bundle),commitment({...bundle,signature:'two'}));assert.match(calldata(bundle),/^0x415556454e31[0-9a-f]{64}$/)});
test('inclusion verifies chain, receipt, signer and exact input',async()=>{const proof={payload:{id:'a'},signature:'sig'};const hash='0x'+'a'.repeat(64);const tx={chainId:4663,from:'0x1111',to:'0x1111',data:calldata(proof)};const receipt={status:1,blockNumber:123};const rpc={getNetwork:async()=>({chainId:4663n}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt};assert.equal((await verifyInclusion(proof,hash,{rpc,expectedSigner:'0x1111'})).included,true);assert.equal((await verifyInclusion(proof,hash,{rpc:{...rpc,getTransaction:async()=>({...tx,data:'0xdead'})}})).reason,'commitment_mismatch');assert.equal((await verifyInclusion(proof,hash,{rpc:{...rpc,getTransactionReceipt:async()=>({...receipt,status:0})}})).reason,'transaction_failed');await assert.rejects(()=>verifyInclusion(proof,hash,{rpc:{...rpc,getNetwork:async()=>({chainId:46630n})}}),/wrong_chain/)});

test('registry inclusion requires exact call and matching emitted commitment',async()=>{
  const proof={payload:{id:'registry'},signature:'sig'};
  const publisher='0x1111111111111111111111111111111111111111';
  const registry='0x2222222222222222222222222222222222222222';
  const iface=new Interface(['function commit(bytes32 commitment)','event ProofCommitted(bytes32 indexed commitment,address indexed publisher)']);
  const event=iface.encodeEventLog('ProofCommitted',[commitment(proof),publisher]);
  const tx={chainId:4663,from:publisher,to:registry,data:iface.encodeFunctionData('commit',[commitment(proof)])};
  const receipt={status:1,blockNumber:456,logs:[{address:registry,...event}]};
  const rpc={getNetwork:async()=>({chainId:4663n}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt};
  const opts={rpc,expectedSigner:publisher,expectedTarget:registry};
  assert.equal((await verifyInclusion(proof,'0x'+'a'.repeat(64),opts)).included,true);
  assert.equal((await verifyInclusion(proof,'0x'+'a'.repeat(64),{...opts,expectedTarget:publisher})).reason,'unexpected_recipient');
  assert.equal((await verifyInclusion(proof,'0x'+'a'.repeat(64),{...opts,rpc:{...rpc,getTransactionReceipt:async()=>({...receipt,logs:[]})}})).reason,'registry_event_missing');
  assert.equal((await verifyInclusion(proof,'0x'+'a'.repeat(64),{...opts,rpc:{...rpc,getTransaction:async()=>({...tx,data:'0xdead'})}})).reason,'commitment_mismatch');
});
