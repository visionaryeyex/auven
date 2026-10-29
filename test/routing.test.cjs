const { test } = require('node:test');
const assert = require('node:assert/strict');
const route = require('../api/route.js');

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
