const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.AUVEN_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'auven-market-'));process.env.AUVEN_SETUP_TOKEN='market-test-setup';
const {handler}=require('../api-handler.cjs');
async function call(method,url,payload,token){let status,data;await handler({method,url,body:payload,headers:{'x-setup-token':'market-test-setup',...(token?{authorization:'Bearer '+token}:{})}},{writeHead(code){status=code},end(value){data=JSON.parse(value)}});return {status,...data}}
test('listing is opt-in, owned and signed; private agent details do not enter the catalogue',async()=>{
  const owner=await call('POST','/api/workspaces',{name:'Owner workspace'}),other=await call('POST','/api/workspaces',{name:'Other workspace'});
  const agent=await call('POST','/api/agents',{kind:'hosted',name:'Research agent',purpose:'Research documents',instructions:'PRIVATE instructions that must never be published.',daily_limit_cents:100},owner.admin_token);
  assert.equal(agent.status,201);
  const payload={agent_id:agent.agent.id,category:'Research',description:'Summarizes provided research notes.'};
  assert.equal((await call('POST','/api/marketplace',payload,other.admin_token)).status,404);
  const created=await call('POST','/api/marketplace',payload,owner.admin_token);assert.equal(created.status,201);
  assert.equal((await call('POST','/api/verify',created.passport)).signature_valid,true);
  assert.equal((await call('POST','/api/marketplace',payload,owner.admin_token)).status,409);
  const list=await call('GET','/api/marketplace');assert.equal(list.listings.length,1);
  const serialized=JSON.stringify(list);assert.equal(serialized.includes('PRIVATE instructions'),false);assert.equal(serialized.includes(agent.agent.credential),false);assert.equal(serialized.includes(owner.admin_token),false);assert.equal(serialized.includes(owner.id),false);
  assert.equal((await call('DELETE','/api/marketplace/'+created.id,null,other.admin_token)).status,404);
  assert.equal((await call('DELETE','/api/marketplace/'+created.id,null,owner.admin_token)).status,200);
  assert.equal((await call('GET','/api/marketplace')).listings.length,0);
});
