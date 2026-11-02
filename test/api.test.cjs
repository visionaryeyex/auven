const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');process.env.AUVEN_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'auven-api-'));process.env.AUVEN_OPENAI_API_KEY='test-only-key';delete process.env.AUVEN_MODEL;const {handler}=require('../api-handler.cjs');
async function call(method,url,payload,token,headers={}){let status,output;const req={method,url,headers:{...headers,...(token?{authorization:'Bearer '+token}:{})},body:payload};const res={writeHead(n){status=n},end(s){output=JSON.parse(s)}};await handler(req,res);return {status,...output}}
let workspace;
test('API registers workspace and agent, signs passport, scopes proofs, stops agent',async()=>{const w=await call('POST','/api/workspaces',{name:'Test workspace'});assert.equal(w.status,201);workspace=w;const a=await call('POST','/api/agents',{name:'Existing bot',purpose:'Research',daily_limit_cents:100},w.admin_token);assert.equal(a.status,201);assert.equal(a.passport.algorithm,'ML-DSA-65');const list=await call('GET','/api/proofs',null,w.admin_token);assert.equal(list.proofs.length,1);const verify=await call('POST','/api/verify',a.passport);assert.equal(verify.signature_valid,true);const status=await call('PATCH',`/api/agents/${a.agent.id}/status`,{status:'stopped'},w.admin_token);assert.equal(status.status,'stopped');const pub=await call('POST',`/api/proofs/${list.proofs[0].id}/publish`,null,w.admin_token);assert.equal(pub.error,'chain_signer_not_configured')});
test('agent registration is distinct from gateway use and rotating a credential revokes the old one',async()=>{
  const created=await call('POST','/api/agents',{name:'Setup bot',purpose:'Connect later',daily_limit_cents:100},workspace.admin_token);
  const id=created.agent.id,old=created.agent.credential;
  assert.equal((await call('GET','/api/agents',null,workspace.admin_token)).agents.find(a=>a.id===id).has_gateway_activity,0);
  const rotated=await call('POST',`/api/agents/${id}/credential/rotate`,null,workspace.admin_token);
  assert.equal(rotated.status,200);assert.notEqual(rotated.credential,old);
  assert.equal((await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Hello'}],max_tokens:20},old,{'idempotency-key':'revoked-agent-001'})).error,'invalid_agent_credential');
  const originalFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'Hello'}}],usage:{total_tokens:20}})});
  try{assert.equal((await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Hello'}],max_tokens:20},rotated.credential,{'idempotency-key':'rotated-agent-001'})).status,200)}finally{global.fetch=originalFetch}
  assert.equal((await call('GET','/api/agents',null,workspace.admin_token)).agents.find(a=>a.id===id).has_gateway_activity,1);
});
test('gateway forwards a Sol chat request with a compatible completion limit',async()=>{const a=await call('POST','/api/agents',{name:'Test bot',purpose:'Test',daily_limit_cents:1000},workspace.admin_token);const originalFetch=global.fetch;let upstreamBody;global.fetch=async(_url,options)=>{upstreamBody=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'Hello'}}],usage:{total_tokens:96}})}};try{const out=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Hello'}],max_tokens:256},a.agent.credential,{'idempotency-key':'sol-request-0001'});assert.equal(out.status,200);assert.equal(out.result.choices[0].message.content,'Hello');assert.equal(upstreamBody.model,'gpt-6.1-sol');assert.equal(upstreamBody.max_completion_tokens,256);assert.equal(upstreamBody.reasoning_effort,'low');assert.equal('max_tokens' in upstreamBody,false)}finally{global.fetch=originalFetch}});
test('MCP authenticates agent, exposes scoped tools, and applies gateway policy',async()=>{
  const a=await call('POST','/api/agents',{name:'MCP bot',purpose:'Research',daily_limit_cents:1000},workspace.admin_token);
  const request=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
  const invoke=(payload,credential=a.agent.credential,headers={})=>call('POST','/api/mcp',payload,credential,{'content-type':'application/json',...headers});
  assert.equal((await invoke(request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),'wrong')).status,401);
  const init=await invoke(request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}));
  assert.equal(init.result.serverInfo.name,'auven');
  const list=await invoke(request(2,'tools/list',{}));
  assert.deepEqual(list.result.tools.map(tool=>tool.name),['auven_connection_test','auven_chat','auven_action_status']);
  const before=(await call('GET','/api/events',null,workspace.admin_token)).events.length;
  const connected=await invoke(request(3,'tools/call',{name:'auven_connection_test',arguments:{}}));
  assert.match(connected.result.content[0].text,/Connected to AUVEN as MCP bot/);
  assert.equal((await call('GET','/api/events',null,workspace.admin_token)).events.length,before);
  assert.ok((await call('GET','/api/agents',null,workspace.admin_token)).agents.find(agent=>agent.id===a.agent.id).mcp_last_seen);
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
    const rotated=await call('POST',`/api/agents/${a.agent.id}/credential/rotate`,null,workspace.admin_token);
    assert.equal(rotated.status,200);
    assert.equal((await call('GET','/api/agents',null,workspace.admin_token)).agents.find(agent=>agent.id===a.agent.id).mcp_last_seen,null);
    assert.equal((await invoke(request(6,'tools/call',{name:'auven_connection_test',arguments:{}}))).status,401);
  }finally{global.fetch=originalFetch}
});
test('agent control queues requests for owner review, limits calls, and scopes results',async()=>{
  const a=await call('POST','/api/agents',{name:'Controlled bot',purpose:'Review',daily_limit_cents:1000},workspace.admin_token);
  const other=await call('POST','/api/agents',{name:'Other bot',purpose:'Isolation',daily_limit_cents:1000},workspace.admin_token);
  const policy=await call('PATCH',`/api/agents/${a.agent.id}/policy`,{daily_limit_cents:1000,daily_request_limit:1,max_tokens_per_request:200,approval_required:true},workspace.admin_token);
  assert.equal(policy.status,200);
  const originalFetch=global.fetch;let upstreamCalls=0;
  global.fetch=async()=>{upstreamCalls++;return {ok:true,json:async()=>({choices:[{message:{content:'Approved answer'}}],usage:{total_tokens:50}})}};
  try{
    const pending=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Review this'}],max_tokens:100},a.agent.credential,{'idempotency-key':'control-request-001'});
    assert.equal(pending.status,'pending_approval');assert.equal(upstreamCalls,0);
    const list=await call('GET','/api/actions',null,workspace.admin_token);
    assert.ok(list.actions.some(x=>x.id===pending.action_id&&x.status==='pending'));
    assert.equal(list.actions.find(x=>x.id===pending.action_id).messages_json.includes('Review this'),true);
    assert.equal((await call('GET',`/api/actions/${pending.action_id}`,null,other.agent.credential)).status,404);
    const approved=await call('POST',`/api/actions/${pending.action_id}/decision`,{decision:'approve'},workspace.admin_token);
    assert.equal(approved.status,'completed');assert.equal(upstreamCalls,1);
    const result=await call('GET',`/api/actions/${pending.action_id}`,null,a.agent.credential);
    assert.equal(result.action.status,'completed');assert.equal(result.action.result.choices[0].message.content,'Approved answer');
    assert.equal((await call('GET','/api/actions',null,workspace.admin_token)).actions.find(x=>x.id===pending.action_id).messages_json,'[]');
    const limited=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Second'}],max_tokens:100},a.agent.credential,{'idempotency-key':'control-request-002'});
    assert.equal(limited.error,'request_limit_exceeded');
    assert.equal((await call('POST',`/api/actions/${pending.action_id}/decision`,{decision:'approve'},workspace.admin_token)).status,409);
  }finally{global.fetch=originalFetch}
});
test('owner denial and per-call token cap block provider work',async()=>{
  const a=await call('POST','/api/agents',{name:'Review bot',purpose:'Review',daily_limit_cents:1000},workspace.admin_token);
  await call('PATCH',`/api/agents/${a.agent.id}/policy`,{daily_limit_cents:1000,daily_request_limit:2,max_tokens_per_request:100,approval_required:true},workspace.admin_token);
  const large=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Large'}],max_tokens:101},a.agent.credential,{'idempotency-key':'review-request-001'});
  assert.equal(large.error,'token_limit_exceeded');
  const pending=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Small'}],max_tokens:50},a.agent.credential,{'idempotency-key':'review-request-002'});
  assert.equal(pending.status,'pending_approval');
  const denied=await call('POST',`/api/actions/${pending.action_id}/decision`,{decision:'deny'},workspace.admin_token);
  assert.equal(denied.status,'denied');
  const result=await call('GET',`/api/actions/${pending.action_id}`,null,a.agent.credential);
  assert.equal(result.action.status,'denied');
  assert.equal((await call('GET','/api/actions',null,workspace.admin_token)).actions.find(x=>x.id===pending.action_id).messages_json,'[]');
});
test('MCP can retrieve an approved action',async()=>{
  const a=await call('POST','/api/agents',{name:'MCP approval bot',purpose:'Review',daily_limit_cents:1000},workspace.admin_token);
  await call('PATCH',`/api/agents/${a.agent.id}/policy`,{daily_limit_cents:1000,daily_request_limit:3,max_tokens_per_request:100,approval_required:true},workspace.admin_token);
  const invoke=(id,name,args,credential=a.agent.credential)=>call('POST','/api/mcp',{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}},credential,{'content-type':'application/json'});
  const pending=await invoke(1,'auven_chat',{prompt:'Approve this',max_tokens:40});
  const actionId=pending.result.content[0].text.match(/[a-f0-9]{32}/)?.[0];
  assert.ok(actionId);
  const waiting=await invoke(2,'auven_action_status',{action_id:actionId});
  assert.match(waiting.result.content[0].text,/pending/);
  const originalFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'Approved via MCP'}}],usage:{total_tokens:20}})});
  try{await call('POST',`/api/actions/${actionId}/decision`,{decision:'approve'},workspace.admin_token)}finally{global.fetch=originalFetch}
  const completed=await invoke(3,'auven_action_status',{action_id:actionId});
  assert.match(completed.result.content[0].text,/Approved via MCP/);
});
test('a stricter policy blocks approval of an earlier pending request',async()=>{
  const a=await call('POST','/api/agents',{name:'Changed policy bot',purpose:'Safety',daily_limit_cents:1000},workspace.admin_token);
  await call('PATCH',`/api/agents/${a.agent.id}/policy`,{daily_limit_cents:1000,daily_request_limit:2,max_tokens_per_request:100,approval_required:true},workspace.admin_token);
  const pending=await call('POST','/api/gateway/chat',{messages:[{role:'user',content:'Old policy'}],max_tokens:50},a.agent.credential,{'idempotency-key':'changed-policy-001'});
  assert.equal(pending.status,'pending_approval');
  await call('PATCH',`/api/agents/${a.agent.id}/policy`,{daily_limit_cents:0,daily_request_limit:0,max_tokens_per_request:25,approval_required:true},workspace.admin_token);
  const approval=await call('POST',`/api/actions/${pending.action_id}/decision`,{decision:'approve'},workspace.admin_token);
  assert.equal(approval.error,'action_not_pending_or_policy_changed');
  assert.equal((await call('GET',`/api/actions/${pending.action_id}`,null,a.agent.credential)).action.status,'pending');
  assert.equal((await call('POST',`/api/actions/${pending.action_id}/decision`,{decision:'deny'},workspace.admin_token)).status,'denied');
});
