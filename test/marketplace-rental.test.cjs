const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.AUVEN_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'auven-rental-'));
process.env.AUVEN_SETUP_TOKEN='test-setup';process.env.AUVEN_OPENAI_API_KEY='test';process.env.AUVEN_MARKETPLACE_EXECUTION='enabled';
const {handler}=require('../api-handler.cjs');
async function call(method,url,payload,token,key){let status,data;await handler({method,url,body:payload,headers:{'x-setup-token':'test-setup',...(token?{authorization:'Bearer '+token}:{}),...(key?{'idempotency-key':key}:{})}},{writeHead(code){status=code},end(value){data=JSON.parse(value)}});return {http:status,data}}
test('rental requires consent and enforces owner and renter limits with scoped idempotency',async()=>{
  const owner=(await call('POST','/api/workspaces',{name:'Owner'})).data,renter=(await call('POST','/api/workspaces',{name:'Renter'})).data,other=(await call('POST','/api/workspaces',{name:'Other'})).data;
  const agent=(await call('POST','/api/agents',{kind:'hosted',name:'Research agent',purpose:'Summarize text',instructions:'Use only supplied text and provide a concise summary.',daily_limit_cents:100},owner.admin_token)).data.agent;
  const listing=(await call('POST','/api/marketplace',{agent_id:agent.id,category:'Research',description:'Summarizes research notes.'},owner.admin_token)).data;
  const access=(await call('POST','/api/marketplace/'+listing.id+'/access',{},renter.admin_token)).data;
  const url='/api/marketplace/access/'+access.id,body={prompt:'Summarize this text',max_tokens:100};
  process.env.AUVEN_MARKETPLACE_EXECUTION='disabled';assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0001')).data.error,'marketplace_execution_unavailable');process.env.AUVEN_MARKETPLACE_EXECUTION='enabled';
  assert.equal((await call('POST',url+'/run',body,other.admin_token,'request-0001')).data.error,'access_unavailable');
  assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0001')).data.error,'access_unavailable');
  await call('POST',url,{decision:'approve'},owner.admin_token);
  assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0001')).data.error,'renter_limit_exceeded');
  assert.equal((await call('POST',url+'/limits',{daily_limit_cents:20,daily_request_limit:1},other.admin_token)).http,404);
  await call('POST',url+'/limits',{daily_limit_cents:20,daily_request_limit:1},renter.admin_token);
  const originalFetch=global.fetch;let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'Summary'}}],usage:{total_tokens:25}})}};
  try{
    const completed=await call('POST',url+'/run',body,renter.admin_token,'request-0001');assert.equal(completed.http,200);
    assert.equal((await call('DELETE','/api/marketplace/'+listing.id,null,owner.admin_token)).http,409);
    assert.equal(completed.data.receipt.payload.type,'marketplace_usage_receipt');assert.equal((await call('POST','/api/verify',completed.data.receipt)).data.signature_valid,true);
    assert.equal(JSON.stringify(completed.data.receipt).includes(body.prompt),false);
    assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0001')).data.error,'duplicate_request');
    assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0002')).data.error,'renter_limit_exceeded');
    assert.equal(calls,1);
    await call('POST',url+'/limits',{daily_limit_cents:1000,daily_request_limit:100},renter.admin_token);
    await call('PATCH','/api/agents/'+agent.id+'/policy',{daily_limit_cents:20,daily_request_limit:100,max_tokens_per_request:4096,approval_required:false},owner.admin_token);
    assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-owner-limit')).data.error,'owner_limit_exceeded');
    await call('PATCH','/api/agents/'+agent.id+'/policy',{daily_limit_cents:100,daily_request_limit:100,max_tokens_per_request:4096,approval_required:true},owner.admin_token);
    assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0003')).data.error,'owner_approval_not_supported');
    await call('POST',url,{decision:'revoke'},owner.admin_token);
    assert.equal((await call('POST',url+'/run',body,renter.admin_token,'request-0004')).data.error,'access_unavailable');
    await call('POST','/api/marketplace/'+listing.id+'/access',{},renter.admin_token);await call('POST',url,{decision:'approve'},owner.admin_token);
    const renewed=(await call('GET','/api/marketplace/access',null,renter.admin_token)).data.requests[0];assert.equal(renewed.daily_limit,0);assert.equal(renewed.daily_request_limit,0);assert.equal(renewed.counterparty,'Owner');
  }finally{global.fetch=originalFetch}
});
