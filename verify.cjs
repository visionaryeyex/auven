const fs = require('node:fs');
const { createHash } = require('node:crypto');
const Solana = require('./solana.cjs');
const Legacy = require('./chain.cjs');

async function main() {
  const [file, tx, publisher, registry] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: node verify.cjs proof.json [transaction-signature] [trusted-publisher] [legacy-registry-address]');
    process.exitCode = 2;
    return;
  }
  try {
    const { ml_dsa65 } = await import('@noble/post-quantum/ml-dsa.js');
    const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (proof.algorithm !== 'ML-DSA-65' || proof.format !== 'AUVEN-v1') throw Error('unsupported_format');
    const bytes = Buffer.from(JSON.stringify(proof.payload, Object.keys(proof.payload).sort()));
    const digest = '0x' + createHash('sha256').update(bytes).digest('hex');
    if (digest !== proof.digest || !ml_dsa65.verify(Buffer.from(proof.signature, 'base64'), bytes, Buffer.from(proof.public_key, 'base64'))) throw Error('invalid_signature');
    if (tx && !publisher) throw Error('trusted_publisher_required');
    const inclusion = tx
      ? /^0x[0-9a-fA-F]{64}$/.test(tx)
        ? await Legacy.verifyInclusion(proof, tx, { expectedSigner: publisher, expectedTarget: registry || publisher })
        : await Solana.verifyInclusion(proof, tx, { expectedSigner: publisher })
      : { included: false, reason: 'transaction_not_provided' };
    console.log(JSON.stringify({ signature_valid: true, onchain: inclusion, meaning: 'Signature, trusted publisher, and onchain inclusion are separate checks.' }));
    if (tx && !inclusion.included) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ signature_valid: false, error: error.message }));
    process.exitCode = 1;
  }
}

main();
