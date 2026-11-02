const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auven-provider-'));
process.env.AUVEN_OPENAI_API_KEY = 'test-only-key';
const { handler } = require('../api-handler.cjs');

async function call(method, url, body, credential) {
  let status;
  let payload;
  await handler({ method, url, body, headers: credential ? { authorization: `Bearer ${credential}`, 'idempotency-key': randomUUID() } : {} }, {
    writeHead(code) { status = code; },
    end(text) { payload = JSON.parse(text); }
  });
  return { status, ...payload };
}

test('gateway exposes a safe provider failure category without leaking provider details', async () => {
  const workspace = await call('POST', '/api/workspaces', { name: 'Provider diagnostics' });
  const agent = await call('POST', '/api/agents', {
    name: 'Diagnostic agent', purpose: 'Check provider errors', daily_limit_cents: 1000
  }, workspace.admin_token);
  const originalFetch = global.fetch;
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [status, code, expected] of [
      [401, 'invalid_api_key', 'provider_auth_failed'],
      [429, 'insufficient_quota', 'provider_quota_exceeded'],
      [429, 'rate_limit_exceeded', 'provider_rate_limited'],
      [404, 'model_not_found', 'provider_model_unavailable']
    ]) {
      global.fetch = async () => ({
        ok: false, status,
        json: async () => ({ error: { code, message: 'private provider detail' } })
      });
      const response = await call('POST', '/api/gateway/chat', {
        messages: [{ role: 'user', content: 'Hello' }], max_tokens: 32
      }, agent.agent.credential);
      assert.equal(response.status, 502);
      assert.equal(response.error, expected);
      assert.doesNotMatch(JSON.stringify(response), /private provider detail/);
    }
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
  }
});
