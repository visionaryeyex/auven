const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('holder requests share a daily workspace cap across agents', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auven-holder-quota-'));
  process.env.AUVEN_DATA_DIR = directory;
  const D = require('../db.cjs');
  try {
    const workspace = D.createWorkspace('Holder quota test');
    const first = D.createAgent(workspace.id, 'First', 'Test', 100000);
    const second = D.createAgent(workspace.id, 'Second', 'Test', 100000);
    const request = { max_tokens: 10, model_tier: 'holder', holder_daily_limit: 3 };
    for (let i = 0; i < 3; i++) {
      const result = D.reserve(i === 1 ? second : first, `holder-${i}`, 1, request);
      assert.equal(result.event.reason, 'policy_allowed');
    }
    const blocked = D.reserve(second, 'holder-4', 1, request);
    assert.equal(blocked.event.reason, 'holder_daily_limit_exceeded');
    const standard = D.reserve(second, 'standard-1', 1, { max_tokens: 10, model_tier: 'standard' });
    assert.equal(standard.event.reason, 'policy_allowed');
  } finally {
    D.db.close();
    delete process.env.AUVEN_DATA_DIR;
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});
