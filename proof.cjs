const fs=require('node:fs'),path=require('node:path');const {randomBytes,createHash}=require('node:crypto');const {ml_dsa65}=require('@noble/post-quantum/ml-dsa.js');
const dir=process.env.AUVEN_DATA_DIR||path.join(__dirname,'.data');
const keyFile=path.join(dir,'signing-key.json');let keys;
if(process.env.AUVEN_PQ_SIGNING_SEED){if(!/^[a-fA-F0-9]{64}$/.test(process.env.AUVEN_PQ_SIGNING_SEED))throw Error('AUVEN_PQ_SIGNING_SEED must be 32-byte hex');keys=ml_dsa65.keygen(Buffer.from(process.env.AUVEN_PQ_SIGNING_SEED,'hex'))}
else if(process.env.VERCEL)throw Error('AUVEN_PQ_SIGNING_SEED required on Vercel');
else if(fs.existsSync(keyFile)){const k=JSON.parse(fs.readFileSync(keyFile,'utf8'));keys={secretKey:Buffer.from(k.secretKey,'base64'),publicKey:Buffer.from(k.publicKey,'base64')}}
else{fs.mkdirSync(dir,{recursive:true});keys=ml_dsa65.keygen(randomBytes(32));fs.writeFileSync(keyFile,JSON.stringify({secretKey:Buffer.from(keys.secretKey).toString('base64'),publicKey:Buffer.from(keys.publicKey).toString('base64')}),{mode:0o600,flag:'wx'})}
const canonical=x=>JSON.stringify(x,Object.keys(x).sort());
function sign(payload){const bytes=Buffer.from(canonical(payload));return {algorithm:'ML-DSA-65',format:'AUVEN-v1',payload,signature:Buffer.from(ml_dsa65.sign(bytes,keys.secretKey)).toString('base64'),public_key:Buffer.from(keys.publicKey).toString('base64'),digest:'0x'+createHash('sha256').update(bytes).digest('hex')}}
function verify(bundle){if(bundle?.algorithm!=='ML-DSA-65'||bundle?.format!=='AUVEN-v1')return false;try{return ml_dsa65.verify(Buffer.from(bundle.signature,'base64'),Buffer.from(canonical(bundle.payload)),Buffer.from(bundle.public_key,'base64'))&&bundle.digest==='0x'+createHash('sha256').update(canonical(bundle.payload)).digest('hex')}catch{return false}}
module.exports={sign,verify};
