const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');

const algorithm = import('@noble/post-quantum/ml-dsa.js').then(({ ml_dsa65 }) => ml_dsa65);
const dir = process.env.AUVEN_DATA_DIR || path.join(__dirname, '.data');
const keyFile = path.join(dir, 'signing-key.json');
let signingKeys;

async function keys() {
  if (!signingKeys) signingKeys = (async () => {
    const ml_dsa65 = await algorithm;
    if (process.env.AUVEN_PQ_SIGNING_SEED) {
      if (!/^[a-fA-F0-9]{64}$/.test(process.env.AUVEN_PQ_SIGNING_SEED)) throw Error('AUVEN_PQ_SIGNING_SEED must be 32-byte hex');
      return ml_dsa65.keygen(Buffer.from(process.env.AUVEN_PQ_SIGNING_SEED, 'hex'));
    }
    if (process.env.VERCEL) throw Error('AUVEN_PQ_SIGNING_SEED required on Vercel');
    if (fs.existsSync(keyFile)) {
      const stored = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      return { secretKey: Buffer.from(stored.secretKey, 'base64'), publicKey: Buffer.from(stored.publicKey, 'base64') };
    }
    fs.mkdirSync(dir, { recursive: true });
    const generated = ml_dsa65.keygen(randomBytes(32));
    fs.writeFileSync(keyFile, JSON.stringify({ secretKey: Buffer.from(generated.secretKey).toString('base64'), publicKey: Buffer.from(generated.publicKey).toString('base64') }), { mode: 0o600, flag: 'wx' });
    return generated;
  })();
  return signingKeys;
}

const canonical = value => JSON.stringify(value, Object.keys(value).sort());

async function sign(payload) {
  const [ml_dsa65, pair] = await Promise.all([algorithm, keys()]);
  const bytes = Buffer.from(canonical(payload));
  return {
    algorithm: 'ML-DSA-65', format: 'AUVEN-v1', payload,
    signature: Buffer.from(ml_dsa65.sign(bytes, pair.secretKey)).toString('base64'),
    public_key: Buffer.from(pair.publicKey).toString('base64'),
    digest: '0x' + createHash('sha256').update(bytes).digest('hex')
  };
}

async function verify(bundle) {
  if (bundle?.algorithm !== 'ML-DSA-65' || bundle?.format !== 'AUVEN-v1') return false;
  try {
    const ml_dsa65 = await algorithm;
    const bytes = Buffer.from(canonical(bundle.payload));
    return ml_dsa65.verify(Buffer.from(bundle.signature, 'base64'), bytes, Buffer.from(bundle.public_key, 'base64'))
      && bundle.digest === '0x' + createHash('sha256').update(bytes).digest('hex');
  } catch { return false; }
}

module.exports = { sign, verify };
