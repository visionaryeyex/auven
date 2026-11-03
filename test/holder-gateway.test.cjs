const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.AUVEN_OPENAI_API_KEY = 'test-only-key';
process.env.AUVEN_PRIVY_APP_ID = 'test-app';
process.env.AUVEN_PRIVY_APP_SECRET = 'test-secret';
process.env.AUVEN_HOLDER_MIN_TOKENS = '10';
process.env.AUVEN_HOLDER_MODEL = 'approved-holder-model';
process.env.AUVEN_HOLDER_ESTIMATE_MULTIPLIER = '2';
const D = require('../db-postgres.cjs');
const Accounts = require('../db-accounts.cjs');
const Auth = require('../auth.cjs');
const Token = require('../token.cjs');
const { handler } = require('../api-handler.cjs');

async function call(method, url, body, credential = 'agent-credential', headers = {}) {
  let status, output;
  await handler({ method, url, headers: { authorization: 'Bearer ' + credential, ...headers }, body }, {
    writeHead(code) { status = code; },
    end(text) { output = JSON.parse(text); }
  });
  return { httpStatus: status, ...output };
}

test('holder route checks linked wallet and onchain balance before the provider, including approval', async () => {
  const original = {
    ensureSchema: D.ensureSchema, agentByToken: D.agentByToken, workspace: D.workspace,
    reserve: D.reserve, settle: D.settle, pendingAction: D.pendingAction, claimAction: D.claimAction,
    finishAction: D.finishAction, privyIdsForWorkspace: Accounts.privyIdsForWorkspace,
    walletsForUser: Auth.walletsForUser, readWallets: Token.readWallets, fetch: global.fetch
  };
  let balance = '0', providerCalls = 0, reservations = 0;
  D.ensureSchema = async () => {};
  D.agentByToken = async () => ({ id: 'agent-1', workspace_id: 'workspace-1', kind: 'external' });
  D.workspace = async () => ({ id: 'workspace-1' });
  Accounts.privyIdsForWorkspace = async () => ['did:privy:owner'];
  Auth.walletsForUser = async () => ['verified-wallet'];
  Token.readWallets = async wallets => { assert.deepEqual(wallets, ['verified-wallet']); return { total_balance_raw: balance, total_balance: '10', decimals: 6 }; };
  D.reserve = async (_agent, _id, _amount, request) => { reservations++; assert.equal(request.model_tier, 'holder'); return { event: { id: 'event-1', decision: 'reserved' } }; };
  D.settle = async () => {};
  D.pendingAction = async () => ({ id: 'action-1', model_tier: 'holder' });
  D.claimAction = async () => ({ id: 'action-1', event_id: 'event-1', max_tokens: 100, messages_json: '[{"role":"user","content":"Hi"}]' });
  D.finishAction = async () => {};
  global.fetch = async (_url, options) => { providerCalls++; assert.equal(JSON.parse(options.body).model, 'approved-holder-model'); return { ok: true, json: async () => ({ usage: { total_tokens: 20 }, choices: [{ message: { content: 'OK' } }] }) }; };
  try {
    const body = { messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, model_tier: 'holder', wallet: 'spoofed-wallet' };
    const denied = await call('POST', '/api/gateway/chat', body, 'agent-credential', { 'idempotency-key': 'holder-request-001' });
    assert.equal(denied.httpStatus, 403);
    assert.equal(denied.error, 'holder_balance_required');
    assert.equal(reservations, 0);
    assert.equal(providerCalls, 0);
    balance = '10000000';
    const allowed = await call('POST', '/api/gateway/chat', body, 'agent-credential', { 'idempotency-key': 'holder-request-002' });
    assert.equal(allowed.httpStatus, 200);
    assert.equal(allowed.model_tier, 'holder');
    assert.equal(providerCalls, 1);
    balance = '0';
    const approvalDenied = await call('POST', '/api/actions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/decision', { decision: 'approve' }, 'admin-token');
    assert.equal(approvalDenied.httpStatus, 403);
    assert.equal(providerCalls, 1);
    balance = '10000000';
    const approved = await call('POST', '/api/actions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/decision', { decision: 'approve' }, 'admin-token');
    assert.equal(approved.httpStatus, 200);
    assert.equal(providerCalls, 2);
  } finally {
    Object.assign(D, Object.fromEntries(Object.entries(original).filter(([key]) => ['ensureSchema','agentByToken','workspace','reserve','settle','pendingAction','claimAction','finishAction'].includes(key))));
    Accounts.privyIdsForWorkspace = original.privyIdsForWorkspace;
    Auth.walletsForUser = original.walletsForUser;
    Token.readWallets = original.readWallets;
    global.fetch = original.fetch;
    await D.pool.end();
  }
});
