const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('workspace URL follows the selected section and an older response cannot replace it', async () => {
  const listeners = new Map();
  const deferred = [];
  const tabs = ['overview', 'agents', 'settings'].map(page => ({ dataset: { page }, classList: { toggle() {} }, setAttribute() {} }));
  const element = () => ({ hidden: false, innerHTML: '', textContent: '', value: '', classList: { add() {}, toggle() {}, remove() {}, contains: () => false }, querySelector: () => element(), querySelectorAll: () => [], addEventListener() {}, close() {}, showModal() {} });
  const nodes = new Map();
  const select = key => {
    if (!nodes.has(key)) nodes.set(key, element());
    return nodes.get(key);
  };
  const location = { pathname: '/', search: '' };
  const history = {
    pushState(_state, _title, url) { location.pathname = url; location.search = ''; },
    replaceState(_state, _title, url) { location.pathname = url; location.search = ''; }
  };
  const context = vm.createContext({
    document: { querySelector: select, querySelectorAll: query => query === '[data-page]' ? tabs : [], createElement: () => element() },
    window: {
      scrollTo() {},
      addEventListener(name, callback) { listeners.set(name, callback); },
      auvenAuth: { ready: Promise.resolve(), accessToken: async () => null, signedIn: () => false }
    },
    sessionStorage: { getItem: () => 'test-admin-token', removeItem() {} },
    location, history, URLSearchParams, setTimeout, clearTimeout, console,
    fetch: async url => {
      if (url !== '/api/agents') throw new Error(`Unexpected request ${url}`);
      return new Promise(resolve => deferred.push(() => resolve({ ok: true, json: async () => ({ agents: [] }) })));
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist', 'app.js'), 'utf8'), context);
  vm.runInContext("openApp('settings')", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(location.pathname, '/workspace/settings');
  assert.equal(deferred.length, 1);

  vm.runInContext("render('agents')", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(location.pathname, '/workspace/agents');
  assert.equal(deferred.length, 2);
  deferred[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(select('#content').innerHTML, /<h1>Agents<\/h1>/);

  deferred[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(select('#content').innerHTML, /<h1>Agents<\/h1>/);
  assert.doesNotMatch(select('#content').innerHTML, /<h1>Profile<\/h1>/);

  vm.runInContext("home({preventDefault(){}})", context);
  assert.equal(location.pathname, '/');
  assert.equal(select('#app').hidden, true);
  assert.ok(listeners.has('popstate'));
});

test('authenticated workspace renders the selected section instead of account access', async () => {
  const element = () => ({
    hidden: false, innerHTML: '', textContent: '', value: '',
    classList: { add() {}, toggle() {}, remove() {}, contains: () => false },
    querySelector: () => element(),
    querySelectorAll: () => [], addEventListener() {}, close() {}, showModal() {}
  });
  const nodes = new Map();
  const select = key => {
    if (!nodes.has(key)) nodes.set(key, element());
    return nodes.get(key);
  };
  select('#content').querySelector = function (selector) {
    const id = selector.match(/^#([\w-]+)$/)?.[1];
    return id && this.innerHTML.includes(`id="${id}"`) ? element() : null;
  };
  const tabs = ['overview', 'agents', 'proofs', 'settings'].map(page => ({ dataset: { page }, classList: { toggle() {} }, setAttribute() {} }));
  const location = { pathname: '/', search: '' };
  const history = {
    pushState(_state, _title, url) { location.pathname = url; location.search = ''; },
    replaceState(_state, _title, url) { location.pathname = url; location.search = ''; }
  };
  const responses = {
    '/api/me': { workspace: { name: 'AUVEN Verification' }, email: 'verified@example.com', wallets: [] },
    '/api/agents': { agents: [] },
    '/api/events': { events: [] },
    '/api/proofs': { proofs: [] },
    '/api/health': { onchain: 'not_configured' }
  };
  const context = vm.createContext({
    document: { querySelector: select, querySelectorAll: query => query === '[data-page]' ? tabs : [], createElement: () => element() },
    window: { scrollTo() {}, addEventListener() {}, auvenAuth: { ready: Promise.resolve(), accessToken: async () => 'valid-test-token', signedIn: () => true } },
    sessionStorage: { getItem: () => 'test-admin-token', removeItem() {} },
    location, history, URLSearchParams, setTimeout, clearTimeout, console,
    fetch: async url => ({ ok: true, json: async () => responses[url] ?? (() => { throw Error(`Unexpected request ${url}`); })() })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist', 'app.js'), 'utf8'), context);
  for (const [page, title] of [['overview', 'Welcome to AUVEN'], ['agents', 'Agents'], ['activity', 'Activity'], ['proofs', 'Proofs'], ['settings', 'Profile']]) {
    vm.runInContext(`openApp('${page}')`, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(location.pathname, `/workspace/${page}`);
    assert.match(select('#content').innerHTML, new RegExp(`<h1>${title}<\\/h1>`));
    assert.doesNotMatch(select('#content').innerHTML, /Workspace access/);
  }
  vm.runInContext("window.auvenAuth.accessToken=async()=>null; window.auvenAuth.signedIn=()=>false; render('proofs')", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(select('#content').innerHTML, /<h1>Proofs<\/h1>/);
  vm.runInContext("render('settings')", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(select('#content').innerHTML, /<h1>Workspace access<\/h1>/);
});
