const fs=require('node:fs'),path=require('node:path');
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required');process.exit(1)}
const {pool}=require('../db-postgres.cjs');
(async()=>{const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8').replace(/^\uFEFF/,'');await pool.query(sql);console.log('AUVEN PostgreSQL schema ready');await pool.end()})().catch(async e=>{console.error('Migration failed:',e.message);await pool.end();process.exitCode=1});
