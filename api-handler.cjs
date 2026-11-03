const D=process.env.DATABASE_URL?require('./db-postgres.cjs'):process.env.VERCEL?null:require('./db.cjs');
const P=require('./proof.cjs'),Chain=require('./solana.cjs'),LegacyChain=require('./chain.cjs'),Token=require('./token.cjs'),Holder=require('./holder-access.cjs'),Mcp=require('./mcp.cjs'),{createHash,randomUUID}=require('node:crypto');
const Auth=require('./auth.cjs'),Accounts=process.env.DATABASE_URL?require('./db-accounts.cjs'):null;
const providerKey=process.env.AUVEN_OPENAI_API_KEY,model=process.env.AUVEN_MODEL||'gpt-6.1-sol';
function send(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
async function body(req){if(req.body&&typeof req.body==='object')return req.body;let text='';for await(const part of req){text+=part;if(text.length>100000)throw Error('request_too_large')}return JSON.parse(text||'{}')}
const bearer=req=>(req.headers.authorization||'').replace(/^Bearer /,'');
async function account(req){const user=await Auth.userFromToken(bearer(req));if(!user||!Accounts)return null;return {user,id:await Accounts.resolveAccount(user)}}
async function admin(req,res){
  if(bearer(req).split('.').length===3){const owner=await account(req);if(!owner){send(res,401,{error:'invalid_session'});return null}const w=await Accounts.workspaceForAccount(owner.id);if(!w)send(res,404,{error:'workspace_not_found'});return w}
  const w=await D.workspace(bearer(req));if(!w)send(res,401,{error:'invalid_admin_token'});return w
}
const amount=n=>Number.isInteger(n)&&n>=0&&n<=100000000;
async function providerCompletion(messages,maxTokens,selectedModel=model){
  try{const upstream=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${providerKey}`,'content-type':'application/json'},body:JSON.stringify({model:selectedModel,messages,max_completion_tokens:maxTokens,...(selectedModel==='gpt-6.1-sol'?{reasoning_effort:'low'}:{})}),signal:AbortSignal.timeout(55000)});const result=await upstream.json();if(upstream.ok)return {result};
    const code=typeof result?.error?.code==='string'?result.error.code:'';
    const error=upstream.status===401||upstream.status===403?'provider_auth_failed':code==='insufficient_quota'?'provider_quota_exceeded':upstream.status===429?'provider_rate_limited':code==='model_not_found'||upstream.status===404?'provider_model_unavailable':upstream.status===400?'provider_request_rejected':'provider_error';
    console.error('OpenAI request rejected',{status:upstream.status,code,error});
    return {error};}
  catch{return {error:'provider_unavailable'}}
}
function validHostedConfiguration(value){return typeof value.name==='string'&&value.name.trim().length>=2&&value.name.trim().length<=80&&typeof value.purpose==='string'&&value.purpose.trim().length>=2&&value.purpose.trim().length<=500&&typeof value.instructions==='string'&&value.instructions.trim().length>=20&&value.instructions.length<=4000}
async function passportForAgent(agent){const payload={type:'agent_passport',version:agent.kind==='hosted'?2:1,agent_id:agent.id,workspace_id:agent.workspace_id,name:agent.name,purpose:agent.purpose,created_at:agent.created_at};if(agent.kind==='hosted'){payload.kind='hosted';payload.config_version=agent.config_version;payload.instructions_sha256='0x'+createHash('sha256').update(agent.instructions).digest('hex')}return P.sign(payload)}
async function modelFor(workspaceId,tier){
  if(tier==='standard')return {model,multiplier:1};
  if(tier!=='holder')return {status:400,error:'invalid_model_tier'};
  if(!Holder.config().enabled)return {status:409,error:'holder_model_not_available'};
  if(!Accounts)return {status:403,error:'verified_account_required'};
  try{const access=await Holder.forWorkspace(workspaceId,Accounts,Auth,Token);return access.eligible?{model:Holder.config().model,multiplier:Holder.config().multiplier}:{status:403,error:'holder_balance_required'}}
  catch{return {status:503,error:'holder_status_unavailable'}}
}
async function runGateway(agent,input,requestId){
  if(typeof requestId!=='string'||requestId.length<8||requestId.length>128)return {status:400,data:{error:'idempotency_key_required'}};
  if(!Array.isArray(input.messages)||!input.messages.length||!Number.isInteger(input.max_tokens)||input.max_tokens<1||input.max_tokens>4096)return {status:400,data:{error:'invalid_request'}};
  let messages=input.messages;
  if(agent.kind==='hosted'){
    if(!agent.instructions)return {status:422,data:{error:'agent_not_configured'}};
    if(messages.length>30||messages.some(item=>!item||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||!item.content.trim()||item.content.length>16000)||messages.reduce((size,item)=>size+item.content.length,0)>16000)return {status:400,data:{error:'invalid_messages'}};
    messages=[{role:'developer',content:agent.instructions},...messages];
  }
  if(!providerKey)return {status:503,data:{error:'provider_not_configured'}};
  const tier=input.model_tier??'standard',choice=await modelFor(agent.workspace_id,tier);
  if(choice.error)return {status:choice.status,data:{error:choice.error}};
  const estimate=Math.ceil(input.max_tokens*0.2*choice.multiplier),outcome=await D.reserve(agent,requestId,estimate,{max_tokens:input.max_tokens,messages,model_tier:tier});
  if(outcome.existing)return {status:409,data:{error:'duplicate_request',event:outcome.existing}};
  const event=outcome.event;
  if(event.decision==='denied')return {status:403,data:{error:event.reason,event_id:event.id}};
  if(event.decision==='pending')return {status:202,data:{status:'pending_approval',action_id:outcome.action_id,event_id:event.id}};
  const out=await providerCompletion(messages,input.max_tokens,choice.model);
  if(out.error){await D.settle(event.id,'failed',out.error,0);return {status:502,data:{error:out.error,event_id:event.id}}}
  const actual=Math.min(estimate,Math.ceil((out.result.usage?.total_tokens||input.max_tokens)*0.2*choice.multiplier));
  await D.settle(event.id,'allowed','provider_completed',actual);
  return {status:200,data:{event_id:event.id,model_tier:tier,result:out.result}};
}
async function handler(req,res){const p=new URL(req.url,'http://localhost').pathname,m=req.method;
try{
if(D?.ensureSchema)await D.ensureSchema();
if(p==='/api/mcp'){if(!D)return send(res,503,{error:'database_not_configured'});const internal=async(method,url,credential,payload,headers={})=>{let status,data;await handler({method,url,headers:{authorization:'Bearer '+credential,...headers},body:payload},{writeHead(code){status=code},end(raw){data=JSON.parse(raw)}});return {status,data}};return Mcp.handle(req,res,{db:D,callGateway:({credential,prompt,maxTokens,modelTier,requestId})=>internal('POST','/api/gateway/chat',credential,{messages:[{role:'user',content:prompt}],max_tokens:maxTokens,model_tier:modelTier},{'idempotency-key':requestId}),actionStatus:({credential,actionId})=>internal('GET','/api/actions/'+actionId,credential)})}
if(p==='/api/health'){const publisher=Chain.config();return send(res,200,{ok:true,database:D?'configured':'not_configured',auth:Auth.configured()?'configured':'not_configured',network:'Solana',onchain:publisher.configured?'signer_configured':'signer_not_configured',publisher:publisher.publisher,token:Token.configured()?'mint_configured':'mint_not_configured',holder_access:Holder.config().enabled?'configured':'not_configured',provider:providerKey?'configured':'not_configured'});}
if(p==='/api/auth/config'&&m==='GET')return send(res,200,Auth.publicConfig());
if(p==='/api/ready'&&m==='GET'){if(!D)return send(res,503,{ok:false,database:'not_configured'});if(D.pool)await D.pool.query('SELECT proofs.chain_network,account_wallets.address,agents.mcp_last_seen FROM accounts,account_privy_users,workspaces,proofs,account_wallets,agents LIMIT 0');return send(res,200,{ok:true,database:'ready'})}
if(p==='/api/verify'&&m==='POST'){const b=await body(req);return send(res,200,{signature_valid:await P.verify(b),onchain_verified:false})}
if(!D)return send(res,503,{error:'database_not_configured'});
if(p==='/api/me'&&m==='GET'){const owner=await account(req);if(!owner)return send(res,401,{error:'invalid_session'});return send(res,200,await Accounts.profile(owner.id,owner.user))}
if(p==='/api/token/status'&&m==='GET'){
  const owner=await account(req);if(!owner)return send(res,401,{error:'invalid_session'});
  try{const snapshot=await Token.readWallets(owner.user.wallets);return send(res,200,{...snapshot,benefits:Holder.evaluate(snapshot)})}
  catch(error){return send(res,503,{error:['wrong_token_chain','invalid_token_mint'].includes(error.message)?error.message:'token_rpc_unavailable'})}
}
if(p==='/api/token/attest'&&m==='POST'){
  const owner=await account(req);if(!owner)return send(res,401,{error:'invalid_session'});
  const workspace=await Accounts.workspaceForAccount(owner.id);if(!workspace)return send(res,404,{error:'workspace_not_found'});
  if(!Token.configured())return send(res,503,{error:'token_mint_not_configured'});
  const input=await body(req);
  if(typeof input.agent_id!=='string'||!await D.agentOwned(workspace.id,input.agent_id))return send(res,404,{error:'agent_not_found'});
  if(!owner.user.wallets.length)return send(res,422,{error:'wallet_not_linked'});
  let snapshot;
  try{snapshot=await Token.readWallets(owner.user.wallets)}
  catch(error){return send(res,503,{error:['wrong_token_chain','invalid_token_mint'].includes(error.message)?error.message:'token_rpc_unavailable'})}
  if(!snapshot.holder)return send(res,422,{error:'token_balance_required'});
  const wallet=snapshot.wallets.filter(item=>BigInt(item.balance_raw)>0n).sort((a,b)=>BigInt(a.balance_raw)===BigInt(b.balance_raw)?0:BigInt(a.balance_raw)>BigInt(b.balance_raw)?-1:1)[0];
  const proof=await P.sign({type:'token_holder_attestation',version:2,network:'solana',workspace_id:workspace.id,agent_id:input.agent_id,wallet_address:wallet.address,token_mint:snapshot.token_mint,token_symbol:snapshot.symbol,token_decimals:snapshot.decimals,balance_raw:wallet.balance_raw,slot:wallet.slot,checked_at:snapshot.checked_at});
  const id=await D.createProof(workspace.id,input.agent_id,'token_holder',proof);
  return send(res,201,{id,proof,onchain_status:'not_published'});
}
if(p==='/api/workspaces'&&m==='POST'){const b=await body(req);if(typeof b.name!=='string'||b.name.trim().length<2)return send(res,400,{error:'invalid_name'});if(bearer(req).split('.').length===3){const owner=await account(req);if(!owner)return send(res,401,{error:'invalid_session'});if(await Accounts.workspaceForAccount(owner.id))return send(res,409,{error:'workspace_exists'});return send(res,201,await Accounts.createWorkspaceForAccount(owner.id,b.name.trim()))}if(process.env.AUVEN_SETUP_TOKEN&&req.headers['x-setup-token']!==process.env.AUVEN_SETUP_TOKEN)return send(res,403,{error:'invalid_setup_token'});if(!process.env.AUVEN_SETUP_TOKEN&&await D.countWorkspaces()>0)return send(res,403,{error:'setup_closed'});return send(res,201,await D.createWorkspace(b.name.trim()))}
if(p==='/api/workspaces/claim'&&m==='POST'){const owner=await account(req);if(!owner)return send(res,401,{error:'invalid_session'});if(await Accounts.workspaceForAccount(owner.id))return send(res,409,{error:'workspace_exists'});const b=await body(req);if(typeof b.admin_token!=='string'||!b.admin_token)return send(res,400,{error:'admin_token_required'});const w=await Accounts.claimWorkspace(owner.id,b.admin_token);return w?send(res,200,{workspace:w}):send(res,404,{error:'workspace_not_found'})}
if(p==='/api/workspaces/admin-token/rotate'&&m==='POST'){const owner=await account(req);if(!owner)return send(res,401,{error:'invalid_session'});const next=await Accounts.rotateWorkspaceToken(owner.id);return next?send(res,200,{admin_token:next}):send(res,404,{error:'workspace_not_found'})}
if(p==='/api/agents'&&m==='GET'){const w=await admin(req,res);if(!w)return;return send(res,200,{agents:await D.listAgents(w.id)})}
if(p==='/api/agents'&&m==='POST'){const w=await admin(req,res);if(!w)return;const b=await body(req);if(typeof b.name!=='string'||!b.name.trim()||typeof b.purpose!=='string'||!b.purpose.trim()||!amount(b.daily_limit_cents)||b.kind!==undefined&&!['external','hosted'].includes(b.kind))return send(res,400,{error:'invalid_agent'});if(b.kind==='hosted'&&!validHostedConfiguration(b))return send(res,400,{error:'invalid_hosted_configuration'});const a=await D.createAgent(w.id,b.name.trim().slice(0,80),b.purpose.trim().slice(0,500),b.daily_limit_cents,{kind:b.kind||'external',instructions:b.kind==='hosted'?b.instructions.trim():null});const proof=await passportForAgent(a);await D.createProof(w.id,a.id,'passport',proof);return send(res,201,{agent:a,passport:proof})}
const hostedRun=p.match(/^\/api\/agents\/([a-f0-9]+)\/run$/);if(hostedRun&&m==='POST'){const w=await admin(req,res);if(!w)return;const agent=await D.getAgent(w.id,hostedRun[1]);if(!agent)return send(res,404,{error:'agent_not_found'});if(agent.kind!=='hosted')return send(res,409,{error:'agent_not_hosted'});const b=await body(req);if(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>16000)return send(res,400,{error:'invalid_prompt'});const outcome=await runGateway(agent,{messages:[{role:'user',content:b.prompt.trim()}],max_tokens:b.max_tokens??256},req.headers['idempotency-key']||randomUUID());return send(res,outcome.status,outcome.data)}
const status=p.match(/^\/api\/agents\/([a-f0-9]+)\/status$/);if(status&&m==='PATCH'){const w=await admin(req,res);if(!w)return;const b=await body(req);if(!['active','stopped'].includes(b.status))return send(res,400,{error:'invalid_status'});return send(res,(await D.setAgentStatus(w.id,status[1],b.status))?200:404,{status:b.status})}
const agentCredential=p.match(/^\/api\/agents\/([a-f0-9]+)\/credential\/rotate$/);if(agentCredential&&m==='POST'){const w=await admin(req,res);if(!w)return;const next=await D.rotateAgentCredential(w.id,agentCredential[1]);return next?send(res,200,{credential:next}):send(res,404,{error:'agent_not_found'})}
const policy=p.match(/^\/api\/agents\/([a-f0-9]+)\/policy$/);if(policy&&m==='PATCH'){const w=await admin(req,res);if(!w)return;const b=await body(req);if(!amount(b.daily_limit_cents)||!Number.isInteger(b.daily_request_limit)||b.daily_request_limit<0||b.daily_request_limit>10000||!Number.isInteger(b.max_tokens_per_request)||b.max_tokens_per_request<1||b.max_tokens_per_request>4096||typeof b.approval_required!=='boolean')return send(res,400,{error:'invalid_policy'});const updated=await D.setAgentPolicy(w.id,policy[1],b);return send(res,updated?200:404,updated?{policy:b}:{error:'agent_not_found'})}
if(p==='/api/events'&&m==='GET'){const w=await admin(req,res);if(!w)return;return send(res,200,{events:await D.listEvents(w.id)})}
if(p==='/api/actions'&&m==='GET'){const w=await admin(req,res);if(!w)return;return send(res,200,{actions:await D.listActions(w.id)})}
const action=p.match(/^\/api\/actions\/([a-f0-9]+)$/);if(action&&m==='GET'){const agent=await D.agentByToken(bearer(req));if(!agent)return send(res,401,{error:'invalid_agent_credential'});const row=await D.actionForAgent(agent.id,action[1]);if(!row)return send(res,404,{error:'action_not_found'});return send(res,200,{action:{id:row.id,status:row.status,event_id:row.event_id,result:row.result_json?JSON.parse(row.result_json):null,created_at:row.created_at,decided_at:row.decided_at}})}
const decision=p.match(/^\/api\/actions\/([a-f0-9]+)\/decision$/);if(decision&&m==='POST'){const w=await admin(req,res);if(!w)return;const b=await body(req);if(!['approve','deny'].includes(b.decision))return send(res,400,{error:'invalid_decision'});if(b.decision==='deny'){const done=await D.denyAction(w.id,decision[1]);return send(res,done?200:409,done?{status:'denied'}:{error:'action_not_pending'})}if(!providerKey)return send(res,503,{error:'provider_not_configured'});const pending=await D.pendingAction(w.id,decision[1]);if(!pending)return send(res,409,{error:'action_not_pending'});const choice=await modelFor(w.id,pending.model_tier);if(choice.error)return send(res,choice.status,{error:choice.error});const row=await D.claimAction(w.id,decision[1]);if(!row)return send(res,409,{error:'action_not_pending_or_policy_changed'});const out=await providerCompletion(JSON.parse(row.messages_json),row.max_tokens,choice.model);if(out.error){await D.finishAction(row.id,'failed',{error:out.error},0);return send(res,502,{status:'failed',error:out.error})}const estimate=Number(row.estimate)||Math.ceil(row.max_tokens*0.2*choice.multiplier),actual=Math.min(estimate,Math.ceil((out.result.usage?.total_tokens||row.max_tokens)*0.2*choice.multiplier));await D.finishAction(row.id,'completed',out.result,actual);return send(res,200,{status:'completed',action_id:row.id,event_id:row.event_id})}
if(p==='/api/proofs'&&m==='GET'){const w=await admin(req,res);if(!w)return;const rows=await D.listProofs(w.id);return send(res,200,{proofs:rows.map(x=>({...x,payload:JSON.parse(x.payload)}))})}
if(p==='/api/checkpoints'&&m==='POST'){const w=await admin(req,res);if(!w)return;const b=await body(req);if(!await D.agentOwned(w.id,b.agent_id))return send(res,404,{error:'agent_not_found'});const events=await D.checkpointEvents(b.agent_id),digest='0x'+createHash('sha256').update(JSON.stringify(events)).digest('hex');const proof=await P.sign({type:'activity_checkpoint',version:1,workspace_id:w.id,agent_id:b.agent_id,event_count:events.length,events_sha256:digest,created_at:new Date().toISOString()});await D.createProof(w.id,b.agent_id,'checkpoint',proof);return send(res,201,{proof,onchain_status:'not_published'})}
const pub=p.match(/^\/api\/proofs\/([a-f0-9]+)\/publish$/);if(pub&&m==='POST'){const w=await admin(req,res);if(!w)return;const row=await D.getProof(w.id,pub[1]);if(!row)return send(res,404,{error:'proof_not_found'});if(row.tx_hash)return send(res,409,{error:'already_submitted',tx_hash:row.tx_hash});if(!Chain.config().configured)return send(res,503,{error:'chain_signer_not_configured'});const proof=JSON.parse(row.payload);if(!await P.verify(proof))return send(res,422,{error:'invalid_proof_signature'});if(!await D.claimProof(w.id,row.id))return send(res,409,{error:'publication_in_progress'});try{const out=await Chain.publish(proof);await D.updateProof(row.id,'pending',out.tx_hash,out.signer,out.target,'solana');return send(res,202,{...out,explorer_url:Chain.explorer(out.tx_hash)})}catch(e){await D.updateProof(row.id,'unknown');return send(res,502,{error:'chain_publication_uncertain'})}}
const check=p.match(/^\/api\/proofs\/([a-f0-9]+)\/inclusion$/);if(check&&m==='GET'){const w=await admin(req,res);if(!w)return;const row=await D.getProof(w.id,check[1]);if(!row)return send(res,404,{error:'proof_not_found'});const proof=JSON.parse(row.payload),signature_valid=await P.verify(proof);if(!row.tx_hash)return send(res,200,{signature_valid,included:false,reason:'not_submitted'});try{const result=row.chain_network==='solana'?await Chain.verifyInclusion(proof,row.tx_hash,{expectedSigner:row.chain_signer,expectedTarget:row.chain_target}):await LegacyChain.verifyInclusion(proof,row.tx_hash,{expectedSigner:row.chain_signer,expectedTarget:row.chain_target});if(result.included&&signature_valid)await D.updateProof(row.id,'confirmed');return send(res,200,{signature_valid,...result})}catch{return send(res,502,{error:'chain_verification_failed'})}}
if(p==='/api/gateway/chat'&&m==='POST'){const agent=await D.agentByToken(bearer(req));if(!agent)return send(res,401,{error:'invalid_agent_credential'});const outcome=await runGateway(agent,await body(req),req.headers['idempotency-key']);return send(res,outcome.status,outcome.data)}
return send(res,404,{error:'not_found'})
}catch(e){return send(res,e.message==='request_too_large'?413:500,{error:e.message==='request_too_large'?'request_too_large':'server_error'})}}
module.exports={handler};
