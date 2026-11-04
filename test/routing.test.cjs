const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const route = require('../api/route.js');

test('workspace deep links rewrite to the clean root page', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(config.cleanUrls, true);
  assert.deepEqual(config.redirects.find(item => item.source === '/workspace/discover'), {source:'/workspace/discover',destination:'/workspace/marketplace',permanent:true});
  for (const source of ['/workspace', '/workspace/:section']) {
    assert.deepEqual(config.rewrites.find(item => item.source === source), { source, destination: '/' });
  }
});

test('Vercel rewrite reaches nested auth and readiness routes', async () => {
  for (const [path, status, key] of [
    ['auth/config', 200, 'enabled'],
    ['ready', 200, 'database']
  ]) {
    let responseStatus, body;
    const req = { method: 'GET', url: '/api/route?auven_path=' + encodeURIComponent(path), headers: {} };
    const res = { writeHead(code) { responseStatus = code; }, end(text) { body = JSON.parse(text); } };
    await route(req, res);
    assert.equal(responseStatus, status);
    assert.ok(Object.hasOwn(body, key));
    assert.equal(req.url, '/api/' + path);
  }
});

test('Vercel rewrite reaches the protected MCP endpoint', async () => {
  let status, data;
  const req = {method: 'POST', url: '/api/route?auven_path=mcp', headers: {'content-type': 'application/json'}, body: {jsonrpc: '2.0', id: 1, method: 'tools/list'}};
  await route(req, {writeHead(code) { status = code; }, end(text) { data = JSON.parse(text); }});
  assert.equal(req.url, '/api/mcp');
  assert.equal(status, 401);
  assert.equal(data.error, 'invalid_agent_credential');
});
