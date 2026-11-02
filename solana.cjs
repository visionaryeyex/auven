const { createHash } = require('node:crypto');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const { GENESIS, RPC_URL, address } = require('./token.cjs');

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MEMO_ID = new PublicKey(MEMO_PROGRAM);
const explorer = signature => `https://explorer.solana.com/tx/${signature}`;
const commitment = bundle => {
  if (!bundle || typeof bundle !== 'object') throw Error('invalid_proof');
  return '0x' + createHash('sha256').update(Buffer.from('AUVEN-PROOF-v1\0' + JSON.stringify(bundle))).digest('hex');
};
const memo = bundle => `AUVEN1:${commitment(bundle).slice(2)}`;
function signerFromSecret(secret = process.env.AUVEN_SOLANA_SECRET_KEY) {
  let bytes;
  try { bytes = JSON.parse(secret); } catch { throw Error('invalid_solana_secret_key'); }
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw Error('invalid_solana_secret_key');
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
function config() {
  return { configured: Boolean(process.env.AUVEN_SOLANA_SECRET_KEY && process.env.AUVEN_SOLANA_RPC_URL), network: 'solana', mode: 'memo', program: MEMO_PROGRAM };
}
async function assertNetwork(connection) {
  if (await connection.getGenesisHash() !== GENESIS) throw Error('wrong_chain');
}
async function publish(bundle, { connection = new Connection(RPC_URL, 'confirmed'), key = process.env.AUVEN_SOLANA_SECRET_KEY } = {}) {
  if (!key || !process.env.AUVEN_SOLANA_RPC_URL) throw Error('chain_signer_not_configured');
  await assertNetwork(connection);
  const signer = signerFromSecret(key);
  const latest = await connection.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: latest.blockhash });
  tx.add(new TransactionInstruction({ programId: MEMO_ID, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo(bundle), 'utf8') }));
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  return { tx_hash: signature, signer: signer.publicKey.toBase58(), target: MEMO_PROGRAM, commitment: commitment(bundle), network: 'solana', status: 'pending' };
}
async function verifyInclusion(bundle, signature, { connection = new Connection(RPC_URL, 'finalized'), expectedSigner, expectedTarget = MEMO_PROGRAM } = {}) {
  if (typeof signature !== 'string' || signature.length < 80 || signature.length > 90) return { included: false, reason: 'invalid_transaction_signature' };
  address(expectedSigner);
  if (expectedTarget !== MEMO_PROGRAM) return { included: false, reason: 'unexpected_recipient' };
  await assertNetwork(connection);
  const tx = await connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!tx) return { included: false, reason: 'pending_or_missing' };
  if (tx.meta?.err) return { included: false, reason: 'transaction_failed' };
  const keys = tx.transaction.message.accountKeys;
  if (!keys.some(key => key.signer && key.pubkey.toBase58() === expectedSigner)) return { included: false, reason: 'unexpected_signer' };
  const matched = tx.transaction.message.instructions.some(ix =>
    ix.programId.toBase58() === MEMO_PROGRAM && (typeof ix.parsed === 'string' ? ix.parsed : null) === memo(bundle)
  );
  if (!matched) return { included: false, reason: 'commitment_mismatch' };
  return { included: true, network: 'solana', slot: tx.slot, tx_hash: signature, signer: expectedSigner, target: MEMO_PROGRAM, commitment: commitment(bundle) };
}
module.exports = { MEMO_PROGRAM, config, commitment, memo, signerFromSecret, assertNetwork, publish, verifyInclusion, explorer };
