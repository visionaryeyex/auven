const {DatabaseSync}=require('node:sqlite');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const dir=process.env.AUVEN_DATA_DIR||path.join(__dirname,'.data');fs.mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'auven.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,admin_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',daily_limit INTEGER NOT NULL,credential_hash TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(workspace_id) REFERENCES workspaces(id));
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agent_id TEXT NOT NULL,request_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,reserved INTEGER NOT NULL DEFAULT 0,actual INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(agent_id,request_id));
CREATE TABLE IF NOT EXISTS action_requests(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agent_id TEXT NOT NULL,event_id TEXT NOT NULL UNIQUE,messages_json TEXT NOT NULL,max_tokens INTEGER NOT NULL,status TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL,decided_at TEXT);
CREATE TABLE IF NOT EXISTS proofs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agent_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,signature TEXT NOT NULL,public_key TEXT NOT NULL,created_at TEXT NOT NULL,tx_hash TEXT);`);
for(const [name,type] of [['daily_request_limit','INTEGER NOT NULL DEFAULT 100'],['max_tokens_per_request','INTEGER NOT NULL DEFAULT 4096'],['approval_required','INTEGER NOT NULL DEFAULT 0'],['mcp_last_seen','TEXT']]){
  if(!db.prepare('PRAGMA table_info(agents)').all().some(c=>c.name===name))db.exec(`ALTER TABLE agents ADD COLUMN ${name} ${type}`);
}
for(const [name,type] of [['chain_status','TEXT'],['chain_signer','TEXT'],['chain_target','TEXT'],['chain_network',"TEXT NOT NULL DEFAULT 'robinhood'"]]){
  if(!db.prepare('PRAGMA table_info(proofs)').all().some(c=>c.name===name))db.exec(`ALTER TABLE proofs ADD COLUMN ${name} ${type}`);
}
const hash=s=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const id=()=>randomBytes(16).toString('hex');
function eq(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
function workspace(token){if(!token)return null;const h=hash(token);return db.prepare('SELECT id,name FROM workspaces WHERE admin_hash=?').get(h)||null}
function agentByToken(token){if(!token)return null;return db.prepare('SELECT * FROM agents WHERE credential_hash=?').get(hash(token))||null}
function createWorkspace(name){const token=secret(),row={id:id(),name};db.prepare('INSERT INTO workspaces(id,name,admin_hash) VALUES(?,?,?)').run(row.id,name,hash(token));return {...row,admin_token:token}}
function createAgent(workspaceId,name,purpose,dailyLimit){const token=secret(),row={id:id(),workspace_id:workspaceId,name,purpose,status:'active',daily_limit:dailyLimit,created_at:new Date().toISOString()};db.prepare('INSERT INTO agents(id,workspace_id,name,purpose,status,daily_limit,credential_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(row.id,workspaceId,name,purpose,row.status,dailyLimit,hash(token),row.created_at);return {...row,credential:token}}
function listAgents(workspaceId){return db.prepare('SELECT a.id,a.workspace_id,a.name,a.purpose,a.status,a.daily_limit,a.daily_request_limit,a.max_tokens_per_request,a.approval_required,a.mcp_last_seen,a.created_at,EXISTS(SELECT 1 FROM events e WHERE e.agent_id=a.id) AS has_gateway_activity FROM agents a WHERE a.workspace_id=? ORDER BY a.created_at DESC').all(workspaceId)}
function markMcpConnection(agentId){const seen=new Date().toISOString();db.prepare('UPDATE agents SET mcp_last_seen=? WHERE id=?').run(seen,agentId);return seen}
function rotateAgentCredential(workspaceId,agentId){const token=secret();return db.prepare('UPDATE agents SET credential_hash=?,mcp_last_seen=NULL WHERE workspace_id=? AND id=?').run(hash(token),workspaceId,agentId).changes?token:null}
function setAgentPolicy(workspaceId,agentId,policy){return db.prepare('UPDATE agents SET daily_limit=?,daily_request_limit=?,max_tokens_per_request=?,approval_required=? WHERE workspace_id=? AND id=?').run(policy.daily_limit_cents,policy.daily_request_limit,policy.max_tokens_per_request,policy.approval_required?1:0,workspaceId,agentId).changes}
function setAgentStatus(workspaceId,agentId,status){return db.prepare('UPDATE agents SET status=? WHERE workspace_id=? AND id=?').run(status,workspaceId,agentId).changes}
function listEvents(workspaceId){return db.prepare('SELECT * FROM events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId)}
function reserve(agent,requestId,amount,request={}){db.exec('BEGIN IMMEDIATE');try{
  const existing=db.prepare('SELECT * FROM events WHERE agent_id=? AND request_id=?').get(agent.id,requestId);if(existing){db.exec('COMMIT');return {existing}}
  const live=db.prepare('SELECT status,daily_limit,daily_request_limit,max_tokens_per_request,approval_required FROM agents WHERE id=?').get(agent.id);
  const today=new Date().toISOString().slice(0,10);
  const totals=db.prepare("SELECT COALESCE(SUM(reserved),0) spent,COUNT(*) calls FROM events WHERE agent_id=? AND decision IN ('reserved','allowed','pending') AND created_at>=?").get(agent.id,today);
  const reason=live.status!=='active'?'agent_stopped':request.max_tokens>live.max_tokens_per_request?'token_limit_exceeded':totals.calls>=live.daily_request_limit?'request_limit_exceeded':totals.spent+amount>live.daily_limit?'budget_exceeded':live.approval_required&&request.messages?'approval_required':'policy_allowed';
  const decision=reason==='policy_allowed'?'reserved':reason==='approval_required'?'pending':'denied';
  const event={id:id(),workspace_id:agent.workspace_id,agent_id:agent.id,request_id:requestId,decision,reason,reserved:decision==='denied'?0:amount,actual:0,created_at:new Date().toISOString()};
  db.prepare('INSERT INTO events(id,workspace_id,agent_id,request_id,decision,reason,reserved,actual,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(event.id,event.workspace_id,event.agent_id,requestId,decision,reason,event.reserved,0,event.created_at);
  let action_id;
  if(decision==='pending'){action_id=id();db.prepare('INSERT INTO action_requests(id,workspace_id,agent_id,event_id,messages_json,max_tokens,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(action_id,event.workspace_id,agent.id,event.id,JSON.stringify(request.messages),request.max_tokens,'pending',event.created_at)}
  db.exec('COMMIT');return {event,action_id}
}catch(e){db.exec('ROLLBACK');throw e}}
function listActions(workspaceId){return db.prepare("SELECT a.id,a.agent_id,a.event_id,a.messages_json,a.max_tokens,a.status,a.created_at,a.decided_at,g.name AS agent_name FROM action_requests a JOIN agents g ON g.id=a.agent_id WHERE a.workspace_id=? ORDER BY a.created_at DESC LIMIT 100").all(workspaceId)}
function actionForAgent(agentId,actionId){return db.prepare('SELECT id,agent_id,event_id,status,result_json,created_at,decided_at FROM action_requests WHERE agent_id=? AND id=?').get(agentId,actionId)||null}
function claimAction(workspaceId,actionId){db.exec('BEGIN IMMEDIATE');try{
  const row=db.prepare("SELECT a.*,g.status AS agent_status,g.daily_limit,g.daily_request_limit,g.max_tokens_per_request,e.reserved AS estimate FROM action_requests a JOIN agents g ON g.id=a.agent_id JOIN events e ON e.id=a.event_id WHERE a.id=? AND a.workspace_id=? AND a.status='pending'").get(actionId,workspaceId);
  if(!row){db.exec('COMMIT');return null}
  const today=new Date().toISOString().slice(0,10),totals=db.prepare("SELECT COALESCE(SUM(reserved),0) spent,COUNT(*) calls FROM events WHERE agent_id=? AND decision IN ('reserved','allowed','pending') AND created_at>=?").get(row.agent_id,today);
  const old=row.created_at.slice(0,10)<today;
  if(row.agent_status!=='active'||row.max_tokens>row.max_tokens_per_request||Number(totals.calls)+(old?1:0)>row.daily_request_limit||Number(totals.spent)+(old?row.estimate:0)>row.daily_limit){db.exec('COMMIT');return null}
  db.prepare("UPDATE action_requests SET status='processing',decided_at=? WHERE id=?").run(new Date().toISOString(),actionId);
  db.exec('COMMIT');return row
}catch(e){db.exec('ROLLBACK');throw e}}
function denyAction(workspaceId,actionId){db.exec('BEGIN IMMEDIATE');try{const action=db.prepare("SELECT * FROM action_requests WHERE id=? AND workspace_id=? AND status='pending'").get(actionId,workspaceId);if(!action){db.exec('COMMIT');return false}db.prepare("UPDATE action_requests SET status='denied',decided_at=?,messages_json='[]' WHERE id=?").run(new Date().toISOString(),actionId);db.prepare("UPDATE events SET decision='denied',reason='owner_denied',reserved=0 WHERE id=?").run(action.event_id);db.exec('COMMIT');return true}catch(e){db.exec('ROLLBACK');throw e}}
function finishAction(actionId,status,result,actual){db.exec('BEGIN IMMEDIATE');try{const action=db.prepare("SELECT event_id FROM action_requests WHERE id=? AND status='processing'").get(actionId);if(!action){db.exec('COMMIT');return false}db.prepare('UPDATE action_requests SET status=?,result_json=?,messages_json=? WHERE id=?').run(status,JSON.stringify(result),'[]',actionId);db.prepare('UPDATE events SET decision=?,reason=?,actual=?,reserved=? WHERE id=?').run(status==='completed'?'allowed':'failed',status==='completed'?'provider_completed':'provider_error',actual,status==='completed'?actual:0,action.event_id);db.exec('COMMIT');return true}catch(e){db.exec('ROLLBACK');throw e}}
function settle(eventId,decision,reason,actual){db.prepare('UPDATE events SET decision=?,reason=?,actual=? WHERE id=?').run(decision,reason,actual,eventId)}
function countWorkspaces(){return db.prepare('SELECT COUNT(*) n FROM workspaces').get().n}
function createProof(workspaceId,agentId,kind,proof){const proofId=id();db.prepare('INSERT INTO proofs(id,workspace_id,agent_id,kind,payload,signature,public_key,created_at,chain_network) VALUES(?,?,?,?,?,?,?,?,?)').run(proofId,workspaceId,agentId,kind,JSON.stringify(proof),proof.signature,proof.public_key,new Date().toISOString(),'solana');return proofId}
function listProofs(workspaceId){return db.prepare('SELECT id,agent_id,kind,payload,created_at,tx_hash,chain_status,chain_signer,chain_target,chain_network FROM proofs WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId)}
function getProof(workspaceId,proofId){return db.prepare('SELECT * FROM proofs WHERE id=? AND workspace_id=?').get(proofId,workspaceId)}
function claimProof(workspaceId,proofId){return db.prepare("UPDATE proofs SET chain_status='publishing' WHERE id=? AND workspace_id=? AND chain_status IS NULL AND tx_hash IS NULL").run(proofId,workspaceId).changes}
function updateProof(proofId,status,txHash=null,signer=null,target=null,network=null){db.prepare('UPDATE proofs SET chain_status=?,tx_hash=COALESCE(?,tx_hash),chain_signer=COALESCE(?,chain_signer),chain_target=COALESCE(?,chain_target),chain_network=COALESCE(?,chain_network) WHERE id=?').run(status,txHash,signer,target,network,proofId)}
function agentOwned(workspaceId,agentId){return !!db.prepare('SELECT id FROM agents WHERE id=? AND workspace_id=?').get(agentId,workspaceId)}
function checkpointEvents(agentId){return db.prepare('SELECT id,decision,reason,reserved,actual,created_at FROM events WHERE agent_id=? ORDER BY created_at,id').all(agentId)}
module.exports={db,dir,hash,workspace,agentByToken,createWorkspace,createAgent,listAgents,markMcpConnection,rotateAgentCredential,setAgentStatus,setAgentPolicy,listEvents,reserve,settle,id,countWorkspaces,createProof,listProofs,getProof,claimProof,updateProof,agentOwned,checkpointEvents,listActions,actionForAgent,claimAction,denyAction,finishAction};
