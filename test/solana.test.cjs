const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair, Transaction, PublicKey } = require('@solana/web3.js');
const Solana = require('../solana.cjs');
const Token = require('../token.cjs');

test('publishes only a proof commitment with the dedicated signer', async () => {
  const signer = Keypair.generate();
  const proof = { payload: { id: 'one' }, signature: 'signed' };
  const originalRpc = process.env.AUVEN_SOLANA_RPC_URL;
  process.env.AUVEN_SOLANA_RPC_URL = 'https://example.invalid';
  let sent;
  const connection = {
    getGenesisHash: async () => Token.GENESIS,
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111' }),
    sendRawTransaction: async bytes => { sent = Transaction.from(bytes); return '3'.repeat(87); }
  };
  try {
    const result = await Solana.publish(proof, { connection, key: JSON.stringify([...signer.secretKey]) });
    assert.equal(result.network, 'solana');
    assert.equal(result.signer, signer.publicKey.toBase58());
    assert.equal(sent.instructions.length, 1);
    assert.equal(sent.instructions[0].programId.toBase58(), Solana.MEMO_PROGRAM);
    assert.equal(sent.instructions[0].data.toString(), Solana.memo(proof));
    assert.equal(sent.instructions[0].keys[0].pubkey.toBase58(), result.signer);
  } finally {
    if (originalRpc === undefined) delete process.env.AUVEN_SOLANA_RPC_URL;
    else process.env.AUVEN_SOLANA_RPC_URL = originalRpc;
  }
});

test('inclusion checks trusted signer, memo, execution, and network', async () => {
  const signer = Keypair.generate().publicKey.toBase58();
  const proof = { payload: { id: 'one' }, signature: 'signed' };
  const signature = '3'.repeat(87);
  const tx = { slot: 42, meta: { err: null }, transaction: { message: { accountKeys: [{ signer: true, pubkey: new PublicKey(signer) }], instructions: [{ programId: new PublicKey(Solana.MEMO_PROGRAM), parsed: Solana.memo(proof) }] } } };
  const connection = { getGenesisHash: async () => Token.GENESIS, getParsedTransaction: async () => tx };
  assert.equal((await Solana.verifyInclusion(proof, signature, { connection, expectedSigner: signer })).included, true);
  assert.equal((await Solana.verifyInclusion({ ...proof, signature: 'changed' }, signature, { connection, expectedSigner: signer })).reason, 'commitment_mismatch');
  assert.equal((await Solana.verifyInclusion(proof, signature, { connection: { ...connection, getParsedTransaction: async () => ({ ...tx, meta: { err: 'failed' } }) }, expectedSigner: signer })).reason, 'transaction_failed');
  assert.equal((await Solana.verifyInclusion(proof, signature, { connection, expectedSigner: Keypair.generate().publicKey.toBase58() })).reason, 'unexpected_signer');
  await assert.rejects(Solana.verifyInclusion(proof, signature, { connection: { ...connection, getGenesisHash: async () => 'wrong' }, expectedSigner: signer }), /wrong_chain/);
});
