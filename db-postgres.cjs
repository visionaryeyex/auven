const {Pool}=require('pg'),{randomBytes,createHash,timingSafeEqual}=require('node:crypto');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
// Vercel creates a pool per warm function instance. Keep each instance small
// when connecting through Supabase's transaction pooler.
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});
let schemaPromise;
function ensureSchema(){
  if(!schemaPromise)schemaPromise=(async()=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(46630001)");
      await client.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_last_seen timestamptz');
      await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'external'");
      await client.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS instructions text');
      await client.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1');
      await client.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS model_tier text NOT NULL DEFAULT 'standard'");
      await client.query("ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS model_tier text NOT NULL DEFAULT 'standard'");
      await client.query('CREATE TABLE IF NOT EXISTS marketplace_listings(id text PRIMARY KEY,workspace_id text NOT NULL REFERENCES workspaces(id),agent_id text NOT NULL UNIQUE REFERENCES agents(id),category text NOT NULL,description text NOT NULL,passport text NOT NULL,created_at text NOT NULL)');
      await client.query('ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY');
      await client.query('REVOKE ALL ON marketplace_listings FROM PUBLIC, anon, authenticated');
      const column=(await client.query("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='proofs' AND column_name='chain_network'")).rows[0];
      const constraint=(await client.query("SELECT 1 FROM pg_constraint WHERE conname='account_wallets_lowercase' AND conrelid='account_wallets'::regclass")).rowCount;
      if(!column || column.column_default!=="'solana'::text" || column.is_nullable!=='NO' || constraint){
        await client.query('ALTER TABLE account_wallets DROP CONSTRAINT IF EXISTS account_wallets_lowercase');
        await client.query('ALTER TABLE proofs ADD COLUMN IF NOT EXISTS chain_network text');
        await client.query("UPDATE proofs SET chain_network='robinhood' WHERE chain_network IS NULL AND tx_hash IS NOT NULL");
        await client.query("UPDATE proofs SET chain_network='solana' WHERE chain_network IS NULL");
        await client.query("ALTER TABLE proofs ALTER COLUMN chain_network SET DEFAULT 'solana'");
        await client.query('ALTER TABLE proofs ALTER COLUMN chain_network SET NOT NULL');
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}
    finally{client.release()}
  })().catch(error=>{schemaPromise=null;throw error});
  return schemaPromise;
}
const hash=s=>createHash('sha256').update(s).digest('hex'),id=()=>randomBytes(16).toString('hex'),secret=()=>randomBytes(32).toString('base64url');
async function one(sql,args=[]){return (await pool.query(sql,args)).rows[0]||null}async function many(sql,args=[]){return (await pool.query(sql,args)).rows}async function run(sql,args=[]){return (await pool.query(sql,args)).rowCount}
async function workspace(token){return token?one('SELECT id,name FROM workspaces WHERE admin_hash=$1',[hash(token)]):null}
async function agentByToken(token){return token?one('SELECT * FROM agents WHERE credential_hash=$1',[hash(token)]):null}
async function countWorkspaces(){return Number((await one('SELECT COUNT(*) AS n FROM workspaces')).n)}
async function createWorkspace(name){const token=secret(),row={id:id(),name};await run('INSERT INTO workspaces(id,name,admin_hash) VALUES($1,$2,$3)',[row.id,name,hash(token)]);return {...row,admin_token:token}}
async function createAgent(workspaceId,name,purpose,dailyLimit,configuration={}){const token=secret(),kind=configuration.kind==='hosted'?'hosted':'external',instructions=kind==='hosted'?configuration.instructions:null,row={id:id(),workspace_id:workspaceId,name,purpose,status:'active',daily_limit:dailyLimit,kind,instructions,config_version:1,created_at:new Date().toISOString()};await run('INSERT INTO agents(id,workspace_id,name,purpose,status,daily_limit,credential_hash,created_at,kind,instructions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,workspaceId,name,purpose,row.status,dailyLimit,hash(token),row.created_at,kind,instructions]);return {...row,credential:token}}
async function listAgents(w){return many('SELECT a.id,a.workspace_id,a.name,a.purpose,a.status,a.daily_limit,a.daily_request_limit,a.max_tokens_per_request,a.approval_required,a.mcp_last_seen,a.kind,a.instructions,a.config_version,a.created_at,EXISTS(SELECT 1 FROM events e WHERE e.agent_id=a.id) AS has_gateway_activity FROM agents a WHERE a.workspace_id=$1 ORDER BY a.created_at DESC',[w])}
async function getAgent(w,a){return one('SELECT * FROM agents WHERE workspace_id=$1 AND id=$2',[w,a])}
async function markMcpConnection(a){const seen=new Date().toISOString();await run('UPDATE agents SET mcp_last_seen=$1 WHERE id=$2',[seen,a]);return seen}
async function rotateAgentCredential(w,a){const token=secret();return await run('UPDATE agents SET credential_hash=$1,mcp_last_seen=NULL WHERE workspace_id=$2 AND id=$3',[hash(token),w,a])?token:null}
async function setAgentPolicy(w,a,p){return run('UPDATE agents SET daily_limit=$1,daily_request_limit=$2,max_tokens_per_request=$3,approval_required=$4 WHERE workspace_id=$5 AND id=$6',[p.daily_limit_cents,p.daily_request_limit,p.max_tokens_per_request,p.approval_required,w,a])}
async function setAgentStatus(w,a,s){return run('UPDATE agents SET status=$1 WHERE workspace_id=$2 AND id=$3',[s,w,a])}
async function listEvents(w){return many('SELECT * FROM events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',[w])}
async function countHolderRequests(w){const today=new Date().toISOString().slice(0,10);return Number((await one("SELECT COUNT(*) AS calls FROM events WHERE workspace_id=$1 AND model_tier='holder' AND decision IN ('reserved','allowed','pending','failed') AND created_at >= $2",[w,today])).calls)}
async function reserve(agent,requestId,amount,request={}){const client=await pool.connect();try{
  await client.query('BEGIN');
  if(request.model_tier==='holder')await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[agent.workspace_id]);
  const live=(await client.query('SELECT status,daily_limit,daily_request_limit,max_tokens_per_request,approval_required FROM agents WHERE id=$1 FOR UPDATE',[agent.id])).rows[0];if(!live)throw Error('agent_not_found');
  const existing=(await client.query('SELECT * FROM events WHERE agent_id=$1 AND request_id=$2',[agent.id,requestId])).rows[0];if(existing){await client.query('COMMIT');return {existing}}
  const today=new Date().toISOString().slice(0,10);const totals=(await client.query("SELECT COALESCE(SUM(reserved),0) AS spent,COUNT(*) AS calls FROM events WHERE agent_id=$1 AND decision IN ('reserved','allowed','pending') AND created_at >= $2",[agent.id,today])).rows[0];
  const holderCalls=request.model_tier==='holder'?Number((await client.query("SELECT COUNT(*) AS calls FROM events WHERE workspace_id=$1 AND model_tier='holder' AND decision IN ('reserved','allowed','pending','failed') AND created_at >= $2",[agent.workspace_id,today])).rows[0].calls):0;
  const reason=live.status!=='active'?'agent_stopped':request.max_tokens>live.max_tokens_per_request?'token_limit_exceeded':request.model_tier==='holder'&&holderCalls>=request.holder_daily_limit?'holder_daily_limit_exceeded':Number(totals.calls)>=live.daily_request_limit?'request_limit_exceeded':Number(totals.spent)+amount>live.daily_limit?'budget_exceeded':live.approval_required&&request.messages?'approval_required':'policy_allowed';
  const decision=reason==='policy_allowed'?'reserved':reason==='approval_required'?'pending':'denied';const event={id:id(),workspace_id:agent.workspace_id,agent_id:agent.id,request_id:requestId,decision,reason,reserved:decision==='denied'?0:amount,actual:0,created_at:new Date().toISOString()};
  await client.query('INSERT INTO events(id,workspace_id,agent_id,request_id,decision,reason,reserved,actual,created_at,model_tier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[event.id,event.workspace_id,event.agent_id,requestId,decision,reason,event.reserved,0,event.created_at,request.model_tier||'standard']);
  let action_id;if(decision==='pending'){action_id=id();await client.query('INSERT INTO action_requests(id,workspace_id,agent_id,event_id,messages_json,max_tokens,status,created_at,model_tier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[action_id,event.workspace_id,agent.id,event.id,JSON.stringify(request.messages),request.max_tokens,'pending',event.created_at,request.model_tier||'standard'])}
  await client.query('COMMIT');return {event,action_id}
}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
async function listActions(w){return many('SELECT a.id,a.agent_id,a.event_id,a.messages_json,a.max_tokens,a.model_tier,a.status,a.created_at,a.decided_at,g.name AS agent_name FROM action_requests a JOIN agents g ON g.id=a.agent_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC LIMIT 100',[w])}
async function actionForAgent(agentId,actionId){return one('SELECT id,agent_id,event_id,status,result_json,created_at,decided_at FROM action_requests WHERE agent_id=$1 AND id=$2',[agentId,actionId])}
async function pendingAction(w,id){return one("SELECT id,model_tier FROM action_requests WHERE workspace_id=$1 AND id=$2 AND status='pending'",[w,id])}
async function claimAction(w,id){const client=await pool.connect();try{
  await client.query('BEGIN');
  const row=(await client.query("SELECT a.*,g.status AS agent_status,g.daily_limit,g.daily_request_limit,g.max_tokens_per_request,e.reserved AS estimate FROM action_requests a JOIN agents g ON g.id=a.agent_id JOIN events e ON e.id=a.event_id WHERE a.id=$1 AND a.workspace_id=$2 AND a.status='pending' FOR UPDATE OF g",[id,w])).rows[0];
  if(!row){await client.query('COMMIT');return null}
  const today=new Date().toISOString().slice(0,10),totals=(await client.query("SELECT COALESCE(SUM(reserved),0) spent,COUNT(*) calls FROM events WHERE agent_id=$1 AND decision IN ('reserved','allowed','pending') AND created_at >= $2",[row.agent_id,today])).rows[0],old=row.created_at.slice(0,10)<today;
  if(row.agent_status!=='active'||row.max_tokens>row.max_tokens_per_request||Number(totals.calls)+(old?1:0)>row.daily_request_limit||Number(totals.spent)+(old?row.estimate:0)>row.daily_limit||row.model_tier==='holder'&&old){await client.query('COMMIT');return null}
  const claimed=(await client.query("UPDATE action_requests SET status='processing',decided_at=$2 WHERE id=$1 AND status='pending' RETURNING *",[id,new Date().toISOString()])).rows[0]||null;
  await client.query('COMMIT');return claimed
}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
async function denyAction(w,id){const client=await pool.connect();try{await client.query('BEGIN');const action=(await client.query("UPDATE action_requests SET status='denied',decided_at=$3,messages_json='[]' WHERE id=$1 AND workspace_id=$2 AND status='pending' RETURNING event_id",[id,w,new Date().toISOString()])).rows[0];if(!action){await client.query('COMMIT');return false}await client.query("UPDATE events SET decision='denied',reason='owner_denied',reserved=0 WHERE id=$1",[action.event_id]);await client.query('COMMIT');return true}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
async function finishAction(id,status,result,actual){const client=await pool.connect();try{await client.query('BEGIN');const action=(await client.query("UPDATE action_requests SET status=$2,result_json=$3,messages_json='[]' WHERE id=$1 AND status='processing' RETURNING event_id",[id,status,JSON.stringify(result)])).rows[0];if(!action){await client.query('COMMIT');return false}await client.query('UPDATE events SET decision=$1,reason=$2,actual=$3,reserved=$4 WHERE id=$5',[status==='completed'?'allowed':'failed',status==='completed'?'provider_completed':'provider_error',actual,status==='completed'?actual:0,action.event_id]);await client.query('COMMIT');return true}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
async function settle(id,decision,reason,actual){return run('UPDATE events SET decision=$1,reason=$2,actual=$3 WHERE id=$4',[decision,reason,actual,id])}
async function createProof(w,a,kind,proof){const proofId=id();await run('INSERT INTO proofs(id,workspace_id,agent_id,kind,payload,signature,public_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[proofId,w,a,kind,JSON.stringify(proof),proof.signature,proof.public_key,new Date().toISOString()]);return proofId}
async function listProofs(w){return many('SELECT id,agent_id,kind,payload,created_at,tx_hash,chain_status,chain_signer,chain_target,chain_network FROM proofs WHERE workspace_id=$1 ORDER BY created_at DESC',[w])}
async function getProof(w,id){return one('SELECT * FROM proofs WHERE id=$1 AND workspace_id=$2',[id,w])}
async function claimProof(w,id){return run("UPDATE proofs SET chain_status='publishing' WHERE id=$1 AND workspace_id=$2 AND chain_status IS NULL AND tx_hash IS NULL",[id,w])}
async function updateProof(id,status,txHash=null,signer=null,target=null,network=null){return run('UPDATE proofs SET chain_status=$1,tx_hash=COALESCE($2,tx_hash),chain_signer=COALESCE($3,chain_signer),chain_target=COALESCE($4,chain_target),chain_network=COALESCE($5,chain_network) WHERE id=$6',[status,txHash,signer,target,network,id])}
async function agentOwned(w,a){return !!await one('SELECT id FROM agents WHERE id=$1 AND workspace_id=$2',[a,w])}
async function checkpointEvents(a){return many('SELECT id,decision,reason,reserved,actual,created_at FROM events WHERE agent_id=$1 ORDER BY created_at,id',[a])}
module.exports={pool,ensureSchema,hash,id,workspace,agentByToken,countWorkspaces,createWorkspace,createAgent,listAgents,getAgent,markMcpConnection,rotateAgentCredential,setAgentStatus,setAgentPolicy,listEvents,countHolderRequests,reserve,settle,createProof,listProofs,getProof,claimProof,updateProof,agentOwned,checkpointEvents,listActions,actionForAgent,pendingAction,claimAction,denyAction,finishAction};
async function createListing(w,a,category,description,passport){const listingId=id();await run('INSERT INTO marketplace_listings(id,workspace_id,agent_id,category,description,passport,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[listingId,w,a,category,description,JSON.stringify(passport),new Date().toISOString()]);return listingId}
async function listMarketplace(){return many("SELECT l.id,l.category,l.description,l.passport,l.created_at,a.name FROM marketplace_listings l JOIN agents a ON a.id=l.agent_id WHERE a.status='active' ORDER BY l.created_at DESC LIMIT 100")}
async function deleteListing(w,listingId){return run('DELETE FROM marketplace_listings WHERE workspace_id=$1 AND id=$2',[w,listingId])}
Object.assign(module.exports,{createListing,listMarketplace,deleteListing});
