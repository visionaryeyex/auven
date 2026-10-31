const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');process.env.AUVEN_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'auven-api-'));process.env.AUVEN_OPENAI_API_KEY='test-only-key';delete process.env.AUVEN_MODEL;const {handler}=require('../api-handler.cjs');
async function call(method,url,payload,token,headers={}){let status,output;const req={method,url,headers:{...headers,...(token?{authorization:'Bearer '+token}:{})},body:payload};const res={writeHead(n){status=n},end(s){output=JSON.parse(s)}};await handler(req,res);return {status,...output}}
let workspace;
test('API registers workspace and agent, signs passport, scopes proofs, stops agent',async()=>{const w=await call('POST','/api/workspaces',{name:'Test workspace'});assert.equal(w.status,201);workspace=w;const a=await call('POST','/api/agents',{name:'Existing bot',purpose:'Research',daily_limit_cents:100},w.admin_token);assert.equal(a.status,201);assert.equal(a.passport.algorithm,'ML-DSA-65');const list=await call('GET','/api/proofs',null,w.admin_token);assert.equal(list.proofs.length,1);const verify=await call('POST','/api/verify',a.passport);assert.equal(verify.signature_valid,true);const status=await call('PATCH',`/api/agents/${a.agent.id}/status`,{status:'stopped'},w.admin_token);assert.equal(status.status,'stopped');const pub=await call('POST',`/api/proofs/${list.proofs[0].id}/publish`,null,w.admin_token);assert.equal(pub.error,'chain_signer_not_configured')});
test('gateway forwards a Sol chat request with a compatible completion limit',async()=>{const a=await call('POST','/api/agents',{name:'Test bot',purpose:'Test',daily_limit_cents:1000},workspace.admin_token);const originalFetch=global.fetch;let upstreamBody;global.fetch=async(_url,options)=>{upstreamBody=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'Hello'}}],usage:{total_tokens:96}})}};try{const out=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Hello'}],max_tokens:256},a.agent.credential,{'idempotency-key':'sol-request-0001'});assert.equal(out.status,200);assert.equal(out.result.choices[0].message.content,'Hello');assert.equal(upstreamBody.model,'gpt-6.1-sol');assert.equal(upstreamBody.max_completion_tokens,256);assert.equal(upstreamBody.reasoning_effort,'low');assert.equal('max_tokens' in upstreamBody,false)}finally{global.fetch=originalFetch}});
test('MCP authenticates agent, exposes only chat tool, and applies gateway policy',async()=>{
  const a=await call('POST','/api/agents',{name:'MCP bot',purpose:'Research',daily_limit_cents:1000},workspace.admin_token);
  const request=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
  const invoke=(payload,credential=a.agent.credential,headers={})=>call('POST','/api/mcp',payload,credential,{'content-type':'application/json',...headers});
  assert.equal((await invoke(request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),'wrong')).status,401);
  const init=await invoke(request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}));
  assert.equal(init.result.serverInfo.name,'auven');
  const list=await invoke(request(2,'tools/list',{}));
  assert.deepEqual(list.result.tools.map(tool=>tool.name),['auven_chat']);
  const originalFetch=global.fetch;
  global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'From AUVEN'}}],usage:{total_tokens:20}})});
  try{
    const answer=await invoke(request(3,'tools/call',{name:'auven_chat',arguments:{prompt:'Hello',max_tokens:100}}));
    assert.match(answer.result.content[0].text,/From AUVEN/);
    const events=await call('GET','/api/events',null,workspace.admin_token);
    assert.ok(events.events.some(event=>event.agent_id===a.agent.id&&event.decision==='allowed'));
    await call('PATCH',`/api/agents/${a.agent.id}/status`,{status:'stopped'},workspace.admin_token);
    const blocked=await invoke(request(4,'tools/call',{name:'auven_chat',arguments:{prompt:'Again'}}));
    assert.equal(blocked.result.isError,true);
    assert.match(blocked.result.content[0].text,/agent_stopped/);
    assert.equal((await invoke(request(5,'tools/list',{}),a.agent.credential,{origin:'https://example.com'})).status,403);
  }finally{global.fetch=originalFetch}
});
