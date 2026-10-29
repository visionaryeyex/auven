const {DatabaseSync}=require('node:sqlite');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const dir=process.env.AUVEN_DATA_DIR||path.join(__dirname,'.data');fs.mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(path.join(dir,'auven.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,admin_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',daily_limit INTEGER NOT NULL,credential_hash TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(workspace_id) REFERENCES workspaces(id));
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agent_id TEXT NOT NULL,request_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,reserved INTEGER NOT NULL DEFAULT 0,actual INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(agent_id,request_id));
CREATE TABLE IF NOT EXISTS proofs(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agent_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,signature TEXT NOT NULL,public_key TEXT NOT NULL,created_at TEXT NOT NULL,tx_hash TEXT);`);
for(const [name,type] of [['chain_status','TEXT'],['chain_signer','TEXT']]){
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
function listAgents(workspaceId){return db.prepare('SELECT id,workspace_id,name,purpose,status,daily_limit,created_at FROM agents WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId)}
function setAgentStatus(workspaceId,agentId,status){return db.prepare('UPDATE agents SET status=? WHERE workspace_id=? AND id=?').run(status,workspaceId,agentId).changes}
function listEvents(workspaceId){return db.prepare('SELECT * FROM events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(workspaceId)}
function reserve(agent,requestId,amount){db.exec('BEGIN IMMEDIATE');try{const existing=db.prepare('SELECT * FROM events WHERE agent_id=? AND request_id=?').get(agent.id,requestId);if(existing){db.exec('COMMIT');return {existing}}const live=db.prepare('SELECT status,daily_limit FROM agents WHERE id=?').get(agent.id);const today=new Date().toISOString().slice(0,10);const spent=db.prepare("SELECT COALESCE(SUM(reserved),0) n FROM events WHERE agent_id=? AND decision IN ('reserved','allowed') AND created_at>=?").get(agent.id,today).n;const decision=live.status!=='active'?'denied':spent+amount>live.daily_limit?'denied':'reserved';const reason=live.status!=='active'?'agent_stopped':decision==='denied'?'budget_exceeded':'policy_allowed';const event={id:id(),workspace_id:agent.workspace_id,agent_id:agent.id,request_id:requestId,decision,reason,reserved:decision==='reserved'?amount:0,actual:0,created_at:new Date().toISOString()};db.prepare('INSERT INTO events(id,workspace_id,agent_id,request_id,decision,reason,reserved,actual,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(event.id,event.workspace_id,event.agent_id,requestId,decision,reason,event.reserved,0,event.created_at);db.exec('COMMIT');return {event}}catch(e){db.exec('ROLLBACK');throw e}}
function settle(eventId,decision,reason,actual){db.prepare('UPDATE events SET decision=?,reason=?,actual=? WHERE id=?').run(decision,reason,actual,eventId)}
function countWorkspaces(){return db.prepare('SELECT COUNT(*) n FROM workspaces').get().n}
function createProof(workspaceId,agentId,kind,proof){const proofId=id();db.prepare('INSERT INTO proofs(id,workspace_id,agent_id,kind,payload,signature,public_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(proofId,workspaceId,agentId,kind,JSON.stringify(proof),proof.signature,proof.public_key,new Date().toISOString());return proofId}
function listProofs(workspaceId){return db.prepare('SELECT id,agent_id,kind,payload,created_at,tx_hash,chain_status,chain_signer FROM proofs WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId)}
function getProof(workspaceId,proofId){return db.prepare('SELECT * FROM proofs WHERE id=? AND workspace_id=?').get(proofId,workspaceId)}
function claimProof(workspaceId,proofId){return db.prepare("UPDATE proofs SET chain_status='publishing' WHERE id=? AND workspace_id=? AND chain_status IS NULL AND tx_hash IS NULL").run(proofId,workspaceId).changes}
function updateProof(proofId,status,txHash=null,signer=null){db.prepare('UPDATE proofs SET chain_status=?,tx_hash=COALESCE(?,tx_hash),chain_signer=COALESCE(?,chain_signer) WHERE id=?').run(status,txHash,signer,proofId)}
function agentOwned(workspaceId,agentId){return !!db.prepare('SELECT id FROM agents WHERE id=? AND workspace_id=?').get(agentId,workspaceId)}
function checkpointEvents(agentId){return db.prepare('SELECT id,decision,reason,reserved,actual,created_at FROM events WHERE agent_id=? ORDER BY created_at,id').all(agentId)}
module.exports={db,dir,hash,workspace,agentByToken,createWorkspace,createAgent,listAgents,setAgentStatus,listEvents,reserve,settle,id,countWorkspaces,createProof,listProofs,getProof,claimProof,updateProof,agentOwned,checkpointEvents};
